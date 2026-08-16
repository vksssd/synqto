// ─── Hierarchical Topology Service (Dual-Leader Standby & Resilient Mesh Router) ───

import { NetworkPacket, PeerIdentity, createPacket } from './packet';
import { SignalingService, RosterData, PromoteData, DemoteData } from './signaling.service';
import { WebRTCService } from './webrtc.service';

export interface TopologyState {
  isLeader: boolean;
  assignedLeader: string | null;
  assignedStandbyLeader: string | null;
  clusterPeers: string[];
  standbyPeers: string[];
  backboneLeaders: string[];
  allPeers: string[];
}

export class TopologyService {
  private static instance: TopologyService | null = null;
  private signaling: SignalingService;
  private webrtc: WebRTCService;

  private myIdentity: PeerIdentity | null = null;
  private currentRoomId = '';
  private isLeader = false;
  private assignedLeader: string | null = null;
  private assignedStandbyLeader: string | null = null;
  private clusterPeers: Set<string> = new Set();
  private standbyPeers: Set<string> = new Set();
  private backboneLeaders: Set<string> = new Set();
  private allPeers: Set<string> = new Set();

  // Deduplication sliding window (max 1500 items)
  private seenPacketIds: Set<string> = new Set();
  private packetIdOrder: string[] = [];
  private readonly MAX_SEEN_PACKETS = 1500;

  // Listeners for UI state and packet routing
  private packetListeners: Set<(packet: NetworkPacket) => void> = new Set();
  private stateListeners: Set<(state: TopologyState) => void> = new Set();

  private constructor() {
    this.signaling = SignalingService.getInstance();
    this.webrtc = WebRTCService.getInstance();

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

    this.webrtc.setMyPeerId(identity.peerId);

    // Connect to signaling server
    this.signaling.connect(roomId, identity.peerId, identity.nickname);
  }

  public leave() {
    this.signaling.disconnect();
    this.webrtc.closeAll();
    this.isLeader = false;
    this.assignedLeader = null;
    this.assignedStandbyLeader = null;
    this.clusterPeers.clear();
    this.standbyPeers.clear();
    this.backboneLeaders.clear();
    this.allPeers.clear();
    this.emitState();
  }

  private setupSignalingListeners() {
    // 1. Roster updates from server (Dual-Leader aware)
    this.signaling.on('roster', (roster: RosterData) => {
      this.allPeers = new Set(roster.peers.map((p) => p.peerId));
      const me = roster.peers.find((p) => p.peerId === this.myIdentity?.peerId);
      this.isLeader = me ? me.isLeader : false;

      if (this.isLeader) {
        this.assignedLeader = this.myIdentity?.peerId || null;
        this.assignedStandbyLeader = null;
        // Backbone leaders = all leaders except me
        this.backboneLeaders = new Set(
          roster.leaders.filter((lid) => lid !== this.myIdentity?.peerId)
        );

        // Ensure we connect to other leaders for backbone mesh
        this.backboneLeaders.forEach((leaderId) => {
          if (!this.webrtc.isConnected(leaderId)) {
            // Lexicographical tie-breaker for who initiates the connection
            if ((this.myIdentity?.peerId || '') < leaderId) {
              this.webrtc.initiateConnection(leaderId);
            }
          }
        });
      } else {
        this.assignedLeader = roster.yourLeader || null;
        this.assignedStandbyLeader = roster.yourStandbyLeader || null;
        this.clusterPeers.clear();
        this.standbyPeers.clear();
        this.backboneLeaders.clear();

        // Regular peer: 1) connect to primary assigned leader
        if (this.assignedLeader && this.assignedLeader !== this.myIdentity?.peerId) {
          if (!this.webrtc.isConnected(this.assignedLeader)) {
            this.webrtc.initiateConnection(this.assignedLeader);
          }
        }

        // Regular peer: 2) connect to warm standby leader for instant failover (<300ms)
        if (
          this.assignedStandbyLeader &&
          this.assignedStandbyLeader !== this.myIdentity?.peerId &&
          this.assignedStandbyLeader !== this.assignedLeader
        ) {
          if (!this.webrtc.isConnected(this.assignedStandbyLeader)) {
            this.webrtc.initiateConnection(this.assignedStandbyLeader);
          }
        }
      }

      this.emitState();
    });

    // 2. Leader Promotion event from server
    this.signaling.on('promote', (data: PromoteData) => {
      this.isLeader = true;
      this.assignedLeader = this.myIdentity?.peerId || null;
      this.assignedStandbyLeader = null;
      this.clusterPeers = new Set(data.clusterPeers);
      this.standbyPeers = new Set(data.standbyPeers || []);
      this.backboneLeaders = new Set(data.backboneLeaders);

      // Connect to other leaders in backbone
      this.backboneLeaders.forEach((leaderId) => {
        if (!this.webrtc.isConnected(leaderId)) {
          if ((this.myIdentity?.peerId || '') < leaderId) {
            this.webrtc.initiateConnection(leaderId);
          }
        }
      });

      this.emitState();
    });

    // 3. Leader Demotion event from server
    this.signaling.on('demote', (data: DemoteData) => {
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
      if (this.assignedLeader) {
        this.webrtc.initiateConnection(this.assignedLeader);
      }
      // Connect to standby leader
      if (this.assignedStandbyLeader && this.assignedStandbyLeader !== this.assignedLeader) {
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

    // 2. Deliver packet to local listeners
    this.deliverLocally(packet);

    // 3. Decrement TTL and check if relaying is allowed
    const remainingTtl = packet.ttl - 1;
    if (remainingTtl <= 0) {
      return;
    }

    const relayPacket: NetworkPacket = {
      ...packet,
      ttl: remainingTtl,
    };

    // 4. Relay logic (Only Leaders relay packets!)
    if (this.isLeader) {
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

