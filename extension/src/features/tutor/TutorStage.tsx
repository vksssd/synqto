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
  Minimize2,
  Tv,
  Plus,
  Play,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface TutorStageProps {
  currentRoomId: string;
}

type AspectRatioOption = 'auto' | '16:9' | '16:10' | '4:3' | 'fill' | 'stretch' | 'contain';
type ViewSizeMode = 'auto' | 'compact' | 'theater' | 'expanded';

export const TutorStage: React.FC<TutorStageProps> = ({ currentRoomId }) => {
  const tutorService = TutorService.getInstance();
  const [stageState, setStageState] = useState<TutorStageState>(tutorService.getState());
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(tutorService.getActiveRemoteStream());
  const [isStarting, setIsStarting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isWatchingStream, setIsWatchingStream] = useState(true);
  const [showStartModal, setShowStartModal] = useState(false);
  const [streamTitleInput, setStreamTitleInput] = useState('');
  const [selectedBroadcastType, setSelectedBroadcastType] = useState<BroadcastType>('screen');
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(tutorService.getSelectedStreamPeerId());
  const [isAudienceAudioMuted, setIsAudienceAudioMuted] = useState(false);

  // Aspect Ratio, Sizing & Zoom State for Audience Stream Viewing
  const [aspectRatioMode, setAspectRatioMode] = useState<AspectRatioOption>(() => {
    try {
      return (localStorage.getItem('synqto_stream_aspect_mode') as AspectRatioOption) || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [viewSizeMode, setViewSizeMode] = useState<ViewSizeMode>(() => {
    try {
      return (localStorage.getItem('synqto_stream_size_mode') as ViewSizeMode) || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showControlsDrawer, setShowControlsDrawer] = useState(false);
  const [nativeRatio, setNativeRatio] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubState = tutorService.onStateChange((state) => {
      setStageState(state);
      if (state.myRole === 'tutor' || state.isActive || state.activeStreams.length > 0) {
        setIsWatchingStream(true);
      }
    });

    const unsubStream = tutorService.onRemoteStreamChange((stream, peerId) => {
      setRemoteStream(stream);
      setSelectedPeerId(peerId);
      if (stream) {
        setIsWatchingStream(true);
      }
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
          videoRef.current.muted = true; // Mute self preview to prevent audio feedback
          videoRef.current.play().catch(() => {});
        }
      } else if (remoteStream) {
        videoRef.current.srcObject = remoteStream;
        videoRef.current.muted = isAudienceAudioMuted;
        videoRef.current.play().catch(() => {
          // If unmuted autoplay blocked by browser policy, fallback to muted and let user unmute
          if (videoRef.current) {
            videoRef.current.muted = true;
            setIsAudienceAudioMuted(true);
            videoRef.current.play().catch(() => {});
          }
        });
      }
    }
  }, [stageState.isActive, stageState.myRole, remoteStream, isWatchingStream, selectedPeerId, isAudienceAudioMuted]);

  // Track Native Video Dimensions for Auto Aspect Ratio Calculation
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const w = videoRef.current.videoWidth;
      const h = videoRef.current.videoHeight;
      if (w > 0 && h > 0) {
        setNativeRatio(`${w} / ${h}`);
      }
    }
  };

  const handleAspectRatioChange = (mode: AspectRatioOption) => {
    setAspectRatioMode(mode);
    try {
      localStorage.setItem('synqto_stream_aspect_mode', mode);
    } catch {}
  };

  const handleViewSizeChange = (mode: ViewSizeMode) => {
    setViewSizeMode(mode);
    try {
      localStorage.setItem('synqto_stream_size_mode', mode);
    } catch {}
  };

  const handleZoomIn = () => {
    setZoomLevel((z) => Math.min(2.5, +(z + 0.25).toFixed(2)));
  };

  const handleZoomOut = () => {
    setZoomLevel((z) => Math.max(1, +(z - 0.25).toFixed(2)));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  const toggleFullscreen = async () => {
    try {
      if (viewportContainerRef.current) {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        } else {
          await viewportContainerRef.current.requestFullscreen();
          setIsFullscreen(true);
        }
      }
    } catch (e) {}
  };

  const togglePictureInPicture = async () => {
    try {
      if (videoRef.current) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await videoRef.current.requestPictureInPicture();
        }
      }
    } catch (e) {}
  };

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

  // Compute CSS Aspect Ratio & Object Fit for zero padding & maximum screen width usage
  const getContainerAspectRatio = (): string | undefined => {
    if (aspectRatioMode === '16:9') return '16 / 9';
    if (aspectRatioMode === '16:10') return '16 / 10';
    if (aspectRatioMode === '4:3') return '4 / 3';
    if (aspectRatioMode === 'auto' && nativeRatio) return nativeRatio;
    return undefined;
  };

  const getVideoObjectFit = (): 'contain' | 'cover' | 'fill' => {
    if (aspectRatioMode === 'fill') return 'cover';
    if (aspectRatioMode === 'stretch') return 'fill';
    return 'contain';
  };

  const getContainerHeight = (): string => {
    if (isFullscreen) return '100vh';
    if (viewSizeMode === 'compact') return '170px';
    if (viewSizeMode === 'theater') return '320px';
    if (viewSizeMode === 'expanded') return '440px';
    // 'auto' mode: uses aspect ratio calculation so height is exact fit without black bands
    return getContainerAspectRatio() ? 'auto' : '220px';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
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
              maxWidth: '360px',
              background: 'rgba(15, 23, 42, 0.96)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Radio size={16} color="#ef4444" />
                <span>Start Live {selectedBroadcastType === 'screen' ? 'Screen Walkthrough' : 'Camera Stream'}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowStartModal(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Walkthrough / Stream Title (Optional)
                </label>
                <input
                  type="text"
                  className="input-glass"
                  placeholder="e.g. Dry Run of DP Memoization approach..."
                  value={streamTitleInput}
                  onChange={(e) => setStreamTitleInput(e.target.value)}
                  autoFocus
                  style={{ width: '100%', fontSize: '12px' }}
                />
              </div>

              <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                💡 Peers in the room will see your live stream with zero latency and full-resolution code sharing.
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setShowStartModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1.5, background: '#ef4444', borderColor: '#ef4444' }}
                  onClick={handleConfirmStart}
                  disabled={isStarting}
                >
                  {isStarting ? 'Starting...' : 'Go Live Now 🚀'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Active Stage Banner or Standby Prompt */}
      {stageState.isActive ? (
        <div
          className="glass-card"
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(99, 102, 241, 0.12))',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            width: '100%',
          }}
        >
          {/* Header Row: Broadcaster info + Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  boxShadow: '0 0 8px #ef4444',
                  animation: 'pulse 1.5s infinite',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#fca5a5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentStreamInfo ? currentStreamInfo.title : 'Live Walkthrough Stream'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {isTutor ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: '22px', height: '22px' }}
                    onClick={toggleMute}
                    title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? <MicOff size={12} color="#f87171" /> : <Mic size={12} color="#10b981" />}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleStopStage}
                    style={{ fontSize: '9.5px', padding: '2px 7px', color: '#fca5a5' }}
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
                      style={{ fontSize: '9.5px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.3)' }}
                      title="Share your own screen as co-presenter"
                    >
                      <Plus size={10} />
                      <span>Also Stream</span>
                    </button>
                  )}

                  {!isWatchingStream ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setIsWatchingStream(true)}
                      style={{ fontSize: '9.5px', padding: '2px 8px', background: '#ef4444' }}
                    >
                      Watch 📺
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setIsWatchingStream(false)}
                      style={{ fontSize: '9.5px', padding: '2px 6px', color: 'var(--text-muted)' }}
                    >
                      Hide
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* List of Multiple Active Streams to Choose From */}
          {activeStreams.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ fontSize: '8.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Active Broadcasters ({activeStreams.length}):
              </div>
              <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
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
                        gap: '4px',
                        padding: '3px 6px',
                        borderRadius: '5px',
                        background: isSelected ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                        border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                        color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        fontSize: '9.5px',
                      }}
                    >
                      <span>{s.broadcasterIdentity?.avatar || '👤'}</span>
                      <span style={{ fontWeight: 600, color: isSelected ? '#fff' : 'var(--text-primary)' }}>
                        {s.broadcasterIdentity?.nickname}
                      </span>
                      {isSelected && <span style={{ color: '#38bdf8', fontSize: '9px' }}>👁️</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Full-Width Video Viewport (Flush Edge-to-Edge with Zero Wasted Space) */}
          {(isTutor || isWatchingStream) && (
            <div
              ref={viewportContainerRef}
              style={{
                position: 'relative',
                width: '100%',
                height: getContainerHeight(),
                aspectRatio: getContainerAspectRatio(),
                borderRadius: isFullscreen ? '0' : '6px',
                overflow: 'hidden',
                background: '#000000',
                border: isFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.6)',
                transition: 'height 0.2s ease',
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={isTutor} // Mute local self-preview
                onLoadedMetadata={handleLoadedMetadata}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: getVideoObjectFit(),
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.15s ease',
                }}
              />

              {/* Bottom Stream Status + Quick Action Overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.85) 100%)',
                  padding: '14px 8px 6px',
                  fontSize: '9.5px',
                  color: '#f8fafc',
                  zIndex: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                    {isTutor
                      ? '🖥️ Broadcasting (You)'
                      : `${currentStreamInfo?.broadcasterIdentity?.nickname || 'Peer'}`}
                  </span>
                  {zoomLevel > 1 && (
                    <span style={{ fontSize: '8.5px', padding: '1px 4px', borderRadius: '3px', background: 'rgba(99, 102, 241, 0.4)', color: '#c7d2fe' }}>
                      {zoomLevel}x
                    </span>
                  )}
                </div>

                {/* Right controls: Volume, Aspect Ratio menu toggle, Zoom, PiP, Fullscreen */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  {!isTutor && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      style={{ width: '22px', height: '22px', padding: 0, background: 'rgba(0,0,0,0.4)' }}
                      onClick={() => setIsAudienceAudioMuted(!isAudienceAudioMuted)}
                      title={isAudienceAudioMuted ? 'Unmute stream audio' : 'Mute stream audio'}
                    >
                      {isAudienceAudioMuted ? <VolumeX size={11} color="#fca5a5" /> : <Volume2 size={11} color="#34d399" />}
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{
                      width: '22px',
                      height: '22px',
                      padding: 0,
                      color: showControlsDrawer ? 'var(--primary)' : '#ffffff',
                      background: showControlsDrawer ? 'rgba(99, 102, 241, 0.3)' : 'rgba(0,0,0,0.4)',
                    }}
                    onClick={() => setShowControlsDrawer(!showControlsDrawer)}
                    title="Aspect Ratio & Fit Options"
                  >
                    <Sliders size={11} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: '22px', height: '22px', padding: 0, background: 'rgba(0,0,0,0.4)' }}
                    onClick={zoomLevel > 1 ? handleResetZoom : handleZoomIn}
                    title={zoomLevel > 1 ? 'Reset Zoom (1x)' : 'Zoom in on code (1.25x)'}
                  >
                    {zoomLevel > 1 ? <RotateCcw size={10} /> : <ZoomIn size={11} />}
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: '22px', height: '22px', padding: 0, background: 'rgba(0,0,0,0.4)' }}
                    onClick={togglePictureInPicture}
                    title="Pop out in Picture-in-Picture window"
                  >
                    <Tv size={11} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: '22px', height: '22px', padding: 0, background: 'rgba(0,0,0,0.4)' }}
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Exit Fullscreen' : 'Full Screen'}
                  >
                    {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                  </button>
                </div>
              </div>

              {/* Quick 1-Click Aspect Ratio & Fit Switcher Pills */}
              <div style={{ display: 'flex', gap: '3px', overflowX: 'auto', padding: '3px 6px', alignItems: 'center', background: 'rgba(0,0,0,0.5)' }}>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Fit:</span>
                {[
                  { id: 'auto', label: '⚡ Auto' },
                  { id: '16:9', label: '📺 16:9' },
                  { id: '16:10', label: '💻 16:10' },
                  { id: '4:3', label: '📐 4:3' },
                  { id: 'fill', label: '🔲 Fill' },
                  { id: 'contain', label: '↔️ Contain' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleAspectRatioChange(opt.id as AspectRatioOption)}
                    style={{
                      fontSize: '8.5px',
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      border: aspectRatioMode === opt.id ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      background: aspectRatioMode === opt.id ? 'rgba(99, 102, 241, 0.45)' : 'rgba(255, 255, 255, 0.04)',
                      color: aspectRatioMode === opt.id ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* 4. Audience Aspect Ratio & Sizing Overlay Drawer */}
              {showControlsDrawer && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    background: 'rgba(15, 23, 42, 0.94)',
                    backdropFilter: 'blur(8px)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    zIndex: 30,
                    animation: 'slideDown 0.15s ease-out',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Settings2 size={11} color="var(--primary)" />
                      <span>Aspect Ratio &amp; Viewport Options</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      style={{ width: '18px', height: '18px', padding: 0 }}
                      onClick={() => setShowControlsDrawer(false)}
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Aspect Ratio Mode Pills */}
                  <div>
                    <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', fontWeight: 600 }}>
                      Aspect Ratio &amp; Scaling:
                    </div>
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {[
                        { id: 'auto', label: '📐 Auto (Exact)' },
                        { id: '16:9', label: '16:9 Wide' },
                        { id: '16:10', label: '16:10 Laptop' },
                        { id: '4:3', label: '4:3 Standard' },
                        { id: 'fill', label: '🔲 Fill (Cover)' },
                        { id: 'stretch', label: '↔ Stretch' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleAspectRatioChange(opt.id as AspectRatioOption)}
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: aspectRatioMode === opt.id ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                            background: aspectRatioMode === opt.id ? 'var(--primary)' : 'rgba(255, 255, 255, 0.04)',
                            color: aspectRatioMode === opt.id ? '#ffffff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Viewport Height / Layout Mode */}
                  <div>
                    <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase', fontWeight: 600 }}>
                      Viewport Height:
                    </div>
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {[
                        { id: 'auto', label: '⚡ Natural (Fit Width)' },
                        { id: 'compact', label: '📱 Compact (170px)' },
                        { id: 'theater', label: '🖥️ Theater (320px)' },
                        { id: 'expanded', label: '📺 Full View (440px)' },
                      ].map((sz) => (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() => handleViewSizeChange(sz.id as ViewSizeMode)}
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            padding: '3px 6px',
                            borderRadius: '4px',
                            border: viewSizeMode === sz.id ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.08)',
                            background: viewSizeMode === sz.id ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                            color: viewSizeMode === sz.id ? '#6ee7b7' : 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {sz.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Zoom Controls Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                      Magnify Code Text: <strong style={{ color: '#fff' }}>{zoomLevel}x</strong>
                    </span>
                    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={handleZoomOut}
                        disabled={zoomLevel <= 1}
                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', cursor: 'pointer' }}
                        title="Zoom out"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={handleResetZoom}
                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', cursor: 'pointer' }}
                        title="Reset 1x"
                      >
                        1x
                      </button>
                      <button
                        type="button"
                        onClick={handleZoomIn}
                        disabled={zoomLevel >= 2.5}
                        style={{ padding: '2px 6px', fontSize: '9px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', cursor: 'pointer' }}
                        title="Zoom in"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Audience Interactive Stage Controls */}
          {!isTutor && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '1px' }}>
              <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)' }}>
                {isSpeaker ? '🎤 You are speaking on stage' : 'Audience View (Full Width)'}
              </div>

              {!isSpeaker && (
                <button
                  type="button"
                  className={`btn ${stageState.isMyHandRaised ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                  style={{
                    fontSize: '9.5px',
                    padding: '2px 7px',
                    color: stageState.isMyHandRaised ? '#f59e0b' : 'var(--text-secondary)',
                  }}
                  onClick={stageState.isMyHandRaised ? () => tutorService.lowerHand(currentRoomId) : handleRaiseHand}
                >
                  <Hand size={10} />
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
                paddingTop: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
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
                  <span style={{ fontSize: '9.5px', color: 'var(--text-primary)' }}>
                    {req.avatar} {req.nickname}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ fontSize: '8.5px', padding: '1px 5px' }}
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
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.65)',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Radio size={12} color="var(--primary)" />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Live Walkthrough &amp; Stream
            </span>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '9.5px', padding: '2px 7px' }}
              onClick={() => handleOpenStartModal('screen')}
              disabled={isStarting}
              title="Share Screen with Peers"
            >
              <Monitor size={10} />
              <span>Share Screen</span>
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '9.5px', padding: '2px 5px' }}
              onClick={() => handleOpenStartModal('camera')}
              disabled={isStarting}
              title="Share Camera Video"
            >
              <Video size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
