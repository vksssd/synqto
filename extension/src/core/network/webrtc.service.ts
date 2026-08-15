// ─── WebRTC Peer Connection & Multi-Subscriber Media Mesh Service ───

import { NetworkPacket } from './packet';

export interface PeerConnectionWrapper {
  peerId: string;
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  remoteStream: MediaStream | null;
  isInitiator: boolean;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed';
}

export class WebRTCService {
  private static instance: WebRTCService | null = null;
  private connections: Map<string, PeerConnectionWrapper> = new Map();
  
  // Independent Local Media Tracks (Audio & Video co-exist without collision)
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
    // 2. Cloudflare STUN
    { urls: 'stun:stun.cloudflare.com:3478' },
    // 3. OpenRelay Free Public TURN Relay (UDP + TCP + TLS Port 443 Strict Firewall Bypass)
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

  public static getInstance(): WebRTCService {
    if (!WebRTCService.instance) {
      WebRTCService.instance = new WebRTCService();
    }
    return WebRTCService.instance;
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

  private getCompositeLocalStream(): MediaStream {
    const stream = new MediaStream();
    if (this.localAudioTrack && this.localAudioTrack.readyState === 'live') {
      stream.addTrack(this.localAudioTrack);
    }
    if (this.localVideoTrack && this.localVideoTrack.readyState === 'live') {
      stream.addTrack(this.localVideoTrack);
    }
    return stream;
  }

  private syncTracksToAllPeers(kindFilter?: 'audio' | 'video') {
    const composite = this.getCompositeLocalStream();

    this.connections.forEach(async (wrapper, peerId) => {
      if (!wrapper.pc || wrapper.pc.connectionState === 'closed') return;

      const senders = wrapper.pc.getSenders();
      let modified = false;

      // Handle Audio Track
      if (!kindFilter || kindFilter === 'audio') {
        const audioSender = senders.find((s) => s.track?.kind === 'audio' || (s as any).kind === 'audio');
        if (this.localAudioTrack && this.localAudioTrack.readyState === 'live') {
          if (audioSender) {
            await audioSender.replaceTrack(this.localAudioTrack).catch(() => {});
          } else {
            try {
              wrapper.pc.addTrack(this.localAudioTrack, composite);
              modified = true;
            } catch (e) {}
          }
        } else if (audioSender) {
          try {
            await audioSender.replaceTrack(null).catch(() => {});
          } catch (e) {}
        }
      }

      // Handle Video Track
      if (!kindFilter || kindFilter === 'video') {
        const videoSender = senders.find((s) => s.track?.kind === 'video' || (s as any).kind === 'video');
        if (this.localVideoTrack && this.localVideoTrack.readyState === 'live') {
          if (videoSender) {
            await videoSender.replaceTrack(this.localVideoTrack).catch(() => {});
          } else {
            try {
              wrapper.pc.addTrack(this.localVideoTrack, composite);
              modified = true;
            } catch (e) {}
          }
        } else if (videoSender) {
          try {
            await videoSender.replaceTrack(null).catch(() => {});
          } catch (e) {}
        }
      }

      if (modified) {
        await this.renegotiate(peerId);
      }
    });
  }

  /**
   * Renegotiates SDP offer with a remote peer when tracks are added/removed.
   */
  public async renegotiate(remotePeerId: string): Promise<void> {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.pc || wrapper.pc.signalingState === 'closed') return;

    try {
      const offer = await wrapper.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await wrapper.pc.setLocalDescription(offer);

      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'offer', offer));
    } catch (err) {
      console.warn(`[WebRTCService] Renegotiation offer error for ${remotePeerId}:`, err);
    }
  }

  /**
   * Initiates a WebRTC connection to a remote peer (creates Offer and DataChannel)
   */
  public async initiateConnection(remotePeerId: string): Promise<void> {
    if (this.connections.has(remotePeerId)) {
      const existing = this.connections.get(remotePeerId)!;
      if (existing.status === 'connected' || existing.status === 'connecting') {
        return;
      }
      this.closeConnection(remotePeerId);
    }

    const pc = this.createPeerConnection(remotePeerId, true);
    const dc = pc.createDataChannel('synqto-data', {
      ordered: true,
    });
    this.setupDataChannel(remotePeerId, dc);

    const wrapper: PeerConnectionWrapper = {
      peerId: remotePeerId,
      pc,
      dataChannel: dc,
      remoteStream: null,
      isInitiator: true,
      status: 'connecting',
    };
    this.connections.set(remotePeerId, wrapper);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);

      this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'offer', offer));
    } catch (err) {
      console.error(`[WebRTCService] Failed to create offer for ${remotePeerId}:`, err);
      this.handleConnectionFailure(remotePeerId);
    }
  }

  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  private async flushPendingIce(remotePeerId: string, pc: RTCPeerConnection) {
    const candidates = this.pendingIceCandidates.get(remotePeerId) || [];
    if (candidates.length > 0) {
      this.pendingIceCandidates.delete(remotePeerId);
      for (const c of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          console.warn(`[WebRTCService] Failed to flush queued ICE candidate for ${remotePeerId}:`, err);
        }
      }
    }
  }

  /**
   * Handles incoming SDP offer (supports initial connection and renegotiation)
   */
  public async handleIncomingOffer(
    remotePeerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    let wrapper = this.connections.get(remotePeerId);

    // If existing active connection, handle as renegotiation without tearing down
    if (wrapper && wrapper.pc && wrapper.pc.signalingState !== 'closed') {
      try {
        if (wrapper.pc.signalingState === 'have-local-offer') {
          // SDP glare collision: rollback local offer to accept incoming offer
          await wrapper.pc.setLocalDescription({ type: 'rollback' });
        }
        await wrapper.pc.setRemoteDescription(new RTCSessionDescription(offer));
        await this.flushPendingIce(remotePeerId, wrapper.pc);
        const answer = await wrapper.pc.createAnswer();
        await wrapper.pc.setLocalDescription(answer);

        this.signalNeededListeners.forEach((fn) => fn(remotePeerId, 'answer', answer));
        return;
      } catch (err) {
        console.warn(`[WebRTCService] Renegotiation answer failed for ${remotePeerId}, recreating connection:`, err);
      }
    }

    // Otherwise initialize new peer connection
    if (wrapper) {
      this.closeConnection(remotePeerId);
    }

    const pc = this.createPeerConnection(remotePeerId, false);
    wrapper = {
      peerId: remotePeerId,
      pc,
      dataChannel: null, // Will be set in ondatachannel
      remoteStream: null,
      isInitiator: false,
      status: 'connecting',
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
      await wrapper.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`[WebRTCService] Failed to add ICE candidate for ${remotePeerId}:`, err);
    }
  }

  private createPeerConnection(remotePeerId: string, isInitiator: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });

    // Ensure audio & video transceivers are configured to receive stream tracks
    try {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
    } catch (e) {}

    // Add active local audio & video media stream tracks
    const composite = this.getCompositeLocalStream();
    if (this.localAudioTrack && this.localAudioTrack.readyState === 'live') {
      try {
        pc.addTrack(this.localAudioTrack, composite);
      } catch (e) {}
    }
    if (this.localVideoTrack && this.localVideoTrack.readyState === 'live') {
      try {
        pc.addTrack(this.localVideoTrack, composite);
      } catch (e) {}
    }

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

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        wrapper.dataChannel = dc;
      }
      this.setupDataChannel(remotePeerId, dc);
    };

    // Remote media track received (Screen share / Camera / Mic)
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

  private setupDataChannel(remotePeerId: string, dc: RTCDataChannel) {
    dc.onopen = () => {
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        wrapper.status = 'connected';
        this.connectionStateListeners.forEach((fn) => fn(remotePeerId, 'connected'));
      }
    };

    dc.onmessage = (event) => {
      try {
        const packet: NetworkPacket = JSON.parse(event.data);
        this.packetListeners.forEach((fn) => fn(remotePeerId, packet));
      } catch (err) {}
    };

    dc.onclose = () => {
      const wrapper = this.connections.get(remotePeerId);
      if (wrapper) {
        wrapper.status = 'disconnected';
      }
    };

    dc.onerror = () => {
      // Clean error catch
    };
  }

  public sendPacket(remotePeerId: string, packet: NetworkPacket): boolean {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper || !wrapper.dataChannel || wrapper.dataChannel.readyState !== 'open') {
      return false;
    }

    try {
      wrapper.dataChannel.send(JSON.stringify(packet));
      return true;
    } catch (err) {
      return false;
    }
  }

  public isConnected(remotePeerId: string): boolean {
    const wrapper = this.connections.get(remotePeerId);
    return Boolean(wrapper && wrapper.dataChannel && wrapper.dataChannel.readyState === 'open');
  }

  public getConnectedPeers(): string[] {
    const result: string[] = [];
    this.connections.forEach((wrapper, peerId) => {
      if (wrapper.dataChannel && wrapper.dataChannel.readyState === 'open') {
        result.push(peerId);
      }
    });
    return result;
  }

  public closeConnection(remotePeerId: string) {
    const wrapper = this.connections.get(remotePeerId);
    if (!wrapper) return;

    if (wrapper.dataChannel) {
      try {
        wrapper.dataChannel.close();
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
