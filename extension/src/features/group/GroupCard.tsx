// ─── Group & Problem Squad Card Component (with Synq Button) ───

import React from 'react';
import { StudyGroup } from './group.types';
import { Lock, Globe, Share2, ArrowRight, LogOut, ExternalLink, Zap, Clock, Hash } from 'lucide-react';
import { getPlatformColor } from '@/features/room/room-utils';

interface GroupCardProps {
  group: StudyGroup;
  isActive: boolean;
  onSynq: (group: StudyGroup) => void;
  onLeaveRoom?: () => void;
  onLeaveGroup?: (groupId: string) => void;
  onShare: (group: StudyGroup) => void;
  onOpenInfo: (group: StudyGroup) => void;
}

export const GroupCard: React.FC<GroupCardProps> = ({
  group,
  isActive,
  onSynq,
  onLeaveRoom,
  onLeaveGroup,
  onShare,
  onOpenInfo,
}) => {
  const platformColor = group.isProblemGroup ? getPlatformColor(group.topicTag) : undefined;

  const isMemberOrCreator = group.isMember || group.isCreator;

  // Format schedule badge
  const scheduleBadge = (() => {
    if (!group.schedule?.openTime) return null;
    const open = group.schedule.openTime;
    const close = group.schedule.closeTime || '';
    const tz = group.schedule.timezone || '';
    const days = group.schedule.days?.join(', ') || '';
    return `${open}${close ? `–${close}` : ''} ${tz}${days ? ` • ${days}` : ''}`;
  })();

  // Tags preview
  const tagsPreview = group.tags?.slice(0, 4);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
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

          <div style={{ minWidth: 0 }}>
            {/* Clickable group name → opens info modal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span
                onClick={() => onOpenInfo(group)}
                style={{
                  fontWeight: 600,
                  color: '#f8fafc',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#a5b4fc')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#f8fafc')}
                title="View group info & online members"
              >
                {group.name}
              </span>
              {isActive && (
                <span
                  style={{
                    fontSize: '9px',
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
              {!isActive && isMemberOrCreator && (
                <span
                  style={{
                    fontSize: '9px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
              {group.isProblemGroup ? (
                <span
                  className="badge"
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    backgroundColor: `${platformColor}20`,
                    borderColor: `${platformColor}50`,
                    color: platformColor,
                  }}
                >
                  {group.topicTag} Problem
                </span>
              ) : (
                <span className="badge" style={{ fontSize: '10px', padding: '1px 6px' }}>
                  {group.topicTag}
                </span>
              )}

              <span
                className="badge"
                style={{
                  fontSize: '10px',
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

              {/* Schedule badge */}
              {scheduleBadge && (
                <span
                  className="badge"
                  style={{
                    fontSize: '9px',
                    padding: '1px 5px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderColor: 'rgba(245, 158, 11, 0.3)',
                    color: '#fbbf24',
                    gap: '3px',
                  }}
                >
                  <Clock size={9} />
                  <span>{scheduleBadge}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {group.canonicalUrl && (
            <a
              href={group.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-icon btn-sm"
              title="Open problem in new tab"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ExternalLink size={13} />
            </a>
          )}

          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => onShare(group)}
            title="Share Invite Code"
          >
            <Share2 size={13} />
          </button>
        </div>
      </div>

      {/* Description if present */}
      {group.description && (
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4, margin: 0 }}>
          {group.description}
        </p>
      )}

      {/* Tags row */}
      {tagsPreview && tagsPreview.length > 0 && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {tagsPreview.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '3px',
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <Hash size={8} />
              {tag.replace('#', '')}
            </span>
          ))}
          {group.tags && group.tags.length > 4 && (
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              +{group.tags.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Footer Controls: Synq Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' }}>
        {isActive ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={onLeaveRoom}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
          >
            <LogOut size={12} />
            <span>Leave Room</span>
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSynq(group)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              fontWeight: 700,
              background: isMemberOrCreator
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : 'linear-gradient(135deg, #f59e0b, #f97316)',
              borderColor: isMemberOrCreator ? '#6366f1' : '#f59e0b',
              padding: '5px 14px',
            }}
          >
            <Zap size={13} />
            <span>
              {group.isProblemGroup
                ? 'Join Problem Room'
                : isMemberOrCreator
                ? '⚡ Open Chat'
                : '⚡ Synq'}
            </span>
            <ArrowRight size={11} />
          </button>
        )}
      </div>
    </div>
  );
};
