// ─── WebRTC P2P Voice Chat & Speaking Detection Engine ───

import { WebRTCService } from '@/core/network/webrtc.service';
import { NetworkService } from '@/core/network/network.service';
import { NotificationService, describeMediaError } from '@/core/notify/notification.service';
import { MediaSessionCoordinator } from '@/core/media/media-session-coordinator';
import { GestureUnlockRegistry } from '@/core/media/gesture-unlock-registry';
import { NetworkPacket, PacketType } from '@/core/network/packet';

export interface VoiceParticipant {
  peerId: string;
  isSpeaking: boolean;
  isMuted: boolean;
  volumeLevel: number;
}

export type VoiceLifecycleState = 'NOT_JOINED' | 'JOINING' | 'JOINED' | 'LEAVING';

export class VoiceService {
  private static instance: VoiceService | null = null;
  private webrtc: WebRTCService;
  private network: NetworkService;
  private mediaCoordinator: MediaSessionCoordinator;

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeCheckInterval: any = null;

  private isInVoice = false;
  private lifecycleState: VoiceLifecycleState = 'NOT_JOINED';
  private joinPromise: Promise<boolean> | null = null;
  private operationGeneration = 0;
  private isMuted = false;
  private permissionNeeded = false;
  private speakingPeers: Set<string> = new Set();
  private participants: Map<string, VoiceParticipant> = new Map();
  private optedInPeers: Set<string> = new Set();
  private pendingRemoteStreams: Map<string, MediaStream> = new Map();
  private remoteAudioUnlocks: GestureUnlockRegistry<string> | null = null;
  private currentRoomId = '';
  private ownedUnsubscribers: Array<() => void> = [];
  private destroyed = false;

  private listeners: Set<(isInVoice: boolean, isMuted: boolean, permissionNeeded: boolean) => void> = new Set();
  private speakingListeners: Set<(speaking: Set<string>) => void> = new Set();

  private constructor() {
    this.webrtc = WebRTCService.getInstance();
    this.network = NetworkService.getInstance();
    this.mediaCoordinator = MediaSessionCoordinator.getInstance();
    this.setupOwnershipListeners();
    this.setupWebRTCListeners();
    this.setupNetworkListeners();
  }

  private setupOwnershipListeners(): void {
    this.ownedUnsubscribers.push(
      this.mediaCoordinator.register('voice', () => {
        if (!this.destroyed) this.leaveVoice();
      })
    );
  }

  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  private setupWebRTCListeners() {
    this.ownedUnsubscribers.push(this.webrtc.onRemoteStream((peerId, stream) => {
      if (this.destroyed) return;
      // Ignore video streams (TutorStage handles screen/camera video and its audio)
      if (stream.getVideoTracks().length > 0) {
        return;
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      this.pendingRemoteStreams.set(peerId, stream);
      if (!this.isInVoice || !this.optedInPeers.has(peerId)) return;
      this.attachRemoteAudio(peerId, stream);
    }));

    this.ownedUnsubscribers.push(this.webrtc.onRemoteStreamRemoved((peerId) => {
      if (this.destroyed) return;
      this.pendingRemoteStreams.delete(peerId);
      this.removeRemoteAudio(peerId);
    }));
  }

  private setupNetworkListeners() {
    this.onNetwork<{ joined?: boolean; requestResponse?: boolean }>(
      'voice:presence',
      (payload, packet) => {
        const peerId = packet.from.peerId;
        if (payload.joined !== true) {
          this.optedInPeers.delete(peerId);
          this.removeRemoteAudio(peerId);
          return;
        }

        this.optedInPeers.add(peerId);
        const stream = this.pendingRemoteStreams.get(peerId);
        if (this.isInVoice && stream) this.attachRemoteAudio(peerId, stream);

        // A newly joined participant asks existing voice members to re-announce. The response
        // flag is false, so simultaneous joins produce two responses rather than a loop.
        if (this.isInVoice && payload.requestResponse) {
          this.network.send(peerId, 'voice:presence', {
            joined: true,
            requestResponse: false,
          });
        }
      }
    );

    this.onNetwork('voice:hangup', (_payload, packet) => {
      this.optedInPeers.delete(packet.from.peerId);
      this.removeRemoteAudio(packet.from.peerId);
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

  private attachRemoteAudio(peerId: string, stream: MediaStream) {
    if (typeof document === 'undefined' || !this.isInVoice) return;

    this.getRemoteAudioUnlocks()?.cancel(peerId);

    let audioEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `synqto-audio-${peerId}`;
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;

    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const currentEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
        if (!this.isInVoice || !currentEl || currentEl.srcObject !== stream) return;
        this.getRemoteAudioUnlocks()?.arm(peerId, () => {
          const pendingEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
          if (pendingEl && pendingEl.srcObject === stream) {
            pendingEl.play().catch(() => {});
          }
        });
      });
    }

    this.participants.set(peerId, {
      peerId,
      isSpeaking: false,
      isMuted: false,
      volumeLevel: 0,
    });
  }

  private removeRemoteAudio(peerId: string) {
    this.remoteAudioUnlocks?.cancel(peerId);
    if (typeof document !== 'undefined') {
      const audioEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl.remove();
      }
    }
    this.participants.delete(peerId);
    this.speakingPeers.delete(peerId);
    this.emitSpeaking();
  }

  private getRemoteAudioUnlocks(): GestureUnlockRegistry<string> | null {
    if (typeof window === 'undefined') return null;
    if (!this.remoteAudioUnlocks) {
      this.remoteAudioUnlocks = new GestureUnlockRegistry(window);
    }
    return this.remoteAudioUnlocks;
  }

  public joinVoice(): Promise<boolean> {
    if (this.destroyed || !this.currentRoomId) return Promise.resolve(false);
    if (this.lifecycleState === 'JOINED') return Promise.resolve(true);
    if (this.joinPromise) return this.joinPromise;

    const generation = ++this.operationGeneration;
    this.lifecycleState = 'JOINING';
    this.emitState();
    const attempt = this.performJoin(generation);
    this.joinPromise = attempt;
    void attempt.finally(() => {
      if (this.joinPromise === attempt) this.joinPromise = null;
    });
    return attempt;
  }

  private async performJoin(generation: number): Promise<boolean> {
    let acquiredStream: MediaStream | null = null;

    try {
      try {
        acquiredStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (constraintErr: any) {
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError'].includes(
          String(constraintErr?.name || '')
        )) {
          throw constraintErr;
        }
        // Fallback to basic audio constraints if advanced DSP filters are rejected by OS/device
        acquiredStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      if (generation !== this.operationGeneration || this.lifecycleState !== 'JOINING') {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const replacedOwner = this.mediaCoordinator.claim('voice');
      if (replacedOwner === 'live') {
        NotificationService.getInstance().warn(
          'Live audio ended',
          'Joining voice uses the same microphone sender, so the live broadcast was stopped.'
        );
      }
      this.localStream = acquiredStream;

      this.permissionNeeded = false;
      this.isInVoice = true;
      this.lifecycleState = 'JOINED';
      this.isMuted = false;

      const audioTrack = this.localStream.getAudioTracks()[0] || null;
      if (audioTrack) {
        audioTrack.enabled = true;
        audioTrack.onended = () => {
          if (
            this.lifecycleState === 'JOINED' &&
            this.localStream?.getAudioTracks().includes(audioTrack)
          ) {
            NotificationService.getInstance().warn(
              'Microphone disconnected',
              'Voice was left because the microphone permission or device ended.'
            );
            this.leaveVoice();
          }
        };
        this.webrtc.setLocalAudioTrack(audioTrack);
      }

      // Start volume / speaking analyser
      await this.startAudioAnalyser(this.localStream, generation);

      this.pendingRemoteStreams.forEach((stream, peerId) => {
        if (this.optedInPeers.has(peerId)) this.attachRemoteAudio(peerId, stream);
      });
      this.network.broadcast('voice:presence', { joined: true, requestResponse: true });

      this.emitState();
      return true;
    } catch (err: any) {
      if (generation !== this.operationGeneration) {
        acquiredStream?.getTracks().forEach((track) => track.stop());
        return false;
      }
      // Surface it to the USER, not only to the console.
      //
      // This previously logged and returned false. From the user's side that is: click
      // "join voice", nothing happens, no explanation anywhere they would look. The browser
      // told us precisely what went wrong (NotAllowedError, NotFoundError, NotReadableError
      // are genuinely different situations with different remedies) and all of it was
      // discarded. describeMediaError turns the DOMException name into the action that fixes
      // it — which in the NotAllowedError case is not obvious, because in a side panel the
      // permission prompt does not appear over the panel at all.
      const { title, detail } = describeMediaError(err, 'microphone');
      NotificationService.getInstance().error(title, detail);
      console.warn('[VoiceService] microphone unavailable:', err?.name || err?.message || err);
      this.permissionNeeded = true;
      this.lifecycleState = 'NOT_JOINED';
      this.emitState();
      return false;
    }
  }

  /**
   * Opens a dedicated permission prompt tab to let user grant microphone and camera access to the extension origin.
   */
  public requestMicrophonePermission(): void {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('permission.html'),
        active: true,
      });
    } else {
      window.open('permission.html', '_blank');
    }
  }

  public leaveVoice() {
    if (this.lifecycleState === 'NOT_JOINED' || this.lifecycleState === 'LEAVING') return;

    const wasJoined = this.isInVoice;
    ++this.operationGeneration;
    this.lifecycleState = 'LEAVING';
    this.isInVoice = false;
    if (wasJoined) {
      this.network.broadcast('voice:hangup', { left: true });
    }

    this.stopAudioAnalyser();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Clean up all remote audio DOM elements
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio[id^="synqto-audio-"]').forEach((el) => {
        const audio = el as HTMLAudioElement;
        audio.srcObject = null;
        audio.remove();
      });
    }
    this.remoteAudioUnlocks?.clear();

    this.webrtc.setLocalAudioTrack(null);
    this.mediaCoordinator.release('voice');
    this.isMuted = false;
    this.lifecycleState = 'NOT_JOINED';
    this.participants.clear();
    this.speakingPeers.clear();

    this.emitState();
    this.emitSpeaking();
  }

  /**
   * A WebRTC stream belongs to the room in which it was negotiated. Room switches must not
   * retain either a remote opt-in announcement or a pending stream from the previous room.
   */
  public setRoom(roomId: string): void {
    if (this.destroyed || roomId === this.currentRoomId) return;
    this.leaveVoice();
    this.optedInPeers.clear();
    this.pendingRemoteStreams.clear();
    this.currentRoomId = roomId;
  }

  public resetForRoom(roomId = '') {
    this.setRoom(roomId);
  }

  public toggleMute(): boolean {
    if (!this.isInVoice || !this.localStream) return this.isMuted;

    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });

    this.emitState();
    return this.isMuted;
  }

  private async startAudioAnalyser(stream: MediaStream, generation: number) {
    this.stopAudioAnalyser();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      if (
        this.destroyed ||
        generation !== this.operationGeneration ||
        this.lifecycleState !== 'JOINED' ||
        this.localStream !== stream
      ) {
        this.stopAudioAnalyser();
        return;
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.volumeCheckInterval = setInterval(() => {
        if (this.destroyed || generation !== this.operationGeneration) return;
        if (!this.analyser || this.isMuted) {
          if (this.speakingPeers.has('self')) {
            this.speakingPeers.delete('self');
            this.emitSpeaking();
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        const isSpeaking = average > 18;
        const wasSpeaking = this.speakingPeers.has('self');

        if (isSpeaking !== wasSpeaking) {
          if (isSpeaking) this.speakingPeers.add('self');
          else this.speakingPeers.delete('self');
          this.emitSpeaking();
        }
      }, 60);
    } catch (e) {
      this.stopAudioAnalyser();
      console.warn('[VoiceService] AudioContext speaking analyser failed:', e);
    }
  }

  private stopAudioAnalyser() {
    if (this.volumeCheckInterval !== null) {
      clearInterval(this.volumeCheckInterval);
      this.volumeCheckInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }

  public getIsInVoice(): boolean {
    return this.isInVoice;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getLifecycleState(): VoiceLifecycleState {
    return this.lifecycleState;
  }

  public getPermissionNeeded(): boolean {
    return this.permissionNeeded;
  }

  public getSpeakingPeers(): Set<string> {
    return this.speakingPeers;
  }

  public onStateChange(
    listener: (isInVoice: boolean, isMuted: boolean, permissionNeeded: boolean) => void
  ): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.isInVoice, this.isMuted, this.permissionNeeded);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onSpeakingChange(listener: (speaking: Set<string>) => void): () => void {
    if (this.destroyed) return () => {};
    this.speakingListeners.add(listener);
    listener(this.speakingPeers);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  private emitState() {
    if (this.destroyed) return;
    this.listeners.forEach((fn) => fn(this.isInVoice, this.isMuted, this.permissionNeeded));
  }

  private emitSpeaking() {
    if (this.destroyed) return;
    const copy = new Set(this.speakingPeers);
    this.speakingListeners.forEach((fn) => fn(copy));
  }

  public destroy(): void {
    if (this.destroyed) return;
    ++this.operationGeneration;
    const wasJoined = this.isInVoice;
    if (wasJoined) this.network.broadcast('voice:hangup', { left: true });
    this.destroyed = true;
    this.isInVoice = false;
    this.lifecycleState = 'NOT_JOINED';
    this.stopAudioAnalyser();
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.localStream = null;
    }
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio[id^="synqto-audio-"]').forEach((element) => {
        const audio = element as HTMLAudioElement;
        audio.srcObject = null;
        audio.remove();
      });
    }
    this.remoteAudioUnlocks?.clear();
    this.remoteAudioUnlocks = null;
    this.webrtc.setLocalAudioTrack(null);
    this.mediaCoordinator.release('voice');
    this.ownedUnsubscribers.splice(0).forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {}
    });
    this.optedInPeers.clear();
    this.pendingRemoteStreams.clear();
    this.participants.clear();
    this.speakingPeers.clear();
    this.listeners.clear();
    this.speakingListeners.clear();
    this.currentRoomId = '';
    this.joinPromise = null;
    if (VoiceService.instance === this) VoiceService.instance = null;
  }
}
