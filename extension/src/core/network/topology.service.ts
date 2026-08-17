// ─── Hierarchical Topology Service (Dual-Leader Standby & Resilient Mesh Router) ───

import { NetworkPacket, PeerIdentity, createPacket } from './packet';
import { SignalingService, RosterData, PromoteData, DemoteData } from './signaling.service';
import { WebRTCService } from './webrtc.service';
import { TopologyEpoch } from '../types/identifiers';
import { TierCoordinator } from '../topology/tier-coordinator';
import { LeaderMesh } from '../topology/leader-mesh';
import { LeaderDigest, TopologyTier, TopologyLifecycleState } from '../topology/topology.types';

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
    this.tierCoordinator = new TierCoordinator();

    this.tierCoordinator.onTierChanged((newTier, oldTier) => {
      this.topologyEpoch++;
      console.info(`[TopologyService] Tier transition: ${oldTier} -> ${newTier} (epoch ${this.topologyEpoch})`);
      this.reconcileConnections();
      this.emitState();
    });

    this.tierCoordinator.onStateChanged(() => {
      this.emitState();
    });

    this.setupSignalingListeners();
    this.setupWebRTCListeners();
  }

  public static getInstance(): TopologyService {
    if (!TopologyService.instance) {
      TopologyService.instance = new TopologyService();
    }
    return TopologyService.instance;
  }

  public init(identity: PeerIdentity, roomId: string) {
    this.myIdentity = identity;
    this.currentRoomId = roomId;
    this.seenPacketIds.clear();
    this.packetIdOrder = [];
    this.retryAttempts.clear();
    this.clearAllRetryTimers();
    this.tierCoordinator.reset();

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

    this.webrtc.setMyPeerId(identity.peerId);

    // Connect to signaling server
    this.signaling.connect(roomId, identity.peerId, identity.nickname);

    // Start background topology reconciliation loop
    this.startReconciliationLoop();
  }

  public leave() {
    this.stopReconciliationLoop();
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
    const delay = Math.min(8000, 1500 * Math.pow(1.5, Math.min(attempts, 4))) + Math.floor(Math.random() * 1000);
    this.retryAttempts.set(peerId, attempts + 1);

    const timer = setTimeout(() => {
      this.retryTimers.delete(peerId);
      if (this.allPeers.has(peerId) && !this.webrtc.isConnected(peerId)) {
        console.log(`[TopologyService] Reconnecting to peer ${peerId} (attempt #${attempts + 1})...`);
        this.webrtc.restartIce(peerId);
      }
    }, delay);

    this.retryTimers.set(peerId, timer);
  }

  private setupSignalingListeners() {
    // 1. Roster updates from server (Dual-Leader aware)
    this.signaling.on('roster', (roster: RosterData) => {
      this.allPeers = new Set(roster.peers.map((p) => p.peerId));
      this.tierCoordinator.updatePeerCount(roster.peers.length);

      const me = roster.peers.find((p) => p.peerId === this.myIdentity?.peerId);
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

  private setupWebRTCListeners() {
    this.webrtc.onSignalNeeded((targetPeerId, type, payload) => {
      if (type === 'offer') {
        this.signaling.sendOffer(targetPeerId, payload);
      } else if (type === 'answer') {
        this.signaling.sendAnswer(targetPeerId, payload);
      } else if (type === 'ice') {
        this.signaling.sendIce(targetPeerId, payload);
      }
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
        const isRequiredPeer =
          peerId === this.assignedLeader ||
          peerId === this.assignedStandbyLeader ||
          this.backboneLeaders.has(peerId);

        if (isRequiredPeer && this.allPeers.has(peerId)) {
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

    // 2. Intercept leader digests
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

