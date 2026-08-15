// ─── Navigation Bar Component with Dedicated Whiteboard Tab ───

import React from 'react';
import { MessageSquare, Palette, Users, Compass, Flame } from 'lucide-react';

export type NavTabType = 'chat' | 'whiteboard' | 'groups' | 'peers' | 'profile';

interface NavBarProps {
  currentTab: NavTabType;
  onSelectTab: (tab: NavTabType) => void;
  unreadCount?: number;
  peerCount?: number;
  currentStreak?: number;
}

export const NavBar: React.FC<NavBarProps> = ({
  currentTab,
  onSelectTab,
  unreadCount = 0,
  peerCount = 0,
  currentStreak = 1,
}) => {
  return (
    <nav className="bottom-nav">
      {/* 1. Default Screen: Problem & Chat */}
      <button
        className={`nav-tab ${currentTab === 'chat' ? 'active' : ''}`}
        onClick={() => onSelectTab('chat')}
      >
        <MessageSquare size={17} />
        <span>Room</span>
        {unreadCount > 0 && <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {/* 2. Squads / Communities Hub */}
      <button
        className={`nav-tab ${currentTab === 'groups' ? 'active' : ''}`}
        onClick={() => onSelectTab('groups')}
      >
        <Users size={17} />
        <span>Squads</span>
      </button>

      {/* 4. Online Buddies / Peers */}
      <button
        className={`nav-tab ${currentTab === 'peers' ? 'active' : ''}`}
        onClick={() => onSelectTab('peers')}
      >
        <Compass size={17} />
        <span>Peers</span>
        {peerCount > 0 && <span className="nav-badge" style={{ background: '#6366f1' }}>{peerCount}</span>}
      </button>

      {/* 5. Profile & Settings */}
      <button
        className={`nav-tab ${currentTab === 'profile' ? 'active' : ''}`}
        onClick={() => onSelectTab('profile')}
      >
        <Flame size={17} color={currentStreak > 0 ? '#f59e0b' : undefined} />
        <span>Profile</span>
      </button>
    </nav>
  );
};
