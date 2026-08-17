// ─── Active Room Card Component ───

import React from 'react';
import { Users, ExternalLink, Radio, LogOut, Lock, Globe } from 'lucide-react';
import { RoomContext, getPlatformBadgeColor } from './room-utils';
import { StatusService } from '@/features/status/status.service';
import { STATUS_PRESETS } from '@/features/status/status.service';
import { PeerStatus } from '@/core/network/packet';

interface RoomCardProps {
  room: RoomContext | null;
  peerCount: number;
  isLeader: boolean;
  isConnected: boolean;
  onLeaveRoom?: () => void;
  onOpenPeers?: () => void;
}

export const RoomCard: React.FC<RoomCardProps> = ({
  room,
  peerCount,
  isLeader,
  isConnected,
  onLeaveRoom,
  onOpenPeers,
}) => {
  const statusService = StatusService.getInstance();
  const [currentStatus, setCurrentStatus] = React.useState<PeerStatus>(statusService.getStatus());

  React.useEffect(() => {
    return statusService.onChange((s) => setCurrentStatus(s));
  }, []);

  if (!room) {
    return (
      <div className="glass-card" style={{ textAlign: 'center', padding: '20px 16px' }}>
        <Radio size={28} color="var(--primary)" style={{ margin: '0 auto 8px', display: 'block' }} />
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
          No Active Problem Room
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Open any LeetCode, Codeforces, NeetCode problem, or join a Study Squad!
        </div>
      </div>
    );
  }

  const platformColor = getPlatformBadgeColor(room.platform);

  return (
    <div className="glass-card">
      <div className="glass-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {room.isGroup && room.groupDetails ? (
            <span
              className="badge"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                borderColor: 'rgba(139, 92, 246, 0.4)',
                color: '#c4b5fd',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              {room.groupDetails.isPrivate ? <Lock size={10} /> : <Globe size={10} />}
              <span>{room.groupDetails.isPrivate ? 'Private Squad' : 'Public Squad'}</span>
            </span>
          ) : (
            <span
              className="badge badge-platform"
              style={{
                backgroundColor: `${platformColor}20`,
                borderColor: `${platformColor}50`,
                color: platformColor,
              }}
            >
              {room.platform}
            </span>
          )}

          <span className={`badge ${isLeader ? 'badge-leader' : 'badge-peer'}`}>
            {isLeader ? '👑 Group Leader' : '⚡ Peer Link'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            className={`status-dot ${isConnected ? 'pulse' : ''}`}
            style={{
              backgroundColor: isConnected ? '#10b981' : '#ef4444',
              color: isConnected ? '#10b981' : '#ef4444',
            }}
            title={isConnected ? 'Connected to P2P Mesh' : 'Connecting...'}
          />
          {onLeaveRoom && (
            <button
              className="btn btn-ghost btn-icon"
              style={{ width: '24px', height: '24px' }}
              onClick={onLeaveRoom}
              title="Leave Room"
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Room / Problem Title */}
      <div style={{ margin: '6px 0 10px' }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 700,
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {room.isGroup && room.groupDetails && (
            <span style={{ fontSize: '18px' }}>{room.groupDetails.avatar}</span>
          )}
          <span>{room.title}</span>
          {room.canonicalUrl && !room.canonicalUrl.startsWith('custom://') && !room.canonicalUrl.startsWith('group://') && (
            <a
              href={room.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--text-muted)' }}
              title="Open problem page"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>

        {room.isGroup && room.groupDetails?.description && (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {room.groupDetails.description}
          </div>
        )}

        <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>
          Room: {room.roomId}
        </div>
      </div>

      {/* Roster trigger & Status selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <button className="btn btn-secondary btn-sm" onClick={onOpenPeers}>
          <Users size={13} color="var(--primary)" />
          <span>{peerCount} {peerCount === 1 ? 'Studying' : 'Studying'}</span>
        </button>

        {/* Quick status dropdown */}
        <select
          className="input-glass"
          style={{
            width: 'auto',
            padding: '3px 8px',
            fontSize: '11px',
            cursor: 'pointer',
          }}
          value={currentStatus}
          onChange={(e) => statusService.setStatus(e.target.value as PeerStatus)}
        >
          {Object.values(STATUS_PRESETS).map((p) => (
            <option key={p.status} value={p.status} style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
              {p.emoji} {p.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
