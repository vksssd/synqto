// ─── Create Group Modal (Serverless & Zero-Knowledge) ───

import React, { useState } from 'react';
import { GroupService } from './group.service';
import {
  X,
  Lock,
  Globe,
  Sparkles,
  Eye,
  EyeOff,
  Dices,
  ShieldCheck,
  Tag,
} from 'lucide-react';

const TOPIC_PRESETS = [
  'LeetCode',
  'System Design',
  'Algorithms',
  'Frontend',
  'AI / ML',
  'Open Source',
  'General',
];

const EMOJI_PRESETS = ['🚀', '🧠', '💻', '⚡', '🔥', '🛡️', '🎯', '☕', '📚', '🏆', '💎', '🦊'];

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const groupService = GroupService.getInstance();

  const [name, setName] = useState('');
  const [topicTag, setTopicTag] = useState('LeetCode');
  const [customTopic, setCustomTopic] = useState('');
  const [avatar, setAvatar] = useState('🚀');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRandomizeAvatar = () => {
    const random = EMOJI_PRESETS[Math.floor(Math.random() * EMOJI_PRESETS.length)];
    setAvatar(random);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Please provide a group name');
      return;
    }

    if (isPrivate && !password.trim()) {
      setErrorMsg('Please enter a password for this private group');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const finalTopic = customTopic.trim() || topicTag;

      await groupService.createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        avatar,
        isPrivate,
        password: isPrivate ? password : undefined,
        topicTag: finalTopic,
      });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create group');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
        {/* Header */}
        <div className="glass-card-header" style={{ marginBottom: 4 }}>
          <div className="glass-card-title" style={{ fontSize: '15px' }}>
            <Sparkles size={16} color="var(--primary)" />
            <span>Create Study Squad</span>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Form an instant serverless P2P study room. All connections and audio are peer-to-peer.
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
          {/* Avatar & Name Row */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Squad Name & Icon
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '42px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid var(--border-medium)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px',
                  flexShrink: 0,
                }}
              >
                {avatar}
                <button
                  type="button"
                  onClick={handleRandomizeAvatar}
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title="Randomize Icon"
                >
                  <Dices size={10} />
                </button>
              </div>

              <input
                type="text"
                className="input-glass"
                placeholder="e.g. NeetCode 150 Gang, Algo Wizards"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                required
                autoFocus
              />
            </div>
          </div>

          {/* Quick Emoji Picker */}
          <div>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
              {EMOJI_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: 'var(--radius-sm)',
                    background: avatar === emoji ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    border: avatar === emoji ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Topic Selector */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Topic / Category
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
              {TOPIC_PRESETS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setTopicTag(tag);
                    setCustomTopic('');
                  }}
                  className={`prompt-pill ${topicTag === tag && !customTopic ? 'active' : ''}`}
                  style={{
                    background: topicTag === tag && !customTopic ? 'rgba(99, 102, 241, 0.22)' : undefined,
                    borderColor: topicTag === tag && !customTopic ? 'var(--primary)' : undefined,
                    color: topicTag === tag && !customTopic ? '#f8fafc' : undefined,
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Description (Optional) */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Group Goal / Description (Optional)
            </label>
            <input
              type="text"
              className="input-glass"
              placeholder="e.g. Solving 2 mediums every evening 7-9 PM"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={80}
            />
          </div>

          {/* Privacy Toggle (Public vs Private Password Protected) */}
          <div
            style={{
              padding: '10px',
              borderRadius: 'var(--radius-md)',
              background: isPrivate ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.03)',
              border: isPrivate ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isPrivate ? <Lock size={15} color="var(--accent-purple)" /> : <Globe size={15} color="var(--text-secondary)" />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '12px', color: '#f8fafc' }}>
                    {isPrivate ? 'Password Protected Group' : 'Open Public Group'}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {isPrivate
                      ? 'Requires a secret passcode to discover & enter'
                      : 'Anyone with the name can discover & join'}
                  </div>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                type="button"
                onClick={() => setIsPrivate(!isPrivate)}
                style={{
                  width: '36px',
                  height: '20px',
                  borderRadius: '10px',
                  background: isPrivate ? 'var(--accent-purple)' : 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  position: 'relative',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'background 0.2s',
                }}
              >
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    position: 'absolute',
                    top: '2px',
                    left: isPrivate ? '18px' : '2px',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>

            {/* Password input when Private is enabled */}
            {isPrivate && (
              <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-glass"
                    placeholder="Enter secret squad password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={isPrivate}
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
                  <span>Zero-knowledge: Password is never sent to the signaling server.</span>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 2 }}
              disabled={isSubmitting || !name.trim() || (isPrivate && !password.trim())}
            >
              {isSubmitting ? 'Creating...' : 'Create & Enter Squad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
