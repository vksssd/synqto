// ─── Group Welcome Gate (First-time member onboarding overlay) ───

import React, { useState, useRef, useEffect } from 'react';
import { StudyGroup } from './group.types';
import { BookOpen, Target, Clock, Shield, ChevronDown } from 'lucide-react';

interface GroupWelcomeGateProps {
  group: StudyGroup;
  onAccept: () => void;
}

export const GroupWelcomeGate: React.FC<GroupWelcomeGateProps> = ({ group, onAccept }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canAccept, setCanAccept] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Check if content overflows
    const checkOverflow = () => {
      if (el.scrollHeight <= el.clientHeight + 10) {
        setCanAccept(true);
        setShowScrollHint(false);
      } else {
        setShowScrollHint(true);
      }
    };

    checkOverflow();

    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20;
      if (atBottom) {
        setCanAccept(true);
        setShowScrollHint(false);
      }
    };

    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const sectionStyle: React.CSSProperties = {
    padding: '12px 14px',
    borderRadius: '10px',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: 700,
    marginBottom: '8px',
  };

  return (
    <div
      className="modal-overlay"
      style={{
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(12px)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: '92%',
          maxWidth: '380px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))',
          borderRadius: '16px',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(99, 102, 241, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* ─── Header ─── */}
        <div
          style={{
            textAlign: 'center',
            padding: '24px 20px 16px',
            background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.12), transparent)',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 12px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3), rgba(139, 92, 246, 0.25))',
              border: '2px solid rgba(99, 102, 241, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '36px',
            }}
          >
            {group.avatar}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#f8fafc', marginBottom: '4px' }}>
            Welcome to {group.name}!
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Please read the group info before continuing
          </div>
        </div>

        {/* ─── Scrollable Content ─── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Description */}
          {group.description && (
            <div style={sectionStyle}>
              <div style={{ ...sectionHeaderStyle, color: '#a5b4fc' }}>
                <BookOpen size={14} color="var(--primary)" />
                <span>About</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {group.description}
              </p>
            </div>
          )}

          {/* Goals */}
          {group.goals && (
            <div style={sectionStyle}>
              <div style={{ ...sectionHeaderStyle, color: '#fbbf24' }}>
                <Target size={14} color="#f59e0b" />
                <span>Goals</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {group.goals}
              </p>
            </div>
          )}

          {/* Rules */}
          {group.rules && (
            <div style={sectionStyle}>
              <div style={{ ...sectionHeaderStyle, color: '#fb7185' }}>
                <Shield size={14} color="#f43f5e" />
                <span>Rules</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {group.rules.split('\n').filter(Boolean).map((rule, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: '8px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: 'rgba(244, 63, 94, 0.15)',
                        border: '1px solid rgba(244, 63, 94, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '9px',
                        fontWeight: 700,
                        color: '#fb7185',
                      }}
                    >
                      {rule.match(/^(\d+)/) ? rule.match(/^(\d+)/)![1] : i + 1}
                    </span>
                    <span>{rule.replace(/^\d+\.\s*/, '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule */}
          {group.schedule?.openTime && (
            <div style={sectionStyle}>
              <div style={{ ...sectionHeaderStyle, color: '#67e8f9' }}>
                <Clock size={14} color="#06b6d4" />
                <span>Schedule</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  🕖 {group.schedule.openTime}
                  {group.schedule.closeTime ? ` – ${group.schedule.closeTime}` : ''}
                  {group.schedule.timezone ? ` ${group.schedule.timezone}` : ''}
                </div>
                {group.schedule.days && group.schedule.days.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {group.schedule.days.map((day) => (
                      <span
                        key={day}
                        style={{
                          fontSize: '10px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(6, 182, 212, 0.12)',
                          border: '1px solid rgba(6, 182, 212, 0.25)',
                          color: '#67e8f9',
                          fontWeight: 600,
                        }}
                      >
                        {day}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── Scroll Hint ─── */}
        {showScrollHint && (
          <div
            style={{
              textAlign: 'center',
              padding: '4px',
              color: 'var(--text-muted)',
              fontSize: '10px',
              animation: 'pulse 1.5s infinite',
            }}
          >
            <ChevronDown size={14} />
            <div>Scroll to read all</div>
          </div>
        )}

        {/* ─── Accept Button ─── */}
        <div style={{ padding: '12px 16px 16px' }}>
          <button
            className="btn btn-primary"
            onClick={onAccept}
            disabled={!canAccept}
            style={{
              width: '100%',
              fontSize: '13px',
              fontWeight: 700,
              padding: '10px',
              opacity: canAccept ? 1 : 0.4,
              transition: 'opacity 0.3s ease',
            }}
          >
            {canAccept ? "✓ I've Read & Understand" : 'Read All to Continue ↓'}
          </button>
        </div>
      </div>
    </div>
  );
};
