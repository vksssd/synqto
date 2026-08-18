// ─── Unified Network Transport Service ───

import { NetworkPacket, PacketType, PeerIdentity, createPacket } from './packet';
import { TopologyService, TopologyState } from './topology.service';
import { TopologyPolicy, ADAPTIVE_POLICY } from '../topology/topology.types';
import { DeliveryReceipt } from './reliable-transport';
import { TransportRouter } from '../transport/transport-router';
import { PacketPipeline } from './packet-pipeline';
import { globalClock } from './hybrid-clock';

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

    // Ingest inbound P2P packets into the same pipeline the relay path uses.
    //
    // This binding was missing entirely. TopologyService.deliverLocally fanned every packet
    // arriving over a WebRTC DataChannel out to `topology.packetListeners` — a Set that
    // nothing in the codebase ever subscribed to. So the inbound P2P path ran dedup, digest
    // interception and TTL relaying correctly and then dropped the packet on the floor at
    // the final step.
    //
    // Only the server-relay path reached application handlers, because RelayTransport
    // subscribes to signaling 'relay:packet' directly and feeds TransportRouter. That is why
    // this was not obvious in normal use: rooms still worked, just entirely via TIER3 relay,
    // with the P2P mesh carrying traffic that was silently discarded on arrival. It is also
    // why the test suite did not catch it — the simulation harness calls
    // transportRouter.routeIncoming() itself and never exercises this seam.
    //
    // routeIncoming is transport-agnostic by contract ("from any physical transport") and
    // applies its own dedup and epoch fencing, so P2P and relay ingress converge here.
    this.topology.onPacket((packet) => {
      this.transportRouter.routeIncoming(packet);
    });

    // Deliver ordered & reassembled packets from PacketPipeline to application features
    this.packetPipeline.onDeliver((packet) => {
      this.dispatchPacket(packet);
    });

    // Prune per-peer send state when the roster confirms a departure. Without this the
    // pipeline's stream counters accumulate an entry per (stream, peer) for the lifetime of
    // the session.
    this.topology.onPeerDeparted((peerId) => {
      this.packetPipeline.forgetPeer(peerId);
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

  /**
   * @param policy Topology constraints for this room. Omit for the adaptive default used by
   * every pre-CoFocus room type (problem, custom, group). CoFocus rooms pass
   * DIRECT_ONLY_POLICY, which pins the room to Tier 1 and forbids server-relay fallback.
   */
  public init(identity: PeerIdentity, roomId: string, policy: TopologyPolicy = ADAPTIVE_POLICY) {
    this.myIdentity = identity;
    this.currentRoomId = roomId;

    // Relay permission must be applied BEFORE any packet can be sent, otherwise a race at
    // join time could leak a CoFocus packet onto the server relay path.
    this.transportRouter.setRelayAllowed(policy.allowRelay);

    // Initialize P2P topology network and bind authoritative route resolver
    this.topology.init(identity, roomId, policy);
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

  /** Identity this service was initialised with, or null before init(). */
  public getMyIdentity(): PeerIdentity | null {
    return this.myIdentity;
  }

  /**
   * Refreshes the identity stamped on OUTGOING packets, without touching the mesh.
   *
   * Identity was captured once at init() and cached in three places (here, PacketPipeline and
   * TopologyService). Renaming yourself, or changing your avatar/colour, updated local UI only:
   * every packet you sent afterwards still carried the OLD nickname, so peers kept seeing the
   * previous name in chat, presence and cursors until you happened to switch rooms and trigger
   * a re-init.
   *
   * Deliberately NOT a re-init: peerId is stable across a rename (IdentityService preserves
   * it), so tearing down and rebuilding WebRTC connections would drop a live session to change
   * a display name.
   */
  public updateIdentity(identity: PeerIdentity): void {
    if (!identity) return;
    this.myIdentity = identity;
    this.topology.updateIdentity(identity);
    this.packetPipeline.updateIdentity(identity);
  }

  private dispatchPacket(packet: NetworkPacket) {
    // Merge the sender's hybrid timestamp BEFORE any handler runs.
    //
    // This ordering matters. A handler may itself send a packet in response, and that reply
    // must carry a timestamp strictly greater than the packet that caused it — otherwise a
    // reply can sort before the message it answers. Merging first guarantees that for every
    // handler, without each one having to remember to do it.
    globalClock.update(packet.hlc);

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
