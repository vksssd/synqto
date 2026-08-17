// ─── Unified Network Transport Service ───

import { NetworkPacket, PacketType, PeerIdentity, createPacket } from './packet';
import { TopologyService, TopologyState } from './topology.service';
import { DeliveryReceipt } from './reliable-transport';
import { TransportRouter } from '../transport/transport-router';
import { PacketPipeline } from './packet-pipeline';

export class NetworkService {
  private static instance: NetworkService | null = null;
  private topology: TopologyService;
  public readonly transportRouter: TransportRouter;
  public readonly packetPipeline: PacketPipeline;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId = '';
  private packetHandlers: Map<PacketType, Set<(packet: NetworkPacket) => void>> = new Map();
  private allPacketHandlers: Set<(packet: NetworkPacket) => void> = new Set();

  private constructor() {
    this.transportRouter = new TransportRouter();
    this.packetPipeline = new PacketPipeline(this.transportRouter);
    this.topology = TopologyService.getInstance();

    // Bind TransportRouter to low-level P2P physical transport
    this.transportRouter.bindP2PSender((packet, targetPeerId) => {
      return this.topology.sendP2PPacket(packet, targetPeerId);
    });

    // Deliver ordered & reassembled packets from PacketPipeline to application features
    this.packetPipeline.onDeliver((packet) => {
      this.dispatchPacket(packet);
    });

    // Keep TransportRouter's active view in sync with TopologyService state changes
    this.topology.onStateChange(() => {
      this.transportRouter.updateView(this.topology.getActiveView());
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

    // Initialize P2P topology network and bind authoritative route resolver
    this.topology.init(identity, roomId);
    this.packetPipeline.init(identity, roomId);

    const resolver = this.topology.getRouteResolver();
    if (resolver) {
      this.transportRouter.bindRouteResolver(
        resolver,
        () => this.topology.getDirectConnectedPeerIds()
      );
    }
    this.transportRouter.updateView(this.topology.getActiveView());
  }

  public leave() {
    this.packetPipeline.clear();
    this.topology.leave();
    this.currentRoomId = '';
  }

  public broadcast<T = unknown>(
    type: PacketType,
    payload: T,
    options?: { channelPriority?: 'control' | 'bulk'; streamId?: string; seq?: number; lamportTime?: number }
  ): NetworkPacket | null {
    if (!this.myIdentity || !this.currentRoomId) return null;

    const packet = createPacket(type, this.myIdentity, this.currentRoomId, payload, undefined, options);

    // Send strictly across PacketPipeline
    this.packetPipeline.sendPacket(packet);

    return packet;
  }

  public send<T = unknown>(
    targetPeerId: string,
    type: PacketType,
    payload: T,
    options?: { channelPriority?: 'control' | 'bulk'; streamId?: string; seq?: number; lamportTime?: number }
  ): NetworkPacket | null {
    if (!this.myIdentity || !this.currentRoomId) return null;

    const packet = createPacket(type, this.myIdentity, this.currentRoomId, payload, targetPeerId, options);

    // Send strictly to target peer via PacketPipeline
    this.packetPipeline.sendPacket(packet, targetPeerId);

    return packet;
  }

  public async sendReliable<T = unknown>(
    targetPeerId: string | undefined,
    type: PacketType | string,
    payload: T,
    options?: { streamId?: string; seq?: number; lamportTime?: number; maxAttempts?: number }
  ): Promise<DeliveryReceipt> {
    if (!this.myIdentity || !this.currentRoomId) {
      throw new Error('[NetworkService] Cannot send reliable packet: uninitialized');
    }

    const packet = createPacket(
      type as PacketType,
      this.myIdentity,
      this.currentRoomId,
      payload,
      targetPeerId,
      options
    );

    const receipt = await this.packetPipeline.sendPacket(packet, targetPeerId, {
      isReliable: true,
      maxAttempts: options?.maxAttempts,
    });

    return receipt ?? {
      messageId: packet.id,
      status: 'delivered',
      attempts: 1,
    };
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
    // 1. Dispatch to registered type handlers
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

    // 2. Global handlers
    this.allPacketHandlers.forEach((fn) => {
      try {
        fn(packet);
      } catch (err) {
        console.error('[NetworkService] Global packet handler error:', err);
      }
    });
  }
}
