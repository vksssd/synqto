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
import { VoiceService } from '@/features/voice/voice.service';
import { RoomService } from './room.service';
import { messageBelongsToRoom } from '@/core/runtime/tab-room-context';
import { ArrowRight, Mic, MicOff, Tv } from 'lucide-react';

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
  const voiceService = VoiceService.getInstance();

  const [customRoomInput, setCustomRoomInput] = useState('');
  const [stageState, setStageState] = useState(tutorService.getState());
  const [isInVoice, setIsInVoice] = useState(voiceService.getIsInVoice());
  const [isMuted, setIsMuted] = useState(voiceService.getIsMuted());
  const [showTutorStage, setShowTutorStage] = useState(false);
  const [showVoiceRoom, setShowVoiceRoom] = useState(false);

  // Listen to live stream and voice state changes
  useEffect(() => {
    const unsubTutor = tutorService.onStateChange((st) => {
      setStageState(st);
      if (st.isActive || st.activeStreams.length > 0 || st.myRole === 'tutor') {
        setShowTutorStage(true);
      }
    });

    const unsubVoice = voiceService.onStateChange((inVoice, muted) => {
      setIsInVoice(inVoice);
      setIsMuted(muted);
    });

    return () => {
      unsubTutor();
      unsubVoice();
    };
  }, [tutorService, voiceService]);

  // Listen for local mouse moves & clicks from content script to broadcast over P2P DataChannel
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      const handleMsg = (msg: any) => {
        if (!room) return;
        if (
          (msg.type === 'LOCAL_CURSOR_MOVE' || msg.type === 'LOCAL_CLICK_PULSE') &&
          !messageBelongsToRoom(msg.roomId, room.roomId)
        ) {
          return;
        }
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
  }, [room, tutorService]);

  const handleJoinCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customRoomInput.trim()) {
      roomService.joinCustomRoom(customRoomInput.trim());
      setCustomRoomInput('');
    }
  };

  const hasLiveStreams = Boolean(stageState.activeStreams.length > 0 || stageState.myRole === 'tutor');
  const activeStreamCount = stageState.activeStreams.length || (stageState.myRole === 'tutor' ? 1 : 0);
  const firstStream = stageState.activeStreams[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflowY: 'auto' }}>
      {/* Active Problem Room Card */}
      {room ? (
        <RoomCard
          room={room}
          peerCount={peers.length}
          isLeader={isLeader}
          isConnected={true}
          onLeaveRoom={() => roomService.leaveRoom()}
          onOpenPeers={onOpenPeers}
        />
      ) : (
        <div className="glass-card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '18px' }}>🌐</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', color: '#f8fafc' }}>
                Global Study Lobby
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
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
              style={{ fontSize: 'var(--font-size-sm)', padding: '6px 10px' }}
             aria-label="Or join custom room (e.g. system-design)"/>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              aria-label="Join custom room"
              title="Join custom room"
              disabled={!customRoomInput.trim()}
              style={{ fontSize: 'var(--font-size-sm)', padding: '6px 10px' }}
            >
              <ArrowRight size={12} />
            </button>
          </form>
        </div>
      )}

      {/* ─── CONDITIONAL TOP LIVE STREAM BANNER (Shown ONLY if active streams exist) ─── */}
      {room && hasLiveStreams && (
        <div
          className="glass-card"
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(139, 92, 246, 0.15))',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 8px #ef4444',
                animation: 'pulse 1.5s infinite',
                flexShrink: 0,
              }}
            />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 800, fontSize: 'var(--font-size-sm)', color: '#fca5a5', textTransform: 'uppercase' }}>
                  LIVE STREAM ({activeStreamCount})
                </span>
                {stageState.myRole === 'tutor' && (
                  <span style={{ fontSize: 'var(--font-size-2xs)', background: 'rgba(239,68,68,0.3)', padding: '1px 4px', borderRadius: '3px', color: '#fff' }}>
                    You are Streaming
                  </span>
                )}
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: '#f8fafc', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {firstStream ? `${firstStream.broadcasterIdentity?.nickname || 'Peer'}: ${firstStream.title}` : 'Active Screen Share'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowTutorStage(!showTutorStage)}
            style={{
              fontSize: 'var(--font-size-sm)',
              padding: '4px 10px',
              background: '#ef4444',
              borderColor: '#ef4444',
              gap: '4px',
              flexShrink: 0,
            }}
          >
            <Tv size={12} />
            <span>{showTutorStage ? 'Hide Stream' : 'Watch Live 📺'}</span>
          </button>
        </div>
      )}

      {/* Expanded Tutor Stage (When watching or streaming) */}
      {room && hasLiveStreams && (showTutorStage || stageState.myRole === 'tutor') && (
        <TutorStage currentRoomId={room.roomId} />
      )}

      {/* ─── CONDITIONAL TOP VOICE CHAT BANNER (Shown ONLY if user is connected to voice) ─── */}
      {room && isInVoice && (
        <div
          className="glass-card"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(6, 182, 212, 0.15))',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
                animation: 'pulse 1.5s infinite',
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 800, fontSize: 'var(--font-size-sm)', color: '#6ee7b7', textTransform: 'uppercase' }}>
                  VOICE LOUNGE ACTIVE
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: '#f8fafc', fontWeight: 600 }}>
                {isMuted ? 'Microphone Muted 🔇' : 'Speaking Live 🎙️'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => voiceService.toggleMute()}
              style={{ fontSize: 'var(--font-size-xs)', padding: '3px 8px', gap: '3px' }}
              title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isMuted ? <MicOff size={12} color="#ef4444" /> : <Mic size={12} color="#10b981" />}
              <span>{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowVoiceRoom(!showVoiceRoom)}
              style={{ fontSize: 'var(--font-size-xs)', padding: '3px 8px' }}
            >
              {showVoiceRoom ? 'Hide Controls' : 'Lounge 🎧'}
            </button>
          </div>
        </div>
      )}

      {/* Expanded Voice Room Controls */}
      {room && isInVoice && showVoiceRoom && (
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
