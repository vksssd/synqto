// ─── Tutor Stage & Multi-Broadcaster Live Stream Service (Phase II) ───

import { NetworkService } from '@/core/network/network.service';
import { WebRTCService } from '@/core/network/webrtc.service';
import { IdentityService } from '@/features/identity/identity.service';
import { GamificationService } from '@/features/gamification/gamification.service';
import {
  TutorStageState,
  ActiveStreamInfo,
  CursorPosition,
  ClickPulse,
  HandRaiseRequest,
  StageRole,
  BroadcastType,
} from './tutor.types';

export class TutorService {
  private static instance: TutorService | null = null;
  private network: NetworkService;
  private webrtc: WebRTCService;
  private identityService: IdentityService;
  private gamificationService: GamificationService;

  private state: TutorStageState = {
    isActive: false,
    tutorPeerId: null,
    tutorIdentity: null,
    guestSpeakers: [],
    handRaises: [],
    isMyHandRaised: false,
    myRole: 'audience',
    isAudioLive: false,
    isVideoLive: false,
    broadcastType: 'audio',
    activeStreams: [],
  };

  private remoteCursors: Map<string, CursorPosition> = new Map();
  private cursorListeners: Set<(cursors: CursorPosition[]) => void> = new Set();
  private stateListeners: Set<(state: TutorStageState) => void> = new Set();
  private remoteStreamListeners: Set<(stream: MediaStream | null, peerId: string | null) => void> = new Set();

  private lastCursorSentTime = 0;
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();
  private selectedStreamPeerId: string | null = null;

  private constructor() {
    this.network = NetworkService.getInstance();
    this.webrtc = WebRTCService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.gamificationService = GamificationService.getInstance();

    this.setupNetworkListeners();
    this.setupWebRTCListeners();
  }

  public static getInstance(): TutorService {
    if (!TutorService.instance) {
      TutorService.instance = new TutorService();
    }
    return TutorService.instance;
  }

  private setupNetworkListeners(): void {
    // 1. Mouse cursor synchronization
    this.network.on<CursorPosition>('canvas:cursor', (payload) => {
      this.handleIncomingCursor(payload);
    });

    // 2. Click ripple synchronization
    this.network.on<ClickPulse>('canvas:click', (payload) => {
      this.handleIncomingClick(payload);
    });

    // 3. Multi-stream announcement
    this.network.on<ActiveStreamInfo>('stream:announce', (streamInfo) => {
      this.handleIncomingStreamAnnounce(streamInfo);
    });

    // 4. Stream stopped announcement
    this.network.on<{ broadcasterPeerId: string }>('stream:stopped', (payload) => {
      this.handleIncomingStreamStopped(payload);
    });

    // 5. Stage state sync (backward compatibility)
    this.network.on<TutorStageState>('stage:state', (payload) => {
      this.handleIncomingStageState(payload);
    });

    // 6. Hand raise requests
    this.network.on<HandRaiseRequest>('stage:hand_raise', (payload) => {
      this.handleIncomingHandRaise(payload);
    });

    // 7. Hand response
    this.network.on<{ targetPeerId: string; accepted: boolean }>('stage:hand_response', (payload) => {
      this.handleIncomingHandResponse(payload);
    });
  }

  private setupWebRTCListeners(): void {
    this.webrtc.onRemoteStream((peerId, stream) => {
      this.remoteStreams.set(peerId, stream);
      if (!this.selectedStreamPeerId || !this.remoteStreams.has(this.selectedStreamPeerId)) {
        this.selectedStreamPeerId = peerId;
      }
      this.notifyStreamListeners();
    });

    this.webrtc.onRemoteStreamRemoved((peerId) => {
      this.remoteStreams.delete(peerId);
      if (this.selectedStreamPeerId === peerId) {
        const remaining = Array.from(this.remoteStreams.keys());
        this.selectedStreamPeerId = remaining.length > 0 ? remaining[0] : null;
      }
      this.notifyStreamListeners();
    });
  }

  private notifyStreamListeners(): void {
    const stream = this.getActiveRemoteStream();
    this.remoteStreamListeners.forEach((fn) => fn(stream, this.selectedStreamPeerId));
  }

  public setSelectedStream(peerId: string): void {
    this.selectedStreamPeerId = peerId;
    this.notifyStreamListeners();
    this.emitState();
  }

  public getSelectedStreamPeerId(): string | null {
    return this.selectedStreamPeerId;
  }

  public getActiveRemoteStream(): MediaStream | null {
    if (this.selectedStreamPeerId && this.remoteStreams.has(this.selectedStreamPeerId)) {
      return this.remoteStreams.get(this.selectedStreamPeerId)!;
    }
    return this.remoteStreams.values().next().value || null;
  }

  public getRemoteStreamByPeerId(peerId: string): MediaStream | null {
    return this.remoteStreams.get(peerId) || null;
  }

  public broadcastCursor(xPct: number, yPct: number, currentRoomId: string): void {
    const now = Date.now();
    if (now - this.lastCursorSentTime < 40) return;
    this.lastCursorSentTime = now;

    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || !currentRoomId) return;

    const isLiveBroadcaster = this.state.myRole === 'tutor' || this.state.myRole === 'speaker' || this.state.activeStreams.some((s) => s.broadcasterPeerId === myIdentity.peerId);

    const payload: CursorPosition = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      avatar: myIdentity.avatar,
      color: myIdentity.color,
      xPct,
      yPct,
      isTutor: isLiveBroadcaster,
      timestamp: now,
    };

    this.network.broadcast('canvas:cursor', payload);
    this.forwardCursorToContentScript(payload);
  }

  public broadcastClick(xPct: number, yPct: number, currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || !currentRoomId) return;

    const isLiveBroadcaster = this.state.myRole === 'tutor' || this.state.myRole === 'speaker' || this.state.activeStreams.some((s) => s.broadcasterPeerId === myIdentity.peerId);

    const payload: ClickPulse = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      xPct,
      yPct,
      color: myIdentity.color || '#6366f1',
      isTutor: isLiveBroadcaster,
      timestamp: Date.now(),
    };

    this.network.broadcast('canvas:click', payload);
    this.forwardClickToContentScript(payload);
  }

  private handleIncomingCursor(cursor: CursorPosition): void {
    if (!cursor || !cursor.peerId) return;
    this.remoteCursors.set(cursor.peerId, cursor);
    this.forwardCursorToContentScript(cursor);

    const cursorList = Array.from(this.remoteCursors.values());
    this.cursorListeners.forEach((fn) => fn(cursorList));
  }

  private handleIncomingClick(click: ClickPulse): void {
    if (!click || !click.peerId) return;
    this.forwardClickToContentScript(click);
  }

  private forwardCursorToContentScript(cursor: CursorPosition): void {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        chrome.tabs.query({}, (tabs) => {
          if (!Array.isArray(tabs)) return;
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'NERD_BUDDY_CURSOR_UPDATE',
                cursor,
              }).catch(() => {});
            }
          });
        });
      } catch (e) {}
    }
  }

  private forwardClickToContentScript(click: ClickPulse): void {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        chrome.tabs.query({}, (tabs) => {
          if (!Array.isArray(tabs)) return;
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'NERD_BUDDY_CLICK_PULSE',
                click,
              }).catch(() => {});
            }
          });
        });
      } catch (e) {}
    }
  }

  /**
   * Starts live broadcasting with chosen media mode and custom stream title
   */
  public async startTutorStage(
    broadcastType: BroadcastType,
    currentRoomId: string,
    customTitle?: string
  ): Promise<boolean> {
    const myIdentity = await this.identityService.getOrCreateIdentity();

    try {
      if (broadcastType === 'screen') {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        // Optionally attach microphone audio track if permitted
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.getAudioTracks().forEach((track) => screenStream.addTrack(track));
          } catch (e) {
            // Microphone track is optional; screen/tab audio continues cleanly without error popup
            console.debug('[TutorService] Screen share operating with system/tab audio (mic optional)');
          }
        }

        this.localStream = screenStream;
      } else if (broadcastType === 'camera') {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      } else {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      this.webrtc.setLocalMediaStream(this.localStream);

      // Connect with all room peers for direct streaming
      const topology = this.network.getTopologyState();
      topology.allPeers.forEach((peerId) => {
        if (peerId !== myIdentity.peerId) {
          this.webrtc.initiateConnection(peerId);
        }
      });

      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stopTutorStage(currentRoomId);
        };
      }

      const streamTitle =
        customTitle?.trim() ||
        `${myIdentity.nickname}'s ${broadcastType === 'screen' ? 'Screen Walkthrough' : broadcastType === 'camera' ? 'Video Stream' : 'Live Walkthrough'}`;

      const streamInfo: ActiveStreamInfo = {
        streamId: `stream-${myIdentity.peerId}-${Date.now()}`,
        broadcasterPeerId: myIdentity.peerId,
        broadcasterIdentity: myIdentity,
        title: streamTitle,
        broadcastType,
        startedAt: Date.now(),
      };

      const otherStreams = this.state.activeStreams.filter((s) => s.broadcasterPeerId !== myIdentity.peerId);

      this.state = {
        ...this.state,
        isActive: true,
        tutorPeerId: myIdentity.peerId,
        tutorIdentity: myIdentity,
        myRole: 'tutor',
        isAudioLive: true,
        isVideoLive: broadcastType !== 'audio',
        broadcastType,
        streamTitle,
        activeStreams: [...otherStreams, streamInfo],
      };

      this.gamificationService.unlockCustomBadge('live_tutor');

      // Announce stream to all room peers
      this.network.broadcast('stream:announce', streamInfo);
      this.broadcastStageState(currentRoomId);
      this.emitState();
      return true;
    } catch (err) {
      console.error('[TutorService] Failed to start stage stream:', err);
      return false;
    }
  }

  public stopTutorStage(currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.webrtc.setLocalMediaStream(null);

    const remainingStreams = this.state.activeStreams.filter(
      (s) => s.broadcasterPeerId !== (myIdentity?.peerId || '')
    );

    this.state = {
      ...this.state,
      isActive: remainingStreams.length > 0,
      tutorPeerId: remainingStreams[0]?.broadcasterPeerId || null,
      tutorIdentity: remainingStreams[0]?.broadcasterIdentity || null,
      myRole: 'audience',
      isAudioLive: false,
      isVideoLive: false,
      broadcastType: remainingStreams[0]?.broadcastType || 'audio',
      streamTitle: remainingStreams[0]?.title || undefined,
      activeStreams: remainingStreams,
    };

    if (myIdentity) {
      this.network.broadcast('stream:stopped', { broadcasterPeerId: myIdentity.peerId });
    }

    this.broadcastStageState(currentRoomId);
    this.emitState();
  }

  private handleIncomingStreamAnnounce(streamInfo: ActiveStreamInfo): void {
    if (!streamInfo || !streamInfo.broadcasterPeerId) return;

    const myIdentity = this.identityService.getCachedIdentity();
    const otherStreams = this.state.activeStreams.filter((s) => s.broadcasterPeerId !== streamInfo.broadcasterPeerId);
    const updatedStreams = [...otherStreams, streamInfo];

    this.state = {
      ...this.state,
      isActive: true,
      tutorPeerId: this.state.tutorPeerId || streamInfo.broadcasterPeerId,
      tutorIdentity: this.state.tutorIdentity || streamInfo.broadcasterIdentity,
      broadcastType: this.state.broadcastType || streamInfo.broadcastType,
      activeStreams: updatedStreams,
    };

    // Auto-select stream if none selected yet
    if (!this.selectedStreamPeerId || !this.remoteStreams.has(this.selectedStreamPeerId)) {
      this.selectedStreamPeerId = streamInfo.broadcasterPeerId;
    }

    // Ensure connection to broadcaster
    if (streamInfo.broadcasterPeerId !== myIdentity?.peerId) {
      if (!this.webrtc.isConnected(streamInfo.broadcasterPeerId)) {
        this.webrtc.initiateConnection(streamInfo.broadcasterPeerId);
      }
    }

    this.emitState();
  }

  private handleIncomingStreamStopped(payload: { broadcasterPeerId: string }): void {
    if (!payload?.broadcasterPeerId) return;

    const remainingStreams = this.state.activeStreams.filter((s) => s.broadcasterPeerId !== payload.broadcasterPeerId);
    this.remoteStreams.delete(payload.broadcasterPeerId);

    if (this.selectedStreamPeerId === payload.broadcasterPeerId) {
      this.selectedStreamPeerId = remainingStreams[0]?.broadcasterPeerId || null;
    }

    this.state = {
      ...this.state,
      isActive: remainingStreams.length > 0,
      tutorPeerId: remainingStreams[0]?.broadcasterPeerId || null,
      tutorIdentity: remainingStreams[0]?.broadcasterIdentity || null,
      activeStreams: remainingStreams,
    };

    this.notifyStreamListeners();
    this.emitState();
  }

  public raiseHand(currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || this.state.myRole !== 'audience') return;

    const request: HandRaiseRequest = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      avatar: myIdentity.avatar,
      requestedAt: Date.now(),
    };

    this.state.isMyHandRaised = true;
    this.network.broadcast('stage:hand_raise', request);
    this.emitState();
  }

  public lowerHand(currentRoomId: string): void {
    this.state.isMyHandRaised = false;
    this.emitState();
  }

  public acceptSpeaker(student: HandRaiseRequest, currentRoomId: string): void {
    if (this.state.myRole !== 'tutor') return;
    if (this.state.guestSpeakers.length >= 2) return;

    const identity = {
      peerId: student.peerId,
      nickname: student.nickname,
      avatar: student.avatar,
      color: '#10b981',
    };

    this.state.guestSpeakers = [...this.state.guestSpeakers, identity];
    this.state.handRaises = this.state.handRaises.filter((h) => h.peerId !== student.peerId);

    this.network.send(student.peerId, 'stage:hand_response', {
      targetPeerId: student.peerId,
      accepted: true,
    });

    this.broadcastStageState(currentRoomId);
    this.emitState();
  }

  public removeSpeaker(peerId: string, currentRoomId: string): void {
    if (this.state.myRole !== 'tutor') return;
    this.state.guestSpeakers = this.state.guestSpeakers.filter((s) => s.peerId !== peerId);
    this.broadcastStageState(currentRoomId);
    this.emitState();
  }

  private handleIncomingStageState(remoteState: TutorStageState): void {
    if (!remoteState) return;
    const myIdentity = this.identityService.getCachedIdentity();
    let myRole: StageRole = 'audience';

    if (myIdentity?.peerId === remoteState.tutorPeerId) {
      myRole = 'tutor';
    } else if (remoteState.guestSpeakers?.some((s) => s.peerId === myIdentity?.peerId)) {
      myRole = 'speaker';
      this.enableSpeakerAudio();
    }

    this.state = {
      ...remoteState,
      myRole,
      isMyHandRaised: this.state.isMyHandRaised && myRole === 'audience',
      activeStreams: remoteState.activeStreams || this.state.activeStreams,
    };

    if (remoteState.isActive && remoteState.tutorPeerId && remoteState.tutorPeerId !== myIdentity?.peerId) {
      if (!this.webrtc.isConnected(remoteState.tutorPeerId)) {
        this.webrtc.initiateConnection(remoteState.tutorPeerId);
      }
    }

    this.emitState();
  }

  private async enableSpeakerAudio(): Promise<void> {
    if (!this.localStream && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.webrtc.setLocalMediaStream(this.localStream);
      } catch (e) {
        console.debug('[TutorService] Speaker mic track bypassed:', e);
      }
    }
  }

  private handleIncomingHandRaise(request: HandRaiseRequest): void {
    if (!request || !request.peerId) return;
    if (this.state.myRole === 'tutor') {
      if (!this.state.handRaises.some((h) => h.peerId === request.peerId)) {
        this.state.handRaises = [...this.state.handRaises, request];
        this.emitState();
      }
    }
  }

  private handleIncomingHandResponse(response: { targetPeerId: string; accepted: boolean }): void {
    if (!response) return;
    const myIdentity = this.identityService.getCachedIdentity();
    if (myIdentity?.peerId === response.targetPeerId) {
      if (response.accepted) {
        this.state.myRole = 'speaker';
        this.state.isMyHandRaised = false;
        this.enableSpeakerAudio();
        this.emitState();
      }
    }
  }

  private broadcastStageState(currentRoomId: string): void {
    if (!currentRoomId) return;
    this.network.broadcast('stage:state', this.state);
  }

  public getState(): TutorStageState {
    return this.state;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public onStateChange(listener: (state: TutorStageState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onRemoteStreamChange(
    listener: (stream: MediaStream | null, peerId: string | null) => void
  ): () => void {
    this.remoteStreamListeners.add(listener);
    listener(this.getActiveRemoteStream(), this.selectedStreamPeerId);
    return () => {
      this.remoteStreamListeners.delete(listener);
    };
  }

  public onCursorsChange(listener: (cursors: CursorPosition[]) => void): () => void {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  public resetStage(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.webrtc.setLocalMediaStream(null);
    this.remoteStreams.clear();
    this.selectedStreamPeerId = null;
    this.remoteCursors.clear();
    this.state = {
      isActive: false,
      tutorPeerId: null,
      tutorIdentity: null,
      guestSpeakers: [],
      handRaises: [],
      isMyHandRaised: false,
      myRole: 'audience',
      isAudioLive: false,
      isVideoLive: false,
      broadcastType: 'audio',
      activeStreams: [],
    };
    this.emitState();
    this.notifyStreamListeners();
  }

  private emitState(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        synqto_live_stage: this.state,
        nerd_buddy_live_stage: this.state,
      });
    }
    this.stateListeners.forEach((fn) => fn(this.state));
  }
}
