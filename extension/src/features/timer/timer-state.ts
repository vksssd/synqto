import { DEFAULT_POMODORO_CONFIG } from './timer.types';
import type { PomodoroConfig, TimerMode, TimerState } from './timer.types';

export const MIN_COUNTDOWN_SECONDS = 1;
export const MAX_TIMER_SECONDS = 24 * 60 * 60;

export type TimerParseResult =
  | { ok: true; seconds: number }
  | { ok: false; error: string };

export type TimerStateResult =
  | { ok: true; state: TimerState }
  | { ok: false; error: string };

const invalidInput = (error: string): TimerParseResult => ({ ok: false, error });

export function normalizePomodoroConfig(raw: Partial<PomodoroConfig> | undefined): PomodoroConfig {
  const next = { ...DEFAULT_POMODORO_CONFIG, ...(raw || {}) };
  const boundedMinutes = (value: unknown, fallback: number, maximum: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(maximum, Math.max(1, Math.floor(value)))
      : fallback;
  next.workDurationMin = boundedMinutes(next.workDurationMin, 25, 120);
  next.shortBreakMin = boundedMinutes(next.shortBreakMin, 5, 60);
  next.longBreakMin = boundedMinutes(next.longBreakMin, 15, 60);
  return next;
}

/**
 * Parses the value accepted by both timer editors.
 *
 * A bare integer is minutes ("25" -> 25:00), while colon forms are durations
 * ("5:09" or "1:05:09"). Keeping this pure and shared prevents the popup and
 * side panel from assigning different meanings to the same edit.
 */
export function parseTimerInput(input: string): TimerParseResult {
  const value = input.trim();
  if (!value) return invalidInput('Enter minutes or a time such as 25:00.');

  let seconds: number;
  if (/^\d+$/.test(value)) {
    seconds = Number(value) * 60;
  } else {
    const parts = value.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
      return invalidInput('Use minutes, MM:SS, or H:MM:SS.');
    }

    const fields = parts.map(Number);
    const secondField = fields[fields.length - 1];
    const minuteField = fields[fields.length - 2];
    if (secondField > 59 || (parts.length === 3 && minuteField > 59)) {
      return invalidInput('Seconds and hour-minute fields must be between 00 and 59.');
    }

    seconds =
      parts.length === 2
        ? minuteField * 60 + secondField
        : fields[0] * 60 * 60 + minuteField * 60 + secondField;
  }

  if (!Number.isSafeInteger(seconds) || seconds > MAX_TIMER_SECONDS) {
    return invalidInput('Timer values cannot exceed 24 hours.');
  }
  return { ok: true, seconds };
}

function safeSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function elapsedSeconds(since: unknown, now: number): number {
  return typeof since === 'number' && Number.isFinite(since)
    ? Math.max(0, Math.floor((now - since) / 1000))
    : 0;
}

/** Derives the visible value from an absolute deadline/start time, never from tick count. */
export function computeTimerTime(state: TimerState, now: number = Date.now()): number {
  if (!state.isRunning) return safeSeconds(state.pausedRemainingSec ?? state.timeLeftSec);

  if (state.mode === 'stopwatch') {
    if (typeof state.startedAt === 'number' && Number.isFinite(state.startedAt)) {
      return Math.max(0, Math.floor((now - state.startedAt) / 1000));
    }
    // Migration path for state persisted by releases that only stored lastUpdated.
    return safeSeconds(state.timeLeftSec) + elapsedSeconds(state.lastUpdated, now);
  }

  if (typeof state.targetEndTime === 'number' && Number.isFinite(state.targetEndTime)) {
    return Math.max(0, Math.ceil((state.targetEndTime - now) / 1000));
  }
  // Migration path for legacy tick-based countdowns.
  return Math.max(0, safeSeconds(state.timeLeftSec) - elapsedSeconds(state.lastUpdated, now));
}

/**
 * Copies persisted state into the canonical timestamp representation. This also migrates
 * legacy counter-only state the first time a current context reads it.
 */
export function normalizeTimerState(state: TimerState, now: number = Date.now()): TimerState {
  const time = computeTimerTime(state, now);
  const next: TimerState = { ...state, timeLeftSec: time };

  if (!state.isRunning) {
    return {
      ...next,
      isRunning: false,
      targetEndTime: undefined,
      startedAt: undefined,
      pausedRemainingSec: time,
    };
  }

  if (state.mode === 'stopwatch') {
    return {
      ...next,
      targetEndTime: undefined,
      startedAt:
        typeof state.startedAt === 'number' && Number.isFinite(state.startedAt)
          ? state.startedAt
          : now - time * 1000,
      pausedRemainingSec: undefined,
    };
  }

  return {
    ...next,
    // Keep an expired running countdown running at zero until its single owner processes
    // the completion transition. Turning it into a paused 00:00 here would strand restored
    // sessions after browser sleep/restart without incrementing the session or selecting the
    // next mode.
    targetEndTime:
      typeof state.targetEndTime === 'number' && Number.isFinite(state.targetEndTime)
        ? state.targetEndTime
        : now + time * 1000,
    startedAt: undefined,
    pausedRemainingSec: undefined,
  };
}

export function validateTimerSeconds(mode: TimerMode, seconds: number): string | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return 'Enter a whole, non-negative duration.';
  if (seconds > MAX_TIMER_SECONDS) return 'Timer values cannot exceed 24 hours.';
  if (mode !== 'stopwatch' && seconds < MIN_COUNTDOWN_SECONDS) {
    return 'A countdown must be at least 00:01.';
  }
  return null;
}

/** Applies an edit without changing whether the timer is running. */
export function editTimerState(
  state: TimerState,
  seconds: number,
  now: number = Date.now()
): TimerStateResult {
  const error = validateTimerSeconds(state.mode, seconds);
  if (error) return { ok: false, error };

  const next: TimerState = {
    ...state,
    timeLeftSec: seconds,
    targetDurationSec: state.mode === 'stopwatch' ? 0 : seconds,
    lastUpdated: now,
  };

  if (!state.isRunning) {
    next.targetEndTime = undefined;
    next.startedAt = undefined;
    next.pausedRemainingSec = seconds;
  } else if (state.mode === 'stopwatch') {
    next.targetEndTime = undefined;
    next.startedAt = now - seconds * 1000;
    next.pausedRemainingSec = undefined;
  } else {
    next.targetEndTime = now + seconds * 1000;
    next.startedAt = undefined;
    next.pausedRemainingSec = undefined;
  }

  return { ok: true, state: next };
}

export function startTimerState(state: TimerState, now: number = Date.now()): TimerState {
  const time = computeTimerTime(state, now);
  if (state.mode !== 'stopwatch' && time < MIN_COUNTDOWN_SECONDS) {
    return normalizeTimerState({ ...state, isRunning: false }, now);
  }
  return {
    ...state,
    timeLeftSec: time,
    isRunning: true,
    targetEndTime: state.mode === 'stopwatch' ? undefined : now + time * 1000,
    startedAt: state.mode === 'stopwatch' ? now - time * 1000 : undefined,
    pausedRemainingSec: undefined,
    lastUpdated: now,
  };
}

export function pauseTimerState(state: TimerState, now: number = Date.now()): TimerState {
  const time = computeTimerTime(state, now);
  return {
    ...state,
    timeLeftSec: time,
    isRunning: false,
    targetEndTime: undefined,
    startedAt: undefined,
    pausedRemainingSec: time,
    lastUpdated: now,
  };
}

/** Adds/subtracts time while preserving the countdown's overall progress denominator. */
export function adjustTimerState(
  state: TimerState,
  deltaSeconds: number,
  now: number = Date.now()
): TimerStateResult {
  const current = computeTimerTime(state, now);
  const minimum = state.mode === 'stopwatch' ? 0 : MIN_COUNTDOWN_SECONDS;
  const requested = Math.min(MAX_TIMER_SECONDS, Math.max(minimum, current + deltaSeconds));
  const edited = editTimerState(state, requested, now);
  if (!edited.ok || state.mode === 'stopwatch') return edited;

  const actualDelta = requested - current;
  edited.state.targetDurationSec = Math.min(
    MAX_TIMER_SECONDS,
    Math.max(requested, safeSeconds(state.targetDurationSec) + actualDelta)
  );
  return edited;
}
