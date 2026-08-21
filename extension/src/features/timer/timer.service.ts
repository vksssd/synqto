// ─── Pomodoro & Focus Timer Service ───

import {
  TimerMode,
  TimerState,
  PomodoroConfig,
  DEFAULT_POMODORO_CONFIG,
  POMODORO_CONFIG_STORAGE_KEY,
  POMODORO_STATE_STORAGE_KEY,
} from './timer.types';
import {
  adjustTimerState,
  computeTimerTime,
  editTimerState,
  normalizeTimerState,
  normalizePomodoroConfig,
  pauseTimerState,
  startTimerState,
} from './timer-state';

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
  private initialized = false;
  private pendingActions: Array<() => void> = [];
  private destroyed = false;
  private activeAudioContexts = new Set<any>();
  private readonly handleStorageChange = (changes: any, area: string): void => {
    if (this.destroyed || area !== 'local') return;
    if (changes[POMODORO_CONFIG_STORAGE_KEY]) {
      this.config = normalizePomodoroConfig(changes[POMODORO_CONFIG_STORAGE_KEY].newValue);
      this.emit();
    }
    if (changes[POMODORO_STATE_STORAGE_KEY]) {
      const incoming: TimerState = changes[POMODORO_STATE_STORAGE_KEY].newValue;
      if (incoming) {
        this.state = normalizeTimerState(incoming);
        this.emit();
      }
    }
  };

  private constructor() {
    void this.initialize();
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
        if (this.destroyed) return;
        if (res[POMODORO_CONFIG_STORAGE_KEY]) {
          this.config = normalizePomodoroConfig(res[POMODORO_CONFIG_STORAGE_KEY]);
        }
        if (res[POMODORO_STATE_STORAGE_KEY]) {
          this.state = normalizeTimerState(res[POMODORO_STATE_STORAGE_KEY] as TimerState);
        } else {
          this.resetToMode('pomodoro');
        }
      } catch (err) {
        console.warn('[TimerService] Failed to load state:', err);
      }
    }
  }

  private async initialize(): Promise<void> {
    await this.loadState();
    if (this.destroyed || this.initialized) return;
    this.initialized = true;
    const pending = this.pendingActions.splice(0);
    pending.forEach((action) => {
      try {
        action();
      } catch (err) {
        console.error('[TimerService] deferred action failed:', err);
      }
    });
    this.startTickLoop();
    this.emit();
  }

  private computeCurrentTimeLeft(state: TimerState = this.state): number {
    return computeTimerTime(state);
  }

  private listenToStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.handleStorageChange);
    }
  }

  private startTickLoop() {
    if (this.destroyed) return;
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.destroyed) return;
      if (this.state.isRunning) {
        const computed = this.computeCurrentTimeLeft();
        this.state.timeLeftSec = computed;

        if (this.state.mode !== 'stopwatch' && computed === 0) {
          this.handleSessionComplete();
        } else {
          this.emit();
        }
      }
    }, 1000);
  }

  private handleSessionComplete() {
    this.state.isRunning = false;
    this.state.targetEndTime = undefined;
    this.state.startedAt = undefined;
    this.state.pausedRemainingSec = undefined;
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
        this.start();
        return;
      }
    } else {
      // Break completed -> back to pomodoro
      this.resetToMode('pomodoro');
    }

    this.emit();
    this.saveState();
  }

  public start() {
    if (this.deferUntilInitialized(() => this.start())) return;
    this.state = startTimerState(this.state);
    this.emit();
    this.saveState();
  }

  public pause() {
    if (this.deferUntilInitialized(() => this.pause())) return;
    this.state = pauseTimerState(this.state);
    this.emit();
    this.saveState();
  }

  public toggle() {
    if (this.deferUntilInitialized(() => this.toggle())) return;
    if (this.state.isRunning) {
      this.pause();
    } else {
      this.start();
    }
  }

  public reset() {
    if (this.deferUntilInitialized(() => this.reset())) return;
    this.state.isRunning = false;
    this.state.targetEndTime = undefined;
    this.state.startedAt = undefined;
    this.state.pausedRemainingSec = undefined;
    this.resetToMode(this.state.mode);
    this.emit();
    this.saveState();
  }

  public setMode(mode: TimerMode) {
    if (this.deferUntilInitialized(() => this.setMode(mode))) return;
    this.state.isRunning = false;
    this.state.targetEndTime = undefined;
    this.state.startedAt = undefined;
    this.state.pausedRemainingSec = undefined;
    this.resetToMode(mode);
    this.emit();
    this.saveState();
  }

  public addTime(seconds: number) {
    if (this.deferUntilInitialized(() => this.addTime(seconds))) return;
    const result = adjustTimerState(this.state, seconds);
    if (!result.ok) return;
    this.state = result.state;
    this.emit();
    this.saveState();
  }

  /** Edits the current countdown/elapsed value without forcing a pause. */
  public setTime(seconds: number): { ok: true } | { ok: false; error: string } {
    const result = editTimerState(this.state, seconds);
    if (!result.ok) return result;
    if (this.deferUntilInitialized(() => {
      this.setTime(seconds);
    })) {
      return { ok: true };
    }
    this.state = result.state;
    this.emit();
    this.saveState();
    return { ok: true };
  }

  private resetToMode(mode: TimerMode) {
    this.state.mode = mode;
    this.state.targetEndTime = undefined;
    this.state.startedAt = undefined;
    this.state.pausedRemainingSec = undefined;

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
    if (this.deferUntilInitialized(() => this.updateConfig({ ...newConfig }))) return;
    this.config = normalizePomodoroConfig({ ...this.config, ...newConfig });
    this.saveConfig();
    this.emit();
  }

  public setEnabled(enabled: boolean) {
    this.updateConfig({ enabled });
  }

  private deferUntilInitialized(action: () => void): boolean {
    if (this.destroyed) return true;
    if (this.initialized) return false;
    if (this.pendingActions.length < 100) this.pendingActions.push(action);
    return true;
  }

  public getConfig(): PomodoroConfig {
    return { ...this.config };
  }

  public getState(): TimerState {
    return { ...this.state };
  }

  public onChange(listener: (state: TimerState, config: PomodoroConfig) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.getState(), this.getConfig());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    if (this.destroyed) return;
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
    if (this.destroyed) return;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [POMODORO_STATE_STORAGE_KEY]: this.state,
      });
    }
  }

  private saveConfig() {
    if (this.destroyed) return;
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
    let ctx: any = null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      this.activeAudioContexts.add(ctx);
      let remainingTones = 4;

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
        osc.onended = () => {
          remainingTones--;
          if (remainingTones === 0) this.closeAudioContext(ctx);
        };

        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };

      // Gentle C major chord arpeggio
      playTone(523.25, 0, 1.2);    // C5
      playTone(659.25, 0.15, 1.2); // E5
      playTone(783.99, 0.3, 1.5);  // G5
      playTone(1046.5, 0.45, 2.0); // C6
    } catch (e) {
      if (ctx) this.closeAudioContext(ctx);
      console.warn('[TimerService] Web Audio chime not supported:', e);
    }
  }

  private closeAudioContext(ctx: any): void {
    if (!this.activeAudioContexts.delete(ctx)) return;
    try {
      Promise.resolve(ctx.close()).catch(() => {});
    } catch {}
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.handleStorageChange);
    }
    this.pendingActions = [];
    [...this.activeAudioContexts].forEach((ctx) => this.closeAudioContext(ctx));
    this.listeners.clear();
    if (TimerService.instance === this) TimerService.instance = null;
  }
}
