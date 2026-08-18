// ─── Merged Profile, Gamification & Settings View ───

import React, { useState, useEffect } from 'react';
import { IdentityService } from '@/features/identity/identity.service';
import { GamificationService } from '@/features/gamification/gamification.service';
import { PeerIdentity } from '@/core/network/packet';
import { StreakStats, Badge } from '@/features/gamification/gamification.types';
import { IdentityCard } from '@/features/identity/IdentityCard';
import { StreakHeatmap } from '@/features/gamification/StreakHeatmap';
import { BadgeGallery } from '@/features/gamification/BadgeGallery';
import { SettingsCard } from './SettingsCard';
import { SyncCard } from '@/features/sync/SyncCard';
import { User, Settings, Layers } from 'lucide-react';

interface ProfileSettingsViewProps {
  isLeader: boolean;
}

type SubSection = 'all' | 'profile' | 'settings';

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({ isLeader }) => {
  const identityService = IdentityService.getInstance();
  const gamificationService = GamificationService.getInstance();

  const [activeSection, setActiveSection] = useState<SubSection>('all');
  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [stats, setStats] = useState<StreakStats>(gamificationService.getStats());
  const [badges, setBadges] = useState<Badge[]>(gamificationService.getBadges());

  useEffect(() => {
    identityService.getOrCreateIdentity().then((id) => setIdentity(id));
    return identityService.onChange((id) => setIdentity(id));
  }, []);

  useEffect(() => {
    return gamificationService.onChange((s, b) => {
      setStats(s);
      setBadges(b);
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ─── Segmented Switcher Header [ All | 👤 Profile & Streaks | ⚙️ App Settings ] ─── */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-surface-elevated)',
          padding: '3px',
          borderRadius: '8px',
          border: '1px solid var(--border-subtle)',
          gap: '3px',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSection('all')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            background: activeSection === 'all' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
            color: activeSection === 'all' ? '#ffffff' : 'var(--text-muted)',
            transition: 'all 0.15s ease',
          }}
        >
          <Layers size={12} />
          <span>All</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('profile')}
          style={{
            flex: 1.4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            background: activeSection === 'profile' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
            color: activeSection === 'profile' ? '#ffffff' : 'var(--text-muted)',
            transition: 'all 0.15s ease',
          }}
        >
          <User size={12} />
          <span>Profile &amp; Streaks</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('settings')}
          style={{
            flex: 1.4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            background: activeSection === 'settings' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'transparent',
            color: activeSection === 'settings' ? '#ffffff' : 'var(--text-muted)',
            transition: 'all 0.15s ease',
          }}
        >
          <Settings size={12} />
          <span>Settings</span>
        </button>
      </div>

      {/* 1. Profile & Gamification Section */}
      {(activeSection === 'all' || activeSection === 'profile') && (
        <>
          {/* Ephemeral Identity Card */}
          <IdentityCard identity={identity} isLeader={isLeader} />

          {/* GitHub-Style Streak Heatmap & Focus Counters */}
          <StreakHeatmap stats={stats} />

          {/* Milestone Achievement Badges */}
          <BadgeGallery badges={badges} />
        </>
      )}

      {/* 2. Settings & Network Section */}
      {(activeSection === 'all' || activeSection === 'settings') && (
        <>
          <SettingsCard />
          {/* SyncCard was fully built but never rendered anywhere, so users had no way to
              see their live P2P topology, peer role or signaling state — the exact
              information needed to tell "nobody else is here" apart from "I failed to
              connect". The section is already titled "Settings & Network"; this is the
              Network half. */}
          <SyncCard />
        </>
      )}
    </div>
  );
};
