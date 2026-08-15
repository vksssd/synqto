// ─── Join Squad via Invite Code / Token Modal ───

import React, { useState, useEffect } from 'react';
import { GroupService } from './group.service';
import { GroupInvitePayload } from './group.types';
import { Ticket, X, Lock, Globe, Eye, EyeOff, ArrowRight } from 'lucide-react';

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

  useEffect(() => {
    if (!inviteInput.trim()) {
      setParsedPayload(null);
      setErrorMsg(null);
      return;
    }

    const payload = groupService.parseInviteCode(inviteInput.trim());
    if (payload) {
      setParsedPayload(payload);
      if (payload.pwd) {
        setPassword(payload.pwd);
      }
      setErrorMsg(null);
    } else if (inviteInput.trim().length > 8) {
      setParsedPayload(null);
      setErrorMsg('Invalid invite code format (must start with NBGRP:)');
    }
  }, [inviteInput]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      // Create or import group from payload
      const group = await groupService.createGroup({
        name: parsedPayload.name,
        description: parsedPayload.description,
        avatar: parsedPayload.avatar || '🚀',
        isPrivate: parsedPayload.isPrivate,
        password: parsedPayload.isPrivate ? password : undefined,
        topicTag: parsedPayload.topicTag || 'General',
      });

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
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Ticket size={16} color="var(--accent-cyan)" />
            <span>Join Squad via Invite Code</span>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Paste a <code>NBGRP:...</code> token to join a peer squad.
        </p>

        {errorMsg && (
          <div
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fca5a5',
              fontSize: '11px',
            }}
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Invite Token
            </label>
            <input
              type="text"
              className="input-glass"
              placeholder="Paste NBGRP:... token"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              autoFocus
              required
            />
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
                  <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                    {parsedPayload.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
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
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {parsedPayload.description}
                </div>
              )}

              {/* Password Input for Private Groups */}
              {parsedPayload.isPrivate && (
                <div style={{ marginTop: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
                    />
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
              disabled={isSubmitting || !parsedPayload || (parsedPayload.isPrivate && !password.trim())}
            >
              {isSubmitting ? 'Joining...' : 'Join Squad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
