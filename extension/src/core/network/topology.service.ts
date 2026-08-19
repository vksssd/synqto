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
import { LinkStateRouter, LSA } from '../topology/link-state';
import { planMesh, planFallbackTargets } from '../topology/mesh-plan';
import { LinkAffinity } from '../topology/link-affinity';
import { PeerIdentityStore } from './peer-identity-store';
import { JoinTracker } from './join-tracker';

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
  private router: LinkStateRouter;
  private routerTimer: any = null;
  private affinity: LinkAffinity = new LinkAffinity();
  private identityStore = PeerIdentityStore.getInstance();
  private snapshotTimer: any = null;
  private joinTracker = new JoinTracker();

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
  /**
   * Notified when the roster confirms a peer has left, so layers that key state by peer ID
   * can prune precisely rather than relying on their own eviction heuristics.
   */
  private onPeerDepartedFns: Set<(peerId: string) => void> = new Set();

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

    this.router = new LinkStateRouter('');
    this.peerSignaling.bindRouter((targetPeerId) => this.router.nextHop(targetPeerId));

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
   * Updates the cached identity used to stamp outgoing packets.
   *
   * Only safe because peerId does not change on a rename — if it ever did, this would have to
   * be a full re-init, since peerId is the key the entire mesh routes on.
   */
  public updateIdentity(identity: PeerIdentity): void {
    if (!identity || identity.peerId !== this.myIdentity?.peerId) return;
    this.myIdentity = identity;
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

    this.joinTracker.reset();
    this.joinTracker.begin(roomId, identity.peerId);
    this.webrtc.setMyPeerId(identity.peerId);
    // Load the persistent DTLS identity before any connection is constructed. Fire-and-forget
    // because blocking room entry on IndexedDB would be a poor trade — a connection built
    // before it resolves simply uses an ephemeral identity.
    void this.webrtc.prewarmIdentity();
    void this.warmStartFromSnapshot(roomId);

    this.peerSignaling.setMyPeerId(identity.peerId);
    this.peerSignaling.reset();
    this.linkMonitor.reset();
    this.router.setMyPeerId(identity.peerId);
    this.router.reset();
    this.affinity.reset();

    // Connect to signaling server
    this.joinTracker.advance('REGISTERING');
    this.signaling.connect(roomId, identity.peerId, identity.nickname);

    // Start background topology reconciliation and link liveness loops
    this.startReconciliationLoop();
    this.linkMonitor.start();
    this.startRoutingLoop();
    this.startSnapshotLoop();
  }

  public leave() {
    this.stopReconciliationLoop();
    this.linkMonitor.stop();
    this.linkMonitor.reset();
    this.stopRoutingLoop();
    this.stopSnapshotLoop();
    // Save on the way out: leaving is the moment the room state is most complete.
    void this.saveSnapshot();
    this.router.reset();
    this.affinity.reset();
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
      // Tier 1: hold the planned link set.
      //
      // For rooms at or below the full-mesh threshold this is still every peer, so nothing
      // changes for the common case. Above it the plan thins out to a ring plus chords,
      // which is what allows the tier to hold more peers than N-1 connections each would
      // permit. The plan is deterministic and symmetric, so both endpoints of every link
      // agree it should exist without any negotiation.
      const plan = planMesh(this.myIdentity.peerId, this.allPeers);
      if (plan.desired.size > 0) {
        this.joinTracker.advance('NEIGHBORS_SELECTED', { required: plan.desired.size });
      }
      this.joinTracker.setLinkProgress(
        this.webrtc.getConnectedPeers().filter((p) => plan.desired.has(p)).length,
        plan.desired.size
      );

      plan.desired.forEach((peerId) => {
        if (peerId === this.myIdentity?.peerId) return;
        const isConnected = this.webrtc.isConnected(peerId);
        const isConnecting = this.webrtc.isConnecting(peerId);

        if (!isConnected && !isConnecting) {
          // Lower peer ID initiates, so a link is dialled from exactly one side.
          if ((this.myIdentity?.peerId || '') < peerId) {
            this.webrtc.initiateConnection(peerId);
          }
        }
      });

      if (!plan.isFullMesh) {
        // Widen the plan when it is not delivering connectivity.
        //
        // Sparsity costs NAT-traversal robustness: a peer gets `targetDegree` chances to
        // find someone reachable where a full mesh gave it N-1, and connection failure is
        // peer-correlated rather than random, so those chances are not independent. Without
        // this, a peer whose planned neighbours are all unreachable sits alone in a room it
        // can see on the roster. See planFallbackTargets for the measured probabilities.
        const connected = this.webrtc.getConnectedPeers();
        const fallback = planFallbackTargets(this.myIdentity.peerId, this.allPeers, {
          connected,
          reachable: this.router.getReachable(),
        });

        for (const peerId of fallback) {
          if (this.webrtc.isConnected(peerId) || this.webrtc.isConnecting(peerId)) continue;
          // No peer-ID ordering here, unlike the planned links. Both endpoints of a broken
          // mesh may be trying to repair it, and deferring to the lower ID would leave the
          // higher one waiting on a peer that may never dial. Perfect negotiation resolves
          // the resulting glare; a missed repair has nothing to resolve it.
          this.webrtc.initiateConnection(peerId);
        }

        if (fallback.length > 0) {
          console.warn(
            `[TopologyService] Mesh not delivering connectivity — widening by ${fallback.length} link(s)`
          );
        }

        // Shed links the plan no longer wants — but never one that is carrying latency
        // sensitive traffic, and never while the mesh is still being repaired. Adaptive
        // promotion (shouldKeepLink) is what stops a sparse plan from tearing down the
        // direct link between two people actively co-editing.
        if (fallback.length === 0) {
          for (const peerId of connected) {
            if (plan.desired.has(peerId)) continue;
            if (this.shouldKeepLink(peerId)) continue;
            this.webrtc.closeConnection(peerId);
          }
        }
      }
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
        this.affinity.forget(peerId);
        this.onPeerDepartedFns.forEach((fn) => fn(peerId));
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

      this.joinTracker.advance('REGISTERED');
      this.joinTracker.advance('ROSTER_SYNCED', { peers: roster.peers.length });

      this.allPeers = new Set(roster.peers.map((p) => p.peerId));
      this.tierCoordinator.updatePeerCount(roster.peers.length);
      this.pruneDepartedPeers();
      this.joinTracker.advance('TOPOLOGY_SYNCED', {
        tier: this.tierCoordinator.getCurrentTier(),
      });

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
   * Whether to hold a link the mesh plan wants to shed.
   *
   * The plan optimises the room; this protects the pair. Two people co-editing would
   * otherwise have their direct link torn down and their keystrokes routed 3-4 hops, which
   * is the difference between collaboration feeling live and feeling broken.
   */
  private shouldKeepLink(peerId: string): boolean {
    return this.affinity.shouldKeep(peerId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Persistence: room snapshot and cold-start bootstrap
  // ───────────────────────────────────────────────────────────────────────────

  private startSnapshotLoop() {
    this.stopSnapshotLoop();
    // Infrequent by design. The snapshot is a hint for the next cold start, not live state,
    // and writing it often would put IndexedDB traffic on the critical path for no gain.
    this.snapshotTimer = setInterval(() => void this.saveSnapshot(), 30_000);
  }

  private stopSnapshotLoop() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private async saveSnapshot(): Promise<void> {
    if (!this.currentRoomId || this.allPeers.size === 0) return;
    try {
      await this.identityStore.saveRoomSnapshot({
        roomId: this.currentRoomId,
        members: Array.from(this.allPeers),
        topology: this.router.getTopology(),
      });
    } catch {
      // Persistence is best-effort; a session must never fail because storage did.
    }
  }

  /**
   * Seeds relay hints for peers we expect to meet in this room.
   *
   * This is the cheap half of the cold-start ladder, and the only half that is reliable. The
   * expensive half — reconnecting to cached peers without the server — cannot work in
   * general: their ICE candidates are long expired, so we still need fresh SDP from
   * somewhere. What the snapshot genuinely buys is knowing WHO to look for and HOW they were
   * reachable, so that once any single path opens, the rest of the room follows from the
   * mesh rather than from the server.
   */
  private async warmStartFromSnapshot(roomId: string): Promise<void> {
    try {
      const snap = await this.identityStore.getRoomSnapshot(roomId);
      if (!snap) return;

      await this.webrtc.loadRelayHints(snap.members);
      console.info(
        `[TopologyService] Warm start: ${snap.members.length} known members, ` +
          `${snap.topology.length} known links from a previous session`
      );
    } catch {
      // No snapshot, or storage unavailable. Cold start proceeds normally.
    }
  }

  /**
   * Re-evaluates admission progress against the links that actually exist.
   *
   * Recorded, not enforced: nothing here blocks traffic or refuses a peer. The point is that
   * "registered" and "able to talk to anyone" become separately observable, so a stalled join
   * says which of the two it stopped at.
   */
  private updateJoinProgress(): void {
    if (!this.myIdentity) return;

    const tier = this.tierCoordinator.getCurrentTier();
    const connected = this.webrtc.getConnectedPeers();

    let required: string[];
    if (tier === 'TIER1_FULL_MESH') {
      required = Array.from(planMesh(this.myIdentity.peerId, this.allPeers).desired);
    } else if (this.isLeader) {
      required = Array.from(this.backboneLeaders);
    } else {
      required = [this.assignedLeader, this.assignedStandbyLeader].filter(
        (x): x is string => Boolean(x)
      );
    }

    const have = connected.filter((p) => required.includes(p));
    this.joinTracker.setLinkProgress(have.length, required.length);

    // A single open link means signalling worked end to end; the full set means the tier's
    // admission requirement is met.
    if (have.length > 0) this.joinTracker.advance('LINKS_CONNECTED');
    if (required.length > 0 && have.length >= required.length) {
      this.joinTracker.advance('TOPOLOGY_CONFIRMED', { required: required.length });
      // Reachability is the last honest check: links can be open while routing has not yet
      // converged, and a peer that cannot be routed to is not yet a participant.
      if (this.router.getReachable().length >= this.allPeers.size - 1) {
        this.joinTracker.advance('ACTIVE');
      }
    }
  }

  /** Current admission state, for diagnostics and bug reports. */
  public getJoinState() {
    return this.joinTracker.getSnapshot();
  }

  /** One-line join trace: which stages were reached, when, and where it stalled. */
  public formatJoinTrace(): string {
    return this.joinTracker.format();
  }

  /** Identity, routing and snapshot diagnostics. */
  public getPersistenceStats() {
    return this.webrtc.getIdentityStats();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Link-state routing
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Periodically re-advertises our neighbour set and ages out departed peers.
   *
   * The router rate-limits its own emissions, so calling this on a short tick is safe: it
   * only produces an LSA when something actually changed and the cooldown has elapsed.
   */
  private startRoutingLoop() {
    this.stopRoutingLoop();
    this.routerTimer = setInterval(() => {
      this.router.ageOut();
      this.advertiseNeighbours();
      this.updateJoinProgress();
    }, 2000);
  }

  private stopRoutingLoop() {
    if (this.routerTimer) {
      clearInterval(this.routerTimer);
      this.routerTimer = null;
    }
  }

  /** Publishes our current neighbour set with measured link costs. */
  private advertiseNeighbours() {
    if (!this.myIdentity) return;

    // Cost is the monitor's smoothed RTT where we have one. A link we have not measured yet
    // gets a neutral estimate rather than 0 — claiming a free link would make every path
    // prefer to route through us before we know anything about it.
    const health = new Map(this.linkMonitor.getHealth().map((h) => [h.peerId, h.rttMs]));
    const neighbours = this.webrtc.getConnectedPeers().map((peerId) => ({
      peerId,
      costMs: health.get(peerId) ?? 50,
    }));

    const lsa = this.router.updateLocalNeighbours(neighbours);
    if (lsa) this.floodLSA(lsa, null);
  }

  /**
   * Floods an LSA to every neighbour except the one it arrived from (split horizon).
   *
   * Sent directly rather than through the route resolver: flooding is how the routing table
   * is built, so it cannot depend on the routing table being correct yet.
   */
  private floodLSA(lsa: LSA, exceptPeerId: string | null) {
    if (!this.myIdentity) return;
    for (const peerId of this.webrtc.getConnectedPeers()) {
      if (peerId === exceptPeerId) continue;
      const packet = createPacket(
        'link:lsa' as any,
        this.myIdentity,
        this.currentRoomId,
        { ...lsa, ttl: Math.max(0, lsa.ttl - 1) },
        peerId,
        { channelPriority: 'control', priority: 'CONTROL' }
      );
      this.webrtc.sendPacket(peerId, packet);
    }
  }

  /**
   * Pushes our whole database to a peer whose link has just come up.
   *
   * Required for correctness, not merely as an optimisation. Flooding only propagates LSAs
   * as they are generated, so without this exchange two peers that were previously apart
   * would each keep a database the other never learns — a healed partition would stay
   * partitioned in the routing tables, and a peer joining an established room would learn
   * only about future changes rather than the room as it already is.
   */
  private syncDatabaseWith(peerId: string) {
    if (!this.myIdentity) return;

    // Batched to fit the DataChannel. This send deliberately bypasses the PacketPipeline —
    // and therefore the chunker — so the snapshot bounds its own message size. A 24-peer
    // room already produced a 10 KB payload, well past the 7 KiB the chunker exists to
    // split, and an unsent push means a healed partition never merges.
    const batches = this.router.getDatabaseSnapshotBatches();
    for (const lsas of batches) {
      if (lsas.length === 0) continue;
      const packet = createPacket(
        'link:lsdb_sync' as any,
        this.myIdentity,
        this.currentRoomId,
        { lsas },
        peerId,
        { channelPriority: 'bulk', priority: 'CONTROL' }
      );
      if (!this.webrtc.sendPacket(peerId, packet)) {
        // The link went away mid-push. Stop rather than burning sends into a dead channel;
        // the next adjacency event will push again from scratch, and the exchange is
        // idempotent so a partial transfer costs nothing.
        break;
      }
    }
  }

  /** Routing diagnostics. */
  public getRoutingStats() {
    return this.router.getStats();
  }

  /** The verified topology this peer can see, for persistence and diagnostics. */
  public getKnownTopology() {
    return this.router.getTopology();
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
      this.joinTracker.advance('SIGNALING_ESTABLISHED', { kind: type });
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

        // New adjacency: exchange databases, then re-advertise so the rest of the room
        // learns about this link. Order matters — the peer needs our database before our
        // new LSA references it.
        this.syncDatabaseWith(peerId);
        this.advertiseNeighbours();
        this.updateJoinProgress();

        if (this.isLeader && !this.backboneLeaders.has(peerId)) {
          this.clusterPeers.add(peerId);
        }
      } else if (status === 'disconnected' || status === 'failed') {
        this.clusterPeers.delete(peerId);
        this.standbyPeers.delete(peerId);

        // Withdraw the link promptly. Waiting for the periodic advertisement would leave
        // the rest of the room routing through an edge that no longer exists.
        this.advertiseNeighbours();

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
    this.affinity.note(fromPeerId, packet.type);

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

    if (packet.type === ('link:lsa' as any)) {
      const lsa = packet.payload as LSA;
      const res = this.router.handleLSA(lsa, fromPeerId);
      if (res.accepted && res.reflood) this.floodLSA(lsa, fromPeerId);
      return;
    }

    if (packet.type === ('link:lsdb_sync' as any)) {
      const lsas = (packet.payload as { lsas?: LSA[] })?.lsas ?? [];
      const novel = this.router.handleDatabaseSnapshot(lsas, fromPeerId);
      // Anything genuinely new to us is new to our other neighbours too.
      for (const lsa of novel) this.floodLSA(lsa, fromPeerId);
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

    // 5a. TIER1 broadcast propagation by reverse-path forwarding.
    //
    // TIER1 previously did no relaying whatsoever, and that was correct while the tier was a
    // full mesh: every peer received every broadcast directly from its origin, so forwarding
    // would only have produced duplicates. A sparse mesh silently invalidates that
    // assumption — peers more than one hop from the sender would simply never receive
    // broadcasts, which is a total delivery failure that looks like the app not working
    // rather than like a routing bug.
    //
    // RPF rather than plain flooding, and rather than an explicitly computed spanning tree:
    //
    //   - Plain flooding delivers, but every edge carries the packet in both directions:
    //     roughly N*k transmissions where a tree needs N-1. In a 30-peer room that is 180
    //     sends instead of 29.
    //   - An explicit tree is efficient but brittle. Peers must agree on it, and while they
    //     disagree — precisely during the churn when reliability matters most — packets fall
    //     off the tree and are lost outright, with no redundancy to cover the gap.
    //
    // RPF gets the tree's efficiency without storing a tree: forward a broadcast only if it
    // arrived from the neighbour we would use to reach its origin. That condition is true on
    // exactly one incoming edge per peer, so the shortest-path tree emerges implicitly from
    // the routing table and re-forms automatically whenever routes change.
    //
    // If routing has no opinion yet (pre-convergence, or an origin outside our map) we fall
    // back to forwarding anyway: duplicates are cheap and already deduplicated at step 1,
    // whereas dropping would lose the packet entirely.
    const isBroadcast = !packet.to;
    if (this.tierCoordinator.getCurrentTier() === 'TIER1_FULL_MESH' && isBroadcast) {
      const originId = packet.from?.peerId;
      if (originId && originId !== this.myIdentity?.peerId) {
        const upstream = this.router.nextHop(originId);
        const onReversePath = !upstream || upstream === fromPeerId;

        if (onReversePath) {
          // Send only to the peers for which we are the parent in the origin's tree. Every
          // peer derives the same tree from the same map, so this delivers to everyone while
          // transmitting once per tree edge rather than once per mesh edge.
          const children = this.router.getBroadcastChildren(originId);
          const targets =
            children ??
            // No map for this origin yet: forward broadly rather than lose the packet.
            this.webrtc.getConnectedPeers().filter((p) => p !== fromPeerId && p !== originId);

          for (const peerId of targets) {
            if (peerId === fromPeerId || peerId === originId) continue;
            this.webrtc.sendPacket(peerId, relayPacket);
          }
        }
      }
      return;
    }

    // 5b. Relay logic (Only Leaders relay packets in Tier 2!)
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
      // Outbound interactive traffic counts toward affinity too. Scoring only inbound would
      // mean the peer doing the typing never promotes the link to the peer watching — the
      // relationship is mutual even when the traffic is mostly one way.
      this.affinity.note(targetPeerId, packet.type);

      if (this.webrtc.isConnected(targetPeerId)) {
        return this.webrtc.sendPacket(targetPeerId, packet);
      }
      return false;
    }

    // P2P Broadcast
    const currentTier = this.tierCoordinator.getCurrentTier();
    if (currentTier === 'TIER1_FULL_MESH') {
      // Send to our neighbours only; RPF at each receiver carries it the rest of the way.
      //
      // Iterating connected peers rather than allPeers is what turns the cost from O(N) into
      // O(degree). In a full-mesh-sized room the two are identical, so small rooms are
      // unaffected; above the sparsity threshold this is the send-amplification saving.
      const children = this.router.getBroadcastChildren(this.myIdentity!.peerId);
      const targets = children ?? this.webrtc.getConnectedPeers();

      let anySent = false;
      for (const peerId of targets) {
        if (peerId === this.myIdentity?.peerId) continue;
        if (!this.webrtc.isConnected(peerId)) continue;
        this.webrtc.sendPacket(peerId, packet);
        anySent = true;
      }

      // If the tree told us to send to nobody but we do have neighbours, fall back. A tree
      // computed from a stale map must never silently swallow a broadcast at its source.
      if (!anySent) {
        for (const peerId of this.webrtc.getConnectedPeers()) {
          if (peerId === this.myIdentity?.peerId) continue;
          this.webrtc.sendPacket(peerId, packet);
          anySent = true;
        }
      }
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

  /** Subscribes to roster-confirmed peer departures. */
  public onPeerDeparted(handler: (peerId: string) => void): () => void {
    this.onPeerDepartedFns.add(handler);
    return () => this.onPeerDepartedFns.delete(handler);
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

