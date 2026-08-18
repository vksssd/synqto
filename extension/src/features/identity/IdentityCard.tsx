// ─── Profile & Identity Card Component (Collapsible & Expandable) ───

import React, { useState } from 'react';
import { RefreshCw, Check, Edit2, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { PeerIdentity } from '@/core/network/packet';
import { IdentityService } from './identity.service';

interface IdentityCardProps {
  identity: PeerIdentity | null;
  isLeader?: boolean;
}

export const IdentityCard: React.FC<IdentityCardProps> = ({ identity, isLeader = false }) => {
  const identityService = IdentityService.getInstance();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [customName, setCustomName] = useState(identity?.nickname || '');

  if (!identity) return null;

  const handleRegenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await identityService.regenerateIdentity();
  };

  const handleSaveName = async () => {
    if (customName.trim()) {
      await identityService.updateNickname(customName.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="glass-card" style={{ transition: 'all 0.2s ease' }}>
      {/* Interactive Card Header */}
      <div
        className="glass-card-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          marginBottom: isExpanded ? '10px' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: identity.color || '#2dd4bf',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--font-size-lg)',
              boxShadow: `0 0 8px ${identity.color || '#2dd4bf'}40`,
            }}
          >
            {identity.avatar}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>
                {identity.nickname}
              </span>
              <span className={`badge ${isLeader ? 'badge-leader' : 'badge-peer'}`} style={{ fontSize: 'var(--font-size-2xs)', padding: '1px 5px' }}>
                {isLeader ? '👑 Leader' : '⚡ Peer'}
              </span>
            </div>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Ephemeral Mesh Identity
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={handleRegenerate}
            title="Reroll Avatar & Nickname"
            style={{ width: '24px', height: '24px', padding: 0 }}
          
            aria-label="Reroll Avatar & Nickname">
            <RefreshCw size={12} />
          </button>
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              Display Nickname:
            </div>
            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="text"
                  className="input-glass"
                  style={{ padding: '2px 6px', width: '130px', fontSize: 'var(--font-size-sm)' }}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" style={{ padding: '2px 6px', height: '22px' }} onClick={handleSaveName}>
                  <Check size={12} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
                  {identity.nickname}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px 4px', height: '20px' }}
                  onClick={() => {
                    setCustomName(identity.nickname);
                    setIsEditing(true);
                  }}
                  title="Edit nickname"
                >
                  <Edit2 size={11} />
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              Network Node ID:
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {identity.peerId}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              Session Role:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck size={12} color={isLeader ? 'var(--accent-amber)' : 'var(--primary)'} />
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isLeader ? 'Room Host (Leader)' : 'Synchronized Peer'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
