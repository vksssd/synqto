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
  const [isJoiningHandle, setIsJoiningHandle] = useState(false);

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

  const handleLeaveClick = async (group?: StudyGroup) => {
    if (group) {
      await groupService.leaveGroup(group.id);
    }
    roomService.leaveCurrentRoom();
  };

  const handleDeleteClick = (groupId: string) => {
    groupService.deleteGroup(groupId);
  };

  const matchesTopicFilter = (g: StudyGroup) => {
    if (selectedTopic === 'All') return true;
    if (selectedTopic === 'Problems') {
      return Boolean(
        g.isProblemGroup ||
          g.topicTag === 'LeetCode' ||
          g.topicTag === 'Codeforces' ||
          g.topicTag === 'NeetCode'
      );
    }
    return g.topicTag === selectedTopic;
  };

  // Ranked search (exact handle > exact name > prefix > substring) so typing a full squad
  // name puts it first instead of burying it behind incidental description matches.
  const filteredGroups = (searchQuery.trim() ? groupService.searchGroups(searchQuery) : groups)
    .filter(matchesTopicFilter);

  // A public squad's room ID derives from its name, so a name that matches nothing locally
  // is still joinable — the squad may simply exist only on other peers. Offer that instead
  // of a dead end.
  const searchHandle = searchQuery.trim() ? GroupService.toHandle(searchQuery) : '';
  const canJoinSearchedHandle =
    GroupService.isValidHandle(searchQuery) &&
    !groups.some((g) => g.slug === searchHandle && !g.isPrivate);

  const handleJoinSearchedHandle = async () => {
    if (!canJoinSearchedHandle || isJoiningHandle) return;
    try {
      setIsJoiningHandle(true);
      const res = await groupService.joinByHandle(searchQuery);
      if (res.success) {
        setSearchQuery('');
      }
    } finally {
      setIsJoiningHandle(false);
    }
  };

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
            <button className="btn btn-secondary btn-sm" onClick={() => handleLeaveClick()}>
              Leave
            </button>
          </div>
        </div>
      )}

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
            <Sparkles size={24} color="var(--text-dim)" aria-hidden="true" />
            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              {searchQuery.trim() ? `No local squad matches “${searchQuery.trim()}”` : 'No study squads or problem groups found'}
            </div>

            {/* A public squad's room is derived from its name, so a name unknown locally is
                still joinable — it may exist only on other peers. Without this the search
                dead-ends and the squad is unreachable despite being perfectly valid. */}
            {canJoinSearchedHandle ? (
              <>
                <div style={{ fontSize: '11px', maxWidth: '260px' }}>
                  Squads live on peers, not a server — so this one may exist even though you
                  haven't seen it. Join <strong>@{searchHandle}</strong> to find out.
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleJoinSearchedHandle}
                  disabled={isJoiningHandle}
                >
                  {isJoiningHandle ? 'Joining…' : `Join @${searchHandle}`}
                </button>
              </>
            ) : (
              <div style={{ fontSize: '11px', maxWidth: '240px' }}>
                Create your own serverless squad with or without a password, or scan a problem on your current tab!
              </div>
            )}
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
                      onLeave={() => handleLeaveClick(g)}
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
                      onLeave={() => handleLeaveClick(g)}
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
