// ─── CoFocus Session Bar (Together mode) ───
//
// Together sessions deliberately reuse the entire existing room surface (chat, voice, cursor,
// whiteboard) rather than reimplementing it. The one thing that surface knows nothing about is
// that a CoFocus session is running at all: the user chose a session length in the launcher and
// CoFocusService is counting it down, but ProblemRoomChatView has no concept of any of that, so
// without this the countdown was invisible and the chosen length appeared to do nothing.
//
// Kept as a thin bar mounted above the normal room view so that Together's promise — "the full
// collaboration surface, unchanged" — stays true.

import React, { useState, useEffect } from 'react';
import { CoFocusService } from './cofocus.service';
import { CoFocusSessionState } from './cofocus.types';
import { Users, Timer, Plus, LogOut, UserX } from 'lucide-react';

function formatCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const CoFocusSessionBar: React.FC = () => {
  const cofocus = CoFocusService.getInstance();
  const [session, setSession] = useState<CoFocusSessionState>(cofocus.getState());

  useEffect(() => cofocus.onChange(setSession), []);

  if (session.phase === 'idle') return null;

  const isComplete = session.phase === 'completed';
  const partnerGone = !session.partnerPresent && (session.phase === 'active' || isComplete);

  return (
    <div
      className="glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '7px 10px',
        flexShrink: 0,
        background: isComplete
          ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(5, 150, 105, 0.10))'
          : 'linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.10))',
        border: isComplete ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(99, 102, 241, 0.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
        <Users size={14} color={isComplete ? '#34d399' : '#a5b4fc'} style={{ flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {isComplete ? 'Session complete' : 'Study Together'}
            {session.subjectTag ? ` · ${session.subjectTag}` : ''}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: partnerGone ? '#fbbf24' : 'var(--text-muted)',
            }}
          >
            {partnerGone ? (
              <>
                <UserX size={9} />
                <span>{session.partnerNickname || 'Your partner'} left</span>
              </>
            ) : session.partnerPresent ? (
              <span>with {session.partnerNickname || 'your partner'}</span>
            ) : (
              <span>waiting for your partner…</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
        {(session.phase === 'active' || isComplete) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(0, 0, 0, 0.28)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '2px 7px',
            }}
          >
            <Timer size={11} color={isComplete ? '#34d399' : '#c4b5fd'} />
            <span
              style={{
                fontWeight: 700,
                fontSize: 'var(--font-size-sm)',
                fontVariantNumeric: 'tabular-nums',
                color: isComplete ? '#34d399' : '#c4b5fd',
              }}
            >
              {isComplete ? 'Done' : formatCountdown(session.remainingSec)}
            </span>
          </div>
        )}

        {isComplete && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => cofocus.extendSession(25 * 60)}
            title="Add another 25 minutes"
            style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10.5px', padding: '3px 7px' }}
          >
            <Plus size={11} />
            <span>25m</span>
          </button>
        )}

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => cofocus.endSession()}
          title="Leave this CoFocus session"
          style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10.5px', padding: '3px 7px' }}
        >
          <LogOut size={11} />
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
};
