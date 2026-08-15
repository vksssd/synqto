// ─── Group & Squads Hub View (With Problem Groups & Squads) ───

import React, { useState, useEffect } from 'react';
import { StudyGroup } from './group.types';
import { GroupService } from './group.service';
import { RoomService } from '@/features/room/room.service';
import { RoomContext } from '@/features/room/room-utils';
import { GroupCard } from './GroupCard';
import { CreateGroupModal } from './CreateGroupModal';
import { PasswordPromptModal } from './PasswordPromptModal';
import { JoinInviteModal } from './JoinInviteModal';
import { ShareGroupModal } from './ShareGroupModal';
import {
  Users,
  Plus,
  Ticket,
  Search,
  Sparkles,
  Lock,
  Globe,
  Code2,
} from 'lucide-react';

interface GroupHubViewProps {
  currentRoom: RoomContext | null;
  onOpenChat?: () => void;
}

export const GroupHubView: React.FC<GroupHubViewProps> = ({ currentRoom, onOpenChat }) => {
  const groupService = GroupService.getInstance();
  const roomService = RoomService.getInstance();

  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [selectedTopic, setSelectedTopic] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [passwordTargetGroup, setPasswordTargetGroup] = useState<StudyGroup | null>(null);
  const [shareTargetGroup, setShareTargetGroup] = useState<StudyGroup | null>(null);

  useEffect(() => {
    return groupService.onChange((list) => setGroups(list));
  }, []);

  const handleJoinClick = async (group: StudyGroup) => {
    if (group.isProblemGroup) {
      // Direct problem room join
      await roomService.joinProblemRoom(
        group.topicTag,
        group.slug,
        group.name,
        group.canonicalUrl || `custom://${group.slug}`
      );
      if (onOpenChat) onOpenChat();
      return;
    }

    if (group.isPrivate && !group.passwordHash) {
      setPasswordTargetGroup(group);
      return;
    }

    const res = await groupService.joinGroup(group);
    if (!res.success) {
      setPasswordTargetGroup(group);
    } else if (onOpenChat) {
      onOpenChat();
    }
  };

  const handleLeaveClick = () => {
    roomService.leaveCurrentRoom();
  };

  const handleDeleteClick = (groupId: string) => {
    groupService.deleteGroup(groupId);
  };

  const filteredGroups = groups.filter((g) => {
    let matchesTopic = true;
    if (selectedTopic === 'All') {
      matchesTopic = true;
    } else if (selectedTopic === 'Problems') {
      matchesTopic = Boolean(g.isProblemGroup || g.topicTag === 'LeetCode' || g.topicTag === 'Codeforces' || g.topicTag === 'NeetCode');
    } else {
      matchesTopic = g.topicTag === selectedTopic;
    }

    const matchesSearch =
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      g.topicTag.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTopic && matchesSearch;
  });

  const topics = ['All', 'Problems', 'LeetCode', 'System Design', 'Algorithms', 'General'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* Top Banner & Quick Actions */}
      <div className="glass-card" style={{ padding: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={16} color="var(--primary)" />
              <span>Study Squads &amp; Problem Groups</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Serverless P2P study circles &amp; active problem rooms
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={14} />
            <span>Create Squad</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setIsInviteOpen(true)}
          >
            <Ticket size={14} color="var(--accent-cyan)" />
            <span>Join via Code</span>
          </button>
        </div>
      </div>

      {/* Active Room Callout Banner */}
      {currentRoom && (
        <div
          className="glass-card"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.15))',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '22px' }}>
              {currentRoom.isGroup && currentRoom.groupDetails ? currentRoom.groupDetails.avatar : '⚡'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                  {currentRoom.title}
                </span>
                <span className="status-dot pulse" style={{ background: '#10b981' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                <span>Currently Active</span>
                <span>•</span>
                <span style={{ color: '#a5b4fc' }}>{currentRoom.platform}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            {onOpenChat && (
              <button className="btn btn-primary btn-sm" onClick={onOpenChat}>
                Open Room
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleLeaveClick}>
              Leave
            </button>
          </div>
        </div>
      )}

      {/* Search & Topic Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={13}
            color="var(--text-muted)"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            className="input-glass"
            placeholder="Search squads & problems..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '30px', fontSize: '11px' }}
          />
        </div>

        {/* Topic Pills */}
        <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
          {topics.map((t) => (
            <button
              key={t}
              className={`prompt-pill ${selectedTopic === t ? 'active' : ''}`}
              onClick={() => setSelectedTopic(t)}
              style={{
                background: selectedTopic === t ? 'rgba(99, 102, 241, 0.22)' : undefined,
                borderColor: selectedTopic === t ? 'var(--primary)' : undefined,
                color: selectedTopic === t ? '#f8fafc' : undefined,
                fontSize: '10px',
                padding: '2px 8px',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Groups List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto' }}>
        {filteredGroups.length === 0 ? (
          <div
            className="glass-card"
            style={{
              textAlign: 'center',
              padding: '28px 16px',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Sparkles size={24} color="var(--text-dim)" />
            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              No study squads or problem groups found
            </div>
            <div style={{ fontSize: '11px', maxWidth: '240px' }}>
              Create your own serverless squad with or without a password, or scan a problem on your current tab!
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setIsCreateOpen(true)}
              style={{ marginTop: '6px' }}
            >
              <Plus size={13} />
              <span>Create Squad Now</span>
            </button>
          </div>
        ) : (
          <>
            {/* 1. My Joined Squads Section */}
            {filteredGroups.some((g) => g.isMember || g.isCreator) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#a5b4fc', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>🌟 My Joined Squads</span>
                  <span style={{ fontSize: '10px', background: 'rgba(99,102,241,0.2)', padding: '1px 6px', borderRadius: '10px', color: '#c7d2fe' }}>
                    {filteredGroups.filter((g) => g.isMember || g.isCreator).length}
                  </span>
                </div>
                {filteredGroups
                  .filter((g) => g.isMember || g.isCreator)
                  .map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      isActive={Boolean(currentRoom && currentRoom.roomId === g.roomId)}
                      onJoin={handleJoinClick}
                      onLeave={handleLeaveClick}
                      onShare={(group) => setShareTargetGroup(group)}
                      onDelete={handleDeleteClick}
                    />
                  ))}
              </div>
            )}

            {/* 2. Discover More Public Squads & Problems */}
            {filteredGroups.some((g) => !g.isMember && !g.isCreator) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
                  🌐 Discover &amp; Join More Squads
                </div>
                {filteredGroups
                  .filter((g) => !g.isMember && !g.isCreator)
                  .map((g) => (
                    <GroupCard
                      key={g.id}
                      group={g}
                      isActive={Boolean(currentRoom && currentRoom.roomId === g.roomId)}
                      onJoin={handleJoinClick}
                      onLeave={handleLeaveClick}
                      onShare={(group) => setShareTargetGroup(group)}
                      onDelete={handleDeleteClick}
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <CreateGroupModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <PasswordPromptModal
        group={passwordTargetGroup}
        isOpen={Boolean(passwordTargetGroup)}
        onClose={() => setPasswordTargetGroup(null)}
      />

      <JoinInviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
      />

      <ShareGroupModal
        group={shareTargetGroup}
        isOpen={Boolean(shareTargetGroup)}
        onClose={() => setShareTargetGroup(null)}
      />
    </div>
  );
};
