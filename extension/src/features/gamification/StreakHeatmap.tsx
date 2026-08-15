// ─── GitHub-Style Streak Heatmap Grid Component ───

import React, { useState } from 'react';
import { StreakStats } from './gamification.types';
import { Flame, Zap, CheckCircle2, Clock, Calendar } from 'lucide-react';

interface StreakHeatmapProps {
  stats: StreakStats;
}

export const StreakHeatmap: React.FC<StreakHeatmapProps> = ({ stats }) => {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  // Generate array of past 60 days
  const days: { dateStr: string; dayNum: number; count: number; minutes: number; problems: number }[] = [];
  const today = new Date();

  const activityMap = stats.activityMap || {};
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const act = activityMap[dateStr];
    days.push({
      dateStr,
      dayNum: d.getDate(),
      count: act ? act.count : 0,
      minutes: act ? act.minutesSpent : 0,
      problems: act ? act.problemsVisited : 0,
    });
  }

  const getCellColor = (count: number) => {
    if (count === 0) return 'rgba(255, 255, 255, 0.04)';
    if (count === 1) return 'rgba(99, 102, 241, 0.35)';
    if (count === 2) return 'rgba(99, 102, 241, 0.65)';
    if (count === 3) return 'rgba(99, 102, 241, 0.9)';
    return '#10b981'; // Emerald for super active days
  };

  const hours = Math.floor(stats.totalFocusMinutes / 60);
  const minutes = stats.totalFocusMinutes % 60;

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="glass-card-header" style={{ marginBottom: 0 }}>
        <div className="glass-card-title">
          <Flame size={16} color="var(--accent-amber)" />
          <span>Study Streak &amp; Activity</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>
          <Zap size={12} />
          <span>{stats.currentStreak} Day Streak!</span>
        </div>
      </div>

      {/* Summary KPI Pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#f59e0b' }}>
            {stats.currentStreak}d
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Current
          </div>
        </div>

        <div
          style={{
            padding: '6px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#c4b5fd' }}>
            {stats.longestStreak}d
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Best Streak
          </div>
        </div>

        <div
          style={{
            padding: '6px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#a5b4fc' }}>
            {stats.totalProblemsSolved}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Problems
          </div>
        </div>

        <div
          style={{
            padding: '6px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#6ee7b7' }}>
            {hours > 0 ? `${hours}h` : `${minutes}m`}
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Focus Time
          </div>
        </div>
      </div>

      {/* GitHub-style Heatmap Grid */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500 }}>
            Activity (Last 60 Days)
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: 'var(--text-dim)' }}>
            <span>Less</span>
            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'rgba(255, 255, 255, 0.04)' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'rgba(99, 102, 241, 0.35)' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'rgba(99, 102, 241, 0.65)' }} />
            <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#10b981' }} />
            <span>More</span>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(15, 1fr)',
            gap: '4px',
            padding: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {days.map((d) => (
            <div
              key={d.dateStr}
              onMouseEnter={() => setHoveredDate(d.dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
              style={{
                aspectRatio: '1',
                borderRadius: '3px',
                background: getCellColor(d.count),
                cursor: 'pointer',
                transition: 'transform 0.15s, border-color 0.15s',
                border: hoveredDate === d.dateStr ? '1px solid #ffffff' : '1px solid transparent',
                transform: hoveredDate === d.dateStr ? 'scale(1.25)' : 'scale(1)',
                zIndex: hoveredDate === d.dateStr ? 10 : 1,
              }}
              title={`${d.dateStr}: ${d.problems} problems, ${d.minutes}m focus`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
