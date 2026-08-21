// ─── Toast renderer for the side panel ───
//
// The rendering half of NotificationService. Deliberately separate from it: the service
// decides WHAT the user is told, this decides how it looks in React. The content-script
// widget renders the same notifications into its shadow DOM from the same service, so the
// two surfaces cannot disagree about which failures are worth surfacing.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import {
  NotificationService,
  type SynqtoNotification,
  type NotificationLevel,
} from './notification.service';

const ICON: Record<NotificationLevel, LucideIcon> = {
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

/** Role tokens rather than literal hex, so toasts follow the active theme like everything else. */
const TONE: Record<NotificationLevel, { bg: string; border: string; fg: string }> = {
  success: { bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.45)', fg: '#6ee7b7' },
  info: { bg: 'rgba(99,102,241,0.14)', border: 'rgba(99,102,241,0.45)', fg: '#c7d2fe' },
  warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.45)', fg: '#fcd34d' },
  error: { bg: 'rgba(239,68,68,0.16)', border: 'rgba(239,68,68,0.5)', fg: '#fca5a5' },
};

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<SynqtoNotification[]>([]);
  const service = NotificationService.getInstance();

  useEffect(() => service.subscribe(setItems), []);

  if (items.length === 0) return null;

  return (
    // aria-live="polite" so a screen reader announces a toast without interrupting whatever
    // the user is doing. role="status" rather than "alert" for the same reason: these are
    // consequences of an action the user just took, not emergencies.
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'absolute',
        left: 'var(--sq-pad, 8px)',
        right: 'var(--sq-pad, 8px)',
        bottom: `calc(var(--nav-height, 58px) + var(--sq-pad, 8px))`,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sq-gap, 6px)',
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      {items.map((n) => {
        const tone = TONE[n.level];
        const Icon = ICON[n.level];
        return (
          <div
            key={n.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--sq-gap, 8px)',
              padding: 'var(--sq-pad, 9px)',
              borderRadius: 'var(--radius-md, 8px)',
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              color: 'var(--text-primary)',
              backdropFilter: 'blur(10px)',
              pointerEvents: 'auto',
              // Never below the legibility floor, at any panel width.
              fontSize: 'max(var(--font-size-xs, 11.5px), 11px)',
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: tone.fg, flex: '0 0 auto', marginTop: 1 }} aria-hidden>
              <Icon size={15} />
            </span>

            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontWeight: 600 }}>{n.title}</strong>
              {n.detail && (
                <span style={{ color: 'var(--text-secondary)', display: 'block' }}>{n.detail}</span>
              )}
            </span>

            <button
              type="button"
              onClick={() => service.dismiss(n.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // Sized from the shared control scale, like every other target.
                minWidth: 'calc(var(--sq-ctl, 34px) * 0.7)',
                minHeight: 'calc(var(--sq-ctl, 34px) * 0.7)',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm, 6px)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
