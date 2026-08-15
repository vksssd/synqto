// ─── Milestone Achievement Badge Gallery Component ───

import React, { useState } from 'react';
import { Badge } from './gamification.types';
import { Award, Lock, CheckCircle2 } from 'lucide-react';

interface BadgeGalleryProps {
  badges: Badge[];
}

export const BadgeGallery: React.FC<BadgeGalleryProps> = ({ badges }) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'streak' | 'problem' | 'focus' | 'social'>('all');

  const filteredBadges = badges.filter(
    (b) => selectedCategory === 'all' || b.category === selectedCategory
  );

  const unlockedCount = badges.filter((b) => Boolean(b.unlockedAt)).length;

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="glass-card-header" style={{ marginBottom: 0 }}>
        <div className="glass-card-title">
          <Award size={16} color="var(--primary)" />
          <span>Milestone Badges ({unlockedCount}/{badges.length})</span>
        </div>
        <span
          className="badge"
          style={{
            fontSize: '10px',
            background: 'rgba(99, 102, 241, 0.15)',
            borderColor: 'rgba(99, 102, 241, 0.4)',
            color: '#c4b5fd',
          }}
        >
          {Math.round((unlockedCount / badges.length) * 100)}% Complete
        </span>
      </div>

      {/* Category Filter Pills */}
      <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
        {(['all', 'streak', 'problem', 'focus', 'social'] as const).map((cat) => (
          <button
            key={cat}
            className={`prompt-pill ${selectedCategory === cat ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
            style={{
              textTransform: 'capitalize',
              fontSize: '10px',
              padding: '2px 8px',
              background: selectedCategory === cat ? 'rgba(99, 102, 241, 0.22)' : undefined,
              borderColor: selectedCategory === cat ? 'var(--primary)' : undefined,
              color: selectedCategory === cat ? '#f8fafc' : undefined,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Badge Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
        {filteredBadges.map((badge) => {
          const isUnlocked = Boolean(badge.unlockedAt);
          const percent = Math.min(100, Math.round((badge.progress.current / badge.progress.max) * 100));

          return (
            <div
              key={badge.id}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                background: isUnlocked
                  ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.1))'
                  : 'rgba(255, 255, 255, 0.02)',
                border: isUnlocked
                  ? '1px solid rgba(99, 102, 241, 0.35)'
                  : '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                position: 'relative',
                transition: 'all 0.18s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '20px', filter: isUnlocked ? 'none' : 'grayscale(100%) opacity(40%)' }}>
                  {badge.icon}
                </div>
                {isUnlocked ? (
                  <CheckCircle2 size={13} color="var(--accent-emerald)" />
                ) : (
                  <Lock size={12} color="var(--text-dim)" />
                )}
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: isUnlocked ? '#f8fafc' : 'var(--text-muted)' }}>
                  {badge.title}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', lineHeight: 1.3, marginTop: '2px' }}>
                  {badge.description}
                </div>
              </div>

              {/* Progress Bar */}
              {!isUnlocked && (
                <div style={{ marginTop: '4px' }}>
                  <div
                    style={{
                      height: '4px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${percent}%`,
                        background: 'var(--primary)',
                        borderRadius: '2px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    <span>Progress</span>
                    <span>{badge.progress.current}/{badge.progress.max}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
