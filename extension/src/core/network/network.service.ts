// ─── Unified Network Transport Service ───

import { NetworkPacket, PacketType, PeerIdentity, createPacket } from './packet';
import { TopologyService, TopologyState } from './topology.service';
import { ReliableTransport, DeliveryReceipt, TransportAckPayload } from './reliable-transport';
import { NetworkEnvelope, createEnvelope, envelopeToPacket, inferDeliveryClass } from './envelope';

export class NetworkService {
  private static instance: NetworkService | null = null;
  private topology: TopologyService;
  private reliableTransport: ReliableTransport;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId = '';
  private packetHandlers: Map<PacketType, Set<(packet: NetworkPacket) => void>> = new Map();
  private allPacketHandlers: Set<(packet: NetworkPacket) => void> = new Set();

  private constructor() {
    this.topology = TopologyService.getInstance();
    this.reliableTransport = ReliableTransport.getInstance();

    // Bind reliable transport sender to topology broadcast / direct send
    this.reliableTransport.bindSender((env: NetworkEnvelope) => {
      const pkt = envelopeToPacket(env);
      if (env.targetPeerId) {
        this.topology.sendPacket(env.targetPeerId, pkt);
      } else {
        this.topology.broadcastPacket(pkt);
      }
    });

    // Listen to incoming packets from P2P topology
    this.topology.onPacket((packet) => {
      this.dispatchPacket(packet);
    });
  }

  public static getInstance(): NetworkService {
    if (!NetworkService.instance) {
      NetworkService.instance = new NetworkService();
    }
    return NetworkService.instance;
  }

  public init(identity: PeerIdentity, roomId: string) {
    this.myIdentity = identity;
    this.currentRoomId = roomId;

    // Initialize P2P topology network exclusively
    this.topology.init(identity, roomId);
  }

  public leave() {
    this.reliableTransport.clear();
    this.topology.leave();
    this.currentRoomId = '';
  }

  public broadcast<T = unknown>(
    type: PacketType,
    payload: T,
    options?: { channelPriority?: 'control' | 'bulk'; seq?: number; lamportTime?: number }
  ): NetworkPacket | null {
    if (!this.myIdentity || !this.currentRoomId) return null;

    const packet = createPacket(type, this.myIdentity, this.currentRoomId, payload, undefined, options);

    // Send across P2P topology
    this.topology.broadcastPacket(packet);

    return packet;
  }

  public send<T = unknown>(
    targetPeerId: string,
    type: PacketType,
    payload: T,
    options?: { channelPriority?: 'control' | 'bulk'; seq?: number; lamportTime?: number }
  ): NetworkPacket | null {
    if (!this.myIdentity || !this.currentRoomId) return null;

    const packet = createPacket(type, this.myIdentity, this.currentRoomId, payload, targetPeerId, options);

    // Send to target peer via topology
    this.topology.sendPacket(targetPeerId, packet);

    return packet;
  }

  public async sendReliable<T = unknown>(
    targetPeerId: string | undefined,
    type: PacketType | string,
    payload: T,
    options?: { seq?: number; lamportTime?: number; maxAttempts?: number }
  ): Promise<DeliveryReceipt> {
    if (!this.myIdentity || !this.currentRoomId) {
      throw new Error('[NetworkService] Cannot send reliable packet: uninitialized');
    }

    const envelope = createEnvelope({
      type,
      from: this.myIdentity,
      roomId: this.currentRoomId,
      targetPeerId,
      payload,
      seq: options?.seq,
      lamport: options?.lamportTime,
    });

    return this.reliableTransport.sendReliable(envelope, options?.maxAttempts);
  }

  public on<T = unknown>(type: PacketType, handler: (payload: T, packet: NetworkPacket) => void): () => void {
    if (!this.packetHandlers.has(type)) {
      this.packetHandlers.set(type, new Set());
    }

    const wrapper = (packet: NetworkPacket) => {
      handler(packet.payload as T, packet);
    };

    this.packetHandlers.get(type)!.add(wrapper);
    return () => {
      this.packetHandlers.get(type)?.delete(wrapper);
    };
  }

  public onAny(handler: (packet: NetworkPacket) => void): () => void {
    this.allPacketHandlers.add(handler);
    return () => {
      this.allPacketHandlers.delete(handler);
    };
  }

  public onTopologyChange(handler: (state: TopologyState) => void): () => void {
    return this.topology.onStateChange(handler);
  }

  public getTopologyState(): TopologyState {
    return this.topology.getState();
  }

  private dispatchPacket(packet: NetworkPacket) {
    // 1. Deduplication check via ReliableTransport
    if (!this.reliableTransport.filterDuplicate(packet.id)) {
      return; // Drop duplicate packet
    }

    // 2. Intercept ACK packets for reliable transport
    if (packet.type === ('transport:ack' as any) || packet.type === ('transport:nack' as any)) {
      this.reliableTransport.handleAck(packet.payload as TransportAckPayload, packet.from.peerId);
      return;
    }

    // 3. Auto-reply ACK for directed reliable packets
    if (packet.to && this.myIdentity && packet.to === this.myIdentity.peerId) {
      const deliveryClass = inferDeliveryClass(packet.type);
      if (deliveryClass === 'reliable' || deliveryClass === 'durable') {
        const ackPacket = createPacket(
          'transport:ack' as any,
          this.myIdentity,
          this.currentRoomId,
          { messageId: packet.id, status: 'ack' } as TransportAckPayload,
          packet.from.peerId
        );
        this.topology.sendPacket(packet.from.peerId, ackPacket);
      }
    }

    // 4. Dispatch to registered type handlers
    const handlers = this.packetHandlers.get(packet.type);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(packet);
        } catch (err) {
          console.error(`[NetworkService] Handler error for ${packet.type}:`, err);
        }
      });
    }

    // 5. Global handlers
    this.allPacketHandlers.forEach((fn) => {
      try {
        fn(packet);
      } catch (err) {
        console.error('[NetworkService] Global packet handler error:', err);
      }
    });
  }
}
