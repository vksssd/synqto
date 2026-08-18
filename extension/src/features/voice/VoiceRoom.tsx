// ─── Voice Room & Audio Controls Component ───

import React, { useState, useEffect } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Volume2 } from 'lucide-react';
import { VoiceService } from './voice.service';
import { OnlinePeer } from '@/features/discovery/discovery.service';

interface VoiceRoomProps {
  peers: OnlinePeer[];
  myAvatar?: string;
  myNickname?: string;
}

export const VoiceRoom: React.FC<VoiceRoomProps> = ({
  peers,
  myAvatar = '🦊',
  myNickname = 'You',
}) => {
  const voiceService = VoiceService.getInstance();
  const [isInVoice, setIsInVoice] = useState(voiceService.getIsInVoice());
  const [isMuted, setIsMuted] = useState(voiceService.getIsMuted());
  const [permissionNeeded, setPermissionNeeded] = useState(voiceService.getPermissionNeeded());
  const [speakingPeers, setSpeakingPeers] = useState<Set<string>>(voiceService.getSpeakingPeers());

  useEffect(() => {
    const unsubState = voiceService.onStateChange((inVoice, muted, permNeeded) => {
      setIsInVoice(inVoice);
      setIsMuted(muted);
      setPermissionNeeded(permNeeded);
    });

    const unsubSpeaking = voiceService.onSpeakingChange((speaking) => {
      setSpeakingPeers(new Set(speaking));
    });

    return () => {
      unsubState();
      unsubSpeaking();
    };
  }, []);

  const handleToggleVoice = async () => {
    if (isInVoice) {
      voiceService.leaveVoice();
    } else {
      const ok = await voiceService.joinVoice();
      if (!ok) {
        setPermissionNeeded(true);
      }
    }
  };

  const handleGrantMicPermission = () => {
    voiceService.requestMicrophonePermission();
  };

  const handleToggleMute = () => {
    voiceService.toggleMute();
  };

  return (
    <div className="glass-card">
      <div className="glass-card-header">
        <div className="glass-card-title">
          <Volume2 size={15} color="var(--primary)" />
          <span>Voice Study Room</span>
        </div>
        {isInVoice && (
          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
            Live Mesh Call
          </span>
        )}
      </div>

      {/* Voice controls & Avatars */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
        {/* Avatars of active voice peers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Self avatar */}
          <div
            className={`speaking-ring ${speakingPeers.has('self') ? 'active' : ''}`}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              opacity: isInVoice ? (isMuted ? 0.6 : 1) : 0.4,
            }}
            title={isInVoice ? (isMuted ? 'Muted' : 'Speaking') : 'Not in voice'}
          >
            {myAvatar}
          </div>

          {/* Remote peers in room */}
          {peers.slice(0, 4).map((p) => (
            <div
              key={p.identity.peerId}
              className={`speaking-ring ${speakingPeers.has(p.identity.peerId) ? 'active' : ''}`}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: p.identity.color || '#8b5cf6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}
              title={p.identity.nickname}
            >
              {p.identity.avatar}
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {isInVoice ? (
            <>
              <button
                className={`btn btn-icon ${isMuted ? 'btn-secondary' : 'btn-primary'}`}
                onClick={handleToggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff size={14} color="#f43f5e" /> : <Mic size={14} />}
              </button>
              <button
                className="btn btn-secondary btn-icon"
                style={{ background: 'rgba(244, 63, 94, 0.2)', borderColor: 'rgba(244, 63, 94, 0.4)' }}
                onClick={handleToggleVoice}
                title="Leave Voice"
              
            aria-label="Leave Voice">
                <PhoneOff size={14} color="#f43f5e" />
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={handleToggleVoice}>
              <PhoneCall size={13} />
              <span>Join Voice</span>
            </button>
          )}
        </div>
      </div>

      {/* Permission Needed Helper Banner */}
      {permissionNeeded && !isInVoice && (
        <div
          style={{
            marginTop: '8px',
            padding: '6px 10px',
            borderRadius: '6px',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: 'var(--font-size-xs)', color: '#fcd34d' }}>
            ⚠️ Chrome mic permission needed
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ fontSize: 'var(--font-size-xs)', padding: '2px 7px' }}
            onClick={handleGrantMicPermission}
          >
            Allow Mic 🎙️
          </button>
        </div>
      )}
    </div>
  );
};
