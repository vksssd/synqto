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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
      {/* Active Problem / Room Card */}
      <RoomCard
        room={room}
        peerCount={peers.length + 1}
        isLeader={isLeader}
        isConnected={Boolean(identity && room)}
        onLeaveRoom={() => roomService.leaveCurrentRoom()}
        onOpenPeers={onOpenPeers}
      />

      {/* If not in a room, provide quick custom room form */}
      {!room && (
        <form onSubmit={handleJoinCustom} className="glass-card" style={{ padding: '10px 12px' }}>
          <div className="glass-card-title" style={{ marginBottom: '6px', fontSize: '12px' }}>
            <Plus size={13} color="var(--primary)" />
            <span>Join Custom Study Room</span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              className="input-glass"
              placeholder="e.g. leetcode-grind, system-design..."
              value={customRoomInput}
              onChange={(e) => setCustomRoomInput(e.target.value)}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!customRoomInput.trim()}>
              <ArrowRight size={13} />
            </button>
          </div>
        </form>
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

      {/* Integrated Real-time P2P Chat Stream */}
      <div style={{ flex: 1, minHeight: '260px', display: 'flex', flexDirection: 'column' }}>
        <ChatView
          myIdentity={identity}
          roomId={room?.roomId || 'global-lobby'}
        />
      </div>
    </div>
  );
};
