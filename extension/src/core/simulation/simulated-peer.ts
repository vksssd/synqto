// ─── Simulated Peer Entity (Hosts Real P1/P2 Production Code) ───

import { PeerId, RoomId } from '../types/identifiers';
import { NetworkPacket, PacketType, PeerIdentity, createPacket } from '../network/packet';
import { TopologyView } from '../topology/topology-view';
import { RouteResolver } from '../topology/route-resolver';
import { TransportRouter } from '../transport/transport-router';
import { PacketPipeline } from '../network/packet-pipeline';
import { PayloadChunker } from '../network/chunker';
import { ReplicatedStore } from '../replication/replicated-store';
import { VirtualNetwork } from './virtual-network';
import { MetricsCollector } from './metrics-collector';

export class SimulatedPeer {
  public readonly identity: PeerIdentity;
  public readonly topologyView: TopologyView;
  public readonly routeResolver: RouteResolver;
  public readonly transportRouter: TransportRouter;
  public readonly packetPipeline: PacketPipeline;
  public readonly replicatedStores: Map<string, ReplicatedStore<any, any>> = new Map();

  public isAlive: boolean = true;
  public directNeighbors: Set<PeerId> = new Set();
  public deliveredPackets: NetworkPacket[] = [];
  public lastSeenSeqPerStream: Map<string, number> = new Map(); // "${streamId}:${senderPeerId}" -> lastSeq

  constructor(
    public readonly peerId: PeerId,
    public readonly roomId: RoomId,
    private virtualNetwork: VirtualNetwork,
    private metrics?: MetricsCollector
  ) {
    this.identity = {
      peerId,
      nickname: `Peer_${peerId.slice(-4)}`,
      avatar: '🤖',
      color: '#6366f1',
    };

    this.topologyView = {
      roomId,
      tier: 'TIER1_FULL_MESH',
      phase: 'STABLE',
      epoch: 1,
      generation: 1,
      membershipVersion: 1,
      leaders: [],
      relayAvailable: true,
      timestamp: Date.now(),
    };

    this.routeResolver = new RouteResolver(peerId, 1);

    // Bind virtual Relay transport to TransportRouter constructor
    const virtualRelay = {
      name: 'virtual-relay',
      capabilities: { maxPayloadBytes: 32768, guarantees: { reliable: true, ordered: false } },
      sendTo: (targetPeerId: PeerId, packet: NetworkPacket) => {
        if (!this.isAlive) return false;
        const sent = this.virtualNetwork.sendRelay(this.peerId, targetPeerId, packet);
        if (sent && this.metrics) this.metrics.relayRoutes++;
        return sent;
      },
      broadcast: (packet: NetworkPacket) => {
        if (!this.isAlive) return false;
        const sent = this.virtualNetwork.sendRelay(this.peerId, undefined, packet);
        if (sent && this.metrics) this.metrics.relayRoutes++;
        return sent;
      },
      onPacket: (fn: (packet: NetworkPacket) => void) => {
        // Registered in VirtualNetwork
      },
    };

    this.transportRouter = new TransportRouter(virtualRelay as any);
    this.transportRouter.updateView(this.topologyView);

    // Bind real TransportRouter to VirtualNetwork physical channels
    this.transportRouter.bindP2PSender((packet: NetworkPacket, targetPeerId?: PeerId) => {
      if (!this.isAlive) return false;
      if (!targetPeerId) {
        let sentAny = false;
        for (const neighborId of this.directNeighbors) {
          const sent = this.virtualNetwork.sendP2P(this.peerId, neighborId, packet);
          if (sent) sentAny = true;
        }
        if (sentAny && this.metrics) this.metrics.directRoutes++;
        return sentAny;
      }

      const sent = this.virtualNetwork.sendP2P(this.peerId, targetPeerId, packet);
      if (sent && this.metrics) {
        this.metrics.directRoutes++;
      }
      return sent;
    });

    // Bind authoritative RouteResolver to TransportRouter
    this.transportRouter.bindRouteResolver(
      this.routeResolver,
      () => this.directNeighbors
    );

    // Instantiate real PacketPipeline
    this.packetPipeline = new PacketPipeline(this.transportRouter);
    this.packetPipeline.init(this.identity, roomId);

    if (this.metrics) {
      this.packetPipeline.getReliableTransport().onRetry(() => {
        this.metrics!.recordRetransmission();
      });
      this.packetPipeline.getReliableTransport().onAck(() => {
        this.metrics!.acks++;
      });
    }

    // Listen for application delivery from PacketPipeline
    this.packetPipeline.onDeliver((packet: NetworkPacket) => {
      this.onApplicationDeliver(packet);
    });

    // Register physical incoming listener with VirtualNetwork (including tick callback)
    this.virtualNetwork.registerPeer(
      peerId,
      (packet: NetworkPacket) => {
        if (!this.isAlive) return; // Dropped if peer is dead
        this.transportRouter.routeIncoming(packet);
      },
      (now: number) => {
        if (this.isAlive) {
          this.packetPipeline.step(now);
        }
      }
    );
  }

  public setNeighbors(neighbors: PeerId[]): void {
    this.directNeighbors = new Set(neighbors);
  }

  public updateTopology(view: Partial<TopologyView>): void {
    Object.assign(this.topologyView, view);
    this.transportRouter.updateView(this.topologyView);
  }

  /**
   * Application-level transmission
   */
  public send(
    type: PacketType,
    payload: unknown,
    targetPeerId?: PeerId,
    options?: { streamId?: string; seq?: number; isReliable?: boolean }
  ): NetworkPacket {
    const packet = createPacket(
      type,
      this.identity,
      this.roomId,
      payload,
      targetPeerId,
      options
    );

    packet.timestamp = this.virtualNetwork.getCurrentTime();

    if (this.metrics) {
      this.metrics.recordSent(packet, options?.isReliable ?? true);
      const fragments = PayloadChunker.chunkPacket(packet);
      if (fragments.length > 1) {
        this.metrics.chunkedTransfers++;
        this.metrics.chunksSent += fragments.length;
      }
    }

    this.packetPipeline.sendPacket(packet, targetPeerId, {
      isReliable: options?.isReliable ?? true,
    }).catch((err) => {
      // Handled by pipeline receipt
    });

    return packet;
  }

  private onApplicationDeliver(packet: NetworkPacket): void {
    if (!this.isAlive) return;

    this.deliveredPackets.push(packet);

    const latencyMs = Math.max(1, this.virtualNetwork.getCurrentTime() - packet.timestamp);

    if (this.metrics) {
      this.metrics.recordDelivery(this.peerId, packet, latencyMs);
    }

    // Verify stream-scoped sequence monotonicity
    if (packet.streamId && typeof packet.seq === 'number') {
      const streamKey = `${packet.streamId}:${packet.from.peerId}`;
      const lastSeq = this.lastSeenSeqPerStream.get(streamKey);

      if (lastSeq !== undefined && packet.seq <= lastSeq) {
        if (this.metrics) {
          this.metrics.orderingViolations++;
          this.metrics.recordViolation(
            'SEQUENCE_INVERSION',
            `Peer ${this.peerId} received out-of-order sequence: last was ${lastSeq}, got ${packet.seq} for stream ${streamKey}`
          );
        }
      } else {
        this.lastSeenSeqPerStream.set(streamKey, packet.seq);
      }
    }

    // Route state replication packets to registered stores
    if (packet.type.startsWith('state:')) {
      for (const store of this.replicatedStores.values()) {
        store.handleIncomingPacket(packet);
      }
    }
  }

  public registerStore<TState, TOp>(store: ReplicatedStore<TState, TOp>): void {
    this.replicatedStores.set(store.storeId, store);
  }

  public getStore<TState, TOp>(storeId: string): ReplicatedStore<TState, TOp> | undefined {
    return this.replicatedStores.get(storeId);
  }

  public crash(): void {
    this.isAlive = false;
    if (this.metrics) this.metrics.leaderCrashes++;
  }

  public restart(): void {
    this.isAlive = true;
  }
}
