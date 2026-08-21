// ─── Microphone Permission Unlocker for Chrome Extensions ───

import React, { useState, useEffect, useRef } from 'react';
import { Mic, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { OwnedTimeouts } from '@/shared/owned-timeouts';

export const MicPermissionTab: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutsRef = useRef<OwnedTimeouts | null>(null);
  if (timeoutsRef.current === null) timeoutsRef.current = new OwnedTimeouts();
  const timeouts = timeoutsRef.current;

  const handleRequestMic = async () => {
    setStatus('requesting');
    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop stream immediately since we only needed the permission grant
      stream.getTracks().forEach((track) => track.stop());
      if (!mountedRef.current) return;

      setStatus('granted');
      try {
        localStorage.setItem('synqto_mic_granted', 'true');
      } catch (e) {}

      closeTimerRef.current = timeouts.replace(closeTimerRef.current, () => {
        closeTimerRef.current = null;
        if (window.opener || window.history.length > 1) {
          window.close();
        }
      }, 1500);
    } catch (err: any) {
      console.error('[MicPermission] Permission request failed:', err);
      if (!mountedRef.current) return;
      setStatus('denied');
      setErrorMsg(err?.message || 'Permission was dismissed or denied in the browser prompt.');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    // Automatically trigger permission prompt on page load
    void handleRequestMic();
    return () => {
      mountedRef.current = false;
      timeouts.clearAll();
      closeTimerRef.current = null;
    };
  }, [timeouts]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-app)',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'inherit',
        padding: '20px',
      }}
    >
      <div
        style={{
          maxWidth: '440px',
          width: '100%',
          background: 'var(--bg-surface-elevated)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid var(--border-subtle)',
          padding: '32px 24px',
          textAlign: 'center',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: status === 'granted' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.2)',
            border: `2px solid ${status === 'granted' ? 'var(--accent-emerald)' : 'var(--primary)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 18px',
          }}
        >
          {status === 'granted' ? (
            <CheckCircle2 size={32} color="var(--accent-emerald)" />
          ) : status === 'denied' ? (
            <AlertCircle size={32} color="var(--accent-rose)" />
          ) : (
            <Mic size={32} color="var(--primary)" />
          )}
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
          {status === 'granted'
            ? 'Microphone Access Granted! 🎉'
            : status === 'denied'
              ? 'Microphone Permission Needed'
              : 'Allow Microphone for Voice Rooms'}
        </h2>

        <p style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 24px' }}>
          {status === 'granted'
            ? 'Permission successfully granted for Synqto! This tab will close automatically and return to your study room.'
            : status === 'denied'
              ? 'Microphone permission was blocked or dismissed. Please click the button below and select "Allow" in Chrome.'
              : 'Chrome requires a one-time permission grant on this tab so you can talk with peers in Synqto Voice Study Rooms.'}
        </p>

        {status === 'granted' ? (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Sparkles size={16} />
            <span>Ready! Returning to sidepanel...</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleRequestMic}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              transition: 'all 0.2s ease',
            }}
          >
            <Mic size={16} />
            <span>{status === 'requesting' ? 'Requesting Permission...' : 'Allow Microphone Access 🎙️'}</span>
          </button>
        )}

        {errorMsg && (
          <div
            style={{
              marginTop: '16px',
              fontSize: 'var(--font-size-md)',
              color: '#fca5a5',
              background: 'rgba(244, 63, 94, 0.1)',
              padding: '8px 12px',
              borderRadius: '6px',
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
};
