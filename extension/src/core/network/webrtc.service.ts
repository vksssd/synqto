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
    // 4. OpenRelay Free Public TURN Relay (UDP + TCP + TLS Port 443 Strict Firewall Bypass)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
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
  public async loadRelayHints(peerIds: string[]): Promise<void> {
    for (const peerId of peerIds) {
      try {
        if (await this.identityStore.shouldForceRelay(peerId)) {
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
      if ((wrapper.pc.signalingState as string) === 'closed') return;
      await wrapper.pc.setLocalDescription(offer);

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
      if ((wrapper.pc.signalingState as string) === 'closed') return;
      await wrapper.pc.setLocalDescription(offer);

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
    };
    this.connections.set(remotePeerId, wrapper);

    try {
      wrapper.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

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
      const offerCollision = wrapper.makingOffer || wrapper.pc.signalingState !== 'stable';
      wrapper.ignoreOffer = !isPolite && offerCollision;

      if (wrapper.ignoreOffer) {
        console.log(`[WebRTCService] Impolite peer ignoring colliding offer from ${remotePeerId}`);
        return;
      }

      if (offerCollision) {
        try {
          await wrapper.pc.setLocalDescription({ type: 'rollback' });
        } catch (e) {}
      }

      try {
        await wrapper.pc.setRemoteDescription(new RTCSessionDescription(offer));
        await this.flushPendingIce(remotePeerId, wrapper.pc);
        const answer = await wrapper.pc.createAnswer();
        await wrapper.pc.setLocalDescription(answer);

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
    };
    this.connections.set(remotePeerId, wrapper);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingIce(remotePeerId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

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
      await wrapper.pc.setRemoteDescription(new RTCSessionDescription(answer));
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
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc || !wrapper.pc.remoteDescription || wrapper.pc.signalingState === 'closed') {
      // Buffer until the remote description exists — but bounded on both axes, because this
      // path is reachable from the network before any connection is established.
      if (
        !this.pendingIceCandidates.has(remotePeerId) &&
        this.pendingIceCandidates.size >= WebRTCService.MAX_ICE_PEERS
      ) {
        this.iceDropped++;
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
      return;
    }

    try {
      if (candidate.candidate) {
        await wrapper.pc.addIceCandidate(new RTCIceCandidate(candidate));
        this.noteIce(remotePeerId, 'received');
      }
    } catch (err) {
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
        this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'ice', event.candidate!.toJSON()));
      }
      // event.candidate === null means gathering is complete; nothing to send.
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

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

  private setupDataChannel(remotePeerId: string, dc: RTCDataChannel, _kind: 'control' | 'bulk') {
    const handleOpen = () => {
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
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

    dc.onerror = () => {};
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

