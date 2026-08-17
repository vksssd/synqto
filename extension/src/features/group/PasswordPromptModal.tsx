// ─── Password Prompt Modal for Private Groups ───

import React, { useState } from 'react';
import { StudyGroup } from './group.types';
import { GroupService } from './group.service';
import { Lock, X, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';

interface PasswordPromptModalProps {
  group: StudyGroup | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const PasswordPromptModal: React.FC<PasswordPromptModalProps> = ({
  group,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const groupService = GroupService.getInstance();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !group) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setErrorMsg('Please enter group password');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const res = await groupService.joinGroup(group, password);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to enter group');
        return;
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to join group');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '360px' }}>
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Lock size={16} color="var(--accent-purple)" />
            <span>Private Squad Access</span>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Group Mini Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              fontSize: '22px',
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(139, 92, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {group.avatar}
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>{group.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{group.topicTag}</div>
          </div>
        </div>

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

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Enter Squad Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="input-glass"
                placeholder="Enter password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
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

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: '#c4b5fd',
            }}
          >
            <ShieldCheck size={12} />
            <span>Zero-Knowledge: Validated locally &amp; cryptographically derived.</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1.5 }}
              disabled={isSubmitting || !password.trim()}
            >
              {isSubmitting ? 'Unlocking...' : 'Unlock & Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
