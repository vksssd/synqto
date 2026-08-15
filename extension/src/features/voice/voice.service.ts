// ─── WebRTC P2P Voice Chat & Speaking Detection Engine ───

import { WebRTCService } from '@/core/network/webrtc.service';

export interface VoiceParticipant {
  peerId: string;
  isSpeaking: boolean;
  isMuted: boolean;
  volumeLevel: number;
}

export class VoiceService {
  private static instance: VoiceService | null = null;
  private webrtc: WebRTCService;

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeCheckInterval: any = null;

  private isInVoice = false;
  private isMuted = false;
  private permissionNeeded = false;
  private speakingPeers: Set<string> = new Set();
  private participants: Map<string, VoiceParticipant> = new Map();

  private listeners: Set<(isInVoice: boolean, isMuted: boolean, permissionNeeded: boolean) => void> = new Set();
  private speakingListeners: Set<(speaking: Set<string>) => void> = new Set();

  private constructor() {
    this.webrtc = WebRTCService.getInstance();
    this.setupWebRTCListeners();
  }

  public static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  private setupWebRTCListeners() {
    this.webrtc.onRemoteStream((peerId, stream) => {
      // Ignore video streams (TutorStage handles screen/camera video and its audio)
      if (stream.getVideoTracks().length > 0) {
        return;
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

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
          const unlock = () => {
            const currentEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
            if (currentEl) {
              currentEl.play().catch(() => {});
            }
            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
          };
          window.addEventListener('click', unlock, { once: true });
          window.addEventListener('keydown', unlock, { once: true });
          window.addEventListener('touchstart', unlock, { once: true });
        });
      }

      this.participants.set(peerId, {
        peerId,
        isSpeaking: false,
        isMuted: false,
        volumeLevel: 0,
      });
    });

    this.webrtc.onRemoteStreamRemoved((peerId) => {
      const audioEl = document.getElementById(`synqto-audio-${peerId}`) as HTMLAudioElement;
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl.remove();
      }
      this.participants.delete(peerId);
      this.speakingPeers.delete(peerId);
      this.emitSpeaking();
    });
  }

  public async joinVoice(): Promise<boolean> {
    if (this.isInVoice) return true;

    try {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (constraintErr) {
        // Fallback to basic audio constraints if advanced DSP filters are rejected by OS/device
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      this.permissionNeeded = false;
      this.isInVoice = true;
      this.isMuted = false;

      const audioTrack = this.localStream.getAudioTracks()[0] || null;
      if (audioTrack) {
        audioTrack.enabled = true;
        this.webrtc.setLocalAudioTrack(audioTrack);
      }

      // Start volume / speaking analyser
      await this.startAudioAnalyser(this.localStream);

      this.emitState();
      return true;
    } catch (err: any) {
      console.warn(
        '[VoiceService] Microphone access requires permission in Chrome extension:',
        err?.name || err?.message || err
      );
      this.permissionNeeded = true;
      this.emitState();
      return false;
    }
  }

  /**
   * Opens a dedicated permission prompt tab to let user grant microphone access to the extension origin.
   */
  public requestMicrophonePermission(): void {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('sidepanel.html?requestMic=1'),
        active: true,
      });
    } else {
      window.open('sidepanel.html?requestMic=1', '_blank');
    }
  }

  public leaveVoice() {
    if (!this.isInVoice) return;

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

    this.webrtc.setLocalAudioTrack(null);
    this.isInVoice = false;
    this.isMuted = false;
    this.participants.clear();
    this.speakingPeers.clear();

    this.emitState();
    this.emitSpeaking();
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

  private async startAudioAnalyser(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.volumeCheckInterval = setInterval(() => {
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
      console.warn('[VoiceService] AudioContext speaking analyser failed:', e);
    }
  }

  private stopAudioAnalyser() {
    if (this.volumeCheckInterval) {
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

  public getPermissionNeeded(): boolean {
    return this.permissionNeeded;
  }

  public getSpeakingPeers(): Set<string> {
    return this.speakingPeers;
  }

  public onStateChange(
    listener: (isInVoice: boolean, isMuted: boolean, permissionNeeded: boolean) => void
  ): () => void {
    this.listeners.add(listener);
    listener(this.isInVoice, this.isMuted, this.permissionNeeded);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onSpeakingChange(listener: (speaking: Set<string>) => void): () => void {
    this.speakingListeners.add(listener);
    listener(this.speakingPeers);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  private emitState() {
    this.listeners.forEach((fn) => fn(this.isInVoice, this.isMuted, this.permissionNeeded));
  }

  private emitSpeaking() {
    const copy = new Set(this.speakingPeers);
    this.speakingListeners.forEach((fn) => fn(copy));
  }
}
