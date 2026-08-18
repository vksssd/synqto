// ─── Join Squad via Invite Code / Token Modal ───

import React, { useState, useEffect } from 'react';
import { GroupService } from './group.service';
import { GroupInvitePayload } from './group.types';
import { Ticket, X, Lock, Globe, Eye, EyeOff } from 'lucide-react';

interface JoinInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const JoinInviteModal: React.FC<JoinInviteModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const groupService = GroupService.getInstance();

  const [inviteInput, setInviteInput] = useState('');
  const [parsedPayload, setParsedPayload] = useState<GroupInvitePayload | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Input accepts EITHER an NBGRP invite token OR a plain group name/@handle. A public
  // group's room ID derives deterministically from its handle, so a name alone is enough
  // to resolve and join — no invite exchange and no directory service required.
  const trimmed = inviteInput.trim();
  const looksLikeToken = /^NBGRP:/i.test(trimmed);
  const handlePreview = !looksLikeToken && trimmed ? GroupService.toHandle(trimmed) : '';
  const canJoinByHandle = !looksLikeToken && GroupService.isValidHandle(trimmed);

  useEffect(() => {
    if (!trimmed) {
      setParsedPayload(null);
      setErrorMsg(null);
      return;
    }

    if (!looksLikeToken) {
      // Handle mode — nothing to parse, validity is reflected inline below the field.
      setParsedPayload(null);
      setErrorMsg(null);
      return;
    }

    const payload = groupService.parseInviteCode(trimmed);
    if (payload) {
      setParsedPayload(payload);
      if (payload.pwd) {
        setPassword(payload.pwd);
      }
      setErrorMsg(null);
    } else {
      setParsedPayload(null);
      setErrorMsg('That invite token looks incomplete — copy the whole NBGRP:… string.');
    }
  }, [trimmed, looksLikeToken]);

  // Escape closes the dialog. Modals previously trapped the user into clicking the X or
  // the backdrop, which is both an accessibility failure and a common source of "stuck"
  // reports when the backdrop is covered by another element.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Join by name/handle ──
    if (!looksLikeToken) {
      if (!canJoinByHandle) {
        setErrorMsg('Enter a squad name (at least 2 letters or numbers) or paste an invite token.');
        return;
      }
      try {
        setIsSubmitting(true);
        setErrorMsg(null);
        const res = await groupService.joinByHandle(trimmed);
        if (!res.success) {
          setErrorMsg(res.error || 'Could not join that squad');
          return;
        }
        onSuccess?.();
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to join squad by name');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // ── Join via invite token ──
    if (!parsedPayload) {
      setErrorMsg('Please paste a valid invite token');
      return;
    }

    if (parsedPayload.isPrivate && !password.trim()) {
      setErrorMsg('Please enter squad password');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      // Private squads must go through createGroup because the room ID is derived from
      // the password, which only the joining client knows. Public squads resolve straight
      // from the handle.
      //
      // NOTE: createGroup stamps isCreator/creatorPeerId on the caller. Accepting an invite
      // does NOT make you the creator, so the flag is corrected immediately afterwards —
      // previously every invited member was recorded as the squad's creator.
      const group = await groupService.createGroup({
        name: parsedPayload.name,
        description: parsedPayload.description,
        avatar: parsedPayload.avatar || '🚀',
        isPrivate: parsedPayload.isPrivate,
        password: parsedPayload.isPrivate ? password : undefined,
        topicTag: parsedPayload.topicTag || 'General',
      });

      groupService.markAsJoinedNotCreated(group.id);

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to join group via invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '380px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-squad-title"
      >
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Ticket size={16} color="var(--accent-cyan)" aria-hidden="true" />
            <span id="join-squad-title">Find or Join a Squad</span>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close dialog">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
          Type a squad <strong>name</strong> to find it, or paste an <code>NBGRP:…</code> invite token.
        </p>

        {errorMsg && (
          <div
            role="alert"
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fca5a5',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label
              htmlFor="join-squad-input"
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}
            >
              Squad name or invite token
            </label>
            <input
              id="join-squad-input"
              type="text"
              className="input-glass"
              placeholder="e.g. leetcode-grind  ·  or NBGRP:…"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              aria-describedby="join-squad-hint"
             aria-label="Squad name or invite token"/>

            {/* Live resolution preview: shows the exact handle the name normalizes to, so
                two people can confirm they are typing the same thing before joining. */}
            <div id="join-squad-hint" aria-live="polite" style={{ marginTop: '5px', minHeight: '14px' }}>
              {handlePreview && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: canJoinByHandle ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                  {canJoinByHandle ? (
                    <>Joins public squad <strong>@{handlePreview}</strong></>
                  ) : (
                    <>Keep typing — needs at least 2 letters or numbers</>
                  )}
                </span>
              )}
              {looksLikeToken && !parsedPayload && !errorMsg && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>Reading invite token…</span>
              )}
            </div>
          </div>

          {/* Parsed Group Preview Card */}
          {parsedPayload && (
            <div
              style={{
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                animation: 'slideUp 0.18s ease-out',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '24px' }}>{parsedPayload.avatar}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 'var(--font-size-md)' }}>
                    {parsedPayload.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    <span>{parsedPayload.topicTag || 'General'}</span>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {parsedPayload.isPrivate ? (
                        <>
                          <Lock size={11} color="var(--accent-purple)" />
                          <span>Private</span>
                        </>
                      ) : (
                        <>
                          <Globe size={11} color="var(--text-secondary)" />
                          <span>Public</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {parsedPayload.description && (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  {parsedPayload.description}
                </div>
              )}

              {/* Password Input for Private Groups */}
              {parsedPayload.isPrivate && (
                <div style={{ marginTop: '4px' }}>
                  <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    Squad Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input-glass"
                      placeholder="Enter squad password..."
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      style={{ paddingRight: '36px' }}
                     aria-label="Enter squad password"/>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                      }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1.5 }}
              disabled={
                isSubmitting ||
                // Handle mode needs only a resolvable name; token mode needs a parsed
                // payload (and a password when the squad is private).
                (looksLikeToken
                  ? !parsedPayload || (parsedPayload.isPrivate && !password.trim())
                  : !canJoinByHandle)
              }
            >
              {isSubmitting ? 'Joining...' : 'Join Squad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
