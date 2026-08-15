// ─── Profile & Identity Card Component ───

import React, { useState } from 'react';
import { RefreshCw, Check, Edit2 } from 'lucide-react';
import { PeerIdentity } from '@/core/network/packet';
import { IdentityService } from './identity.service';

interface IdentityCardProps {
  identity: PeerIdentity | null;
  isLeader?: boolean;
}

export const IdentityCard: React.FC<IdentityCardProps> = ({ identity, isLeader = false }) => {
  const identityService = IdentityService.getInstance();
  const [isEditing, setIsEditing] = useState(false);
  const [customName, setCustomName] = useState(identity?.nickname || '');

  if (!identity) return null;

  const handleRegenerate = async () => {
    await identityService.regenerateIdentity();
  };

  const handleSaveName = async () => {
    if (customName.trim()) {
      await identityService.updateNickname(customName.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Avatar Icon */}
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: identity.color || '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: `0 0 12px ${identity.color}40`,
            }}
          >
            {identity.avatar}
          </div>

          {/* Nickname & Role */}
          <div>
            {isEditing ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="text"
                  className="input-glass"
                  style={{ padding: '2px 6px', width: '130px', fontSize: '12px' }}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  autoFocus
                />
                <button className="btn btn-ghost btn-sm" onClick={handleSaveName}>
                  <Check size={14} color="#10b981" />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>
                  {identity.nickname}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '2px' }}
                  onClick={() => {
                    setCustomName(identity.nickname);
                    setIsEditing(true);
                  }}
                  title="Edit nickname"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span className={`badge ${isLeader ? 'badge-leader' : 'badge-peer'}`}>
                {isLeader ? '👑 Group Leader' : '⚡ Peer Node'}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{identity.peerId}</span>
            </div>
          </div>
        </div>

        {/* Action button */}
        <button
          className="btn btn-secondary btn-icon"
          onClick={handleRegenerate}
          title="Reroll Avatar & Nickname"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
};
