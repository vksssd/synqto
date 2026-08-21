// ─── CoFocus Watcher View (Silent Camera-Only Body Doubling) ───
//
// Deliberately minimal. Watcher mode's entire promise is "someone is studying alongside me,
// and nothing else happens": camera tiles, a countdown, and a way out. There is no chat, no
// whiteboard, no cursor overlay, no code sync, and — importantly — no microphone.
//
// The no-mic guarantee is structural rather than a UI convention: the camera stream is
// acquired through TutorService.startTutorStage('camera', roomId, title, withMic=false), which
// calls getUserMedia({ video, audio: false }). No audio track is ever requested, so the browser
// never even prompts for microphone permission. That is a stronger guarantee than muting an
// acquired track, which could be un-muted by any later code path.

import React, { useState, useEffect, useRef } from 'react';
import { describeMediaError } from '@/core/notify/notification.service';
import { formatTimerTime } from '@/features/timer/timer-format';
import { RoomContext } from '@/features/room/room-utils';
import { PeerIdentity } from '@/core/network/packet';
import { TutorService } from '@/features/tutor/tutor.service';
import { CoFocusService } from './cofocus.service';
import { CoFocusSessionState } from './cofocus.types';
import { Eye, LogOut, MicOff, Timer, Plus, VideoOff, Loader2 } from 'lucide-react';

interface CoFocusWatcherViewProps {
  room: RoomContext;
  identity: PeerIdentity | null;
}

/**
 * Turns a getUserMedia rejection into something actionable.
 *
 * The distinction that matters: NotAllowedError with no prompt having appeared means the
 * extension origin has not been granted camera access and this context cannot ask. The user
 * needs to grant it somewhere that can prompt, which is a different action from "plug in a
 * camera" or "close the other app using it".
 */
/**
 * Camera failure text, from the shared translator.
 *
 * This was a second, independent switch over the same DOMException names as
 * describeMediaError — same cases, same intent, separately worded. Two copies of one mapping
 * drift: the messages differed already, so the same underlying failure read differently
 * depending on whether it hit the camera path or the microphone path.
 */
function describeCameraFailure(err: unknown): string {
  const { title, detail } = describeMediaError(err, 'camera');
  return `${title}. ${detail}`;
}


export const CoFocusWatcherView: React.FC<CoFocusWatcherViewProps> = ({ room, identity }) => {
  const tutorService = TutorService.getInstance();
  const cofocus = CoFocusService.getInstance();

  const [session, setSession] = useState<CoFocusSessionState>(cofocus.getState());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => cofocus.onChange(setSession), []);

  // Acquire the camera exactly once per room, and always release it on unmount. Leaving a
  // camera live after leaving a focus session would be a serious privacy failure, so teardown
  // runs unconditionally in cleanup rather than only on the explicit Leave button.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const ok = await tutorService.startTutorStage(
          'camera',
          room.roomId,
          'Focus Session',
          /* withMic */ false // never request an audio track — see file header
        );
        if (cancelled) return;
        if (!ok) {
          setCameraError(describeCameraFailure(null));
        }
        setLocalStream(tutorService.getLocalStream());
      } catch (err) {
        // Name the actual failure rather than collapsing every cause into one message.
        //
        // "Camera is off" is true and useless: it cannot distinguish a denied permission from
        // an absent device from a context that is not allowed to prompt at all. That last case
        // is the one worth calling out — a Chrome extension side panel does not reliably show
        // the camera permission bubble, so getUserMedia can reject with NotAllowedError without
        // the user ever being asked. Reported as "no camera feed and no prompt", it looks like
        // the feature is missing rather than blocked.
        if (!cancelled) setCameraError(describeCameraFailure(err));
      } finally {
        if (!cancelled) setIsStartingCamera(false);
      }
    })();

    return () => {
      cancelled = true;
      tutorService.stopTutorStage(room.roomId);
    };
  }, [room.roomId]);

  // Re-announce our camera once the partner is actually in the room.
  //
  // startTutorStage() connects to, and announces to, whoever is present at the instant it
  // runs. In a matchmade session that is necessarily BEFORE the partner has finished joining
  // (the room is entered at phase 'matched'), so that first announce reaches an empty room.
  // Without this the partner never learns our stream exists and both sides show "camera off"
  // for the entire session. Re-announcing on arrival is what actually makes Watcher work.
  const hasAnnouncedToPartner = useRef(false);
  useEffect(() => {
    // Reset on departure so a partner who drops and rejoins is re-announced to rather than
    // being stuck with no stream for the rest of the session.
    if (!session.partnerPresent) {
      hasAnnouncedToPartner.current = false;
      return;
    }
    if (hasAnnouncedToPartner.current) return;
    if (!localStream) return; // camera not up yet — this effect re-runs when it is
    hasAnnouncedToPartner.current = true;
    tutorService.reannounceStream(room.roomId);
  }, [session.partnerPresent, localStream, room.roomId]);

  // Partner's camera.
  useEffect(() => {
    setRemoteStream(tutorService.getActiveRemoteStream());
    return tutorService.onRemoteStreamChange((stream) => setRemoteStream(stream));
  }, []);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const isComplete = session.phase === 'completed';
  const waitingForPartner = !session.partnerPresent;
  // Distinguish "hasn't arrived yet" from "was here and left" — the same boolean means very
  // different things before and after the session has started, and showing a join spinner for
  // someone who already left would be misleading.
  const partnerLeft = !session.partnerPresent && (session.phase === 'active' || session.phase === 'completed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div
        className="glass-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.10))',
          border: '1px solid rgba(99, 102, 241, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye size={16} color="#a5b4fc" />
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>Focus Session</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
              <MicOff size={10} />
              <span>Silent · camera only</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {session.phase === 'active' || isComplete ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: isComplete ? 'rgba(16, 185, 129, 0.18)' : 'rgba(0, 0, 0, 0.28)',
                border: isComplete ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '3px 8px',
              }}
            >
              <Timer size={12} color={isComplete ? '#34d399' : '#c4b5fd'} />
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '13px',
                  fontVariantNumeric: 'tabular-nums',
                  color: isComplete ? '#34d399' : '#c4b5fd',
                }}
              >
                {isComplete ? 'Done' : formatTimerTime(session.remainingSec)}
              </span>
            </div>
          ) : null}

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => cofocus.endSession()}
            title="Leave this focus session"
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}
          >
            <LogOut size={12} />
            <span>Leave</span>
          </button>
        </div>
      </div>

      {/* Session complete — soft checkpoint, room stays open */}
      {isComplete && (
        <div
          className="glass-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
          }}
        >
          <div style={{ fontSize: '11.5px', color: '#a7f3d0' }}>
            🎉 Session complete. Nice work — you're still connected if you'd like to keep going.
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => cofocus.extendSession(25 * 60)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', flexShrink: 0 }}
          >
            <Plus size={12} />
            <span>25 min</span>
          </button>
        </div>
      )}

      {/* Camera tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
        {/* Partner */}
        <VideoTile
          videoRef={remoteVideoRef}
          hasStream={Boolean(remoteStream)}
          label={session.partnerNickname || 'Your study partner'}
          isSelf={false}
          placeholder={
            partnerLeft ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <VideoOff size={22} color="#fbbf24" />
                <span style={{ fontSize: '11.5px', color: '#fbbf24' }}>Your partner left the session</span>
              </div>
            ) : waitingForPartner ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <Loader2 size={22} color="var(--primary)" style={{ animation: 'spin 1.2s linear infinite' }} />
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Waiting for your partner…</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <VideoOff size={22} color="var(--text-muted)" />
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Partner's camera is off</span>
              </div>
            )
          }
        />

        {/* Self */}
        <VideoTile
          videoRef={localVideoRef}
          hasStream={Boolean(localStream)}
          label={`${identity?.nickname || 'You'} (you)`}
          isSelf
          placeholder={
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              {isStartingCamera ? (
                <>
                  <Loader2 size={22} color="var(--primary)" style={{ animation: 'spin 1.2s linear infinite' }} />
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Starting camera…</span>
                </>
              ) : (
                <>
                  <VideoOff size={22} color="#fca5a5" />
                  <span style={{ fontSize: '11.5px', color: '#fca5a5', textAlign: 'center', padding: '0 12px' }}>
                    {cameraError || 'Camera is off'}
                  </span>
                </>
              )}
            </div>
          }
        />
      </div>

      {/* Footer note — sets expectations about what this mode deliberately does not do */}
      <div
        style={{
          fontSize: '10.5px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          lineHeight: 1.5,
          padding: '2px 8px 8px',
        }}
      >
        No microphone, chat or whiteboard in Watcher mode — just quiet company.
        <br />
        Want to talk it through? Leave and start a <strong>Together</strong> session instead.
      </div>
    </div>
  );
};

const VideoTile: React.FC<{
  videoRef: React.RefObject<HTMLVideoElement>;
  hasStream: boolean;
  label: string;
  isSelf: boolean;
  placeholder: React.ReactNode;
}> = ({ videoRef, hasStream, label, isSelf, placeholder }) => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      aspectRatio: '4 / 3',
      background: 'var(--bg-surface-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <video
      ref={videoRef}
      autoPlay
      playsInline
      // Self-view is always muted to prevent audio feedback. Partner tiles carry no audio
      // track at all in Watcher mode, so muting them is belt-and-braces rather than load-bearing.
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: hasStream ? 'block' : 'none',
        // Mirror only your own camera — mirrored partners read as unnatural.
        transform: isSelf ? 'scaleX(-1)' : undefined,
      }}
    />
    {!hasStream && placeholder}

    <div
      style={{
        position: 'absolute',
        left: '8px',
        bottom: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        background: 'rgba(0, 0, 0, 0.55)',
        borderRadius: '5px',
        padding: '2px 7px',
        fontSize: '10.5px',
        fontWeight: 600,
        color: '#f8fafc',
        backdropFilter: 'blur(6px)',
      }}
    >
      <MicOff size={10} color="#94a3b8" />
      <span>{label}</span>
    </div>
  </div>
);
