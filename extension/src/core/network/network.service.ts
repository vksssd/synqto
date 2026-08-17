// ─── Unified Network Transport Service ───

import { NetworkPacket, PacketType, PeerIdentity, createPacket } from './packet';
import { TopologyService, TopologyState } from './topology.service';

export class NetworkService {
  private static instance: NetworkService | null = null;
  private topology: TopologyService;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId = '';
  private packetHandlers: Map<PacketType, Set<(packet: NetworkPacket) => void>> = new Map();
  private allPacketHandlers: Set<(packet: NetworkPacket) => void> = new Set();

  private constructor() {
    this.topology = TopologyService.getInstance();

    // Listen to topology packets
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
    // Specific type handlers
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

    // Global handlers
    this.allPacketHandlers.forEach((fn) => {
      try {
        fn(packet);
      } catch (err) {
        console.error('[NetworkService] Global packet handler error:', err);
      }
    });
  }
}
