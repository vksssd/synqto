// ─── Pomodoro & Focus Timer Types ───

export type TimerMode = 'pomodoro' | 'short_break' | 'long_break' | 'stopwatch';

export interface TimerState {
  mode: TimerMode;
  timeLeftSec: number;       // seconds remaining (or elapsed for stopwatch)
  targetDurationSec: number; // total duration
  isRunning: boolean;
  sessionsCompleted: number;
  lastUpdated: number;
  targetEndTime?: number;      // Epoch timestamp (ms) when active countdown completes
  startedAt?: number;          // Epoch timestamp (ms) when active stopwatch started
  pausedRemainingSec?: number; // Snapshot of remaining seconds when paused
}

export interface PomodoroConfig {
  enabled: boolean;          // Default: false (turned on from settings)
  workDurationMin: number;   // default: 25
  shortBreakMin: number;     // default: 5
  longBreakMin: number;      // default: 15
  autoStartBreaks: boolean;
  soundAlerts: boolean;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  enabled: false,
  workDurationMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  autoStartBreaks: false,
  soundAlerts: true,
};

export const POMODORO_CONFIG_STORAGE_KEY = 'synqto_pomodoro_config';
export const POMODORO_STATE_STORAGE_KEY = 'synqto_pomodoro_state';
