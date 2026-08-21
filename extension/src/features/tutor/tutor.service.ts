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
import { NotificationService, describeMediaError } from '@/core/notify/notification.service';
import { MediaSessionCoordinator } from '@/core/media/media-session-coordinator';
import { NetworkPacket, PacketType, PeerIdentity } from '@/core/network/packet';
import {
  SignalingService,
  StreamAdmissionResponse,
} from '@/core/network/signaling.service';

function createInitialStageState(): TutorStageState {
  return {
    viewerState: 'NOT_WATCHING',
    broadcasterState: 'IDLE',
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
}

interface AcquiredBroadcastMedia {
  stream: MediaStream;
  sourceStreams: MediaStream[];
  audioContext: AudioContext | null;
  hasMicrophone: boolean;
  warning?: string;
}

interface BroadcastAdmissionResult {
  granted: boolean;
  reason?: string;
}

export class TutorService {
  private static instance: TutorService | null = null;
  private network: NetworkService;
  private webrtc: WebRTCService;
  private identityService: IdentityService;
  private gamificationService: GamificationService;
  private mediaCoordinator: MediaSessionCoordinator;
  private signaling: SignalingService;

  private state: TutorStageState = createInitialStageState();

  private remoteCursors: Map<string, CursorPosition> = new Map();
  private cursorListeners: Set<(cursors: CursorPosition[]) => void> = new Set();
  private stateListeners: Set<(state: TutorStageState) => void> = new Set();
  private remoteStreamListeners: Set<(stream: MediaStream | null, peerId: string | null) => void> = new Set();

  private lastCursorSentTime = 0;
  private localStream: MediaStream | null = null;
  private localSourceStreams: MediaStream[] = [];
  private mixAudioContext: AudioContext | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();
  private selectedStreamPeerId: string | null = null;
  private currentRoomId = '';
  private startPromise: Promise<boolean> | null = null;
  private speakerMediaPromise: Promise<void> | null = null;
  private operationGeneration = 0;
  private admissionHeld = false;
  private admissionRequestPromise: Promise<BroadcastAdmissionResult> | null = null;
  private ownedUnsubscribers: Array<() => void> = [];
  private admissionTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private admissionCancellers = new Set<() => void>();
  private destroyed = false;

  private constructor() {
    this.network = NetworkService.getInstance();
    this.webrtc = WebRTCService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.gamificationService = GamificationService.getInstance();
    this.mediaCoordinator = MediaSessionCoordinator.getInstance();
    this.signaling = SignalingService.getInstance();
    this.setupOwnershipListeners();
    this.setupNetworkListeners();
    this.setupWebRTCListeners();
  }

  private setupOwnershipListeners(): void {
    this.ownedUnsubscribers.push(
      this.mediaCoordinator.register('live', () => {
        if (!this.destroyed) this.handleLiveMediaReplaced();
      })
    );
    this.ownedUnsubscribers.push(this.signaling.on('connection:change', (event: { connected?: boolean }) => {
      if (this.destroyed) return;
      if (!event.connected) this.admissionHeld = false;
    }));
    this.ownedUnsubscribers.push(this.signaling.on('room:registered', () => {
      if (this.destroyed) return;
      if (this.state.broadcasterState === 'LIVE' && !this.admissionHeld) {
        void this.revalidateBroadcastAdmission();
      }
    }));
  }

  public static getInstance(): TutorService {
    if (!TutorService.instance) {
      TutorService.instance = new TutorService();
    }
    return TutorService.instance;
  }

  private setupNetworkListeners(): void {
    // 1. Mouse cursor synchronization
    this.onNetwork<CursorPosition>('canvas:cursor', (payload, packet) => {
      this.handleIncomingCursor({
        ...payload,
        peerId: packet.from.peerId,
        nickname: packet.from.nickname,
        avatar: packet.from.avatar,
        color: packet.from.color,
      });
    });

    // 2. Click ripple synchronization
    this.onNetwork<ClickPulse>('canvas:click', (payload, packet) => {
      this.handleIncomingClick({
        ...payload,
        peerId: packet.from.peerId,
        nickname: packet.from.nickname,
        color: packet.from.color,
      });
    });

    // 3. Multi-stream announcement
    this.onNetwork<ActiveStreamInfo>('stream:announce', (streamInfo, packet) => {
      this.handleIncomingStreamAnnounce(streamInfo, packet.from);
    });

    // 4. Stream stopped announcement
    this.onNetwork<{ broadcasterPeerId: string }>('stream:stopped', (_payload, packet) => {
      this.handleIncomingStreamStopped({ broadcasterPeerId: packet.from.peerId });
    });

    // 5. Stage state sync (backward compatibility)
    this.onNetwork<TutorStageState>('stage:state', (payload, packet) => {
      if (payload?.tutorPeerId !== packet.from.peerId) return;
      this.handleIncomingStageState({
        ...payload,
        tutorPeerId: packet.from.peerId,
        tutorIdentity: packet.from,
        // Stream ownership is learned from each broadcaster's own signed/canonicalized
        // announcement, never from a third party's aggregate stage snapshot.
        activeStreams: this.state.activeStreams,
        handRaises: this.state.handRaises,
        lastMediaError: this.state.lastMediaError,
        guestSpeakers: Array.isArray(payload.guestSpeakers)
          ? payload.guestSpeakers.slice(0, TutorService.MAX_GUEST_SPEAKERS)
          : [],
      });
    });

    // 6. Hand raise requests
    this.onNetwork<HandRaiseRequest>('stage:hand_raise', (payload, packet) => {
      this.handleIncomingHandRaise({
        ...payload,
        peerId: packet.from.peerId,
        nickname: packet.from.nickname,
        avatar: packet.from.avatar,
      });
    });

    // 7. Hand response
    this.onNetwork<{ targetPeerId: string; accepted: boolean }>('stage:hand_response', (payload, packet) => {
      if (packet.from.peerId !== this.state.tutorPeerId) return;
      this.handleIncomingHandResponse(payload);
    });

    // 8. Hand withdrawn — keeps the tutor's queue from showing stale requests.
    this.onNetwork<{ peerId: string }>('stage:hand_lower', (_payload, packet) => {
      this.handleIncomingHandLower({ peerId: packet.from.peerId });
    });
  }

  private onNetwork<T = unknown>(
    type: PacketType,
    handler: (payload: T, packet: NetworkPacket) => void
  ): void {
    const unsubscribe = this.network.on<T>(type, (payload, packet) => {
      if (
        this.destroyed ||
        !this.currentRoomId ||
        packet.roomId !== this.currentRoomId
      ) {
        return;
      }
      handler(payload, packet);
    });
    this.ownedUnsubscribers.push(unsubscribe);
  }

  private setupWebRTCListeners(): void {
    this.ownedUnsubscribers.push(this.webrtc.onRemoteStream((peerId, stream) => {
      if (this.destroyed) return;
      this.remoteStreams.set(peerId, stream);
      // WebRTCService carries voice and live media over the same peer connection. Do not
      // disable or select an audio-only voice stream merely because TutorService observed it;
      // live ownership is established by stream:announce or the guest-speaker roster.
      if (!this.isExpectedLivePeer(peerId)) return;
      if (!this.selectedStreamPeerId || !this.remoteStreams.has(this.selectedStreamPeerId)) {
        this.selectedStreamPeerId = peerId;
      }
      if (
        this.state.viewerState === 'REQUESTING' &&
        this.selectedStreamPeerId === peerId
      ) {
        this.setRemoteStreamEnabled(stream, true);
        this.state.viewerState = 'WATCHING';
        this.emitState();
      } else if (this.state.viewerState !== 'WATCHING' || this.selectedStreamPeerId !== peerId) {
        this.setRemoteStreamEnabled(stream, false);
      }
      this.notifyStreamListeners();
    }));

    this.ownedUnsubscribers.push(this.webrtc.onRemoteStreamRemoved((peerId) => {
      if (this.destroyed) return;
      this.remoteStreams.delete(peerId);
      if (this.selectedStreamPeerId === peerId) {
        const remaining = Array.from(this.remoteStreams.keys());
        this.selectedStreamPeerId = remaining.length > 0 ? remaining[0] : null;
      }
      this.notifyStreamListeners();
    }));
  }

  private notifyStreamListeners(): void {
    if (this.destroyed) return;
    const stream = this.getActiveRemoteStream();
    this.remoteStreamListeners.forEach((fn) => fn(stream, this.selectedStreamPeerId));
  }

  public setSelectedStream(peerId: string): void {
    const previousPeerId = this.selectedStreamPeerId;
    this.selectedStreamPeerId = peerId;
    if (previousPeerId && previousPeerId !== peerId) {
      const previous = this.remoteStreams.get(previousPeerId);
      if (previous) this.setRemoteStreamEnabled(previous, false);
    }
    if (this.state.viewerState === 'WATCHING') {
      const selected = this.remoteStreams.get(peerId);
      if (selected) this.setRemoteStreamEnabled(selected, true);
      else {
        this.state.viewerState = 'REQUESTING';
        this.webrtc.initiateConnection(peerId);
      }
    }
    this.notifyStreamListeners();
    this.emitState();
  }

  public getSelectedStreamPeerId(): string | null {
    return this.selectedStreamPeerId;
  }

  public getActiveRemoteStream(): MediaStream | null {
    if (this.state.viewerState !== 'WATCHING') return null;
    if (this.selectedStreamPeerId && this.remoteStreams.has(this.selectedStreamPeerId)) {
      return this.remoteStreams.get(this.selectedStreamPeerId)!;
    }
    return null;
  }

  public getRemoteStreamByPeerId(peerId: string): MediaStream | null {
    return this.remoteStreams.get(peerId) || null;
  }

  public joinStream(peerId?: string): boolean {
    if (this.destroyed || !this.currentRoomId) return false;
    if (this.state.myRole === 'tutor') return true;
    const targetPeerId =
      peerId || this.selectedStreamPeerId || this.state.activeStreams[0]?.broadcasterPeerId;
    if (!targetPeerId) return false;

    this.selectedStreamPeerId = targetPeerId;
    this.state.viewerState = 'REQUESTING';
    const stream = this.remoteStreams.get(targetPeerId);
    if (stream) {
      this.setRemoteStreamEnabled(stream, true);
      this.state.viewerState = 'WATCHING';
    } else {
      this.webrtc.initiateConnection(targetPeerId);
    }
    this.notifyStreamListeners();
    this.emitState();
    return true;
  }

  public leaveStream(): void {
    if (this.state.viewerState === 'NOT_WATCHING' || this.state.viewerState === 'LEAVING') {
      return;
    }
    this.state.viewerState = 'LEAVING';
    this.remoteStreams.forEach((stream) => this.setRemoteStreamEnabled(stream, false));
    this.state.viewerState = 'NOT_WATCHING';
    this.notifyStreamListeners();
    this.emitState();
  }

  private setRemoteStreamEnabled(stream: MediaStream, enabled: boolean): void {
    stream.getTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  private isExpectedLivePeer(peerId: string): boolean {
    return (
      this.state.activeStreams.some((stream) => stream.broadcasterPeerId === peerId) ||
      this.state.guestSpeakers.some((speaker) => speaker.peerId === peerId)
    );
  }

  private handleLiveMediaReplaced(): void {
    if (this.state.broadcasterState !== 'IDLE' || this.state.myRole === 'tutor') {
      this.stopTutorStage(this.currentRoomId);
      return;
    }
    if (this.state.myRole === 'speaker' && this.localStream) {
      ++this.operationGeneration;
      this.releaseLocalMedia();
      this.state.isAudioLive = false;
      this.state.isVideoLive = false;
      this.state.lastMediaError = 'Speaker media stopped because voice chat took microphone ownership.';
      this.emitState();
    }
  }

  public broadcastCursor(xPct: number, yPct: number, currentRoomId: string): void {
    if (this.destroyed || !currentRoomId || currentRoomId !== this.currentRoomId) return;
    const now = Date.now();
    // 40ms was 25 packets/sec/peer, and each one fans out to EVERY peer in the room — so a
    // 20-peer room with five people moving the mouse generated ~2,500 packets/sec of pure
    // pointer noise. 75ms (~13/sec) is still visually smooth for a remote cursor, which the
    // eye integrates anyway, at roughly half the traffic.
    if (now - this.lastCursorSentTime < 75) return;
    this.lastCursorSentTime = now;

    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity) return;

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
    if (this.destroyed || !currentRoomId || currentRoomId !== this.currentRoomId) return;
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity) return;

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
    if (
      !cursor ||
      !cursor.peerId ||
      !Number.isFinite(cursor.xPct) ||
      !Number.isFinite(cursor.yPct) ||
      cursor.xPct < 0 ||
      cursor.xPct > 100 ||
      cursor.yPct < 0 ||
      cursor.yPct > 100
    ) return;
    const myIdentity = this.identityService.getCachedIdentity();
    if (myIdentity && cursor.peerId === myIdentity.peerId) return;
    this.remoteCursors.set(cursor.peerId, cursor);
    this.forwardCursorToContentScript(cursor);

    const cursorList = Array.from(this.remoteCursors.values());
    this.cursorListeners.forEach((fn) => fn(cursorList));
  }

  private handleIncomingClick(click: ClickPulse): void {
    if (
      !click ||
      !click.peerId ||
      !Number.isFinite(click.xPct) ||
      !Number.isFinite(click.yPct) ||
      click.xPct < 0 ||
      click.xPct > 100 ||
      click.yPct < 0 ||
      click.yPct > 100
    ) return;
    const myIdentity = this.identityService.getCachedIdentity();
    if (myIdentity && click.peerId === myIdentity.peerId) return;
    this.forwardClickToContentScript(click);
  }

  private forwardCursorToContentScript(cursor: CursorPosition): void {
    if (this.destroyed) return;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        chrome.tabs.query({}, (tabs) => {
          if (this.destroyed) return;
          if (!Array.isArray(tabs)) return;
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'NERD_BUDDY_CURSOR_UPDATE',
                roomId: this.network.getCurrentRoomId(),
                cursor,
              }).catch(() => {});
            }
          });
        });
      } catch (e) {}
    }
  }

  private forwardClickToContentScript(click: ClickPulse): void {
    if (this.destroyed) return;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        chrome.tabs.query({}, (tabs) => {
          if (this.destroyed) return;
          if (!Array.isArray(tabs)) return;
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
              chrome.tabs.sendMessage(tab.id, {
                type: 'NERD_BUDDY_CLICK_PULSE',
                roomId: this.network.getCurrentRoomId(),
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
  public startTutorStage(
    broadcastType: BroadcastType,
    currentRoomId: string,
    customTitle?: string,
    withMic = true
  ): Promise<boolean> {
    if (this.destroyed || !currentRoomId || currentRoomId !== this.currentRoomId) {
      this.state.lastMediaError = 'Join a room before starting a live stream.';
      this.emitState();
      return Promise.resolve(false);
    }
    if (this.state.broadcasterState === 'LIVE' && this.localStream) {
      return Promise.resolve(true);
    }
    if (this.startPromise) return this.startPromise;

    const generation = ++this.operationGeneration;
    this.state.broadcasterState = 'REQUESTING_PERMISSION';
    this.state.lastMediaError = undefined;
    this.emitState();

    const attempt = this.performStartTutorStage(
      generation,
      broadcastType,
      currentRoomId,
      customTitle,
      withMic
    );
    this.startPromise = attempt;
    void attempt.finally(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
    return attempt;
  }

  private async performStartTutorStage(
    generation: number,
    broadcastType: BroadcastType,
    currentRoomId: string,
    customTitle?: string,
    withMic = true
  ): Promise<boolean> {
    let acquired: AcquiredBroadcastMedia | null = null;

    try {
      const myIdentity = await this.identityService.getOrCreateIdentity();
      acquired = await this.acquireBroadcastMedia(broadcastType, withMic);

      if (
        generation !== this.operationGeneration ||
        currentRoomId !== this.currentRoomId ||
        this.state.broadcasterState !== 'REQUESTING_PERMISSION'
      ) {
        this.releaseAcquiredMedia(acquired);
        return false;
      }

      this.state.broadcasterState = 'REQUESTING_ADMISSION';
      this.emitState();

      const otherStreams = this.state.activeStreams.filter(
        (stream) => stream.broadcasterPeerId !== myIdentity.peerId
      );
      if (otherStreams.length >= TutorService.MAX_ACTIVE_BROADCASTERS) {
        this.releaseAcquiredMedia(acquired);
        this.state.broadcasterState = 'IDLE';
        this.state.lastMediaError = `Live stage is full — ${TutorService.MAX_ACTIVE_BROADCASTERS} broadcasters max.`;
        NotificationService.getInstance().warn('Live stage is full', this.state.lastMediaError);
        this.emitState();
        return false;
      }

      const admission = await this.requestBroadcastAdmission(generation);
      if (
        generation !== this.operationGeneration ||
        currentRoomId !== this.currentRoomId ||
        this.state.broadcasterState !== 'REQUESTING_ADMISSION'
      ) {
        if (admission.granted) this.signaling.releaseStreamAdmission();
        this.releaseAcquiredMedia(acquired);
        return false;
      }
      if (!admission.granted) {
        this.releaseAcquiredMedia(acquired);
        this.state.broadcasterState = 'IDLE';
        this.state.lastMediaError =
          admission.reason === 'stage-full'
            ? `Live stage is full — ${TutorService.MAX_ACTIVE_BROADCASTERS} broadcasters max.`
            : admission.reason === 'unsupported-server'
              ? 'The signaling server must be updated before this extension can start a live stream.'
              : 'Live admission could not be confirmed by the server. Check the connection and try again.';
        NotificationService.getInstance().warn('Could not go live', this.state.lastMediaError);
        this.emitState();
        return false;
      }
      this.admissionHeld = true;

      if (generation !== this.operationGeneration || currentRoomId !== this.currentRoomId) {
        this.releaseBroadcastAdmission();
        this.releaseAcquiredMedia(acquired);
        return false;
      }

      this.localStream = acquired.stream;
      this.localSourceStreams = acquired.sourceStreams;
      this.mixAudioContext = acquired.audioContext;
      const replacedOwner = this.mediaCoordinator.claim('live');
      if (replacedOwner === 'voice') {
        NotificationService.getInstance().warn(
          'Voice chat left',
          'Starting a live broadcast uses the same microphone sender, so voice chat was left.'
        );
      }
      const videoTrack = acquired.stream.getVideoTracks()[0] || null;
      const audioTrack = acquired.stream.getAudioTracks()[0] || null;

      if (videoTrack) {
        videoTrack.onended = () => {
          if (
            generation === this.operationGeneration &&
            this.state.broadcasterState === 'LIVE' &&
            this.localStream?.getVideoTracks().includes(videoTrack)
          ) {
            NotificationService.getInstance().warn(
              'Live video ended',
              'The shared screen or camera track was stopped, so the live stream ended.'
            );
            this.stopTutorStage(currentRoomId);
          }
        };
      }
      if (audioTrack) {
        audioTrack.onended = () => {
          if (
            generation !== this.operationGeneration ||
            this.state.broadcasterState !== 'LIVE' ||
            !this.localStream?.getAudioTracks().includes(audioTrack)
          ) {
            return;
          }
          if (broadcastType === 'audio') {
            this.stopTutorStage(currentRoomId);
            return;
          }
          this.webrtc.setLocalAudioTrack(null);
          this.state.isAudioLive = false;
          this.state.isMicMuted = true;
          this.updateOwnStreamInfo({ withMic: false, isMicMuted: true });
          NotificationService.getInstance().warn(
            'Live microphone ended',
            'Video is still live, but microphone audio stopped.'
          );
          this.broadcastStageState(currentRoomId);
          this.emitState();
        };
      }
      this.webrtc.setLocalMediaStream(acquired.stream);

      // Connect with all room peers for direct streaming
      const topology = this.network.getTopologyState();
      topology.allPeers.forEach((peerId) => {
        if (peerId !== myIdentity.peerId) {
          this.webrtc.initiateConnection(peerId);
        }
      });

      const streamTitle =
        customTitle?.trim() ||
        `${myIdentity.nickname}'s ${broadcastType === 'screen' ? 'Screen Walkthrough' : broadcastType === 'camera' ? 'Video Stream' : 'Live Walkthrough'}`;

      const effectiveWithMic = acquired.hasMicrophone;
      const streamInfo: ActiveStreamInfo = {
        streamId: `stream-${myIdentity.peerId}-${Date.now()}`,
        broadcasterPeerId: myIdentity.peerId,
        broadcasterIdentity: myIdentity,
        title: streamTitle,
        broadcastType,
        withMic: effectiveWithMic,
        isMicMuted: false,
        startedAt: Date.now(),
      };

      this.state = {
        ...this.state,
        broadcasterState: 'LIVE',
        isActive: true,
        tutorPeerId: myIdentity.peerId,
        tutorIdentity: myIdentity,
        myRole: 'tutor',
        isAudioLive: Boolean(audioTrack),
        isVideoLive: broadcastType !== 'audio',
        withMic: effectiveWithMic,
        isMicMuted: false,
        broadcastType,
        streamTitle,
        activeStreams: [...otherStreams, streamInfo],
      };

      this.gamificationService.unlockCustomBadge('live_tutor');

      // Announce stream to all room peers
      this.network.broadcast('stream:announce', streamInfo);
      this.broadcastStageState(currentRoomId);
      if (acquired.warning) {
        this.state.lastMediaError = acquired.warning;
        NotificationService.getInstance().warn('Microphone not included', acquired.warning);
      }
      this.emitState();
      return true;
    } catch (err: any) {
      if (acquired) {
        if (this.localStream === acquired.stream) this.releaseLocalMedia();
        else this.releaseAcquiredMedia(acquired);
      }
      this.releaseBroadcastAdmission();
      if (generation !== this.operationGeneration) return false;
      this.state.broadcasterState = 'IDLE';
      this.state.myRole = 'audience';
      this.state.isAudioLive = false;
      this.state.isVideoLive = false;
      const device = broadcastType === 'camera' ? 'camera' : 'microphone';
      const described = describeMediaError(err, device);
      const isScreenCancelled =
        broadcastType === 'screen' &&
        ['NotAllowedError', 'AbortError'].includes(String(err?.name || ''));
      this.state.lastMediaError = isScreenCancelled
        ? 'Screen sharing was cancelled before the stream started.'
        : described.detail;
      if (isScreenCancelled) {
        NotificationService.getInstance().warn('Screen sharing cancelled', this.state.lastMediaError);
      } else {
        NotificationService.getInstance().error(described.title, described.detail);
      }
      this.emitState();
      console.error('[TutorService] Failed to start stage stream:', err);
      return false;
    }
  }

  public static readonly MAX_ACTIVE_BROADCASTERS = 2;

  private scheduleAdmissionTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    let timeout!: ReturnType<typeof setTimeout>;
    timeout = setTimeout(() => {
      this.admissionTimeouts.delete(timeout);
      callback();
    }, delayMs);
    this.admissionTimeouts.add(timeout);
    return timeout;
  }

  private clearAdmissionTimeout(timeout: ReturnType<typeof setTimeout>): void {
    clearTimeout(timeout);
    this.admissionTimeouts.delete(timeout);
  }

  private requestBroadcastAdmission(generation: number): Promise<BroadcastAdmissionResult> {
    if (this.destroyed) {
      return Promise.resolve({ granted: false, reason: 'stale-operation' });
    }
    if (this.admissionRequestPromise) return this.admissionRequestPromise;

    const attempt = (async (): Promise<BroadcastAdmissionResult> => {
      if (!this.signaling.getIsRoomRegistered()) {
        const registered = await new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            this.clearAdmissionTimeout(timeout);
            unsubscribe();
            this.admissionCancellers.delete(cancel);
            resolve(value);
          };
          const cancel = () => finish(false);
          this.admissionCancellers.add(cancel);
          const unsubscribe = this.signaling.on('room:registered', () => finish(true));
          const timeout = this.scheduleAdmissionTimeout(() => finish(false), 10_000);
        });
        if (!registered) return { granted: false, reason: 'server-not-ready' };
      }
      if (!this.signaling.supportsStreamAdmission()) {
        return { granted: false, reason: 'unsupported-server' };
      }
      if (generation !== this.operationGeneration || !this.currentRoomId) {
        return { granted: false, reason: 'stale-operation' };
      }

      const requestId = `admit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      return await new Promise<BroadcastAdmissionResult>((resolve) => {
        let settled = false;
        let sent = false;
          const finish = (result: BroadcastAdmissionResult) => {
            if (settled) return;
            settled = true;
            this.clearAdmissionTimeout(timeout);
            unsubscribe();
            this.admissionCancellers.delete(cancel);
            if ((!result.granted || generation !== this.operationGeneration) && sent) {
              this.signaling.releaseStreamAdmission();
            }
            resolve(result);
          };
          const cancel = () => finish({ granted: false, reason: 'stale-operation' });
          this.admissionCancellers.add(cancel);
        const unsubscribe = this.signaling.on(
          'stream:admission_response',
          (response: StreamAdmissionResponse) => {
            if (response?.requestId !== requestId) return;
            finish({ granted: response.granted === true, reason: response.reason });
          }
        );
        const timeout = this.scheduleAdmissionTimeout(
          () => finish({ granted: false, reason: 'admission-timeout' }),
          5_000
        );
        sent = this.signaling.requestStreamAdmission(requestId);
        if (!sent) finish({ granted: false, reason: 'server-not-ready' });
      });
    })();

    this.admissionRequestPromise = attempt;
    void attempt.finally(() => {
      if (this.admissionRequestPromise === attempt) this.admissionRequestPromise = null;
    });
    return attempt;
  }

  private async revalidateBroadcastAdmission(): Promise<void> {
    const generation = this.operationGeneration;
    const result = await this.requestBroadcastAdmission(generation);
    if (generation !== this.operationGeneration || this.state.broadcasterState !== 'LIVE') {
      if (result.granted) this.signaling.releaseStreamAdmission();
      return;
    }
    if (result.granted) {
      this.admissionHeld = true;
      this.reannounceStream(this.currentRoomId);
      return;
    }

    NotificationService.getInstance().error(
      'Live admission lost',
      result.reason === 'stage-full'
        ? 'The live stage filled while reconnecting, so this broadcast was stopped.'
        : 'The server could not restore the live slot after reconnecting.'
    );
    this.stopTutorStage(this.currentRoomId);
  }

  private releaseBroadcastAdmission(): void {
    if (this.admissionHeld) this.signaling.releaseStreamAdmission();
    this.admissionHeld = false;
  }

  private async acquireBroadcastMedia(
    broadcastType: BroadcastType,
    withMic: boolean
  ): Promise<AcquiredBroadcastMedia> {
    if (broadcastType === 'camera') {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: withMic,
      });
      return {
        stream,
        sourceStreams: [stream],
        audioContext: null,
        hasMicrophone: withMic && stream.getAudioTracks().length > 0,
      };
    }

    if (broadcastType === 'audio') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return { stream, sourceStreams: [stream], audioContext: null, hasMicrophone: true };
    }

    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    if (!withMic || !navigator.mediaDevices?.getUserMedia) {
      return {
        stream: screenStream,
        sourceStreams: [screenStream],
        audioContext: null,
        hasMicrophone: false,
      };
    }

    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      return {
        stream: screenStream,
        sourceStreams: [screenStream],
        audioContext: null,
        hasMicrophone: false,
        warning: 'Screen sharing is live with system audio only because the microphone was unavailable.',
      };
    }

    const videoTrack = screenStream.getVideoTracks()[0];
    const micTrack = micStream.getAudioTracks()[0];
    if (!screenStream.getAudioTracks().length) {
      return {
        stream: new MediaStream([
          ...(videoTrack ? [videoTrack] : []),
          ...(micTrack ? [micTrack] : []),
        ]),
        sourceStreams: [screenStream, micStream],
        audioContext: null,
        hasMicrophone: Boolean(micTrack),
      };
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx();
      const destination = audioContext.createMediaStreamDestination();
      audioContext.createMediaStreamSource(screenStream).connect(destination);
      audioContext.createMediaStreamSource(micStream).connect(destination);
      const mixedAudioTrack = destination.stream.getAudioTracks()[0];
      return {
        stream: new MediaStream([
          ...(videoTrack ? [videoTrack] : []),
          ...(mixedAudioTrack ? [mixedAudioTrack] : []),
        ]),
        sourceStreams: [screenStream, micStream],
        audioContext,
        hasMicrophone: Boolean(micTrack),
      };
    } catch (err) {
      micStream.getTracks().forEach((track) => track.stop());
      return {
        stream: screenStream,
        sourceStreams: [screenStream],
        audioContext: null,
        hasMicrophone: false,
        warning: 'Screen sharing is live with system audio only because microphone mixing failed.',
      };
    }
  }

  private releaseAcquiredMedia(media: AcquiredBroadcastMedia): void {
    const tracks = new Set<MediaStreamTrack>();
    media.stream.getTracks().forEach((track) => tracks.add(track));
    media.sourceStreams.forEach((stream) => {
      stream.getTracks().forEach((track) => tracks.add(track));
    });
    tracks.forEach((track) => {
      track.onended = null;
      track.stop();
    });
    if (media.audioContext && media.audioContext.state !== 'closed') {
      void media.audioContext.close().catch(() => {});
    }
  }

  private releaseLocalMedia(): void {
    const hadLocalMedia = Boolean(
      this.localStream || this.localSourceStreams.length || this.mixAudioContext
    );
    if (hadLocalMedia) {
      this.releaseAcquiredMedia({
        stream: this.localStream || new MediaStream(),
        sourceStreams: this.localSourceStreams,
        audioContext: this.mixAudioContext,
        hasMicrophone: false,
      });
    }
    this.localStream = null;
    this.localSourceStreams = [];
    this.mixAudioContext = null;
    if (hadLocalMedia) this.webrtc.setLocalMediaStream(null);
    this.mediaCoordinator.release('live');
  }

  private updateOwnStreamInfo(update: Partial<ActiveStreamInfo>): void {
    const myPeerId = this.identityService.getCachedIdentity()?.peerId;
    if (!myPeerId) return;
    this.state.activeStreams = this.state.activeStreams.map((stream) =>
      stream.broadcasterPeerId === myPeerId ? { ...stream, ...update } : stream
    );
    const ownStream = this.state.activeStreams.find(
      (stream) => stream.broadcasterPeerId === myPeerId
    );
    if (ownStream) this.network.broadcast('stream:announce', ownStream);
  }

  /**
   * Switches media source on-the-fly (e.g. Screen to Webcam or Webcam to Screen)
   */
  public async switchMediaSource(newType: 'screen' | 'camera', currentRoomId: string): Promise<boolean> {
    if (
      this.destroyed ||
      !this.localStream ||
      this.state.myRole !== 'tutor' ||
      this.state.broadcasterState !== 'LIVE' ||
      currentRoomId !== this.currentRoomId
    ) return false;
    const generation = this.operationGeneration;

    try {
      let newStream: MediaStream;
      if (newType === 'screen') {
        newStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } else {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (
        !newVideoTrack ||
        generation !== this.operationGeneration ||
        currentRoomId !== this.currentRoomId
      ) {
        newStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      newStream.getAudioTracks().forEach((track) => track.stop());

      // Stop old video track
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.onended = null;
        oldVideoTrack.stop();
        this.localStream.removeTrack(oldVideoTrack);
      }

      this.localStream.addTrack(newVideoTrack);
      this.localSourceStreams.push(newStream);
      this.webrtc.setLocalVideoTrack(newVideoTrack);

      newVideoTrack.onended = () => {
        if (
          generation === this.operationGeneration &&
          this.state.broadcasterState === 'LIVE' &&
          this.localStream?.getVideoTracks().includes(newVideoTrack)
        ) {
          this.stopTutorStage(currentRoomId);
        }
      };

      this.state.broadcastType = newType;
      this.updateOwnStreamInfo({ broadcastType: newType });
      this.broadcastStageState(currentRoomId);
      this.emitState();
      return true;
    } catch (err: any) {
      const described = describeMediaError(err, 'camera');
      this.state.lastMediaError = described.detail;
      NotificationService.getInstance().error(described.title, described.detail);
      this.emitState();
      console.error('[TutorService] Error switching media source:', err);
      return false;
    }
  }

  /**
   * Toggles microphone mute during live broadcast
   */
  public toggleMic(isMuted: boolean): void {
    const audioTracks = this.localStream?.getAudioTracks() || [];
    if (!audioTracks.length) return;
    audioTracks.forEach((track) => (track.enabled = !isMuted));
    this.state.isMicMuted = audioTracks.every((track) => !track.enabled);
    this.updateOwnStreamInfo({ isMicMuted: this.state.isMicMuted });
    this.broadcastStageState(this.currentRoomId);
    this.emitState();
  }

  /**
   * Re-establishes peer connections and re-announces the local live stream to whoever is in
   * the room NOW.
   *
   * WHY THIS EXISTS — startTutorStage() connects to `topology.allPeers` and broadcasts
   * `stream:announce` exactly once, at the moment it is called. That is correct for the
   * classic flow (a tutor starts broadcasting into an already-populated room), but it silently
   * fails whenever the audience arrives AFTER the broadcast starts: the new peer was not in
   * allPeers, so no connection was initiated toward them, and the single announce packet was
   * broadcast to a room that did not yet contain them. They never learn a stream exists.
   *
   * CoFocus Watcher hits this every single time — the camera starts as soon as the matched
   * room is joined, which is necessarily before the partner has finished joining — so without
   * a re-announce both peers sit looking at "Partner's camera is off" forever.
   *
   * Safe to call repeatedly: initiateConnection is idempotent for an existing peer connection,
   * and a duplicate stream:announce for the same streamId is de-duplicated by receivers.
   */
  public reannounceStream(currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    if (!myIdentity || !this.localStream) return;

    const myStream = this.state.activeStreams.find(
      (s) => s.broadcasterPeerId === myIdentity.peerId
    );
    if (!myStream) return;

    const topology = this.network.getTopologyState();
    topology.allPeers.forEach((peerId) => {
      if (peerId !== myIdentity.peerId) {
        this.webrtc.initiateConnection(peerId);
      }
    });

    this.network.broadcast('stream:announce', myStream);
    this.broadcastStageState(currentRoomId);
  }

  public stopTutorStage(currentRoomId: string): void {
    const myIdentity = this.identityService.getCachedIdentity();
    const hadAnnouncedStream = Boolean(
      myIdentity &&
        this.state.activeStreams.some(
          (stream) => stream.broadcasterPeerId === myIdentity.peerId
        )
    );
    ++this.operationGeneration;
    this.releaseBroadcastAdmission();
    this.state.broadcasterState = 'STOPPING';
    this.releaseLocalMedia();

    const remainingStreams = this.state.activeStreams.filter(
      (s) => s.broadcasterPeerId !== (myIdentity?.peerId || '')
    );

    this.state = {
      ...this.state,
      broadcasterState: 'IDLE',
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

    if (hadAnnouncedStream && myIdentity && currentRoomId === this.currentRoomId) {
      this.network.broadcast('stream:stopped', { broadcasterPeerId: myIdentity.peerId });
    }

    if (currentRoomId === this.currentRoomId) this.broadcastStageState(currentRoomId);
    this.emitState();
  }

  private handleIncomingStreamAnnounce(
    streamInfo: ActiveStreamInfo,
    senderIdentity: PeerIdentity
  ): void {
    if (
      !streamInfo ||
      typeof streamInfo.streamId !== 'string' ||
      streamInfo.streamId.length < 1 ||
      streamInfo.streamId.length > 160 ||
      !['audio', 'camera', 'screen'].includes(streamInfo.broadcastType)
    ) return;

    const canonicalStream: ActiveStreamInfo = {
      streamId: streamInfo.streamId,
      broadcasterPeerId: senderIdentity.peerId,
      broadcasterIdentity: senderIdentity,
      title:
        typeof streamInfo.title === 'string' && streamInfo.title.trim()
          ? streamInfo.title.trim().slice(0, 160)
          : `${senderIdentity.nickname}'s live stream`,
      broadcastType: streamInfo.broadcastType,
      withMic: streamInfo.withMic === true,
      isMicMuted: streamInfo.isMicMuted === true,
      startedAt:
        Number.isFinite(streamInfo.startedAt) && streamInfo.startedAt > 0
          ? streamInfo.startedAt
          : Date.now(),
    };

    const otherStreams = this.state.activeStreams.filter(
      (stream) => stream.broadcasterPeerId !== canonicalStream.broadcasterPeerId
    );
    const updatedStreams = [...otherStreams, canonicalStream];

    this.state = {
      ...this.state,
      isActive: true,
      tutorPeerId: this.state.tutorPeerId || canonicalStream.broadcasterPeerId,
      tutorIdentity: this.state.tutorIdentity || canonicalStream.broadcasterIdentity,
      broadcastType: this.state.broadcastType || canonicalStream.broadcastType,
      activeStreams: updatedStreams,
    };

    // Auto-select stream if none selected yet
    if (!this.selectedStreamPeerId || !this.remoteStreams.has(this.selectedStreamPeerId)) {
      this.selectedStreamPeerId = canonicalStream.broadcasterPeerId;
    }

    const pendingStream = this.remoteStreams.get(canonicalStream.broadcasterPeerId);
    if (pendingStream) {
      const shouldEnable =
        this.state.viewerState === 'WATCHING' &&
        this.selectedStreamPeerId === canonicalStream.broadcasterPeerId;
      this.setRemoteStreamEnabled(pendingStream, shouldEnable);
      this.notifyStreamListeners();
    }

    this.emitState();
  }

  private handleIncomingStreamStopped(payload: { broadcasterPeerId: string }): void {
    if (!payload?.broadcasterPeerId) return;

    const remainingStreams = this.state.activeStreams.filter((s) => s.broadcasterPeerId !== payload.broadcasterPeerId);
    this.remoteStreams.delete(payload.broadcasterPeerId);

    if (this.selectedStreamPeerId === payload.broadcasterPeerId) {
      this.selectedStreamPeerId = remainingStreams[0]?.broadcasterPeerId || null;
      this.state.viewerState = 'NOT_WATCHING';
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

    // Tell the tutor the hand went down. Previously this only cleared local state, so the
    // request stayed in the tutor's queue forever — the tutor would keep seeing a raised
    // hand from someone who had already withdrawn, and accepting them promoted a person
    // who was no longer asking. currentRoomId was accepted as a parameter but unused,
    // which is what made the omission easy to miss.
    const myIdentity = this.identityService.getCachedIdentity();
    if (myIdentity) {
      this.network.broadcast('stage:hand_lower', { peerId: myIdentity.peerId });
    }

    this.emitState();
  }

  /** Maximum simultaneous interactive guests on stage alongside the tutor. */
  public static readonly MAX_GUEST_SPEAKERS = 2;

  public acceptSpeaker(student: HandRaiseRequest, currentRoomId: string): boolean {
    if (this.state.myRole !== 'tutor') return false;

    // At capacity this used to `return` silently: the tutor clicked Accept, nothing
    // happened, and no explanation appeared anywhere. Report it so the UI can say why.
    if (this.state.guestSpeakers.length >= TutorService.MAX_GUEST_SPEAKERS) {
      this.state.lastMediaError = `Stage is full — ${TutorService.MAX_GUEST_SPEAKERS} guests max. Remove one to add another.`;
      this.emitState();
      return false;
    }

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

    this.state.lastMediaError = undefined;
    this.broadcastStageState(currentRoomId);
    this.emitState();
    return true;
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
    const previousRole = this.state.myRole;
    const localViewerState = this.state.viewerState;
    const localBroadcasterState = this.state.broadcasterState;
    let myRole: StageRole = 'audience';

    if (myIdentity?.peerId === remoteState.tutorPeerId) {
      myRole = 'tutor';
    } else if (remoteState.guestSpeakers?.some((s) => s.peerId === myIdentity?.peerId)) {
      myRole = 'speaker';
      this.enableSpeakerAudio();
    }

    this.state = {
      ...remoteState,
      viewerState: localViewerState,
      broadcasterState: localBroadcasterState,
      myRole,
      isMyHandRaised: this.state.isMyHandRaised && myRole === 'audience',
      activeStreams: remoteState.activeStreams || this.state.activeStreams,
    };

    if (previousRole === 'speaker' && myRole === 'audience') {
      this.releaseLocalMedia();
      this.state.isAudioLive = false;
      this.state.isVideoLive = false;
    }
    this.remoteStreams.forEach((stream, peerId) => {
      if (!this.isExpectedLivePeer(peerId)) return;
      this.setRemoteStreamEnabled(
        stream,
        localViewerState === 'WATCHING' && this.selectedStreamPeerId === peerId
      );
    });

    if (
      remoteState.isActive &&
      remoteState.tutorPeerId &&
      remoteState.tutorPeerId !== myIdentity?.peerId &&
      (myRole === 'speaker' || localViewerState === 'REQUESTING' || localViewerState === 'WATCHING')
    ) {
      if (!this.webrtc.isConnected(remoteState.tutorPeerId)) {
        this.webrtc.initiateConnection(remoteState.tutorPeerId);
      }
    }

    this.emitState();
  }

  /**
   * Brings an accepted guest speaker onto the stage with microphone audio.
   *
   * Audio-first is deliberate: a guest is promoted mid-conversation, and silently opening
   * their camera the instant a tutor accepts them would be a privacy surprise. Video is
   * therefore opt-in via setSpeakerVideoEnabled() once they are already on stage.
   */
  private enableSpeakerAudio(): Promise<void> {
    if (this.localStream || this.speakerMediaPromise) {
      return this.speakerMediaPromise || Promise.resolve();
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return Promise.resolve();
    }

    const generation = this.operationGeneration;
    const attempt = (async () => {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (
          generation !== this.operationGeneration ||
          this.state.myRole !== 'speaker' ||
          !this.currentRoomId
        ) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const replacedOwner = this.mediaCoordinator.claim('live');
        if (replacedOwner === 'voice') {
          NotificationService.getInstance().warn(
            'Voice chat left',
            'Joining the live stage as a speaker uses the same microphone sender.'
          );
        }
        this.localStream = stream;
        this.localSourceStreams = [stream];
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.onended = () => {
            if (
              generation === this.operationGeneration &&
              this.state.myRole === 'speaker' &&
              this.localStream?.getAudioTracks().includes(audioTrack)
            ) {
              this.releaseLocalMedia();
              this.state.isAudioLive = false;
              this.state.lastMediaError = 'Microphone ended while you were a stage speaker.';
              this.emitState();
            }
          };
        }
        this.webrtc.setLocalMediaStream(stream);
        this.state.isAudioLive = Boolean(audioTrack);
        this.state.lastMediaError = undefined;
        this.emitState();
      } catch (e: any) {
        stream?.getTracks().forEach((track) => track.stop());
        if (generation !== this.operationGeneration) return;
        const described = describeMediaError(e, 'microphone');
        NotificationService.getInstance().error(described.title, described.detail);
        this.state.lastMediaError = described.detail;
        this.emitState();
      }
    })();
    this.speakerMediaPromise = attempt;
    void attempt.finally(() => {
      if (this.speakerMediaPromise === attempt) this.speakerMediaPromise = null;
    });
    return attempt;
  }

  /**
   * Turns a guest speaker's camera on or off while they are on stage.
   *
   * Previously a guest could only ever be a voice: enableSpeakerAudio requested
   * { audio: true } and nothing else, so an accepted audience member had no way to appear
   * on camera even though BroadcastType already modelled 'camera' and the stage state
   * already tracked isVideoLive. This adds the missing half so a guest can join with
   * camera + mic or mic only, which is what the two-guest stage was designed for.
   *
   * The video track is added to the SAME MediaStream the peer connections already carry,
   * so no renegotiation dance is needed beyond what setLocalMediaStream performs.
   */
  public async setSpeakerVideoEnabled(enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.state.myRole !== 'speaker' && this.state.myRole !== 'tutor') {
      return { ok: false, error: 'Only stage speakers can toggle camera' };
    }

    if (!enabled) {
      const existing = this.localStream?.getVideoTracks() ?? [];
      existing.forEach((t) => {
        t.onended = null;
        t.stop();
        this.localStream?.removeTrack(t);
      });
      this.state.isVideoLive = false;
      this.webrtc.setLocalMediaStream(this.localStream);
      this.emitState();
      return { ok: true };
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: 'Camera not available in this context' };
    }

    const generation = this.operationGeneration;
    const roomId = this.currentRoomId;
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
      });
      const track = camStream.getVideoTracks()[0];
      if (
        !track ||
        generation !== this.operationGeneration ||
        roomId !== this.currentRoomId ||
        (this.state.myRole !== 'speaker' && this.state.myRole !== 'tutor')
      ) {
        camStream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        return { ok: false, error: 'Stage changed before the camera was ready' };
      }

      const replacedOwner = this.mediaCoordinator.claim('live');
      if (replacedOwner === 'voice') {
        NotificationService.getInstance().warn(
          'Voice chat left',
          'Stage camera uses the live media sender, so voice chat was left.'
        );
      }

      // Reuse the live stream so existing senders pick the track up in place.
      if (!this.localStream) {
        this.localStream = camStream;
      } else {
        this.localStream.getVideoTracks().forEach((t) => {
          t.stop();
          this.localStream?.removeTrack(t);
        });
        this.localStream.addTrack(track);
      }
      this.localSourceStreams.push(camStream);

      // A guest can stop sharing from the browser's own UI; keep our state honest.
      track.onended = () => {
        if (
          generation === this.operationGeneration &&
          roomId === this.currentRoomId &&
          this.localStream?.getVideoTracks().includes(track)
        ) {
          this.state.isVideoLive = false;
          this.webrtc.setLocalVideoTrack(null);
          this.emitState();
        }
      };

      this.webrtc.setLocalMediaStream(this.localStream);
      this.state.isVideoLive = true;
      this.state.lastMediaError = undefined;
      this.emitState();
      return { ok: true };
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      const msg = denied
        ? 'Camera permission denied — grant access and try again.'
        : 'Could not start the camera.';
      this.state.lastMediaError = msg;
      NotificationService.getInstance().error('Camera unavailable', msg);
      this.emitState();
      return { ok: false, error: msg };
    }
  }

  /** Removes a withdrawn request from the tutor's queue. */
  private handleIncomingHandLower(payload: { peerId: string }): void {
    if (!payload?.peerId) return;
    if (this.state.handRaises.some((h) => h.peerId === payload.peerId)) {
      this.state.handRaises = this.state.handRaises.filter((h) => h.peerId !== payload.peerId);
      this.emitState();
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
    if (this.destroyed || !currentRoomId || currentRoomId !== this.currentRoomId) return;
    this.network.broadcast('stage:state', this.state);
  }

  public getState(): TutorStageState {
    return this.state;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public onStateChange(listener: (state: TutorStageState) => void): () => void {
    if (this.destroyed) return () => {};
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public onRemoteStreamChange(
    listener: (stream: MediaStream | null, peerId: string | null) => void
  ): () => void {
    if (this.destroyed) return () => {};
    this.remoteStreamListeners.add(listener);
    listener(this.getActiveRemoteStream(), this.selectedStreamPeerId);
    return () => {
      this.remoteStreamListeners.delete(listener);
    };
  }

  public onCursorsChange(listener: (cursors: CursorPosition[]) => void): () => void {
    if (this.destroyed) return () => {};
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  /** Binds all live media and announcements to one room lifecycle. */
  public setRoom(roomId: string): void {
    if (this.destroyed) return;
    if (roomId === this.currentRoomId) return;
    ++this.operationGeneration;
    this.releaseBroadcastAdmission();
    this.releaseLocalMedia();
    this.remoteStreams.forEach((stream) => this.setRemoteStreamEnabled(stream, false));
    this.remoteStreams.clear();
    this.selectedStreamPeerId = null;
    this.remoteCursors.clear();
    this.currentRoomId = roomId;
    this.state = createInitialStageState();
    this.emitState();
    this.notifyStreamListeners();
  }

  public resetStage(): void {
    if (this.destroyed) return;
    ++this.operationGeneration;
    this.releaseBroadcastAdmission();
    this.releaseLocalMedia();
    this.remoteStreams.forEach((stream) => this.setRemoteStreamEnabled(stream, false));
    this.remoteStreams.clear();
    this.selectedStreamPeerId = null;
    this.remoteCursors.clear();
    this.state = createInitialStageState();
    this.emitState();
    this.notifyStreamListeners();
  }

  private emitState(): void {
    if (this.destroyed) return;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        synqto_live_stage: this.state,
        nerd_buddy_live_stage: this.state,
      });
    }
    this.stateListeners.forEach((fn) => fn(this.state));
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.operationGeneration;
    [...this.admissionCancellers].forEach((cancel) => {
      try {
        cancel();
      } catch {}
    });
    this.admissionCancellers.clear();
    this.admissionTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.admissionTimeouts.clear();
    this.releaseBroadcastAdmission();
    this.releaseLocalMedia();
    this.remoteStreams.forEach((stream) => this.setRemoteStreamEnabled(stream, false));
    this.remoteStreams.clear();
    this.remoteCursors.clear();
    this.selectedStreamPeerId = null;
    this.ownedUnsubscribers.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {}
    });
    this.cursorListeners.clear();
    this.stateListeners.clear();
    this.remoteStreamListeners.clear();
    this.currentRoomId = '';
    this.state = createInitialStageState();
    this.startPromise = null;
    this.speakerMediaPromise = null;
    this.admissionRequestPromise = null;
    if (TutorService.instance === this) TutorService.instance = null;
  }
}
