// ─── Tutor Stage & Live Cursor Service (Phase II Full Implementation) ───

import { NetworkService } from '@/core/network/network.service';
import { WebRTCService } from '@/core/network/webrtc.service';
import { IdentityService } from '@/features/identity/identity.service';
import { GamificationService } from '@/features/gamification/gamification.service';
import { PeerIdentity } from '@/core/network/packet';
import {
  TutorStageState,
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
  };

  private remoteCursors: Map<string, CursorPosition> = new Map();
  private cursorListeners: Set<(cursors: CursorPosition[]) => void> = new Set();
  private stateListeners: Set<(state: TutorStageState) => void> = new Set();
  private remoteStreamListeners: Set<(stream: MediaStream | null) => void> = new Set();

  private lastCursorSentTime = 0;
  private localStream: MediaStream | null = null;
  private activeRemoteStream: MediaStream | null = null;

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
    this.network.on<CursorPosition>('canvas:cursor', (payload) => {
      this.handleIncomingCursor(payload);
    });

    this.network.on<ClickPulse>('canvas:click', (payload) => {
      this.handleIncomingClick(payload);
    });

    this.network.on<TutorStageState>('stage:state', (payload) => {
      this.handleIncomingStageState(payload);
    });

    this.network.on<HandRaiseRequest>('stage:hand_raise', (payload) => {
      this.handleIncomingHandRaise(payload);
    });

    this.network.on<{ targetPeerId: string; accepted: boolean }>('stage:hand_response', (payload) => {
      this.handleIncomingHandResponse(payload);
    });
  }

  private setupWebRTCListeners(): void {
    this.webrtc.onRemoteStream((peerId, stream) => {
      this.activeRemoteStream = stream;
      this.remoteStreamListeners.forEach((fn) => fn(stream));
    });

    this.webrtc.onRemoteStreamRemoved((peerId) => {
      this.activeRemoteStream = null;
      this.remoteStreamListeners.forEach((fn) => fn(null));
    });
  }

  /**
   * Broadcasts local mouse pointer as relative percentages (0-100%)
   * Throttled to 40ms (~25fps).
   */
  public broadcastCursor(xPct: number, yPct: number, currentRoomId: string): void {
    const now = Date.now();
    if (now - this.lastCursorSentTime < 40) return;
    this.lastCursorSentTime = now;

    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || !currentRoomId) return;

    const payload: CursorPosition = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      avatar: myIdentity.avatar,
      color: myIdentity.color,
      xPct,
      yPct,
      isTutor: this.state.myRole === 'tutor',
      timestamp: now,
    };

    this.network.broadcast('canvas:cursor', payload);
    this.forwardCursorToContentScript(payload);
  }

  /**
   * Broadcasts a click pulse at specific coordinates
   */
  public broadcastClick(xPct: number, yPct: number, currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || !currentRoomId) return;

    const payload: ClickPulse = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      xPct,
      yPct,
      color: myIdentity.color || '#6366f1',
      isTutor: this.state.myRole === 'tutor' || this.state.tutorPeerId === myIdentity.peerId,
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
   * Starts live broadcasting as Tutor / Host with chosen media mode:
   * 'audio' | 'camera' | 'screen'
   */
  public async startTutorStage(broadcastType: BroadcastType, currentRoomId: string): Promise<boolean> {
    const myIdentity = await this.identityService.getOrCreateIdentity();

    try {
      if (broadcastType === 'screen') {
        // Screen share with audio
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        // Also get microphone audio if available
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getAudioTracks().forEach((track) => screenStream.addTrack(track));
        } catch (e) {
          console.warn('[TutorService] Mic track optional for screen share:', e);
        }

        this.localStream = screenStream;
      } else if (broadcastType === 'camera') {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
      } else {
        // Audio only
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      // Attach stream tracks to WebRTC connections
      this.webrtc.setLocalMediaStream(this.localStream);

      // Ensure tutor initiates direct WebRTC connection with all room peers for direct streaming
      const topology = this.network.getTopologyState();
      topology.allPeers.forEach((peerId) => {
        if (peerId !== myIdentity.peerId) {
          this.webrtc.initiateConnection(peerId);
        }
      });

      // Handle screen share stop button click
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          this.stopTutorStage(currentRoomId);
        };
      }

      this.state = {
        ...this.state,
        isActive: true,
        tutorPeerId: myIdentity.peerId,
        tutorIdentity: myIdentity,
        myRole: 'tutor',
        isAudioLive: true,
        isVideoLive: broadcastType !== 'audio',
        broadcastType,
      };

      this.gamificationService.unlockCustomBadge('live_tutor');
      this.broadcastStageState(currentRoomId);
      this.emitState();
      return true;
    } catch (err) {
      console.error('[TutorService] Failed to start stage stream:', err);
      return false;
    }
  }

  /**
   * Stops the live stage.
   */
  public stopTutorStage(currentRoomId: string): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.webrtc.setLocalMediaStream(null);

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
    };

    this.broadcastStageState(currentRoomId);
    this.emitState();
  }

  /**
   * Audience member raises hand to join the stage.
   */
  public raiseHand(currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || this.state.myRole !== 'audience') return;

    this.state.isMyHandRaised = true;
    this.emitState();

    const payload: HandRaiseRequest = {
      peerId: myIdentity.peerId,
      nickname: myIdentity.nickname,
      avatar: myIdentity.avatar,
      requestedAt: Date.now(),
    };

    this.network.broadcast('stage:hand_raise', payload);
  }

  /**
   * Tutor accepts student to stage (bounded to max 2 guest speakers).
   */
  public acceptSpeaker(student: HandRaiseRequest, currentRoomId: string): void {
    if (this.state.myRole !== 'tutor') return;
    if (this.state.guestSpeakers.length >= 2) return; // Bounded to max 2

    const identity: PeerIdentity = {
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

  /**
   * Removes a guest speaker from the stage.
   */
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
      // If promoted to speaker, enable local audio track
      this.enableSpeakerAudio();
    }

    this.state = {
      ...remoteState,
      myRole,
      isMyHandRaised: this.state.isMyHandRaised && myRole === 'audience',
    };

    // If tutor is broadcasting, ensure audience initiates direct connection to tutor
    if (remoteState.isActive && remoteState.tutorPeerId && remoteState.tutorPeerId !== myIdentity?.peerId) {
      if (!this.webrtc.isConnected(remoteState.tutorPeerId)) {
        this.webrtc.initiateConnection(remoteState.tutorPeerId);
      }
    }

    this.emitState();
  }

  private async enableSpeakerAudio(): Promise<void> {
    if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.webrtc.setLocalMediaStream(this.localStream);
      } catch (e) {
        console.warn('[TutorService] Failed to enable speaker mic:', e);
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

  public getActiveRemoteStream(): MediaStream | null {
    return this.activeRemoteStream;
  }

  public onStateChange(listener: (state: TutorStageState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onRemoteStreamChange(listener: (stream: MediaStream | null) => void): () => void {
    this.remoteStreamListeners.add(listener);
    listener(this.activeRemoteStream);
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

  private emitState(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ nerd_buddy_live_stage: this.state });
    }
    this.stateListeners.forEach((fn) => fn(this.state));
  }
}
