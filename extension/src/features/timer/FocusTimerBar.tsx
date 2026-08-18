// ─── Floating & Header Focus Timer & Pomodoro Bar Component ───

import React, { useState, useEffect } from 'react';
import { TimerService } from './timer.service';
import { TimerState, PomodoroConfig, TimerMode } from './timer.types';
import { Play, Pause, RotateCcw } from 'lucide-react';

export const FocusTimerBar: React.FC = () => {
  const timerService = TimerService.getInstance();
  const [state, setState] = useState<TimerState>(timerService.getState());
  const [config, setConfig] = useState<PomodoroConfig>(timerService.getConfig());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    return timerService.onChange((s, c) => {
      setState(s);
      setConfig(c);
    });
  }, []);

  if (!config.enabled) {
    return null; // By default not visible unless toggled on in settings
  }

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressPct = () => {
    if (state.mode === 'stopwatch' || state.targetDurationSec === 0) return 100;
    const progress = 1 - state.timeLeftSec / state.targetDurationSec;
    return Math.min(100, Math.max(0, progress * 100));
  };

  const getModeColor = (mode: TimerMode) => {
    switch (mode) {
      case 'pomodoro':
        return '#f43f5e'; // Rose / Red
      case 'short_break':
        return '#10b981'; // Emerald
      case 'long_break':
        return '#06b6d4'; // Cyan
      case 'stopwatch':
        return '#8b5cf6'; // Purple
      default:
        return '#6366f1';
    }
  };

  const currentColor = getModeColor(state.mode);

  return (
    <div
      className="glass-card"
      style={{
        padding: '10px 12px',
        marginBottom: '10px',
        border: `1px solid ${state.isRunning ? `${currentColor}40` : 'rgba(255, 255, 255, 0.1)'}`,
        boxShadow: state.isRunning ? `0 4px 20px ${currentColor}20` : 'none',
        transition: 'all 0.3s ease',
      }}
    >
      {/* Top row: Timer Display, Play/Pause, Mode title, Expand Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => timerService.toggle()}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: currentColor,
              color: '#ffffff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: `0 2px 8px ${currentColor}60`,
              transition: 'transform 0.15s ease',
            }}
            title={state.isRunning ? 'Pause Timer' : 'Start Timer'}
          >
            {state.isRunning ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '2px' }} />}
          </button>

          <div>
            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '18px',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.5px',
                lineHeight: 1.1,
              }}
            >
              {formatTime(state.timeLeftSec)}
            </div>
            <div style={{ fontSize: '10px', color: currentColor, fontWeight: 600, textTransform: 'capitalize' }}>
              {state.mode === 'pomodoro'
                ? '🍅 Focus Session'
                : state.mode === 'short_break'
                ? '☕ Short Break'
                : state.mode === 'long_break'
                ? '🌴 Long Break'
                : '⏱️ Stopwatch'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {state.sessionsCompleted > 0 && (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '10px',
                background: 'rgba(244, 63, 94, 0.15)',
                color: '#f43f5e',
                fontWeight: 600,
                marginRight: '4px',
              }}
              title="Completed Focus Sessions"
            >
              🎯 {state.sessionsCompleted}
            </span>
          )}

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => timerService.addTime(60)}
            title="Add 1 minute"
            style={{ padding: '4px 6px', fontSize: '11px' }}
          >
            +1m
          </button>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => timerService.reset()}
            title="Reset timer"
            style={{ padding: '4px' }}
          >
            <RotateCcw size={13} />
          </button>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setIsExpanded(!isExpanded)}
            title="Toggle timer modes"
            style={{ padding: '4px 6px', fontSize: '10px', color: 'var(--text-muted)' }}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* 🚀 Rocket Racing Progress Track from Launchpad to Finish Flag 🏁 */}
      {state.mode !== 'stopwatch' && (
        <div style={{ marginTop: '10px', position: 'relative' }}>
          {/* Racing track background with distance markings */}
          <div
            style={{
              height: '8px',
              borderRadius: '6px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {/* Track speed lines */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(255,255,255,0.06) 15px, rgba(255,255,255,0.06) 20px)',
              }}
            />

            {/* Glowing Propulsion Fill */}
            <div
              style={{
                height: '100%',
                width: `${getProgressPct()}%`,
                background: `linear-gradient(90deg, rgba(99, 102, 241, 0.6) 0%, ${currentColor} 100%)`,
                boxShadow: state.isRunning ? `0 0 10px ${currentColor}` : 'none',
                transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>

          {/* Launch & Destination Badges + Moving Rocket Icon */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '9px', color: 'var(--text-muted)' }}>
            <span>🛫 Launchpad</span>
            <span style={{ fontWeight: 700, color: currentColor }}>{Math.round(getProgressPct())}% Completed</span>
            <span>🏁 Goal</span>
          </div>

          {/* Animated Traveling Rocket 🚀 */}
          <div
            style={{
              position: 'absolute',
              top: '-6px',
              left: `calc(${Math.min(95, Math.max(2, getProgressPct()))}% - 10px)`,
              pointerEvents: 'none',
              transition: 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              alignItems: 'center',
              filter: state.isRunning ? 'drop-shadow(0 0 6px rgba(244, 63, 94, 0.9))' : 'none',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                display: 'inline-block',
                transform: 'rotate(45deg)',
                animation: state.isRunning ? 'rocketThrust 0.8s ease-in-out infinite alternate' : 'none',
              }}
            >
              🚀
            </span>
            {state.isRunning && (
              <span
                style={{
                  fontSize: '10px',
                  marginLeft: '-4px',
                  animation: 'flameFlicker 0.3s ease-in-out infinite alternate',
                }}
              >
                🔥
              </span>
            )}
          </div>
        </div>
      )}

      {/* Expandable Mode Switcher & Presets */}
      {isExpanded && (
        <div
          style={{
            display: 'flex',
            gap: '4px',
            marginTop: '10px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => timerService.setMode('pomodoro')}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '10px',
              borderRadius: '6px',
              background: state.mode === 'pomodoro' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${state.mode === 'pomodoro' ? '#f43f5e' : 'transparent'}`,
              color: state.mode === 'pomodoro' ? '#f43f5e' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: state.mode === 'pomodoro' ? 600 : 400,
            }}
          >
            🍅 25m
          </button>

          <button
            onClick={() => timerService.setMode('short_break')}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '10px',
              borderRadius: '6px',
              background: state.mode === 'short_break' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${state.mode === 'short_break' ? '#10b981' : 'transparent'}`,
              color: state.mode === 'short_break' ? '#10b981' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: state.mode === 'short_break' ? 600 : 400,
            }}
          >
            ☕ 5m
          </button>

          <button
            onClick={() => timerService.setMode('long_break')}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '10px',
              borderRadius: '6px',
              background: state.mode === 'long_break' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${state.mode === 'long_break' ? '#06b6d4' : 'transparent'}`,
              color: state.mode === 'long_break' ? '#06b6d4' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: state.mode === 'long_break' ? 600 : 400,
            }}
          >
            🌴 15m
          </button>

          <button
            onClick={() => timerService.setMode('stopwatch')}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: '10px',
              borderRadius: '6px',
              background: state.mode === 'stopwatch' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${state.mode === 'stopwatch' ? '#8b5cf6' : 'transparent'}`,
              color: state.mode === 'stopwatch' ? '#8b5cf6' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: state.mode === 'stopwatch' ? 600 : 400,
            }}
          >
            ⏱️ Stopw.
          </button>
        </div>
      )}
    </div>
  );
};
