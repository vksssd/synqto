// ─── WebRTC Peer Connection & Dual-Channel Mesh Service (Perfect Negotiation) ───

import { NetworkPacket } from './packet';
import {
  PeerIdentityStore,
  detectCandidateKind,
  extractFingerprint,
} from './peer-identity-store';

/**
 * Why an offer was created.
 *
 * Every createOffer must name one. The aggregate "110 offers, 56 answers, 1267 ICE" is
 * uninterpretable precisely because it has no attribution: it cannot distinguish a room that
 * negotiated once per peer from one looping on renegotiation, and those are opposite
 * problems. There is deliberately no UNKNOWN — an offer nobody can explain is the bug.
 */
export type NegotiationReason =
  | 'INITIAL'
  | 'NEGOTIATION_NEEDED'
  | 'ICE_RESTART'
  | 'TRACK_CHANGE'
  | 'RECOVERY';

export interface NegotiationRecord {
  peerId: string;
  /** Which PeerConnection instance for this peer, counting from 1. */
  generation: number;
  reason: NegotiationReason;
  at: number;
}

export interface WebRTCConnectionDiagnostic {
  kind:
    | 'signal-stage'
    | 'ice-candidate-stage'
    | 'ice-gathering-state'
    | 'ice-state'
    | 'peer-connection-state'
    | 'dtls-state'
    | 'sctp-state'
    | 'data-channel-state';
  remotePeerId: string;
  state: string;
  channel?: 'control' | 'bulk';
  generation?: number;
  reason?: NegotiationReason;
  candidateType?: 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
}

export interface PeerConnectionWrapper {
  peerId: string;
  /**
   * Which PeerConnection this is for this peer.
   *
   * Without a generation, SDP and ICE counts are summed across every connection ever built
   * to a peer, so "1267 ICE candidates" could be 12 connections gathering 100 each or one
   * connection gathering 1267 — the first is normal, the second is pathological, and the
   * aggregate cannot tell them apart.
   */
  generation: number;
  pc: RTCPeerConnection;
  controlChannel: RTCDataChannel | null;
  bulkChannel: RTCDataChannel | null;
  remoteStream: MediaStream | null;
  isInitiator: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed';
  makingOffer: boolean;
  ignoreOffer: boolean;
  isPolite: boolean;
  /**
   * When this wrapper entered 'connecting'. Exists to detect an offer or answer that was
   * handed to the signaling layer but never actually delivered — see sweepStuckConnections.
   * Without this a peer whose only path was a relay hop that silently failed to forward (the
   * relay had no route to the target yet) sits in 'connecting' forever: no browser timeout
   * fires because ICE never starts without a remote description, and the reconciliation loop
   * treats isConnecting()===true as "already being handled" and never retries.
   */
  connectingSince: number;
}

export class WebRTCService {
  private static instance: WebRTCService | null = null;
  private myPeerId = '';
  private connections: Map<string, PeerConnectionWrapper> = new Map();
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  /**
   * Bounds on ICE buffering.
   *
   * pendingIceCandidates is filled directly from the network by handleIncomingIce, before
   * any connection exists — so it is attacker-reachable and must be bounded on both axes.
   * A peer that trickles candidates forever, or a room where many peers signal and vanish,
   * would otherwise grow it without limit for the lifetime of the session.
   *
   * 40 candidates is generous: a typical host gathers 4-12 (host, srflx, relay per
   * interface/family). 200 peers far exceeds any real room.
   */
  private static readonly MAX_PENDING_ICE_PER_PEER = 40;
  private static readonly MAX_ICE_PEERS = 200;
  private iceDropped = 0;

  /** Stable DTLS identity, loaded once by prewarmIdentity(). */
  private cachedCertificate: RTCCertificate | null = null;
  /** Peers known to require TURN, so ICE can skip the doomed direct attempt. */
  private forceRelayPeers: Set<string> = new Set();
  private identityStore = PeerIdentityStore.getInstance();
  private fingerprintMismatches = 0;

  /** Per-peer PeerConnection generation counter. */
  private generations: Map<string, number> = new Map();
  /** Per-generation negotiation and candidate accounting, keyed `peerId#generation`. */
  private pcStats: Map<string, {
    peerId: string;
    generation: number;
    offers: Record<NegotiationReason, number>;
    answers: number;
    iceSent: number;
    iceReceived: number;
    /**
     * Locally gathered candidates by type. The decisive diagnostic for "connects on the same
     * machine but not across machines": host candidates alone are enough for loopback and
     * often for the same LAN, but a cross-network peer needs srflx (from STUN) or relay (from
     * TURN). Zero srflx means STUN produced nothing; zero relay means TURN did.
     */
    gathered: { host: number; srflx: number; relay: number };
    createdAt: number;
    closedAt?: number;
    closeReason?: string;
  }> = new Map();
  private recentNegotiations: NegotiationRecord[] = [];
  private static readonly MAX_NEGOTIATION_HISTORY = 200;

  // Distinct local media tracks
  private localAudioTrack: MediaStreamTrack | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;

  // Event listener sets for multi-service subscription without overwrite
  private packetListeners: Set<(fromPeerId: string, packet: NetworkPacket) => void> = new Set();
  private connectionStateListeners: Set<
    (peerId: string, status: 'connecting' | 'connected' | 'disconnected' | 'failed') => void
  > = new Set();
  private remoteStreamListeners: Set<(peerId: string, stream: MediaStream) => void> = new Set();
  private remoteStreamRemovedListeners: Set<(peerId: string) => void> = new Set();
  private signalNeededListeners: Set<
    (targetPeerId: string, type: 'offer' | 'answer' | 'ice', payload: any) => void
  > = new Set();
  private diagnosticListeners: Set<(event: WebRTCConnectionDiagnostic) => void> = new Set();
  /** One-shot stages already reported for a peer-connection generation. */
  private emittedDiagnosticMilestones: Set<string> = new Set();
  private static readonly MAX_DIAGNOSTIC_MILESTONES = 2_000;
  private observedDtlsTransports: WeakSet<object> = new WeakSet();
  private observedSctpTransports: WeakSet<object> = new WeakSet();

  private iceServers: RTCIceServer[] = [
    // 1. Google Public STUN
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // 2. Cloudflare Public STUN
    { urls: 'stun:stun.cloudflare.com:3478' },
    // 3. Matrix Public STUN
    { urls: 'stun:turn.matrix.org:3478' },
    // NO TURN SERVER IS CONFIGURED BY DEFAULT.
    //
    // This list previously carried openrelay.metered.ca with the public
    // openrelayproject/openrelayproject credentials. That host no longer resolves — the free
    // service was withdrawn — which made it worse than absent: a TURN URL that cannot be
    // resolved still consumes ICE gathering time waiting to fail, delaying the candidates that
    // would have worked.
    //
    // The consequence of having no TURN at all is specific and worth stating plainly, because
    // it matches a symptom that looks like a bug in this codebase: peers on the same machine
    // connect instantly (host candidates), peers on the same LAN usually connect (host again),
    // and peers across networks connect only when at least one side's NAT is permissive enough
    // for STUN's reflexive candidate to be usable. A pair where both sides are behind
    // symmetric NAT cannot connect at all without a relay — no amount of signalling fixes it,
    // because there is no path.
    //
    // TURN is therefore a deployment requirement, not an optimisation. Supply one via
    // setIceServers() (persisted in chrome.storage) or by editing this list:
    //
    //   - Cloudflare Calls TURN, Twilio NTS, or metered.ca's current paid tier
    //   - self-hosted coturn, which is the cheapest option at this scale
    //
    // getConnectivityDiagnosis() reports 'no-turn' whenever relay candidates are absent, so
    // this condition is visible rather than presenting as an unexplained connection failure.
  ];

  private constructor() {
    this.loadCustomIceServers();
  }

  private loadCustomIceServers() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['synqto_custom_ice_servers'], (res) => {
        if (res.synqto_custom_ice_servers && Array.isArray(res.synqto_custom_ice_servers)) {
          this.iceServers = [...this.iceServers, ...res.synqto_custom_ice_servers];
        }
      });
    }
  }

  public setIceServers(servers: RTCIceServer[]) {
    this.iceServers = servers;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ synqto_custom_ice_servers: servers });
    }
  }

  public getIceServers(): RTCIceServer[] {
    return this.iceServers;
  }

  public static getInstance(): WebRTCService {
    if (!WebRTCService.instance) {
      WebRTCService.instance = new WebRTCService();
    }
    return WebRTCService.instance;
  }

  public setMyPeerId(peerId: string) {
    this.myPeerId = peerId;
  }

  /**
   * Loads the persistent DTLS identity before any connection is built.
   *
   * Called from init rather than lazily inside createPeerConnection, because applying a
   * certificate requires it at construction time and createPeerConnection cannot be made
   * async without rippling through every caller. Loading it up front means the only
   * connections that miss it are ones attempted in the first few milliseconds of a cold
   * start, which fall back to an ephemeral identity and still work.
   */
  public async prewarmIdentity(): Promise<void> {
    try {
      this.cachedCertificate = await this.identityStore.getCertificate();
    } catch {
      this.cachedCertificate = null;
    }
  }

  /** Marks peers that have historically needed TURN, so ICE can skip direct attempts. */
  public async loadRelayHints(peerIds: string[], isCurrent: () => boolean = () => true): Promise<void> {
    for (const peerId of peerIds) {
      if (!isCurrent()) return;
      try {
        const shouldForceRelay = await this.identityStore.shouldForceRelay(peerId);
        if (!isCurrent()) return;
        if (shouldForceRelay) {
          this.forceRelayPeers.add(peerId);
        }
      } catch {
        // A hint is an optimisation; failing to load one must never block connecting.
      }
    }
  }

  public onRemoteStream(fn: (peerId: string, stream: MediaStream) => void): () => void {
    this.remoteStreamListeners.add(fn);
    return () => this.remoteStreamListeners.delete(fn);
  }

  public onRemoteStreamRemoved(fn: (peerId: string) => void): () => void {
    this.remoteStreamRemovedListeners.add(fn);
    return () => this.remoteStreamRemovedListeners.delete(fn);
  }

  public onPacket(fn: (fromPeerId: string, packet: NetworkPacket) => void): () => void {
    this.packetListeners.add(fn);
    return () => this.packetListeners.delete(fn);
  }

  public onConnectionState(
    fn: (peerId: string, status: 'connecting' | 'connected' | 'disconnected' | 'failed') => void
  ): () => void {
    this.connectionStateListeners.add(fn);
    return () => this.connectionStateListeners.delete(fn);
  }

  public onSignalNeeded(
    fn: (targetPeerId: string, type: 'offer' | 'answer' | 'ice', payload: any) => void
  ): () => void {
    this.signalNeededListeners.add(fn);
    return () => this.signalNeededListeners.delete(fn);
  }

  public onDiagnostic(fn: (event: WebRTCConnectionDiagnostic) => void): () => void {
    this.diagnosticListeners.add(fn);
    return () => this.diagnosticListeners.delete(fn);
  }

  private emitDiagnostic(event: WebRTCConnectionDiagnostic): void {
    const generation =
      event.generation ??
      this.connections.get(event.remotePeerId)?.generation ??
      this.generations.get(event.remotePeerId) ??
      0;
    const correlatedEvent = { ...event, generation };
    this.diagnosticListeners.forEach((fn) => {
      try {
        fn(correlatedEvent);
      } catch {
        // Diagnostics must never affect negotiation.
      }
    });
  }

  /** Emits a milestone once per peer-connection generation to keep candidate-heavy traces bounded. */
  private emitMilestone(event: WebRTCConnectionDiagnostic): void {
    const generation =
      event.generation ??
      this.connections.get(event.remotePeerId)?.generation ??
      this.generations.get(event.remotePeerId) ??
      0;
    const key = [
      event.remotePeerId,
      generation,
      event.kind,
      event.state,
      event.channel || '',
      event.reason || '',
      event.candidateType || '',
    ].join('|');
    if (this.emittedDiagnosticMilestones.has(key)) return;
    this.emittedDiagnosticMilestones.add(key);
    if (this.emittedDiagnosticMilestones.size > WebRTCService.MAX_DIAGNOSTIC_MILESTONES) {
      const oldest = this.emittedDiagnosticMilestones.values().next().value;
      if (oldest !== undefined) this.emittedDiagnosticMilestones.delete(oldest);
    }
    this.emitDiagnostic({ ...event, generation });
  }

  /**
   * Observes the transports browsers normally hide behind the aggregate connection state.
   * ICE succeeding does not prove DTLS or SCTP succeeded; recording each layer prevents a
   * failed SCTP start from being misreported as a generic WebRTC disconnect.
   */
  private observeTransportStates(remotePeerId: string, pc: RTCPeerConnection): void {
    const sctp = pc.sctp;
    if (!sctp) return;

    const reportSctp = () => {
      this.emitMilestone({ kind: 'sctp-state', remotePeerId, state: sctp.state });
    };
    const dtls = sctp.transport;
    const reportDtls = () => {
      this.emitMilestone({ kind: 'dtls-state', remotePeerId, state: dtls.state });
    };

    reportSctp();
    reportDtls();

    if (!this.observedSctpTransports.has(sctp)) {
      this.observedSctpTransports.add(sctp);
      sctp.addEventListener('statechange', reportSctp);
    }
    if (!this.observedDtlsTransports.has(dtls)) {
      this.observedDtlsTransports.add(dtls);
      dtls.addEventListener('statechange', reportDtls);
    }
  }

  public setCallbacks(callbacks: {
    onPacketReceived?: (fromPeerId: string, packet: NetworkPacket) => void;
    onConnectionStateChange?: (
      peerId: string,
      status: 'connecting' | 'connected' | 'disconnected' | 'failed'
    ) => void;
    onRemoteStreamReceived?: (peerId: string, stream: MediaStream) => void;
    onRemoteStreamRemoved?: (peerId: string) => void;
    onSignalNeeded?: (targetPeerId: string, type: 'offer' | 'answer' | 'ice', payload: any) => void;
  }) {
    if (callbacks.onPacketReceived) this.packetListeners.add(callbacks.onPacketReceived);
    if (callbacks.onConnectionStateChange) this.connectionStateListeners.add(callbacks.onConnectionStateChange);
    if (callbacks.onRemoteStreamReceived) this.remoteStreamListeners.add(callbacks.onRemoteStreamReceived);
    if (callbacks.onRemoteStreamRemoved) this.remoteStreamRemovedListeners.add(callbacks.onRemoteStreamRemoved);
    if (callbacks.onSignalNeeded) this.signalNeededListeners.add(callbacks.onSignalNeeded);
  }

  public setLocalAudioTrack(track: MediaStreamTrack | null) {
    this.localAudioTrack = track;
    this.syncTracksToAllPeers('audio');
  }

  public setLocalVideoTrack(track: MediaStreamTrack | null) {
    this.localVideoTrack = track;
    this.syncTracksToAllPeers('video');
  }

  public setLocalMediaStream(stream: MediaStream | null) {
    if (stream) {
      const audio = stream.getAudioTracks()[0] || null;
      const video = stream.getVideoTracks()[0] || null;
      if (audio) this.localAudioTrack = audio;
      if (video) this.localVideoTrack = video;
      this.syncTracksToAllPeers();
    } else {
      this.localAudioTrack = null;
      this.localVideoTrack = null;
      this.syncTracksToAllPeers();
    }
  }

  private async syncTracksToAllPeers(kindFilter?: 'audio' | 'video') {
    for (const [, wrapper] of this.connections.entries()) {
      if (!wrapper.pc || wrapper.pc.connectionState === 'closed') continue;

      const transceivers = wrapper.pc.getTransceivers();
      let needsRenegotiation = false;

      // 1. Audio Transceiver Sync
      if (!kindFilter || kindFilter === 'audio') {
        const audioTx = transceivers.find((t) => t.receiver.track.kind === 'audio');
        if (audioTx) {
          const trackToSet = this.localAudioTrack && this.localAudioTrack.readyState === 'live' ? this.localAudioTrack : null;
          if (audioTx.sender.track !== trackToSet) {
            await audioTx.sender.replaceTrack(trackToSet).catch(() => {});
            audioTx.direction = trackToSet ? 'sendrecv' : 'recvonly';
            needsRenegotiation = true;
          }
        }
      }

      // 2. Video Transceiver Sync
      if (!kindFilter || kindFilter === 'video') {
        const videoTx = transceivers.find((t) => t.receiver.track.kind === 'video');
        if (videoTx) {
          const trackToSet = this.localVideoTrack && this.localVideoTrack.readyState === 'live' ? this.localVideoTrack : null;
          if (videoTx.sender.track !== trackToSet) {
            await videoTx.sender.replaceTrack(trackToSet).catch(() => {});
            videoTx.direction = trackToSet ? 'sendrecv' : 'recvonly';
            needsRenegotiation = true;
          }
        }
      }

      if (needsRenegotiation) {
        await this.renegotiate(wrapper.peerId, 'TRACK_CHANGE');
      }
    }
  }

  /**
   * Renegotiates SDP offer using Perfect Negotiation
   */
  public async renegotiate(
    remotePeerId: string,
    reason: NegotiationReason = 'NEGOTIATION_NEEDED'
  ): Promise<void> {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc) return;

    const signalingState = wrapper.pc.signalingState as string;
    if (signalingState === 'closed') return;

    try {
      wrapper.makingOffer = true;
      const offer = await wrapper.pc.createOffer();
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-created',
        reason,
      });
      if ((wrapper.pc.signalingState as string) === 'closed') return;
      await wrapper.pc.setLocalDescription(offer);
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-local-applied',
        reason,
      });
      this.observeTransportStates(remotePeerId, wrapper.pc);

      this.noteOffer(remotePeerId, reason);
      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'offer', offer));
    } catch (err) {
      console.warn(`[WebRTCService] Renegotiation offer error for ${remotePeerId}:`, err);
    } finally {
      if (wrapper) wrapper.makingOffer = false;
    }
  }

  /**
   * Triggers an ICE restart to recover from stale network/NAT states
   */
  public async restartIce(remotePeerId: string): Promise<void> {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc || (wrapper.pc.signalingState as string) === 'closed') {
      return this.initiateConnection(remotePeerId);
    }

    try {
      wrapper.makingOffer = true;
      const offer = await wrapper.pc.createOffer({ iceRestart: true });
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-created',
        reason: 'ICE_RESTART',
      });
      if ((wrapper.pc.signalingState as string) === 'closed') return;
      await wrapper.pc.setLocalDescription(offer);
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-local-applied',
        reason: 'ICE_RESTART',
      });
      this.observeTransportStates(remotePeerId, wrapper.pc);

      this.noteOffer(remotePeerId, 'ICE_RESTART');
      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'offer', offer));
    } catch (err) {
      console.warn(`[WebRTCService] ICE restart offer error for ${remotePeerId}, re-initiating:`, err);
      this.closeConnection(remotePeerId);
      await this.initiateConnection(remotePeerId);
    } finally {
      if (wrapper) wrapper.makingOffer = false;
    }
  }

  /**
   * Initiates a WebRTC connection with Dual DataChannels (control & bulk)
   */
  public async initiateConnection(remotePeerId: string): Promise<void> {
    if (this.connections.has(remotePeerId)) {
      const existing = this.connections.get(remotePeerId)!;
      if (existing.status === 'connected' || existing.status === 'connecting') {
        return;
      }
      this.closeConnection(remotePeerId);
    }

    const isPolite = this.myPeerId ? this.myPeerId < remotePeerId : false;
    const pc = this.createPeerConnection(remotePeerId);

    // 1. Control channel (Ordered, low-latency, ACKs, presence, cursor, voice signaling)
    const controlChannel = pc.createDataChannel('synqto_control', {
      ordered: true,
      maxRetransmits: 5,
    });
    this.setupDataChannel(remotePeerId, controlChannel, 'control');

    // 2. Bulk channel (Unordered high throughput for screenshots, whiteboard state, blobs)
    const bulkChannel = pc.createDataChannel('synqto_bulk', {
      ordered: false,
    });
    this.setupDataChannel(remotePeerId, bulkChannel, 'bulk');

    const wrapper: PeerConnectionWrapper = {
      peerId: remotePeerId,
      generation: this.nextGeneration(remotePeerId),
      pc,
      controlChannel,
      bulkChannel,
      remoteStream: null,
      isInitiator: true,
      status: 'connecting',
      makingOffer: false,
      ignoreOffer: false,
      isPolite,
      connectingSince: Date.now(),
    };
    this.connections.set(remotePeerId, wrapper);
    this.emitMilestone({
      kind: 'data-channel-state',
      remotePeerId,
      state: 'created',
      channel: 'control',
    });
    this.emitMilestone({
      kind: 'data-channel-state',
      remotePeerId,
      state: 'created',
      channel: 'bulk',
    });

    try {
      wrapper.makingOffer = true;
      const offer = await pc.createOffer();
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-created',
        reason: 'INITIAL',
      });
      await pc.setLocalDescription(offer);
      this.emitMilestone({
        kind: 'signal-stage',
        remotePeerId,
        state: 'offer-local-applied',
        reason: 'INITIAL',
      });
      this.observeTransportStates(remotePeerId, pc);

      this.noteOffer(remotePeerId, 'INITIAL');
      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'offer', offer));
    } catch (err) {
      console.error(`[WebRTCService] Failed to create offer for ${remotePeerId}:`, err);
      this.handleConnectionFailure(remotePeerId);
    } finally {
      wrapper.makingOffer = false;
    }
  }

  private async flushPendingIce(remotePeerId: string, pc: RTCPeerConnection) {
    const candidates = this.pendingIceCandidates.get(remotePeerId) || [];
    if (candidates.length > 0) {
      this.pendingIceCandidates.delete(remotePeerId);
      for (const c of candidates) {
        try {
          if (c.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
            this.emitMilestone({
              kind: 'ice-candidate-stage',
              remotePeerId,
              state: 'applied',
              candidateType: this.candidateType(c),
            });
          }
        } catch (err) {
          console.warn(`[WebRTCService] Failed to flush queued ICE candidate for ${remotePeerId}:`, err);
        }
      }
    }
  }

  /**
   * Handles incoming SDP offer with W3C Perfect Negotiation
   */
  public async handleIncomingOffer(
    remotePeerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    let wrapper = this.connections.get(remotePeerId);
    const isPolite = this.myPeerId ? this.myPeerId < remotePeerId : false;

    // Handle existing connection renegotiation / offer collision
    if (wrapper && wrapper.pc && wrapper.pc.signalingState !== 'closed') {
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-received' });
      const offerCollision = wrapper.makingOffer || wrapper.pc.signalingState !== 'stable';
      wrapper.ignoreOffer = !isPolite && offerCollision;

      if (wrapper.ignoreOffer) {
        this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-ignored' });
        console.log(`[WebRTCService] Impolite peer ignoring colliding offer from ${remotePeerId}`);
        return;
      }

      if (offerCollision) {
        try {
          await wrapper.pc.setLocalDescription({ type: 'rollback' });
          this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-rollback' });
        } catch (e) {}
      }

      try {
        await wrapper.pc.setRemoteDescription(new RTCSessionDescription(offer));
        this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-remote-applied' });
        this.observeTransportStates(remotePeerId, wrapper.pc);
        await this.flushPendingIce(remotePeerId, wrapper.pc);
        const answer = await wrapper.pc.createAnswer();
        this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-created' });
        await wrapper.pc.setLocalDescription(answer);
        this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-local-applied' });
        this.observeTransportStates(remotePeerId, wrapper.pc);

        this.recordAnswer(remotePeerId);
        this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'answer', answer));
        return;
      } catch (err) {
        console.warn(`[WebRTCService] Perfect negotiation answer failed for ${remotePeerId}, resetting:`, err);
      }
    }

    if (wrapper) {
      this.closeConnection(remotePeerId);
    }

    const pc = this.createPeerConnection(remotePeerId);
    wrapper = {
      peerId: remotePeerId,
      generation: this.nextGeneration(remotePeerId),
      pc,
      controlChannel: null,
      bulkChannel: null,
      remoteStream: null,
      isInitiator: false,
      status: 'connecting',
      makingOffer: false,
      ignoreOffer: false,
      isPolite,
      connectingSince: Date.now(),
    };
    this.connections.set(remotePeerId, wrapper);
    this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-received' });

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'offer-remote-applied' });
      this.observeTransportStates(remotePeerId, pc);
      await this.flushPendingIce(remotePeerId, pc);
      const answer = await pc.createAnswer();
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-created' });
      await pc.setLocalDescription(answer);
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-local-applied' });
      this.observeTransportStates(remotePeerId, pc);

      this.recordAnswer(remotePeerId);
      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'answer', answer));
    } catch (err) {
      console.error(`[WebRTCService] Failed to handle offer from ${remotePeerId}:`, err);
      this.handleConnectionFailure(remotePeerId);
    }
  }

  /**
   * Handles incoming SDP answer
   */
  public async handleIncomingAnswer(
    remotePeerId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc || wrapper.pc.signalingState === 'closed') return;

    try {
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-received' });
      await wrapper.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.emitMilestone({ kind: 'signal-stage', remotePeerId, state: 'answer-remote-applied' });
      this.observeTransportStates(remotePeerId, wrapper.pc);
      await this.flushPendingIce(remotePeerId, wrapper.pc);
    } catch (err) {
      console.error(`[WebRTCService] Failed to set remote description for ${remotePeerId}:`, err);
    }
  }

  /**
   * Handles incoming ICE candidate
   */
  public async handleIncomingIce(
    remotePeerId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const candidateType = this.candidateType(candidate);
    this.emitMilestone({
      kind: 'ice-candidate-stage',
      remotePeerId,
      state: 'received',
      candidateType,
    });
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc || !wrapper.pc.remoteDescription || wrapper.pc.signalingState === 'closed') {
      // Buffer until the remote description exists — but bounded on both axes, because this
      // path is reachable from the network before any connection is established.
      if (
        !this.pendingIceCandidates.has(remotePeerId) &&
        this.pendingIceCandidates.size >= WebRTCService.MAX_ICE_PEERS
      ) {
        this.iceDropped++;
        this.emitMilestone({
          kind: 'ice-candidate-stage',
          remotePeerId,
          state: 'dropped',
          candidateType,
        });
        return;
      }
      if (!this.pendingIceCandidates.has(remotePeerId)) {
        this.pendingIceCandidates.set(remotePeerId, []);
      }
      const queue = this.pendingIceCandidates.get(remotePeerId)!;
      if (queue.length >= WebRTCService.MAX_PENDING_ICE_PER_PEER) {
        // Drop the oldest: later candidates are generally the more useful ones (srflx and
        // relay arrive after host), so discarding the tail would bias toward unusable
        // host-only candidates on a restricted network.
        queue.shift();
        this.iceDropped++;
      }
      queue.push(candidate);
      this.emitMilestone({
        kind: 'ice-candidate-stage',
        remotePeerId,
        state: 'queued',
        candidateType,
      });
      return;
    }

    try {
      if (candidate.candidate) {
        await wrapper.pc.addIceCandidate(new RTCIceCandidate(candidate));
        this.noteIce(remotePeerId, 'received');
        this.emitMilestone({
          kind: 'ice-candidate-stage',
          remotePeerId,
          state: 'applied',
          candidateType,
        });
      }
    } catch (err) {
      this.emitMilestone({
        kind: 'ice-candidate-stage',
        remotePeerId,
        state: 'rejected',
        candidateType,
      });
      console.warn(`[WebRTCService] Failed to add ICE candidate for ${remotePeerId}:`, err);
    }
  }

  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    // The persistent certificate is applied when it is already loaded. It cannot be awaited
    // here without making every caller async, and a connection built before the certificate
    // resolves is still perfectly valid — it just uses an ephemeral identity for that one
    // session. prewarmIdentity() loads it during init so that is a cold-start-only case.
    const config: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    };
    if (this.cachedCertificate) {
      config.certificates = [this.cachedCertificate];
    }
    if (this.forceRelayPeers.has(remotePeerId)) {
      // This peer has needed TURN more than once. Their NATs have not changed, so attempting
      // direct connectivity again would spend the full ICE timeout rediscovering that.
      config.iceTransportPolicy = 'relay';
    }

    const pc = new RTCPeerConnection(config);

    try {
      pc.addTransceiver(
        this.localAudioTrack && this.localAudioTrack.readyState === 'live' ? this.localAudioTrack : 'audio',
        { direction: this.localAudioTrack ? 'sendrecv' : 'recvonly' }
      );
      pc.addTransceiver(
        this.localVideoTrack && this.localVideoTrack.readyState === 'live' ? this.localVideoTrack : 'video',
        { direction: this.localVideoTrack ? 'sendrecv' : 'recvonly' }
      );
    } catch (e) {}

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Candidates are NOT cached for reuse. They are ephemeral by construction — the
        // port is released when this PeerConnection closes, and a NAT mapping expires within
        // minutes — so a stored candidate would point at nothing on the next connection.
        // What is worth persisting is which candidate TYPE succeeded; see
        // peer-identity-store.ts.
        this.noteIce(remotePeerId, 'sent');
        this.noteGatheredCandidate(remotePeerId, event.candidate!);
        this.emitMilestone({
          kind: 'ice-candidate-stage',
          remotePeerId,
          state: 'gathered',
          candidateType: this.candidateType(event.candidate),
        });
        this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'ice', event.candidate!.toJSON()));
      } else {
        this.emitMilestone({
          kind: 'ice-candidate-stage',
          remotePeerId,
          state: 'end-of-candidates',
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      this.emitDiagnostic({
        kind: 'ice-gathering-state',
        remotePeerId,
        state: pc.iceGatheringState,
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.emitDiagnostic({
        kind: 'peer-connection-state',
        remotePeerId,
        state,
      });
      this.observeTransportStates(remotePeerId, pc);

      if (state === 'connected') {
        // Record how this connection was actually established, so the next attempt to this
        // peer can start from what worked rather than rediscovering it.
        void this.recordConnectionOutcome(remotePeerId, pc);
      } else if (state === 'failed') {
        void this.identityStore.recordFailure(remotePeerId);
      }

      let status: 'connecting' | 'connected' | 'disconnected' | 'failed' = 'connecting';
      if (state === 'connected') status = 'connected';
      else if (state === 'disconnected') status = 'disconnected';
      else if (state === 'failed' || state === 'closed') status = 'failed';

      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        wrapper.status = status;
      }

      this.connectionStateListeners.forEach((fn) => fn(remotePeerId, status));

      if (state === 'failed' || state === 'closed') {
        this.closeConnection(remotePeerId, `connectionState=${state}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      this.emitDiagnostic({ kind: 'ice-state', remotePeerId, state: iceState });
      this.observeTransportStates(remotePeerId, pc);
      if (iceState === 'failed' || iceState === 'disconnected') {
        const wrapper = this.connections.get(remotePeerId);
        if (wrapper && wrapper.status === 'connected') {
          wrapper.status = 'disconnected';
          this.connectionStateListeners.forEach((fn) => fn(remotePeerId, 'disconnected'));
        }
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      const label = dc.label || '';
      const kind = label.includes('bulk') ? 'bulk' : 'control';
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        if (kind === 'bulk') {
          wrapper.bulkChannel = dc;
        } else {
          wrapper.controlChannel = dc;
        }
      }
      this.emitMilestone({
        kind: 'data-channel-state',
        remotePeerId,
        state: 'created',
        channel: kind,
      });
      this.setupDataChannel(remotePeerId, dc, kind);
    };

    // Remote media track received
    pc.ontrack = (event) => {
      const wrapper = this.connections.get(remotePeerId);
      let stream: MediaStream;

      if (event.streams && event.streams[0]) {
        stream = event.streams[0];
      } else if (wrapper && wrapper.remoteStream) {
        wrapper.remoteStream.addTrack(event.track);
        stream = wrapper.remoteStream;
      } else {
        stream = new MediaStream([event.track]);
      }

      if (wrapper) {
        wrapper.remoteStream = stream;
      }

      this.remoteStreamListeners.forEach((fn) => fn(remotePeerId, stream));
    };

    return pc;
  }

  private setupDataChannel(remotePeerId: string, dc: RTCDataChannel, kind: 'control' | 'bulk') {
    const handleOpen = () => {
      this.emitDiagnostic({
        kind: 'data-channel-state',
        remotePeerId,
        state: 'open',
        channel: kind,
      });
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        this.observeTransportStates(remotePeerId, wrapper.pc);
        wrapper.status = 'connected';
        this.connectionStateListeners.forEach((fn) => fn(remotePeerId, 'connected'));
      }
    };

    if (dc.readyState === 'open') {
      handleOpen();
    } else {
      dc.onopen = handleOpen;
    }

    dc.onmessage = (event) => {
      try {
        const packet: NetworkPacket = JSON.parse(event.data);
        this.packetListeners.forEach((fn) => fn(remotePeerId, packet));
      } catch (err) {}
    };

    dc.onclose = () => {
      this.emitDiagnostic({
        kind: 'data-channel-state',
        remotePeerId,
        state: 'closed',
        channel: kind,
      });
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        const isStillConnected = Boolean(
          (wrapper.controlChannel && wrapper.controlChannel.readyState === 'open') ||
          (wrapper.bulkChannel && wrapper.bulkChannel.readyState === 'open')
        );
        if (!isStillConnected) {
          wrapper.status = 'disconnected';
        }
      }
    };

    dc.onerror = () => {
      this.emitDiagnostic({
        kind: 'data-channel-state',
        remotePeerId,
        state: 'error',
        channel: kind,
      });
    };
  }

  /**
   * Intelligently routes packet to either control or bulk DataChannel
   */
  public sendPacket(remotePeerId: string, packet: NetworkPacket): boolean {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return false;

    const data = JSON.stringify(packet);

    if (packet.channelPriority === 'bulk' && wrapper.bulkChannel && wrapper.bulkChannel.readyState === 'open') {
      try {
        wrapper.bulkChannel.send(data);
        return true;
      } catch (e) {}
    }

    if (wrapper.controlChannel && wrapper.controlChannel.readyState === 'open') {
      try {
        wrapper.controlChannel.send(data);
        return true;
      } catch (e) {
        return false;
      }
    }

    if (wrapper.bulkChannel && wrapper.bulkChannel.readyState === 'open') {
      try {
        wrapper.bulkChannel.send(data);
        return true;
      } catch (e) {
        return false;
      }
    }

    return false;
  }

  public isConnected(remotePeerId: string): boolean {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return false;
    return Boolean(
      (wrapper.controlChannel && wrapper.controlChannel.readyState === 'open') ||
      (wrapper.bulkChannel && wrapper.bulkChannel.readyState === 'open')
    );
  }

  public isConnecting(remotePeerId: string): boolean {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return false;
    return wrapper.status === 'connecting' || wrapper.makingOffer;
  }

  /**
   * Default budget for how long a connection may sit in 'connecting' before
   * sweepStuckConnections gives up on it. See that method for why this exists.
   *
   * 15s is generous relative to normal negotiation (host candidates land in under a second;
   * STUN/TURN reflexive candidates typically resolve within 2-4s) but short enough that a
   * genuinely undeliverable offer does not leave a newcomer waiting through several
   * reconciliation cycles before the mesh notices and tries a different path.
   */
  public static readonly STUCK_CONNECTING_MS = 15_000;

  /**
   * Resets any connection that has sat in 'connecting' for longer than maxAgeMs.
   *
   * This exists because a connection attempt can fail silently with no browser-level signal
   * to react to. handleIncomingOffer/initiateConnection hand the SDP to
   * PeerSignaling.route(), which prefers relaying through an existing mesh neighbour over the
   * server — but pickRelays' blind fan-out (used before routing has converged, which is
   * exactly the newcomer case) cannot verify the chosen neighbour can actually reach the
   * target. When it cannot, the neighbour drops the signal and route() has already reported
   * success. The local RTCPeerConnection then has a local description and nothing else: no
   * remote description ever arrives, so ICE never begins checking and `connectionState` never
   * leaves 'new' — there is no browser timeout to rescue this.
   *
   * Without this sweep, isConnecting() stays true forever and the reconciliation loop
   * (topology.service.ts) treats the peer as already being handled, so it is never retried.
   * A newcomer whose first attempt took the unlucky relay path would simply never join.
   *
   * Resetting closes the stuck attempt so the connection is fully absent from `connections`
   * afterward — the next reconciliation tick then sees neither isConnected() nor
   * isConnecting() and calls initiateConnection() again, this time with fresh routing state
   * (the relay attempt that failed will itself have taught the mesh something, if link-state
   * has advanced) or a renewed server fallback.
   */
  public sweepStuckConnections(maxAgeMs: number = WebRTCService.STUCK_CONNECTING_MS): string[] {
    const now = Date.now();
    const stuck: string[] = [];
    this.connections.forEach((wrapper, peerId) => {
      if (wrapper.status === 'connecting' && now - wrapper.connectingSince > maxAgeMs) {
        stuck.push(peerId);
      }
    });
    for (const peerId of stuck) {
      console.warn(`[WebRTCService] Connection to ${peerId} stuck in 'connecting' for over ${maxAgeMs}ms — resetting for retry`);
      this.handleConnectionFailure(peerId);
    }
    return stuck;
  }

  public getConnectionStatus(
    remotePeerId: string
  ): 'connecting' | 'connected' | 'disconnected' | 'failed' | 'idle' {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return 'idle';
    return wrapper.status;
  }

  public getConnectedPeers(): string[] {
    const result: string[] = [];
    this.connections.forEach((wrapper, peerId) => {
      if (
        (wrapper.controlChannel && wrapper.controlChannel.readyState === 'open') ||
        (wrapper.bulkChannel && wrapper.bulkChannel.readyState === 'open')
      ) {
        result.push(peerId);
      }
    });
    return result;
  }

  /** Correlates topology-level signal routing events with this peer's current PC attempt. */
  public getConnectionGeneration(remotePeerId: string): number {
    return this.connections.get(remotePeerId)?.generation ?? this.generations.get(remotePeerId) ?? 0;
  }

  private recordAnswer(peerId: string): void {
    const wrapper = this.connections.get(peerId);
    const gen = wrapper?.generation ?? this.generations.get(peerId) ?? 0;
    const stat = this.pcStats.get(this.statsKey(peerId, gen));
    if (stat) stat.answers++;
  }

  public closeConnection(remotePeerId: string, reason = 'explicit') {
    this.noteClose(remotePeerId, reason);
    // Drop buffered ICE first, unconditionally.
    //
    // This used to sit at the end of the method, after an early `if (!wrapper) return`.
    // ICE candidates arriving for a peer we never built a PeerConnection for — a peer that
    // signalled and then vanished, or one whose offer never arrived — were buffered by
    // handleIncomingIce and then never reachable by any cleanup path, because there was no
    // wrapper for closeConnection to find. The buffer grew for the lifetime of the session.
    this.pendingIceCandidates.delete(remotePeerId);

    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return;

    if (wrapper.controlChannel) {
      try {
        wrapper.controlChannel.close();
      } catch (e) {}
    }
    if (wrapper.bulkChannel) {
      try {
        wrapper.bulkChannel.close();
      } catch (e) {}
    }
    if (wrapper.pc) {
      try {
        wrapper.pc.close();
      } catch (e) {}
    }
    if (wrapper.remoteStream) {
      this.remoteStreamRemovedListeners.forEach((fn) => fn(remotePeerId));
    }

    this.connections.delete(remotePeerId);
  }

  public closeAll() {
    const peerIds = Array.from(this.connections.keys());
    peerIds.forEach((id) => this.closeConnection(id));
    // ICE can arrive before an offer creates a wrapper. Those peer IDs are absent from
    // `connections`, so iterating live wrappers alone leaves their candidate queues behind
    // across rooms. The remaining maps are also session diagnostics, not durable identity
    // hints; retaining them would grow one peer/generation entry per room forever.
    this.pendingIceCandidates.clear();
    this.generations.clear();
    this.pcStats.clear();
    this.recentNegotiations = [];
    this.emittedDiagnosticMilestones.clear();
    this.observedDtlsTransports = new WeakSet();
    this.observedSctpTransports = new WeakSet();
    this.iceDropped = 0;
  }

  /**
   * Persists the candidate type and DTLS fingerprint of a successful connection.
   *
   * The fingerprint check is identity pinning: a peer ID presenting a different key than we
   * recorded is either a genuine new install or an impersonation attempt, and the two are
   * indistinguishable from here. It is counted rather than enforced — refusing the
   * connection would lock out anyone who reinstalled or cleared storage, which is a far more
   * common event than an attack. Surfacing it is the useful part.
   */
  private async recordConnectionOutcome(remotePeerId: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const kind = await detectCandidateKind(pc);
      const fingerprint = extractFingerprint(pc.remoteDescription?.sdp);

      if (fingerprint && (await this.identityStore.isFingerprintMismatch(remotePeerId, fingerprint))) {
        this.fingerprintMismatches++;
        console.warn(
          `[WebRTCService] Peer ${remotePeerId} presented a different DTLS fingerprint than previously recorded`
        );
      }

      if (kind) {
        await this.identityStore.recordSuccess(remotePeerId, kind, fingerprint);
        if (kind === 'relay') this.forceRelayPeers.add(remotePeerId);
        else this.forceRelayPeers.delete(remotePeerId);
      }
    } catch {
      // Diagnostics only — never let this affect the connection.
    }
  }

  /**
   * Whether this client can reach peers beyond its own machine, and if not, why.
   *
   * Reported as a verdict rather than raw counters because the raw numbers require knowing
   * what host/srflx/relay mean to interpret, and the actionable distinction is simple: no
   * srflx means STUN is not reachable, no relay means TURN is not usable, and with neither
   * only same-machine (and sometimes same-LAN) connections can ever succeed.
   */
  public getConnectivityDiagnosis(): {
    verdict: 'ok' | 'no-stun' | 'no-turn' | 'host-only' | 'unknown';
    detail: string;
    gathered: { host: number; srflx: number; relay: number };
  } {
    const totals = { host: 0, srflx: 0, relay: 0 };
    for (const s of this.pcStats.values()) {
      totals.host += s.gathered.host;
      totals.srflx += s.gathered.srflx;
      totals.relay += s.gathered.relay;
    }

    if (totals.host + totals.srflx + totals.relay === 0) {
      return { verdict: 'unknown', detail: 'No candidates gathered yet.', gathered: totals };
    }
    if (totals.srflx === 0 && totals.relay === 0) {
      return {
        verdict: 'host-only',
        detail:
          'Only host candidates were gathered. This client can reach peers on the same machine ' +
          'and sometimes the same LAN, but cannot reach anyone across a network. Both STUN and ' +
          'TURN are unreachable.',
        gathered: totals,
      };
    }
    if (totals.relay === 0) {
      return {
        verdict: 'no-turn',
        detail:
          'No relay candidates. Peers behind symmetric NAT cannot be reached. Check that a ' +
          'working TURN server is configured.',
        gathered: totals,
      };
    }
    if (totals.srflx === 0) {
      return {
        verdict: 'no-stun',
        detail: 'No server-reflexive candidates — STUN is unreachable; every connection will pay for TURN.',
        gathered: totals,
      };
    }
    return { verdict: 'ok', detail: 'Host, reflexive and relay candidates all present.', gathered: totals };
  }

  /** Identity and reconnection-hint diagnostics. */
  public getIdentityStats() {
    return {
      hasPersistentCertificate: this.cachedCertificate !== null,
      forceRelayPeers: this.forceRelayPeers.size,
      fingerprintMismatches: this.fingerprintMismatches,
      iceDropped: this.iceDropped,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Negotiation accounting
  // ───────────────────────────────────────────────────────────────────────────

  private statsKey(peerId: string, generation: number): string {
    return `${peerId}#${generation}`;
  }

  private nextGeneration(peerId: string): number {
    const gen = (this.generations.get(peerId) ?? 0) + 1;
    this.generations.set(peerId, gen);
    this.pcStats.set(this.statsKey(peerId, gen), {
      peerId,
      generation: gen,
      offers: {
        INITIAL: 0,
        NEGOTIATION_NEEDED: 0,
        ICE_RESTART: 0,
        TRACK_CHANGE: 0,
        RECOVERY: 0,
      },
      answers: 0,
      iceSent: 0,
      iceReceived: 0,
      gathered: { host: 0, srflx: 0, relay: 0 },
      createdAt: Date.now(),
    });

    // Bounded: keyed by peer and generation, both of which grow over a long session.
    if (this.pcStats.size > 400) {
      const oldest = this.pcStats.keys().next().value;
      if (oldest !== undefined) this.pcStats.delete(oldest);
    }
    return gen;
  }

  /** Records an offer against its connection generation and reason. */
  private noteOffer(peerId: string, reason: NegotiationReason): void {
    const wrapper = this.connections.get(peerId);
    const gen = wrapper?.generation ?? this.generations.get(peerId) ?? 0;
    const stat = this.pcStats.get(this.statsKey(peerId, gen));
    if (stat) stat.offers[reason]++;

    this.recentNegotiations.push({ peerId, generation: gen, reason, at: Date.now() });
    if (this.recentNegotiations.length > WebRTCService.MAX_NEGOTIATION_HISTORY) {
      this.recentNegotiations.shift();
    }
  }

  /**
   * Records the TYPE of each locally gathered candidate.
   *
   * `candidate.type` is authoritative and free — it is already parsed by the browser — and it
   * answers the one question that separates a signalling bug from a connectivity bug. A peer
   * that gathers only `host` will connect to another tab on the same machine and to nothing
   * else, which is exactly the reported symptom.
   */
  private noteGatheredCandidate(peerId: string, candidate: RTCIceCandidate): void {
    const wrapper = this.connections.get(peerId);
    const gen = wrapper?.generation ?? this.generations.get(peerId) ?? 0;
    const stat = this.pcStats.get(this.statsKey(peerId, gen));
    if (!stat) return;

    const type = candidate.type;
    if (type === 'relay') stat.gathered.relay++;
    else if (type === 'srflx' || type === 'prflx') stat.gathered.srflx++;
    else stat.gathered.host++;
  }

  /** Returns only the non-sensitive candidate category; addresses and ports never enter logs. */
  private candidateType(
    candidate: RTCIceCandidate | RTCIceCandidateInit
  ): 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown' {
    const parsed = (candidate as RTCIceCandidate).type;
    if (parsed === 'host' || parsed === 'srflx' || parsed === 'prflx' || parsed === 'relay') {
      return parsed;
    }
    const raw = typeof candidate.candidate === 'string' ? candidate.candidate : '';
    const token = /\btyp\s+(host|srflx|prflx|relay)\b/i.exec(raw)?.[1]?.toLowerCase();
    return token === 'host' || token === 'srflx' || token === 'prflx' || token === 'relay'
      ? token
      : 'unknown';
  }

  private noteIce(peerId: string, direction: 'sent' | 'received'): void {
    const wrapper = this.connections.get(peerId);
    const gen = wrapper?.generation ?? this.generations.get(peerId) ?? 0;
    const stat = this.pcStats.get(this.statsKey(peerId, gen));
    if (!stat) return;
    if (direction === 'sent') stat.iceSent++;
    else stat.iceReceived++;
  }

  private noteClose(peerId: string, reason: string): void {
    const wrapper = this.connections.get(peerId);
    const gen = wrapper?.generation ?? this.generations.get(peerId) ?? 0;
    const stat = this.pcStats.get(this.statsKey(peerId, gen));
    if (stat && !stat.closedAt) {
      stat.closedAt = Date.now();
      stat.closeReason = reason;
    }
  }

  /**
   * Per-generation negotiation accounting.
   *
   * The invariant to read this against: a stable PeerConnection with no network, media or
   * topology change should produce NO new SDP. A generation showing repeated
   * NEGOTIATION_NEEDED or ICE_RESTART without a corresponding cause is a renegotiation loop,
   * which the aggregate counters could never have revealed.
   */
  public getNegotiationStats() {
    const perGeneration = Array.from(this.pcStats.values()).map((s) => ({
      ...s,
      totalOffers: Object.values(s.offers).reduce((a, b) => a + b, 0),
      lifetimeMs: (s.closedAt ?? Date.now()) - s.createdAt,
    }));

    const byReason: Record<string, number> = {};
    for (const s of perGeneration) {
      for (const [reason, count] of Object.entries(s.offers)) {
        byReason[reason] = (byReason[reason] ?? 0) + count;
      }
    }

    // Generations that renegotiated more than once are where a loop would show.
    const suspicious = perGeneration
      .filter((s) => s.totalOffers > 2)
      .map((s) => `${s.peerId}#${s.generation}: ${s.totalOffers} offers`);

    return {
      byReason,
      generations: perGeneration.length,
      peersWithMultipleGenerations: Array.from(this.generations.entries())
        .filter(([, g]) => g > 1)
        .map(([peerId, g]) => ({ peerId, generations: g })),
      suspicious,
      recent: [...this.recentNegotiations].slice(-20),
    };
  }

  private handleConnectionFailure(remotePeerId: string) {
    this.closeConnection(remotePeerId);
    this.connectionStateListeners.forEach((fn) => fn(remotePeerId, 'failed'));
  }
}
