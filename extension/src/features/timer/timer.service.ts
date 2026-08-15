// ─── Pomodoro & Focus Timer Service ───

import {
  TimerMode,
  TimerState,
  PomodoroConfig,
  DEFAULT_POMODORO_CONFIG,
  POMODORO_CONFIG_STORAGE_KEY,
  POMODORO_STATE_STORAGE_KEY,
} from './timer.types';

export class TimerService {
  private static instance: TimerService | null = null;
  private config: PomodoroConfig = DEFAULT_POMODORO_CONFIG;
  private state: TimerState = {
    mode: 'pomodoro',
    timeLeftSec: 25 * 60,
    targetDurationSec: 25 * 60,
    isRunning: false,
    sessionsCompleted: 0,
    lastUpdated: Date.now(),
  };

  private intervalId: any = null;
  private listeners: Set<(state: TimerState, config: PomodoroConfig) => void> = new Set();

  private constructor() {
    this.loadState().then(() => {
      this.startTickLoop();
    });
    this.listenToStorageChanges();
  }

  public static getInstance(): TimerService {
    if (!TimerService.instance) {
      TimerService.instance = new TimerService();
    }
    return TimerService.instance;
  }

  private async loadState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([
          POMODORO_CONFIG_STORAGE_KEY,
          POMODORO_STATE_STORAGE_KEY,
        ]);
        if (res[POMODORO_CONFIG_STORAGE_KEY]) {
          this.config = { ...DEFAULT_POMODORO_CONFIG, ...res[POMODORO_CONFIG_STORAGE_KEY] };
        }
        if (res[POMODORO_STATE_STORAGE_KEY]) {
          const savedState: TimerState = res[POMODORO_STATE_STORAGE_KEY];
          // Account for elapsed time if it was running
          if (savedState.isRunning) {
            const elapsed = Math.floor((Date.now() - savedState.lastUpdated) / 1000);
            if (savedState.mode === 'stopwatch') {
              savedState.timeLeftSec += elapsed;
            } else {
              savedState.timeLeftSec = Math.max(0, savedState.timeLeftSec - elapsed);
              if (savedState.timeLeftSec === 0) {
                savedState.isRunning = false;
              }
            }
          }
          this.state = savedState;
        } else {
          this.resetToMode('pomodoro');
        }
      } catch (err) {
        console.warn('[TimerService] Failed to load state:', err);
      }
    }
  }

  private listenToStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes[POMODORO_CONFIG_STORAGE_KEY]) {
            this.config = { ...DEFAULT_POMODORO_CONFIG, ...changes[POMODORO_CONFIG_STORAGE_KEY].newValue };
            this.emit();
          }
          if (changes[POMODORO_STATE_STORAGE_KEY]) {
            const incoming: TimerState = changes[POMODORO_STATE_STORAGE_KEY].newValue;
            if (incoming) {
              this.state = incoming;
              this.emit();
            }
          }
        }
      });
    }
  }

  private startTickLoop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.state.isRunning) {
        if (this.state.mode === 'stopwatch') {
          this.state.timeLeftSec += 1;
          this.state.lastUpdated = Date.now();
          this.emit();
          this.saveState();
        } else {
          if (this.state.timeLeftSec > 0) {
            this.state.timeLeftSec -= 1;
            this.state.lastUpdated = Date.now();
            this.emit();

            if (this.state.timeLeftSec === 0) {
              this.handleSessionComplete();
            } else if (this.state.timeLeftSec % 5 === 0) {
              this.saveState();
            }
          }
        }
      }
    }, 1000);
  }

  private handleSessionComplete() {
    this.state.isRunning = false;
    this.state.lastUpdated = Date.now();

    if (this.config.soundAlerts) {
      this.playCompletionChime();
    }

    if (this.state.mode === 'pomodoro') {
      this.state.sessionsCompleted += 1;
      const isLongBreak = this.state.sessionsCompleted % 4 === 0;
      const nextMode: TimerMode = isLongBreak ? 'long_break' : 'short_break';
      this.resetToMode(nextMode);

      if (this.config.autoStartBreaks) {
        this.state.isRunning = true;
      }
    } else {
      // Break completed -> back to pomodoro
      this.resetToMode('pomodoro');
    }

    this.emit();
    this.saveState();
  }

  public start() {
    this.state.isRunning = true;
    this.state.lastUpdated = Date.now();
    this.emit();
    this.saveState();
  }

  public pause() {
    this.state.isRunning = false;
    this.state.lastUpdated = Date.now();
    this.emit();
    this.saveState();
  }

  public toggle() {
    if (this.state.isRunning) {
      this.pause();
    } else {
      this.start();
    }
  }

  public reset() {
    this.state.isRunning = false;
    this.resetToMode(this.state.mode);
    this.emit();
    this.saveState();
  }

  public setMode(mode: TimerMode) {
    this.state.isRunning = false;
    this.resetToMode(mode);
    this.emit();
    this.saveState();
  }

  public addTime(seconds: number) {
    if (this.state.mode !== 'stopwatch') {
      this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec + seconds);
      this.state.targetDurationSec = Math.max(this.state.timeLeftSec, this.state.targetDurationSec + seconds);
    } else {
      this.state.timeLeftSec = Math.max(0, this.state.timeLeftSec + seconds);
    }
    this.emit();
    this.saveState();
  }

  private resetToMode(mode: TimerMode) {
    this.state.mode = mode;
    let durationSec = 25 * 60;
    if (mode === 'pomodoro') {
      durationSec = (this.config.workDurationMin || 25) * 60;
    } else if (mode === 'short_break') {
      durationSec = (this.config.shortBreakMin || 5) * 60;
    } else if (mode === 'long_break') {
      durationSec = (this.config.longBreakMin || 15) * 60;
    } else if (mode === 'stopwatch') {
      durationSec = 0;
    }

    this.state.timeLeftSec = durationSec;
    this.state.targetDurationSec = durationSec;
    this.state.lastUpdated = Date.now();
  }

  public updateConfig(newConfig: Partial<PomodoroConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    this.emit();
  }

  public setEnabled(enabled: boolean) {
    this.updateConfig({ enabled });
  }

  public getConfig(): PomodoroConfig {
    return { ...this.config };
  }

  public getState(): TimerState {
    return { ...this.state };
  }

  public onChange(listener: (state: TimerState, config: PomodoroConfig) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState(), this.getConfig());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const s = this.getState();
    const c = this.getConfig();
    this.listeners.forEach((fn) => {
      try {
        fn(s, c);
      } catch (err) {
        console.error('[TimerService] Listener error:', err);
      }
    });
  }

  private saveState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [POMODORO_STATE_STORAGE_KEY]: this.state,
      });
    }
  }

  private saveConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [POMODORO_CONFIG_STORAGE_KEY]: this.config,
      });
    }
  }

  /**
   * Synthesizes a soothing bell chime using Web Audio API
   */
  private playCompletionChime() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };

      // Gentle C major chord arpeggio
      playTone(523.25, 0, 1.2);    // C5
      playTone(659.25, 0.15, 1.2); // E5
      playTone(783.99, 0.3, 1.5);  // G5
      playTone(1046.5, 0.45, 2.0); // C6
    } catch (e) {
      console.warn('[TimerService] Web Audio chime not supported:', e);
    }
  }
}
