// ─── Tutor Stage & Broadcaster View (Phase II Full Implementation) ───

import React, { useState, useEffect, useRef } from 'react';
import { TutorService } from './tutor.service';
import { TutorStageState, HandRaiseRequest, BroadcastType } from './tutor.types';
import {
  Mic,
  MicOff,
  Video,
  Monitor,
  Hand,
  Radio,
  X,
  Check,
  Maximize2,
  Volume2,
  Tv,
  Eye,
  EyeOff,
} from 'lucide-react';

interface TutorStageProps {
  currentRoomId: string;
}

export const TutorStage: React.FC<TutorStageProps> = ({ currentRoomId }) => {
  const tutorService = TutorService.getInstance();
  const [stageState, setStageState] = useState<TutorStageState>(tutorService.getState());
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(tutorService.getActiveRemoteStream());
  const [isStarting, setIsStarting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isWatchingStream, setIsWatchingStream] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const unsubState = tutorService.onStateChange((state) => {
      setStageState(state);
      if (state.myRole === 'tutor') {
        setIsWatchingStream(true);
      }
    });
    const unsubStream = tutorService.onRemoteStreamChange((stream) => setRemoteStream(stream));
    return () => {
      unsubState();
      unsubStream();
    };
  }, []);

  // Attach local or remote video stream to video element when active and watching
  useEffect(() => {
    if (videoRef.current) {
      if (stageState.myRole === 'tutor') {
        const local = tutorService.getLocalStream();
        if (local) {
          videoRef.current.srcObject = local;
          videoRef.current.play().catch(() => {});
        }
      } else if (remoteStream && isWatchingStream) {
        videoRef.current.srcObject = remoteStream;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [stageState.isActive, stageState.myRole, remoteStream, isWatchingStream]);

  const handleStartStage = async (type: BroadcastType) => {
    setIsStarting(true);
    await tutorService.startTutorStage(type, currentRoomId);
    setIsWatchingStream(true);
    setIsStarting(false);
  };

  const handleStopStage = () => {
    tutorService.stopTutorStage(currentRoomId);
    setIsWatchingStream(false);
  };

  const handleRaiseHand = () => {
    tutorService.raiseHand(currentRoomId);
  };

  const handleAcceptSpeaker = (student: HandRaiseRequest) => {
    tutorService.acceptSpeaker(student, currentRoomId);
  };

  const handleRemoveSpeaker = (peerId: string) => {
    tutorService.removeSpeaker(peerId, currentRoomId);
  };

  const toggleMute = () => {
    const stream = tutorService.getLocalStream();
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  if (!stageState.isActive) {
    return (
      <div
        className="glass-card"
        style={{
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(99, 102, 241, 0.08))',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}
            >
              🎓
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '12px' }}>
                Tutor Stage &amp; Live Pointer
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Broadcast code screen, audio &amp; live laser cursor
              </div>
            </div>
          </div>
        </div>

        {/* 3 Live Broadcast Mode Choices */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleStartStage('screen')}
            disabled={isStarting}
            style={{
              fontSize: '10px',
              padding: '6px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              borderColor: 'rgba(99, 102, 241, 0.3)',
            }}
          >
            <Monitor size={14} color="var(--primary)" />
            <span>Screen Share</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleStartStage('camera')}
            disabled={isStarting}
            style={{
              fontSize: '10px',
              padding: '6px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Video size={14} color="#a855f7" />
            <span>Camera</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleStartStage('audio')}
            disabled={isStarting}
            style={{
              fontSize: '10px',
              padding: '6px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Mic size={14} color="#10b981" />
            <span>Voice Stage</span>
          </button>
        </div>
      </div>
    );
  }

  // Active Stage Display
  const isTutor = stageState.myRole === 'tutor';
  const isSpeaker = stageState.myRole === 'speaker';

  return (
    <div
      className="glass-card"
      style={{
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(139, 92, 246, 0.15))',
        border: '1px solid rgba(139, 92, 246, 0.4)',
        boxShadow: 'var(--shadow-glow)',
      }}
    >
      {/* Stage Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#fca5a5',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            <span className="status-dot pulse" style={{ background: '#ef4444' }} />
            LIVE {stageState.broadcastType.toUpperCase()}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Tutor: <strong>{stageState.tutorIdentity?.nickname}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isTutor ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                style={{ width: '24px', height: '24px' }}
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff size={13} color="#f87171" /> : <Mic size={13} color="#10b981" />}
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleStopStage}
                style={{ fontSize: '10px', padding: '2px 8px', color: '#fca5a5' }}
              >
                End Stage
              </button>
            </>
          ) : (
            !isWatchingStream && stageState.isVideoLive ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setIsWatchingStream(true)}
                style={{ fontSize: '10px', padding: '2px 8px', background: '#ef4444' }}
              >
                Watch Stream 📺
              </button>
            ) : isWatchingStream ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setIsWatchingStream(false)}
                style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--text-muted)' }}
              >
                Hide Feed
              </button>
            ) : null
          )}
        </div>
      </div>

      {/* Video Viewport (Screen or Camera Stream) - Rendered for Tutor, OR when Audience clicks "Watch Stream" */}
      {stageState.isVideoLive && (isTutor || isWatchingStream) && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '160px',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: '#000000',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isTutor} // Mute local preview to prevent echo
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />

          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              left: '6px',
              right: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.65)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              color: '#f8fafc',
            }}
          >
            <span>{isTutor ? '🖥️ You are broadcasting' : `🎓 ${stageState.tutorIdentity?.nickname}'s Stream`}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: '20px', height: '20px', padding: 0 }}
                onClick={async () => {
                  try {
                    if (videoRef.current) {
                      if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                      } else {
                        await videoRef.current.requestPictureInPicture();
                      }
                    }
                  } catch (e) {}
                }}
                title="Pop out in Picture-in-Picture window"
              >
                📺
              </button>
              <button
                className="btn btn-ghost btn-icon"
                style={{ width: '20px', height: '20px', padding: 0 }}
                onClick={() => videoRef.current?.requestFullscreen?.()}
                title="Fullscreen"
              >
                <Maximize2 size={11} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage Participants Row (1 Tutor + Max 2 Guests) */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {/* Tutor Card */}
        <div
          style={{
            flex: 1,
            padding: '5px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(139, 92, 246, 0.2)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <div style={{ fontSize: '15px' }}>{stageState.tutorIdentity?.avatar || '🎓'}</div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {stageState.tutorIdentity?.nickname}
            </div>
            <div style={{ fontSize: '8px', color: '#c4b5fd' }}>Host / Tutor 🎤</div>
          </div>
        </div>

        {/* Guest Speaker Slots (Max 2) */}
        {[0, 1].map((idx) => {
          const guest = stageState.guestSpeakers[idx];
          if (guest) {
            return (
              <div
                key={guest.peerId}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
                  <div style={{ fontSize: '13px' }}>{guest.avatar}</div>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {guest.nickname}
                    </div>
                    <div style={{ fontSize: '8px', color: '#6ee7b7' }}>On Stage 🎤</div>
                  </div>
                </div>

                {isTutor && (
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    style={{ width: '16px', height: '16px' }}
                    onClick={() => handleRemoveSpeaker(guest.peerId)}
                    title="Remove from stage"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          }

          return (
            <div
              key={`empty-${idx}`}
              style={{
                flex: 1,
                padding: '5px 8px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px dashed var(--border-subtle)',
                textAlign: 'center',
                fontSize: '9px',
                color: 'var(--text-dim)',
              }}
            >
              Guest Slot
            </div>
          );
        })}
      </div>

      {/* Audience Controls: Raise Hand */}
      {!isTutor && !isSpeaker && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
            {isWatchingStream ? 'Watching live stream' : 'Listening in audience'}
          </span>

          <button
            type="button"
            className={`btn btn-sm ${stageState.isMyHandRaised ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleRaiseHand}
            disabled={stageState.isMyHandRaised || stageState.guestSpeakers.length >= 2}
            style={{ fontSize: '10px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Hand size={11} color={stageState.isMyHandRaised ? '#f59e0b' : '#ffffff'} />
            <span>{stageState.isMyHandRaised ? 'Hand Raised ✋' : 'Raise Hand to Ask Question'}</span>
          </button>
        </div>
      )}

      {/* Tutor Hand Raises Queue */}
      {isTutor && stageState.handRaises.length > 0 && (
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Hand size={11} />
            <span>Hand Raises ({stageState.handRaises.length}):</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {stageState.handRaises.map((req) => (
              <div
                key={req.peerId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '3px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255, 255, 255, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#f8fafc' }}>
                  <span>{req.avatar}</span>
                  <span>{req.nickname}</span>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleAcceptSpeaker(req)}
                  disabled={stageState.guestSpeakers.length >= 2}
                  style={{ fontSize: '9px', padding: '2px 6px' }}
                >
                  <Check size={10} />
                  <span>Accept</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
