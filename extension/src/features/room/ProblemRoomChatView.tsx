// ─── Default Screen: Integrated Problem Room & Real-time Chat View (Phase II) ───

import React, { useState, useEffect } from 'react';
import { RoomContext } from './room-utils';
import { PeerIdentity } from '@/core/network/packet';
import { OnlinePeer } from '@/features/discovery/discovery.service';
import { RoomCard } from './RoomCard';
import { ChatView } from '@/features/chat/ChatView';
import { TutorStage } from '@/features/tutor/TutorStage';
import { TutorService } from '@/features/tutor/tutor.service';
import { VoiceRoom } from '@/features/voice/VoiceRoom';
import { RoomService } from './room.service';
import { Plus, ArrowRight } from 'lucide-react';

interface ProblemRoomChatViewProps {
  room: RoomContext | null;
  identity: PeerIdentity | null;
  peers: OnlinePeer[];
  isLeader: boolean;
  onOpenPeers: () => void;
}

export const ProblemRoomChatView: React.FC<ProblemRoomChatViewProps> = ({
  room,
  identity,
  peers,
  isLeader,
  onOpenPeers,
}) => {
  const roomService = RoomService.getInstance();
  const tutorService = TutorService.getInstance();
  const [customRoomInput, setCustomRoomInput] = useState('');

  // Listen for local mouse moves & clicks from content script to broadcast over P2P DataChannel
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      const handleMsg = (msg: any) => {
        if (!room) return;
        if (msg.type === 'LOCAL_CURSOR_MOVE') {
          tutorService.broadcastCursor(msg.xPct, msg.yPct, room.roomId);
        } else if (msg.type === 'LOCAL_CLICK_PULSE') {
          tutorService.broadcastClick(msg.xPct, msg.yPct, room.roomId);
        }
      };

      chrome.runtime.onMessage.addListener(handleMsg);
      return () => {
        chrome.runtime.onMessage.removeListener(handleMsg);
      };
    }
  }, [room]);

  const handleJoinCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customRoomInput.trim()) {
      roomService.joinCustomRoom(customRoomInput.trim());
      setCustomRoomInput('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflowY: 'auto' }}>
      {/* Active Problem Room Card */}
      {room ? (
        <RoomCard
          room={room}
          peers={peers}
          isLeader={isLeader}
          onOpenPeers={onOpenPeers}
        />
      ) : (
        <div className="glass-card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>🌐</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>
                Global Study Lobby
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Navigate to a LeetCode / Codeforces problem to auto-join its room.
              </div>
            </div>
          </div>

          {/* Quick Custom Room Join */}
          <form onSubmit={handleJoinCustom} style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <input
              type="text"
              className="input-glass"
              placeholder="Or join custom room (e.g. system-design)"
              value={customRoomInput}
              onChange={(e) => setCustomRoomInput(e.target.value)}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!customRoomInput.trim()}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              <ArrowRight size={12} />
            </button>
          </form>
        </div>
      )}

      {/* Tutor Stage Broadcaster */}
      {room && <TutorStage currentRoomId={room.roomId} />}

      {/* Voice Audio Mesh */}
      {room && (
        <VoiceRoom
          peers={peers}
          myAvatar={identity?.avatar}
          myNickname={identity?.nickname}
        />
      )}

      {/* Main Content Area: Dedicated Live Problem Chat View */}
      <div style={{ flex: 1, minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
        <ChatView
          myIdentity={identity}
          roomId={room?.roomId || 'global-lobby'}
        />
      </div>
    </div>
  );
};
