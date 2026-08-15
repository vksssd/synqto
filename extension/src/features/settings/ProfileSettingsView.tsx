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

interface ProfileSettingsViewProps {
  isLeader: boolean;
}

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({ isLeader }) => {
  const identityService = IdentityService.getInstance();
  const gamificationService = GamificationService.getInstance();

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
      {/* 1. Ephemeral Identity Card */}
      <IdentityCard identity={identity} isLeader={isLeader} />

      {/* 2. GitHub-Style Streak Heatmap & Focus Counters */}
      <StreakHeatmap stats={stats} />

      {/* 3. Milestone Achievement Badges */}
      <BadgeGallery badges={badges} />

      {/* 4. Network & Privacy Settings */}
      <SettingsCard />
    </div>
  );
};
