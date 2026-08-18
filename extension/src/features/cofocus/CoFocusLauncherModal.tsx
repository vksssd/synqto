// ─── CoFocus Launcher (Mode Picker & Matchmaking Queue) ───

import React, { useState, useEffect, useCallback } from 'react';
import { useModalA11y } from '@/shared/useModalA11y';
import { CoFocusService } from './cofocus.service';
import {
  CoFocusSessionState,
  SESSION_LENGTH_PRESETS,
  SUBJECT_TAGS,
  SessionLengthPreset,
} from './cofocus.types';
import { X, Eye, Users, Link2, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';

interface CoFocusLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type LauncherTab = 'watcher' | 'together' | 'invite';

export const CoFocusLauncherModal: React.FC<CoFocusLauncherModalProps> = ({ isOpen, onClose }) => {
  const cofocus = CoFocusService.getInstance();

  const [tab, setTab] = useState<LauncherTab>('watcher');
  const [lengthMin, setLengthMin] = useState<SessionLengthPreset>(25);
  const [subjectTag, setSubjectTag] = useState<string>(SUBJECT_TAGS[0]);
  const [inviteCode, setInviteCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState<CoFocusSessionState>(cofocus.getState());

  const isBusy = session.phase === 'queued' || session.phase === 'matched';

  /**
   * Dismissal while matchmaking is in flight.
   *
   * Simply closing the dialog used to leave the user silently enqueued: no visible indication
   * anywhere in the UI that a search was still running, no way to cancel without reopening,
   * and — worst — they could be matched minutes later and dropped into a session with no
   * context for why. Closing the launcher is the user saying they are done searching, so it
   * cancels the queue too.
   *
   * Declared before useModalA11y so that Escape, the X button and the backdrop all route
   * through the SAME dismissal path. Passing raw onClose to the hook was itself a bug: Escape
   * bypassed the cancel and left the queue running.
   */
  const handleDismiss = useCallback(() => {
    if (isBusy) {
      cofocus.cancelQueue();
    }
    onClose();
  }, [isBusy, onClose]);

  const { dialogProps } = useModalA11y(isOpen, handleDismiss);

  useEffect(() => cofocus.onChange(setSession), []);

  // Close automatically once a session actually starts — the launcher's job is done and the
  // room surface takes over. Uses onClose, NOT handleDismiss: the session is live, so there is
  // no queue to cancel and calling cancelQueue here would tear down the session we just began.
  useEffect(() => {
    if (session.phase === 'active') {
      onClose();
    }
  }, [session.phase, onClose]);

  if (!isOpen) return null;

  const lengthSec = lengthMin * 60;

  const handleStart = () => {
    if (tab === 'watcher') {
      void cofocus.startWatcher(lengthSec);
    } else if (tab === 'together') {
      void cofocus.startTogetherRandom(subjectTag, lengthSec);
    } else if (inviteCode.trim()) {
      void cofocus.startTogetherInvite(inviteCode.trim(), lengthSec);
    }
  };

  const handleGenerateInvite = () => {
    setGeneratedCode(cofocus.createInviteCode());
    setCopied(false);
  };

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is visible on screen to copy manually */
    }
  };

  // Backdrop dismissal is disabled while a search is running. An accidental click outside
  // would otherwise throw away a queue position the user may have been holding for a while;
  // when busy they must use Cancel or the X, both of which are unambiguous.
  return (
    <div className="modal-overlay" onClick={isBusy ? undefined : handleDismiss}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        {...dialogProps}
        aria-labelledby="cofocus-title"
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div id="cofocus-title" style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
            🎯 CoFocus — Find a Study Partner
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={handleDismiss}
            aria-label={isBusy ? 'Cancel search and close' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        {isBusy ? (
          <QueueStatus session={session} onCancel={() => cofocus.cancelQueue()} />
        ) : (
          <>
            {session.error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#fca5a5',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '11.5px',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{session.error}</span>
              </div>
            )}

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <ModeTab active={tab === 'watcher'} onClick={() => setTab('watcher')} icon={<Eye size={13} />} label="Watcher" />
              <ModeTab active={tab === 'together'} onClick={() => setTab('together')} icon={<Users size={13} />} label="Together" />
              <ModeTab active={tab === 'invite'} onClick={() => setTab('invite')} icon={<Link2 size={13} />} label="Invite" />
            </div>

            {/* Mode description */}
            <div
              style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '10px',
                fontSize: '11.5px',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}
            >
              {tab === 'watcher' && (
                <>
                  <strong style={{ color: '#a5b4fc' }}>Silent body doubling.</strong> You'll be matched with
                  anyone else studying right now — any subject. <strong>Camera only:</strong> no microphone,
                  no chat, no whiteboard. Just quiet company to keep you accountable.
                </>
              )}
              {tab === 'together' && (
                <>
                  <strong style={{ color: '#a5b4fc' }}>Study together.</strong> Matched with someone studying
                  the same subject. Full collaboration: mic, camera, chat, shared cursor and whiteboard.
                </>
              )}
              {tab === 'invite' && (
                <>
                  <strong style={{ color: '#a5b4fc' }}>Invite a friend.</strong> Skip matchmaking — share a
                  code and you'll both land in the same Together session with the full toolkit.
                </>
              )}
            </div>

            {/* Subject picker (Together only) */}
            {tab === 'together' && (
              <div>
                <label
                  htmlFor="cofocus-subject"
                  style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}
                >
                  Subject
                </label>
                <select
                  id="cofocus-subject"
                  className="input"
                  value={subjectTag}
                  onChange={(e) => setSubjectTag(e.target.value)}
                  style={{ width: '100%', fontSize: '12px' }}
                >
                  {SUBJECT_TAGS.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Invite code entry */}
            {tab === 'invite' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label
                    htmlFor="cofocus-invite"
                    style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}
                  >
                    Have a code? Enter it
                  </label>
                  <input
                    id="cofocus-invite"
                    className="input"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    placeholder="e.g. A1B2C3D4E5"
                    style={{ width: '100%', fontSize: '12px', letterSpacing: '0.06em' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>or create one</span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                </div>

                {generatedCode ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      background: 'rgba(99, 102, 241, 0.14)',
                      border: '1px solid rgba(99, 102, 241, 0.4)',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px 10px',
                    }}
                  >
                    <code style={{ fontSize: '14px', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.1em' }}>
                      {generatedCode}
                    </code>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button className="btn btn-ghost btn-icon" onClick={handleCopyInvite} title="Copy code">
                        {copied ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => void cofocus.startTogetherInvite(generatedCode, lengthSec)}
                      >
                        Start
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={handleGenerateInvite} style={{ width: '100%' }}>
                    Generate invite code
                  </button>
                )}
              </div>
            )}

            {/* Preferred length */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>
                Preferred length
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {SESSION_LENGTH_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn btn-sm ${lengthMin === preset ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setLengthMin(preset)}
                    style={{ flex: 1, fontSize: '11.5px' }}
                    aria-pressed={lengthMin === preset}
                  >
                    {preset >= 60 ? `${preset / 60} hr` : `${preset} min`}
                  </button>
                ))}
              </div>
              {/*
                Duration is NOT a matching filter server-side — a 25-minute request can be paired
                with a 120-minute one. Saying so here keeps the UI honest rather than implying a
                guarantee the matchmaker does not make.
              */}
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '5px', lineHeight: 1.4 }}>
                Sets your own session timer. Your partner may pick a different length.
              </div>
            </div>

            {/* Start */}
            {tab !== 'invite' && (
              <button className="btn btn-primary" onClick={handleStart} style={{ width: '100%', marginTop: '2px' }}>
                {tab === 'watcher' ? 'Find someone to study alongside' : 'Find a study partner'}
              </button>
            )}
            {tab === 'invite' && inviteCode.trim() && (
              <button className="btn btn-primary" onClick={handleStart} style={{ width: '100%', marginTop: '2px' }}>
                Join session
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const ModeTab: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
    onClick={onClick}
    aria-pressed={active}
    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontSize: '11.5px' }}
  >
    {icon}
    <span>{label}</span>
  </button>
);

/** Queue / matched status panel, shown while matchmaking is in flight. */
const QueueStatus: React.FC<{ session: CoFocusSessionState; onCancel: () => void }> = ({ session, onCancel }) => {
  const isMatched = session.phase === 'matched';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        padding: '20px 10px 10px',
        textAlign: 'center',
      }}
    >
      <Loader2 size={30} color="var(--primary)" style={{ animation: 'spin 1.2s linear infinite' }} />

      <div>
        <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)' }}>
          {isMatched ? 'Match found — connecting…' : 'Looking for a study partner…'}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
          {isMatched ? (
            <>Waiting for {session.partnerNickname || 'your partner'} to join.</>
          ) : session.mode === 'TOGETHER' ? (
            <>Searching for someone studying {session.subjectTag || 'the same subject'}.</>
          ) : (
            <>Matching you with anyone studying right now.</>
          )}
        </div>
      </div>

      {session.error && <div style={{ fontSize: '11px', color: '#fbbf24', lineHeight: 1.4 }}>{session.error}</div>}

      {!isMatched && session.queuePosition && session.queuePosition > 1 && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Position {session.queuePosition} in queue</div>
      )}

      <button className="btn btn-secondary btn-sm" onClick={onCancel} style={{ width: '100%' }}>
        Cancel
      </button>
    </div>
  );
};
