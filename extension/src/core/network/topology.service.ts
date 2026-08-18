// ─── Hierarchical Topology Service (Dual-Leader Standby & Resilient Mesh Router) ───

import { NetworkPacket, PeerIdentity, createPacket } from './packet';
import { SignalingService, RosterData, PromoteData, DemoteData } from './signaling.service';
import { WebRTCService } from './webrtc.service';
import { TopologyEpoch, PeerId } from '../types/identifiers';
import { TierCoordinator } from '../topology/tier-coordinator';
import { LeaderMesh } from '../topology/leader-mesh';
import {
  LeaderDigest,
  TopologyTier,
  TopologyLifecycleState,
  TopologyPolicy,
  ADAPTIVE_POLICY,
} from '../topology/topology.types';
import { TopologyView } from '../topology/topology-view';
import { IRouteResolver } from '../topology/route-resolver';
import { PeerSignaling, PeerSignalPayload } from './peer-signaling';
import { LinkMonitor } from './link-monitor';

export interface TopologyState {
  isLeader: boolean;
  assignedLeader: string | null;
  assignedStandbyLeader: string | null;
  clusterPeers: string[];
  standbyPeers: string[];
  backboneLeaders: string[];
  allPeers: string[];
  epoch: TopologyEpoch;
  tier: TopologyTier;
  lifecycleState: TopologyLifecycleState;
}

export class TopologyService {
  private static instance: TopologyService | null = null;
  private signaling: SignalingService;
  private webrtc: WebRTCService;
  private tierCoordinator: TierCoordinator;
  private leaderMesh: LeaderMesh | null = null;
  private static readonly MAX_RECONNECT_DELAY_MS = 15000;

  private peerSignaling: PeerSignaling;
  private linkMonitor: LinkMonitor;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId = '';
  private isLeader = false;
  private assignedLeader: string | null = null;
  private assignedStandbyLeader: string | null = null;
  private clusterPeers: Set<string> = new Set();
  private standbyPeers: Set<string> = new Set();
  private backboneLeaders: Set<string> = new Set();
  private allPeers: Set<string> = new Set();
  private topologyEpoch: TopologyEpoch = 1;
  /** Topology constraints for the currently-joined room. Set by init(). */
  private activePolicy: TopologyPolicy = ADAPTIVE_POLICY;

  // Deduplication sliding window (max 1500 items)
  private seenPacketIds: Set<string> = new Set();
  private packetIdOrder: string[] = [];
  private readonly MAX_SEEN_PACKETS = 1500;

  // Active connection reconciliation loop & retry tracking
  private reconciliationTimer: any = null;
  private retryTimers: Map<string, any> = new Map();
  private retryAttempts: Map<string, number> = new Map();

  // Listeners for UI state and packet routing
  private packetListeners: Set<(packet: NetworkPacket) => void> = new Set();
  private stateListeners: Set<(state: TopologyState) => void> = new Set();

  private constructor() {
    this.signaling = SignalingService.getInstance();
    this.webrtc = WebRTCService.getInstance();
    // Constructed with the default (adaptive) policy; init() replaces it with the policy for
    // the room actually being joined.
    this.tierCoordinator = new TierCoordinator(ADAPTIVE_POLICY);

    this.peerSignaling = new PeerSignaling(
      (peerId) => this.webrtc.isConnected(peerId),
      () => this.webrtc.getConnectedPeers(),
      (targetPeerId, payload) => {
        // Signals ride the control channel as ordinary packets. sendP2PPacket is not used
        // here: it consults the route resolver, which is topology state that may itself be
        // stale during exactly the failures this path exists to repair. A signal must go to
        // a specific neighbour we know is reachable right now, so it goes direct.
        const packet = createPacket(
          'signal:peer' as any,
          this.myIdentity!,
          this.currentRoomId,
          payload,
          targetPeerId,
          { channelPriority: 'control', priority: 'CONTROL' }
        );
        return this.webrtc.sendPacket(targetPeerId, packet);
      },
      (targetPeerId, kind, data) => {
        if (kind === 'offer') this.signaling.sendOffer(targetPeerId, data as any);
        else if (kind === 'answer') this.signaling.sendAnswer(targetPeerId, data as any);
        else this.signaling.sendIce(targetPeerId, data as any);
      }
    );

    this.linkMonitor = new LinkMonitor(
      () => this.webrtc.getConnectedPeers(),
      (peerId, probeId) => {
        const packet = createPacket(
          'link:probe' as any,
          this.myIdentity!,
          this.currentRoomId,
          { probeId },
          peerId,
          { channelPriority: 'control', priority: 'CONTROL' }
        );
        return this.webrtc.sendPacket(peerId, packet);
      },
      (peerId) => this.handleDeadLink(peerId)
    );

    this.bindTierCoordinatorListeners();

    this.setupSignalingListeners();
    this.setupWebRTCListeners();
  }

  /**
   * TierCoordinator is recreated per-room in init() (its policy is immutable), so its
   * listeners are bound in one reusable place rather than only in the constructor.
   */
  private bindTierCoordinatorListeners() {
    this.tierCoordinator.onTierChanged((newTier, oldTier) => {
      this.topologyEpoch++;
      console.info(`[TopologyService] Tier transition: ${oldTier} -> ${newTier} (epoch ${this.topologyEpoch})`);
      this.reconcileConnections();
      this.emitState();
    });

    this.tierCoordinator.onStateChanged(() => {
      this.emitState();
    });
  }

  public static getInstance(): TopologyService {
    if (!TopologyService.instance) {
      TopologyService.instance = new TopologyService();
    }
    return TopologyService.instance;
  }

  /** Topology policy governing the currently-joined room. */
  public getPolicy(): TopologyPolicy {
    return this.activePolicy;
  }

  /**
   * @param policy Topology constraints for THIS room. Defaults to ADAPTIVE_POLICY, preserving
   * the behaviour of every pre-CoFocus call site. CoFocus rooms pass DIRECT_ONLY_POLICY, which
   * both forbids tier promotion and skips leader-mesh construction entirely.
   */
  public init(identity: PeerIdentity, roomId: string, policy: TopologyPolicy = ADAPTIVE_POLICY) {
    this.myIdentity = identity;
    this.currentRoomId = roomId;
    this.activePolicy = policy;
    this.seenPacketIds.clear();
    this.packetIdOrder = [];
    this.retryAttempts.clear();
    this.clearAllRetryTimers();

    // The coordinator's policy is immutable, so a room with a different policy gets a fresh
    // coordinator rather than a mutated one. Rebind listeners to the new instance.
    this.tierCoordinator = new TierCoordinator(policy);
    this.bindTierCoordinatorListeners();
    this.tierCoordinator.reset();

    if (policy.allowLeaderElection) {
      this.leaderMesh = new LeaderMesh(
        identity.peerId,
        roomId,
        () => ({ [identity.peerId]: this.topologyEpoch }),
        () => Date.now()
      );

      this.leaderMesh.bindDigestBroadcast((digest: LeaderDigest) => {
        this.broadcastPacket(
          createPacket('topology:digest' as any, this.myIdentity!, this.currentRoomId, digest)
        );
      });

      this.leaderMesh.onLeaderFailed((failedPeerId) => {
        this.topologyEpoch++;
        console.warn(`[TopologyService] Leader ${failedPeerId} failed. Advancing epoch to ${this.topologyEpoch}`);
        this.reconcileConnections();
      });
    } else {
      // DIRECT_ONLY: a deterministic 2-peer session has no backbone to elect. Not constructing
      // LeaderMesh means no heartbeat timers, no digest broadcasts, and getRouteResolver()
      // returns null — TransportRouter then routes purely direct, which is the intent.
      this.leaderMesh = null;
      console.info(`[TopologyService] Room ${roomId} initialised DIRECT_ONLY (no leader election, no relay)`);
    }

    this.webrtc.setMyPeerId(identity.peerId);
    this.peerSignaling.setMyPeerId(identity.peerId);
    this.peerSignaling.reset();
    this.linkMonitor.reset();

    // Connect to signaling server
    this.signaling.connect(roomId, identity.peerId, identity.nickname);

    // Start background topology reconciliation and link liveness loops
    this.startReconciliationLoop();
    this.linkMonitor.start();
  }

  public leave() {
    this.stopReconciliationLoop();
    this.linkMonitor.stop();
    this.linkMonitor.reset();
    this.peerSignaling.reset();
    this.clearAllRetryTimers();
    if (this.leaderMesh) {
      this.leaderMesh.stop();
      this.leaderMesh = null;
    }
    this.tierCoordinator.reset();
    this.signaling.disconnect();
    this.webrtc.closeAll();
    this.isLeader = false;
    this.assignedLeader = null;
    this.assignedStandbyLeader = null;
    this.clusterPeers.clear();
    this.standbyPeers.clear();
    this.backboneLeaders.clear();
    this.allPeers.clear();
    this.retryAttempts.clear();
    this.emitState();
  }

  private startReconciliationLoop() {
    this.stopReconciliationLoop();
    this.reconciliationTimer = setInterval(() => {
      this.reconcileConnections();
    }, 3500);
  }

  private stopReconciliationLoop() {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  private clearAllRetryTimers() {
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
  }

  /**
   * Periodically verifies all required topology links and repairs broken or deadlocked handshakes
   */
  private reconcileConnections() {
    if (!this.myIdentity || !this.currentRoomId) return;

    const currentTier = this.tierCoordinator.getCurrentTier();

    if (currentTier === 'TIER1_FULL_MESH') {
      // Tier 1 (Full Mesh): Connect directly to all known room peers
      this.allPeers.forEach((peerId) => {
        if (peerId === this.myIdentity?.peerId) return;
        const isConnected = this.webrtc.isConnected(peerId);
        const isConnecting = this.webrtc.isConnecting(peerId);

        if (!isConnected && !isConnecting) {
          if ((this.myIdentity?.peerId || '') < peerId) {
            this.webrtc.initiateConnection(peerId);
          }
        }
      });
      return;
    }

    if (this.isLeader) {
      // Tier 2 Leaders must maintain connections to all other backbone leaders
      this.backboneLeaders.forEach((leaderId) => {
        if (leaderId === this.myIdentity?.peerId) return;
        const isConnected = this.webrtc.isConnected(leaderId);
        const isConnecting = this.webrtc.isConnecting(leaderId);

        if (!isConnected && !isConnecting) {
          if ((this.myIdentity?.peerId || '') < leaderId) {
            this.webrtc.initiateConnection(leaderId);
          }
        }
      });
    } else {
      // Regular peer must maintain connection to primary assigned leader
      if (this.assignedLeader && this.assignedLeader !== this.myIdentity?.peerId) {
        const isConnected = this.webrtc.isConnected(this.assignedLeader);
        const isConnecting = this.webrtc.isConnecting(this.assignedLeader);
        if (!isConnected && !isConnecting) {
          this.webrtc.initiateConnection(this.assignedLeader);
        }
      }

      // Regular peer must maintain pre-warmed connection to standby leader
      if (
        this.assignedStandbyLeader &&
        this.assignedStandbyLeader !== this.myIdentity?.peerId &&
        this.assignedStandbyLeader !== this.assignedLeader
      ) {
        const isConnected = this.webrtc.isConnected(this.assignedStandbyLeader);
        const isConnecting = this.webrtc.isConnecting(this.assignedStandbyLeader);
        if (!isConnected && !isConnecting) {
          this.webrtc.initiateConnection(this.assignedStandbyLeader);
        }
      }
    }
  }

  private schedulePeerReconnection(peerId: string) {
    if (this.retryTimers.has(peerId)) return;

    const attempts = this.retryAttempts.get(peerId) || 0;

    // Full jitter rather than a fixed base plus a small random tail.
    //
    // The previous form was `base + random(0..1000)`: once the exponential term saturated at
    // 8s every peer retried inside the same 1s window. That is the synchronised-retry storm
    // backoff exists to prevent, and it is worst exactly when it matters most — after a
    // network blip that dropped many links at once, when the whole room retries together.
    // Sampling uniformly across the whole window spreads them properly.
    const window = Math.min(
      TopologyService.MAX_RECONNECT_DELAY_MS,
      1500 * Math.pow(1.6, Math.min(attempts, 6))
    );
    const delay = Math.max(500, Math.random() * window);
    this.retryAttempts.set(peerId, attempts + 1);

    const timer = setTimeout(() => {
      this.retryTimers.delete(peerId);

      // The peer may have left, or the link may have healed on its own, while we waited.
      if (!this.allPeers.has(peerId)) {
        this.retryAttempts.delete(peerId);
        this.peerSignaling.forget(peerId);
        return;
      }
      if (this.webrtc.isConnected(peerId)) {
        this.retryAttempts.delete(peerId);
        return;
      }

      // restartIce reuses the existing PeerConnection and its gathered candidates when one
      // survives, and falls back to a fresh connection when it does not. Either way the
      // resulting offer is routed by PeerSignaling, so this repair does not need the server
      // as long as any mesh path to the peer exists.
      this.webrtc.restartIce(peerId);

      // Keep trying. There is no attempt ceiling by design: a peer listed in allPeers is one
      // the room still believes is present, and giving up would leave a permanent hole in
      // the mesh that nothing else repairs. The backoff bounds the cost, and roster removal
      // is what actually stops it.
      this.schedulePeerReconnection(peerId);
    }, delay);

    this.retryTimers.set(peerId, timer);
  }

  /**
   * Drops reconnection state for peers no longer in the roster.
   *
   * retryAttempts was only ever cleared on a successful connect, so every peer that left
   * while disconnected left an entry behind for the lifetime of the session.
   */
  private pruneDepartedPeers() {
    for (const peerId of Array.from(this.retryAttempts.keys())) {
      if (!this.allPeers.has(peerId)) {
        this.retryAttempts.delete(peerId);
        const timer = this.retryTimers.get(peerId);
        if (timer) {
          clearTimeout(timer);
          this.retryTimers.delete(peerId);
        }
        this.peerSignaling.forget(peerId);
        this.linkMonitor.forget(peerId);
      }
    }
  }

  private setupSignalingListeners() {
    // 1. Roster updates from server (Dual-Leader aware)
    this.signaling.on('roster', (roster: RosterData) => {
      // Reject a roster that does not contain us.
      //
      // The roster is authoritative for membership, so acting on a bad one is destructive:
      // allPeers drives isLinkRequired, and pruneDepartedPeers tears down reconnection state
      // for anyone absent. A roster without us is not a roster for our room — it is a
      // half-initialised broadcast from a server that has just restarted and not yet
      // re-registered us, or a message for a room we have already left. Applying it would
      // empty allPeers and permanently stop repairing links that are merely idle, which is
      // exactly the wrong response to a server restart.
      if (!Array.isArray(roster?.peers) || roster.peers.length === 0) return;
      const me = roster.peers.find((p) => p.peerId === this.myIdentity?.peerId);
      if (!me) {
        console.warn('[TopologyService] Ignoring roster that does not list this peer');
        return;
      }

      this.allPeers = new Set(roster.peers.map((p) => p.peerId));
      this.tierCoordinator.updatePeerCount(roster.peers.length);
      this.pruneDepartedPeers();

      this.isLeader = me ? me.isLeader : false;

      if (this.isLeader) {
        this.assignedLeader = this.myIdentity?.peerId || null;
        this.assignedStandbyLeader = null;
        // Backbone leaders = all leaders except me
        this.backboneLeaders = new Set(
          roster.leaders.filter((lid) => lid !== this.myIdentity?.peerId)
        );

        if (this.leaderMesh) {
          this.leaderMesh.setLeaders(roster.leaders, this.topologyEpoch);
          this.leaderMesh.start(this.topologyEpoch);
        }

        // Ensure we connect to other leaders for backbone mesh
        this.backboneLeaders.forEach((leaderId) => {
          if (!this.webrtc.isConnected(leaderId) && !this.webrtc.isConnecting(leaderId)) {
            // Lexicographical tie-breaker for initial handshake, reconciliation loop acts as fallback
            if ((this.myIdentity?.peerId || '') < leaderId) {
              this.webrtc.initiateConnection(leaderId);
            }
          }
        });
      } else {
        if (this.leaderMesh) {
          this.leaderMesh.stop();
        }
        this.assignedLeader = roster.yourLeader || null;
        this.assignedStandbyLeader = roster.yourStandbyLeader || null;
        this.clusterPeers.clear();
        this.standbyPeers.clear();
        this.backboneLeaders.clear();

        // Regular peer: 1) connect to primary assigned leader
        if (this.assignedLeader && this.assignedLeader !== this.myIdentity?.peerId) {
          if (!this.webrtc.isConnected(this.assignedLeader) && !this.webrtc.isConnecting(this.assignedLeader)) {
            this.webrtc.initiateConnection(this.assignedLeader);
          }
        }

        // Regular peer: 2) connect to warm standby leader for instant failover (<300ms)
        if (
          this.assignedStandbyLeader &&
          this.assignedStandbyLeader !== this.myIdentity?.peerId &&
          this.assignedStandbyLeader !== this.assignedLeader
        ) {
          if (!this.webrtc.isConnected(this.assignedStandbyLeader) && !this.webrtc.isConnecting(this.assignedStandbyLeader)) {
            this.webrtc.initiateConnection(this.assignedStandbyLeader);
          }
        }
      }

      this.emitState();
    });

    // 2. Leader Promotion event from server
    this.signaling.on('promote', (data: PromoteData) => {
      this.topologyEpoch++;
      this.isLeader = true;
      this.assignedLeader = this.myIdentity?.peerId || null;
      this.assignedStandbyLeader = null;
      this.clusterPeers = new Set(data.clusterPeers);
      this.standbyPeers = new Set(data.standbyPeers || []);
      this.backboneLeaders = new Set(data.backboneLeaders);

      // Connect to other leaders in backbone
      this.backboneLeaders.forEach((leaderId) => {
        if (!this.webrtc.isConnected(leaderId) && !this.webrtc.isConnecting(leaderId)) {
          if ((this.myIdentity?.peerId || '') < leaderId) {
            this.webrtc.initiateConnection(leaderId);
          }
        }
      });

      this.emitState();
    });

    // 3. Leader Demotion event from server
    this.signaling.on('demote', (data: DemoteData) => {
      this.topologyEpoch++;
      this.isLeader = false;
      this.assignedLeader = data.newLeader;
      this.assignedStandbyLeader = data.newStandbyLeader || null;
      this.clusterPeers.clear();
      this.standbyPeers.clear();
      this.backboneLeaders.clear();

      // Close old connections that are neither primary nor standby leader
      const connected = this.webrtc.getConnectedPeers();
      connected.forEach((peerId) => {
        if (peerId !== this.assignedLeader && peerId !== this.assignedStandbyLeader) {
          this.webrtc.closeConnection(peerId);
        }
      });

      // Connect to primary leader
      if (this.assignedLeader && !this.webrtc.isConnected(this.assignedLeader)) {
        this.webrtc.initiateConnection(this.assignedLeader);
      }
      // Connect to standby leader
      if (
        this.assignedStandbyLeader &&
        this.assignedStandbyLeader !== this.assignedLeader &&
        !this.webrtc.isConnected(this.assignedStandbyLeader)
      ) {
        this.webrtc.initiateConnection(this.assignedStandbyLeader);
      }

      this.emitState();
    });

    // 4. Signaling messages (offer/answer/ice)
    this.signaling.on('signal:offer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      await this.webrtc.handleIncomingOffer(data.from, data.sdp);
    });

    this.signaling.on('signal:answer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      await this.webrtc.handleIncomingAnswer(data.from, data.sdp);
    });

    this.signaling.on('signal:ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      await this.webrtc.handleIncomingIce(data.from, data.candidate);
    });

    // 5. Tier 3 Server Relay messages
    this.signaling.on('relay:packet', (packet: NetworkPacket) => {
      if (packet && packet.from) {
        this.routeIncomingPacket(packet.from.peerId, packet);
      }
    });
  }

  /**
   * A link the monitor has declared dead: probes went unanswered while the channel still
   * reported itself open.
   *
   * Torn down explicitly rather than left to ICE consent timeout, because until the wrapper
   * is gone `isConnected()` keeps returning true and every send into it is silently lost.
   * Repair is then immediate for peers we still expect to be in the room.
   */
  private handleDeadLink(peerId: string): void {
    console.warn(`[TopologyService] Link to ${peerId} unresponsive — tearing down and repairing`);
    this.webrtc.closeConnection(peerId);
    this.clusterPeers.delete(peerId);
    this.standbyPeers.delete(peerId);

    if (this.allPeers.has(peerId) && this.isLinkRequired(peerId)) {
      this.schedulePeerReconnection(peerId);
    }
    this.emitState();
  }

  /**
   * Whether we are supposed to hold a link to this peer under the current tier.
   *
   * TIER1 was previously absent from this test, so in a full mesh no peer counted as
   * required and a dropped link was never scheduled for reconnection from the event path —
   * it healed only when the 3.5s reconciler next happened to run, and only via a fresh
   * connection rather than an ICE restart.
   */
  private isLinkRequired(peerId: string): boolean {
    if (this.tierCoordinator.getCurrentTier() === 'TIER1_FULL_MESH') {
      return this.allPeers.has(peerId);
    }
    return (
      peerId === this.assignedLeader ||
      peerId === this.assignedStandbyLeader ||
      this.backboneLeaders.has(peerId)
    );
  }

  /**
   * Applies a signal that arrived over the mesh instead of the server.
   *
   * Identical handling to the server path — the transport a signal took is not something
   * WebRTC needs to know, and keeping the two paths convergent here is what makes
   * "reconnect without the server" behave exactly like a normal reconnect.
   */
  private async applyPeerSignal(signal: PeerSignalPayload): Promise<void> {
    try {
      if (signal.kind === 'offer') {
        await this.webrtc.handleIncomingOffer(
          signal.originPeerId,
          signal.data as RTCSessionDescriptionInit
        );
      } else if (signal.kind === 'answer') {
        await this.webrtc.handleIncomingAnswer(
          signal.originPeerId,
          signal.data as RTCSessionDescriptionInit
        );
      } else {
        await this.webrtc.handleIncomingIce(
          signal.originPeerId,
          signal.data as RTCIceCandidateInit
        );
      }
    } catch (err) {
      console.warn('[TopologyService] Failed to apply peer-relayed signal:', err);
    }
  }

  /** Signal routing counters — how much traffic avoided the server. */
  public getSignalingStats() {
    return this.peerSignaling.getStats();
  }

  private setupWebRTCListeners() {
    this.webrtc.onSignalNeeded((targetPeerId, type, payload) => {
      // Route through the mesh where possible; the server is the last resort, not the
      // default. See core/network/peer-signaling.ts for the preference order.
      this.peerSignaling.route(targetPeerId, type, payload);
    });

    this.webrtc.onPacket((fromPeerId, packet) => {
      this.routeIncomingPacket(fromPeerId, packet);
    });

    this.webrtc.onConnectionState((peerId, status) => {
      if (status === 'connected') {
        this.retryAttempts.delete(peerId);
        if (this.retryTimers.has(peerId)) {
          clearTimeout(this.retryTimers.get(peerId));
          this.retryTimers.delete(peerId);
        }

        if (this.isLeader && !this.backboneLeaders.has(peerId)) {
          this.clusterPeers.add(peerId);
        }
      } else if (status === 'disconnected' || status === 'failed') {
        this.clusterPeers.delete(peerId);
        this.standbyPeers.delete(peerId);

        // Instant Sub-300ms Failover Check:
        // If primary assigned leader dropped, immediately flip to pre-warmed standby leader!
        if (!this.isLeader && peerId === this.assignedLeader) {
          if (this.assignedStandbyLeader && this.webrtc.isConnected(this.assignedStandbyLeader)) {
            console.warn(
              `[TopologyService] Primary leader ${peerId} disconnected. Instant warm failover to Standby leader ${this.assignedStandbyLeader}!`
            );
            this.assignedLeader = this.assignedStandbyLeader;
            this.assignedStandbyLeader = null;
            this.emitState();
          }
        }

        // Schedule automatic reconnection if this peer is part of our required topology links
        if (this.isLinkRequired(peerId) && this.allPeers.has(peerId)) {
          this.schedulePeerReconnection(peerId);
        }
      }
      this.emitState();
    });
  }

  /**
   * Routes incoming packet according to hierarchical topology
   */
  private routeIncomingPacket(fromPeerId: string, packet: NetworkPacket) {
    // 1. Deduplication check
    if (this.hasSeenPacket(packet.id)) {
      return;
    }
    this.markPacketSeen(packet.id);

    // 2. Intercept peer-relayed signaling.
    //
    // Handled here rather than as an ordinary application packet because a signal may need
    // forwarding to a third peer, and because it must reach WebRTC even while the app layer
    // is unhealthy — repairing the transport cannot depend on the transport being usable.
    if (packet.type === ('signal:peer' as any)) {
      const signal = this.peerSignaling.handleInbound(
        packet.payload as PeerSignalPayload,
        packet
      );
      if (signal) this.applyPeerSignal(signal);
      return; // never delivered to application handlers
    }

    // 2b. Link liveness. Any inbound packet is evidence of life; probes are answered
    // immediately and never surface to the application.
    this.linkMonitor.noteInbound(fromPeerId);

    if (packet.type === ('link:probe' as any)) {
      const probeId = (packet.payload as { probeId?: string })?.probeId ?? '';
      const pong = createPacket(
        'link:pong' as any,
        this.myIdentity!,
        this.currentRoomId,
        { probeId },
        fromPeerId,
        { channelPriority: 'control', priority: 'CONTROL' }
      );
      this.webrtc.sendPacket(fromPeerId, pong);
      return;
    }

    if (packet.type === ('link:pong' as any)) {
      const probeId = (packet.payload as { probeId?: string })?.probeId ?? '0';
      this.linkMonitor.notePong(fromPeerId, Number(probeId) || 0);
      return;
    }

    // 3. Intercept leader digests
    if (packet.type === ('topology:digest' as any) && this.leaderMesh) {
      this.leaderMesh.recordDigest(packet.payload as LeaderDigest);
    }

    // 3. Deliver packet to local listeners
    this.deliverLocally(packet);

    // 4. Decrement TTL and check if relaying is allowed
    const remainingTtl = packet.ttl - 1;
    if (remainingTtl <= 0) {
      return;
    }

    const relayPacket: NetworkPacket = {
      ...packet,
      ttl: remainingTtl,
    };

    // 5. Relay logic (Only Leaders relay packets in Tier 2!)
    if (this.tierCoordinator.getCurrentTier() === 'TIER2_MULTI_LEADER' && this.isLeader) {
      const isFromBackbone = this.backboneLeaders.has(fromPeerId);

      if (isFromBackbone) {
        // Packet came from another leader -> relay down to our cluster members
        this.clusterPeers.forEach((memberId) => {
          if (memberId !== fromPeerId && memberId !== packet.from.peerId) {
            this.webrtc.sendPacket(memberId, relayPacket);
          }
        });
      } else {
        // Packet came from our cluster member ->
        // a) Relay to all other members in our cluster
        this.clusterPeers.forEach((memberId) => {
          if (memberId !== fromPeerId && memberId !== packet.from.peerId) {
            this.webrtc.sendPacket(memberId, relayPacket);
          }
        });

        // b) Relay to all other leaders in the backbone mesh
        this.backboneLeaders.forEach((leaderId) => {
          if (leaderId !== fromPeerId && leaderId !== packet.from.peerId) {
            this.webrtc.sendPacket(leaderId, relayPacket);
          }
        });
      }
    }
  }

  /**
   * Broadcasts packet from local client
   */
  public broadcastPacket(packet: NetworkPacket) {
    this.markPacketSeen(packet.id);
    this.deliverLocally(packet);

    const currentTier = this.tierCoordinator.getCurrentTier();
    const lifecycleState = this.tierCoordinator.getLifecycleState();

    // 1. Tier 3 Server Relay Broadcast
    if (currentTier === 'TIER3_SERVER_RELAY') {
      this.signaling.sendRelayPacket(packet);
      return;
    }

    // 2. Dual-Path Migration: If preparing or demoting Tier 3, send copy to server relay as fallback
    if (lifecycleState === 'TIER3_PREPARING' || lifecycleState === 'TIER3_DEMOTING') {
      this.signaling.sendRelayPacket(packet);
    }

    // 3. Tier 1 (Full Mesh): Direct broadcast to all connected peers
    if (currentTier === 'TIER1_FULL_MESH') {
      this.allPeers.forEach((peerId) => {
        if (peerId !== this.myIdentity?.peerId && this.webrtc.isConnected(peerId)) {
          this.webrtc.sendPacket(peerId, packet);
        }
      });
      return;
    }

    // 4. Tier 2 (Multi-Leader Mesh)
    if (this.isLeader) {
      // Leader sends to all cluster members + all backbone leaders
      this.clusterPeers.forEach((peerId) => {
        this.webrtc.sendPacket(peerId, packet);
      });
      this.backboneLeaders.forEach((leaderId) => {
        this.webrtc.sendPacket(leaderId, packet);
      });
    } else {
      // Regular peer sends to active assigned leader (fallback to standby if needed)
      let sent = false;
      if (this.assignedLeader && this.webrtc.isConnected(this.assignedLeader)) {
        sent = this.webrtc.sendPacket(this.assignedLeader, packet);
      }
      if (!sent && this.assignedStandbyLeader && this.webrtc.isConnected(this.assignedStandbyLeader)) {
        this.webrtc.sendPacket(this.assignedStandbyLeader, packet);
      }
    }
  }

  /**
   * Sends directed packet to target peer
   */
  public sendPacket(targetPeerId: string, packet: NetworkPacket) {
    this.markPacketSeen(packet.id);

    const currentTier = this.tierCoordinator.getCurrentTier();

    // 1. Tier 3 Server Relay Directed Message
    if (currentTier === 'TIER3_SERVER_RELAY') {
      this.signaling.sendRelayPacket(packet);
      return;
    }

    // 2. Direct WebRTC send if connection is alive
    if (this.webrtc.isConnected(targetPeerId)) {
      this.webrtc.sendPacket(targetPeerId, packet);
    } else if (this.isLeader) {
      // Leader broadcasts directed packet across backbone and cluster
      this.broadcastPacket(packet);
    } else {
      // Regular peer sends to active leader to forward
      let sent = false;
      if (this.assignedLeader && this.webrtc.isConnected(this.assignedLeader)) {
        sent = this.webrtc.sendPacket(this.assignedLeader, packet);
      }
      if (!sent && this.assignedStandbyLeader && this.webrtc.isConnected(this.assignedStandbyLeader)) {
        this.webrtc.sendPacket(this.assignedStandbyLeader, packet);
      }
    }
  }

  private hasSeenPacket(id: string): boolean {
    return this.seenPacketIds.has(id);
  }

  private markPacketSeen(id: string) {
    this.seenPacketIds.add(id);
    this.packetIdOrder.push(id);
    if (this.packetIdOrder.length > this.MAX_SEEN_PACKETS) {
      const oldest = this.packetIdOrder.shift();
      if (oldest) {
        this.seenPacketIds.delete(oldest);
      }
    }
  }

  private deliverLocally(packet: NetworkPacket) {
    // If packet has a target and it's not us and not broadcast, ignore local delivery
    if (packet.to && packet.to !== this.myIdentity?.peerId) {
      return;
    }

    this.packetListeners.forEach((listener) => {
      try {
        listener(packet);
      } catch (err) {
        console.error('[TopologyService] Error in packet listener:', err);
      }
    });
  }

  public onPacket(handler: (packet: NetworkPacket) => void): () => void {
    this.packetListeners.add(handler);
    return () => {
      this.packetListeners.delete(handler);
    };
  }

  public getDirectConnectedPeerIds(): Set<PeerId> {
    const direct = new Set<PeerId>();
    this.allPeers.forEach((peerId) => {
      if (this.webrtc.isConnected(peerId)) {
        direct.add(peerId);
      }
    });
    return direct;
  }

  public getActiveView(): TopologyView {
    const state = this.tierCoordinator.getLifecycleState();
    const isStable = state === 'STABLE_TIER1' || state === 'STABLE_TIER2' || state === 'STABLE_TIER3';
    return {
      roomId: this.currentRoomId,
      tier: this.tierCoordinator.getCurrentTier(),
      phase: isStable ? 'STABLE' : 'DRAINING',
      epoch: this.topologyEpoch,
      generation: 1,
      membershipVersion: this.allPeers.size,
      leaders: Array.from(this.backboneLeaders),
      primaryLeader: this.assignedLeader || undefined,
      secondaryLeader: this.assignedStandbyLeader || undefined,
      relayAvailable: this.signaling.isServerConnected(),
      timestamp: Date.now(),
    };
  }

  public getRouteResolver(): IRouteResolver | null {
    return this.leaderMesh?.routeResolver ?? null;
  }

  public sendP2PPacket(packet: NetworkPacket, targetPeerId?: PeerId): boolean {
    if (targetPeerId) {
      if (this.webrtc.isConnected(targetPeerId)) {
        return this.webrtc.sendPacket(targetPeerId, packet);
      }
      return false;
    }

    // P2P Broadcast
    const currentTier = this.tierCoordinator.getCurrentTier();
    if (currentTier === 'TIER1_FULL_MESH') {
      let anySent = false;
      this.allPeers.forEach((peerId) => {
        if (peerId !== this.myIdentity?.peerId && this.webrtc.isConnected(peerId)) {
          this.webrtc.sendPacket(peerId, packet);
          anySent = true;
        }
      });
      return anySent;
    }

    if (currentTier === 'TIER2_MULTI_LEADER') {
      if (this.isLeader) {
        this.clusterPeers.forEach((peerId) => {
          this.webrtc.sendPacket(peerId, packet);
        });
        this.backboneLeaders.forEach((leaderId) => {
          this.webrtc.sendPacket(leaderId, packet);
        });
        return true;
      } else {
        if (this.assignedLeader && this.webrtc.isConnected(this.assignedLeader)) {
          return this.webrtc.sendPacket(this.assignedLeader, packet);
        }
        if (this.assignedStandbyLeader && this.webrtc.isConnected(this.assignedStandbyLeader)) {
          return this.webrtc.sendPacket(this.assignedStandbyLeader, packet);
        }
        return false;
      }
    }

    return false;
  }

  public onStateChange(handler: (state: TopologyState) => void): () => void {
    this.stateListeners.add(handler);
    handler(this.getState());
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  public getState(): TopologyState {
    return {
      isLeader: this.isLeader,
      assignedLeader: this.assignedLeader,
      assignedStandbyLeader: this.assignedStandbyLeader,
      clusterPeers: Array.from(this.clusterPeers),
      standbyPeers: Array.from(this.standbyPeers),
      backboneLeaders: Array.from(this.backboneLeaders),
      allPeers: Array.from(this.allPeers),
      epoch: this.topologyEpoch,
      tier: this.tierCoordinator.getCurrentTier(),
      lifecycleState: this.tierCoordinator.getLifecycleState(),
    };
  }

  private emitState() {
    const state = this.getState();
    this.stateListeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('[TopologyService] Error in state listener:', err);
      }
    });
  }
}

