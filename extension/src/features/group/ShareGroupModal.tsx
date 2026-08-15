// ─── Share Group Modal (Generate Instant Invite Tokens) ───

import React, { useState } from 'react';
import { StudyGroup } from './group.types';
import { GroupService } from './group.service';
import { Share2, X, Copy, Check, Lock, Globe, KeyRound } from 'lucide-react';

interface ShareGroupModalProps {
  group: StudyGroup | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareGroupModal: React.FC<ShareGroupModalProps> = ({
  group,
  isOpen,
  onClose,
}) => {
  const groupService = GroupService.getInstance();

  const [includePassword, setIncludePassword] = useState(false);
  const [passwordForInvite, setPasswordForInvite] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen || !group) return null;

  const inviteCode = groupService.generateInviteCode(
    group,
    includePassword,
    passwordForInvite
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Share2 size={16} color="var(--primary)" />
            <span>Share Study Squad</span>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Group Header Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: '24px' }}>{group.avatar}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>{group.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>{group.topicTag}</span>
              <span>•</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                {group.isPrivate ? (
                  <>
                    <Lock size={11} color="var(--accent-purple)" />
                    <span>Private Squad</span>
                  </>
                ) : (
                  <>
                    <Globe size={11} color="var(--text-secondary)" />
                    <span>Public Squad</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Private password embed option */}
        {group.isPrivate && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(139, 92, 246, 0.08)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: '#e2e8f0' }}>
              <input
                type="checkbox"
                checked={includePassword}
                onChange={(e) => setIncludePassword(e.target.checked)}
              />
              <KeyRound size={13} color="var(--accent-purple)" />
              <span>Embed password for 1-click buddy onboarding</span>
            </label>

            {includePassword && (
              <input
                type="password"
                className="input-glass"
                placeholder="Enter squad password to embed..."
                value={passwordForInvite}
                onChange={(e) => setPasswordForInvite(e.target.value)}
                style={{ fontSize: '11px', padding: '6px 8px' }}
              />
            )}
          </div>
        )}

        {/* Invite Code Box */}
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Squad Invite Token
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 8px',
            }}
          >
            <input
              type="text"
              readOnly
              value={inviteCode}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-cyan)',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                outline: 'none',
                textOverflow: 'ellipsis',
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleCopy}
              style={{ flexShrink: 0 }}
            >
              {copied ? (
                <>
                  <Check size={12} />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={12} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <p style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Send this code to friends. They can click <strong>&quot;Join via Code&quot;</strong> in Synqto to instantly link into your P2P mesh room.
        </p>

        <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginTop: '4px' }}>
          Done
        </button>
      </div>
    </div>
  );
};
