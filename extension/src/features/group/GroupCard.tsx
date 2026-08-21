// ─── Group & Problem Squad Card Component ───

import React, { useState, useEffect, useRef } from 'react';
import { StudyGroup } from './group.types';
import { Lock, Globe, Share2, Trash2, ArrowRight, LogOut, ExternalLink } from 'lucide-react';
import { getPlatformColor } from '@/features/room/room-utils';
import { OwnedTimeouts } from '@/shared/owned-timeouts';

interface GroupCardProps {
  group: StudyGroup;
  isActive: boolean;
  onJoin: (group: StudyGroup) => void;
  onLeave?: () => void;
  onShare: (group: StudyGroup) => void;
  onDelete: (groupId: string) => void;
}

export const GroupCard: React.FC<GroupCardProps> = ({
  group,
  isActive,
  onJoin,
  onLeave,
  onShare,
  onDelete,
}) => {
  const platformColor = group.isProblemGroup ? getPlatformColor(group.topicTag) : undefined;

  // Deleting a squad is irreversible — it drops the record from local storage, and for a
  // private squad whose password the user has not saved elsewhere that means permanently
  // losing the ability to re-derive the room. It was previously a single click on a small
  // trash icon with no confirmation. Two-step inline confirm is used rather than window
  // .confirm() because a blocking native dialog over a side panel is jarring and easy to
  // mis-click through.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutsRef = useRef<OwnedTimeouts | null>(null);
  if (timeoutsRef.current === null) timeoutsRef.current = new OwnedTimeouts();
  const timeouts = timeoutsRef.current;

  useEffect(() => () => {
    timeouts.clearAll();
    confirmTimer.current = null;
  }, [timeouts]);

  const handleDeleteClick = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      // Auto-revert so the card does not sit in a scary armed state indefinitely.
      confirmTimer.current = timeouts.replace(confirmTimer.current, () => {
        confirmTimer.current = null;
        setConfirmingDelete(false);
      }, 4000);
      return;
    }
    timeouts.cancel(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmingDelete(false);
    onDelete(group.id);
  };

  return (
    <div
      className="glass-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        border: isActive
          ? '1px solid rgba(139, 92, 246, 0.45)'
          : '1px solid var(--border-subtle)',
        background: isActive
          ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(139, 92, 246, 0.12))'
          : 'var(--bg-surface)',
        position: 'relative',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-md)',
              background: group.isPrivate
                ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(99, 102, 241, 0.2))'
                : group.isProblemGroup
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(245, 158, 11, 0.15))'
                : 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(16, 185, 129, 0.2))',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              flexShrink: 0,
            }}
          >
            {group.avatar}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: 'var(--font-size-md)' }}>
                {group.name}
              </span>
              {isActive && (
                <span
                  style={{
                    fontSize: 'var(--font-size-2xs)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#a7f3d0',
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    padding: '1px 5px',
                    borderRadius: '4px',
                  }}
                >
                  Active
                </span>
              )}
              {!isActive && (group.isMember || group.isCreator) && (
                <span
                  style={{
                    fontSize: 'var(--font-size-2xs)',
                    fontWeight: 600,
                    color: '#34d399',
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '1px 5px',
                    borderRadius: '4px',
                  }}
                >
                  ✓ Joined
                </span>
              )}
            </div>

            {/* Badges row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
              {group.isProblemGroup ? (
                <span
                  className="badge"
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    padding: '1px 6px',
                    backgroundColor: `${platformColor}20`,
                    borderColor: `${platformColor}50`,
                    color: platformColor,
                  }}
                >
                  {group.topicTag} Problem
                </span>
              ) : (
                <span className="badge" style={{ fontSize: 'var(--font-size-xs)', padding: '1px 6px' }}>
                  {group.topicTag}
                </span>
              )}

              <span
                className="badge"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '1px 6px',
                  background: group.isPrivate ? 'rgba(139, 92, 246, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                  borderColor: group.isPrivate ? 'rgba(139, 92, 246, 0.3)' : undefined,
                  color: group.isPrivate ? '#c4b5fd' : 'var(--text-secondary)',
                }}
              >
                {group.isPrivate ? (
                  <>
                    <Lock size={10} color="var(--accent-purple)" />
                    <span>Private</span>
                  </>
                ) : (
                  <>
                    <Globe size={10} color="var(--text-secondary)" />
                    <span>Public</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {group.canonicalUrl && (
            <a
              href={group.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-icon btn-sm"
              title="Open problem in new tab"
              aria-label={`Open ${group.name} problem in a new tab`}
              style={{ color: 'var(--text-secondary)' }}
            >
              <ExternalLink size={13} aria-hidden={true} />
            </a>
          )}

          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => onShare(group)}
            title="Share Invite Code"
            aria-label={`Share ${group.name}`}
          >
            <Share2 size={13} aria-hidden={true} />
          </button>
          <button
            className={`btn btn-sm ${confirmingDelete ? 'btn-danger' : 'btn-ghost btn-icon'}`}
            onClick={handleDeleteClick}
            onBlur={() => setConfirmingDelete(false)}
            title={confirmingDelete ? 'Click again to permanently delete' : 'Delete squad'}
            aria-label={
              confirmingDelete
                ? `Confirm permanent deletion of ${group.name}`
                : `Delete ${group.name}`
            }
            style={
              confirmingDelete
                ? { background: 'rgba(244, 63, 94, 0.9)', color: '#fff', fontSize: 'var(--font-size-xs)', gap: '4px' }
                : { color: 'var(--text-dim)' }
            }
          >
            <Trash2 size={13} aria-hidden={true} />
            {confirmingDelete && <span>Sure?</span>}
          </button>
        </div>
      </div>

      {/* Description if present */}
      {group.description && (
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
          {group.description}
        </p>
      )}

      {/* Footer Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
        {isActive ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={onLeave}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-sm)' }}
          >
            <LogOut size={12} />
            <span>Leave Room</span>
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onJoin(group)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-sm)' }}
          >
            <span>{group.isProblemGroup ? 'Join Problem Room' : (group.isMember || group.isCreator) ? 'Enter Squad' : 'Join Squad'}</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
};
