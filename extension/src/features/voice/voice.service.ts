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
  private speakingPeers: Set<string> = new Set();
  private participants: Map<string, VoiceParticipant> = new Map();

  private listeners: Set<(isInVoice: boolean, isMuted: boolean) => void> = new Set();
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
      let audioEl = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `audio-${peerId}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {
        const unlock = () => {
          audioEl.play().catch(() => {});
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
      });

      this.participants.set(peerId, {
        peerId,
        isSpeaking: false,
        isMuted: false,
        volumeLevel: 0,
      });
    });

    this.webrtc.onRemoteStreamRemoved((peerId) => {
      const audioEl = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
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
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.isInVoice = true;
      this.isMuted = false;

      // Pass local media stream to WebRTC service
      this.webrtc.setLocalMediaStream(this.localStream);

      // Start volume / speaking analyser
      this.startAudioAnalyser(this.localStream);

      this.emitState();
      return true;
    } catch (err) {
      console.error('[VoiceService] Failed to acquire microphone stream:', err);
      return false;
    }
  }

  public leaveVoice() {
    if (!this.isInVoice) return;

    this.stopAudioAnalyser();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Clean up all remote audio DOM elements and detach media streams
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio[id^="audio-"]').forEach((el) => {
        const audio = el as HTMLAudioElement;
        audio.srcObject = null;
        audio.remove();
      });
    }

    this.webrtc.setLocalMediaStream(null);
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

  private startAudioAnalyser(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
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
      this.audioContext.close();
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

  public getSpeakingPeers(): Set<string> {
    return this.speakingPeers;
  }

  public onStateChange(listener: (isInVoice: boolean, isMuted: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isInVoice, this.isMuted);
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
    this.listeners.forEach((fn) => fn(this.isInVoice, this.isMuted));
  }

  private emitSpeaking() {
    const copy = new Set(this.speakingPeers);
    this.speakingListeners.forEach((fn) => fn(copy));
  }
}
