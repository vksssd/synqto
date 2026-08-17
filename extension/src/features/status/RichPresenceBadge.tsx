// ─── Rich Presence Badge with Study Timer & Problem Indicator ───

import React, { useState, useEffect } from 'react';
import { Clock, BookOpen } from 'lucide-react';
import { PeerStatus } from '@/core/network/packet';
import { formatElapsed } from '@/shared/utils';
import { StatusBadge } from './StatusBadge';

interface RichPresenceBadgeProps {
  status: PeerStatus;
  startedAt?: number;
  problemTitle?: string;
  onStatusChange?: (newStatus: PeerStatus) => void;
}

export const RichPresenceBadge: React.FC<RichPresenceBadgeProps> = ({
  status,
  startedAt = Date.now(),
  problemTitle,
}) => {
  const [elapsed, setElapsed] = useState(formatElapsed(startedAt));

  useEffect(() => {
    setElapsed(formatElapsed(startedAt));
    const timer = setInterval(() => {
      setElapsed(formatElapsed(startedAt));
    }, 10000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <StatusBadge status={status} />

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}
      >
        <Clock size={12} />
        {elapsed}
      </span>

      {problemTitle && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            maxWidth: '160px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <BookOpen size={12} />
          {problemTitle}
        </span>
      )}
    </div>
  );
};
