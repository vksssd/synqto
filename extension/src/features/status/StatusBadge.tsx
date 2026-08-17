// ─── Status Badge Component ───

import React from 'react';
import { PeerStatus } from '@/core/network/packet';
import { STATUS_PRESETS } from './status.service';

interface StatusBadgeProps {
  status: PeerStatus;
  showEmoji?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, showEmoji = true }) => {
  const preset = STATUS_PRESETS[status] || STATUS_PRESETS.solving;

  return (
    <span
      className="badge"
      style={{
        background: `${preset.color}15`,
        borderColor: `${preset.color}40`,
        color: preset.color,
      }}
    >
      <span
        className="status-dot"
        style={{
          backgroundColor: preset.color,
          boxShadow: `0 0 6px ${preset.color}`,
        }}
      />
      {showEmoji && <span>{preset.emoji}</span>}
      <span>{preset.label}</span>
    </span>
  );
};
