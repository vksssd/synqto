// ─── Tutor Stage & Multi-Broadcaster Live Stream View (Phase II Full Implementation) ───

import React, { useState, useEffect, useRef } from 'react';
import { TutorService } from './tutor.service';
import { TutorStageState, HandRaiseRequest, BroadcastType, ActiveStreamInfo } from './tutor.types';
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
  Tv,
  Plus,
  Play,
} from 'lucide-react';

interface TutorStageProps {
  currentRoomId: string;
}

export const TutorStage: React.FC<TutorStageProps> = ({ currentRoomId }) => {
  const tutorService = TutorService.getInstance();
  const [stageState, setStageState] = useState<TutorStageState>(tutorService.getState());
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(tutorService.getActiveRemoteStream());
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(tutorService.getSelectedStreamPeerId());
  const [isStarting, setIsStarting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isWatchingStream, setIsWatchingStream] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [streamTitleInput, setStreamTitleInput] = useState('');
  const [selectedBroadcastType, setSelectedBroadcastType] = useState<BroadcastType>('screen');

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const unsubState = tutorService.onStateChange((state) => {
      setStageState(state);
      if (state.myRole === 'tutor') {
        setIsWatchingStream(true);
      }
    });

    const unsubStream = tutorService.onRemoteStreamChange((stream, peerId) => {
      setRemoteStream(stream);
      setSelectedPeerId(peerId);
    });

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
  }, [stageState.isActive, stageState.myRole, remoteStream, isWatchingStream, selectedPeerId]);

  const handleOpenStartModal = (type: BroadcastType) => {
    setSelectedBroadcastType(type);
    setStreamTitleInput('');
    setShowStartModal(true);
  };

  const handleConfirmStart = async () => {
    setIsStarting(true);
    setShowStartModal(false);
    await tutorService.startTutorStage(selectedBroadcastType, currentRoomId, streamTitleInput);
    setIsWatchingStream(true);
    setIsStarting(false);
  };

  const handleStopStage = () => {
    tutorService.stopTutorStage(currentRoomId);
    setIsWatchingStream(false);
  };

  const handleSelectStream = (stream: ActiveStreamInfo) => {
    tutorService.setSelectedStream(stream.broadcasterPeerId);
    setSelectedPeerId(stream.broadcasterPeerId);
    setIsWatchingStream(true);
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

  const isTutor = stageState.myRole === 'tutor';
  const isSpeaker = stageState.myRole === 'speaker';
  const activeStreams = stageState.activeStreams || [];

  // Active stream currently displayed
  const currentStreamInfo = activeStreams.find((s) => s.broadcasterPeerId === selectedPeerId) || activeStreams[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* 1. Modal to Start Live Stream with Title */}
      {showStartModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            className="glass-card"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '14px',
              background: 'rgba(15, 23, 42, 0.98)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Radio size={14} color="#ef4444" />
                <span>Go Live in this Room</span>
              </div>
              <button
                type="button"
                onClick={() => setShowStartModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Broadcast Type: <strong>{selectedBroadcastType === 'screen' ? '🖥️ Screen Share' : selectedBroadcastType === 'camera' ? '📹 Camera' : '🎙️ Audio'}</strong>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Stream Title (Optional):
              </label>
              <input
                type="text"
                className="input-glass"
                placeholder="e.g. Python O(N) Two Pointers Solution"
                value={streamTitleInput}
                onChange={(e) => setStreamTitleInput(e.target.value)}
                style={{ width: '100%', fontSize: '11px', padding: '6px 8px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowStartModal(false)}
                style={{ fontSize: '11px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConfirmStart}
                disabled={isStarting}
                style={{ fontSize: '11px', background: 'linear-gradient(135deg, #ef4444, #8b5cf6)' }}
              >
                {isStarting ? 'Starting...' : 'Start Broadcasting 🚀'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Main Live Stage Card */}
      {stageState.isActive ? (
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
                LIVE ({activeStreams.length} {activeStreams.length === 1 ? 'Stream' : 'Streams'})
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {currentStreamInfo ? currentStreamInfo.title : 'Live Stream'}
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
                    End Stream
                  </button>
                </>
              ) : (
                <>
                  {!isTutor && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleOpenStartModal('screen')}
                      style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.3)' }}
                      title="Share your own screen as well"
                    >
                      <Plus size={11} />
                      <span>Also Stream</span>
                    </button>
                  )}

                  {!isWatchingStream ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setIsWatchingStream(true)}
                      style={{ fontSize: '10px', padding: '2px 8px', background: '#ef4444' }}
                    >
                      Watch 📺
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setIsWatchingStream(false)}
                      style={{ fontSize: '10px', padding: '2px 6px', color: 'var(--text-muted)' }}
                    >
                      Hide Feed
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* List of Multiple Active Streams to Choose From */}
          {activeStreams.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Active Streams ({activeStreams.length}) — Click to Watch:
              </div>
              <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                {activeStreams.map((s) => {
                  const isSelected = s.broadcasterPeerId === (selectedPeerId || activeStreams[0]?.broadcasterPeerId);
                  return (
                    <button
                      key={s.streamId || s.broadcasterPeerId}
                      type="button"
                      onClick={() => handleSelectStream(s)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: isSelected ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                        border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontSize: '10px',
                      }}
                    >
                      <span>{s.broadcasterIdentity?.avatar || '👤'}</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 600, color: isSelected ? '#fff' : 'var(--text-primary)' }}>
                          {s.broadcasterIdentity?.nickname}
                        </div>
                        <div style={{ fontSize: '9px', color: isSelected ? '#c7d2fe' : 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.title}
                        </div>
                      </div>
                      {isSelected && <span style={{ color: '#38bdf8', fontSize: '10px' }}>👁️</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Video Viewport (Screen or Camera Stream) */}
          {(isTutor || isWatchingStream) && (
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
                muted={isTutor} // Mute local preview
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
                <span>
                  {isTutor
                    ? '🖥️ You are broadcasting'
                    : `🎓 Watching: ${currentStreamInfo?.broadcasterIdentity?.nickname} (${currentStreamInfo?.title || 'Stream'})`}
                </span>
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
                    <Tv size={12} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Audience Interactive Stage Controls */}
          {!isTutor && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                {isSpeaker ? '🎤 You are speaking on stage' : 'Audience View'}
              </div>

              {!isSpeaker && (
                <button
                  type="button"
                  className={`btn ${stageState.isMyHandRaised ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    color: stageState.isMyHandRaised ? '#f59e0b' : 'var(--text-secondary)',
                  }}
                  onClick={stageState.isMyHandRaised ? () => tutorService.lowerHand(currentRoomId) : handleRaiseHand}
                >
                  <Hand size={11} />
                  <span>{stageState.isMyHandRaised ? 'Hand Raised ✋' : 'Raise Hand'}</span>
                </button>
              )}
            </div>
          )}

          {/* Tutor Hand-Raise Approval Queue */}
          {isTutor && stageState.handRaises.length > 0 && (
            <div
              style={{
                marginTop: '4px',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div style={{ fontSize: '9px', fontWeight: 600, color: '#f59e0b' }}>
                Hand Raise Queue ({stageState.handRaises.length}):
              </div>
              {stageState.handRaises.map((req) => (
                <div
                  key={req.peerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <span style={{ fontSize: '10px', color: 'var(--text-primary)' }}>
                    {req.avatar} {req.nickname}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: '9px', padding: '1px 6px' }}
                    onClick={() => handleAcceptSpeaker(req)}
                  >
                    Accept
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Standby Host Broadcast Prompt */
        <div
          className="glass-card"
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.65)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Radio size={13} color="var(--primary)" />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Live Stream &amp; Walkthrough
            </span>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '10px', padding: '3px 8px' }}
              onClick={() => handleOpenStartModal('screen')}
              disabled={isStarting}
              title="Share Screen with Peers"
            >
              <Monitor size={11} />
              <span>Share Screen</span>
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '10px', padding: '3px 6px' }}
              onClick={() => handleOpenStartModal('camera')}
              disabled={isStarting}
              title="Share Camera Video"
            >
              <Video size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
