// ─── WebRTC Peer Connection & Dual-Channel Mesh Service (Perfect Negotiation) ───

import { NetworkPacket } from './packet';

export interface PeerConnectionWrapper {
  peerId: string;
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
        await this.renegotiate(wrapper.peerId);
      }
    }
  }

  /**
   * Renegotiates SDP offer using Perfect Negotiation
   */
  public async renegotiate(remotePeerId: string): Promise<void> {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc) return;

    const signalingState = wrapper.pc.signalingState as string;
    if (signalingState === 'closed') return;

    try {
      wrapper.makingOffer = true;
      const offer = await wrapper.pc.createOffer();
      if ((wrapper.pc.signalingState as string) === 'closed') return;
      await wrapper.pc.setLocalDescription(offer);

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
      if (!this.pendingIceCandidates.has(remotePeerId)) {
        this.pendingIceCandidates.set(remotePeerId, []);
      }
      this.pendingIceCandidates.get(remotePeerId)!.push(candidate);
      return;
    }

    try {
      if (candidate.candidate) {
        await wrapper.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.warn(`[WebRTCService] Failed to add ICE candidate for ${remotePeerId}:`, err);
    }
  }

  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });

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
        this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'ice', event.candidate?.toJSON()));
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
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
        this.closeConnection(remotePeerId);
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

  public closeConnection(remotePeerId: string) {
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
    this.pendingIceCandidates.delete(remotePeerId);
  }

  public closeAll() {
    const peerIds = Array.from(this.connections.keys());
    peerIds.forEach((id) => this.closeConnection(id));
  }

  private handleConnectionFailure(remotePeerId: string) {
    this.closeConnection(remotePeerId);
    this.connectionStateListeners.forEach((fn) => fn(remotePeerId, 'failed'));
  }
}

