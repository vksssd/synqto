// ─── Extension Settings & Diagnostics Card (Clean UI + Day/Night/System Themes) ───

import React, { useState, useEffect } from 'react';
import {
  Server,
  Trash2,
  Shield,
  Info,
  Check,
  MessageSquare,
  Plus,
  X,
  Sun,
  Moon,
  Monitor,
  Layout,
  Palette,
  Sparkles,
  Clock,
  Flame,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { SignalingService } from '@/core/network/signaling.service';
import { ThemeService, ThemeMode } from './theme.service';
import { TimerService } from '@/features/timer/timer.service';
import { PomodoroConfig } from '@/features/timer/timer.types';
import {
  FabSettings,
  DEFAULT_FAB_SETTINGS,
  FAB_STORAGE_KEY,
  SYNQTO_FAB_STORAGE_KEY,
  FabDisplayMode,
  FabClickAction,
  PopupContentMode,
} from './fab-settings.types';

export const SettingsCard: React.FC = () => {
  const signaling = SignalingService.getInstance();
  const themeService = ThemeService.getInstance();
  const timerService = TimerService.getInstance();

  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(themeService.getThemeMode());
  const [serverUrl, setServerUrl] = useState(signaling.getServerUrl());
  const [isServerConnected, setIsServerConnected] = useState(signaling.getIsConnected());
  const [isRetryingServer, setIsRetryingServer] = useState(false);
  const [serverToast, setServerToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [savedUrl, setSavedUrl] = useState(false);
  const [clearedData, setClearedData] = useState(false);
  const [timerConfig, setTimerConfig] = useState<PomodoroConfig>(timerService.getConfig());

  // Floating Button Settings
  const [fabSettings, setFabSettings] = useState<FabSettings>(DEFAULT_FAB_SETTINGS);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [savedFab, setSavedFab] = useState(false);

  useEffect(() => {
    return signaling.on('connection:change', (data: { connected: boolean }) => {
      setIsServerConnected(data.connected);
    });
  }, [signaling]);

  useEffect(() => {
    return timerService.onChange((_, c) => {
      setTimerConfig(c);
    });
  }, [timerService]);

  useEffect(() => {
    return themeService.onChange((mode) => {
      setCurrentTheme(mode);
    });
  }, [themeService]);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([SYNQTO_FAB_STORAGE_KEY, FAB_STORAGE_KEY], (res) => {
        const saved = res[SYNQTO_FAB_STORAGE_KEY] || res[FAB_STORAGE_KEY];
        if (saved) {
          setFabSettings({ ...DEFAULT_FAB_SETTINGS, ...saved });
        }
      });
    }
  }, []);

  const handleSelectTheme = (mode: ThemeMode) => {
    themeService.setThemeMode(mode);
  };

  const handleRetryServerConnection = () => {
    if (isRetryingServer) return;
    const targetUrl = serverUrl.trim();
    if (targetUrl && targetUrl !== signaling.getServerUrl()) {
      signaling.setServerUrl(targetUrl);
    }
    setIsRetryingServer(true);
    signaling.reconnect();

    let handled = false;
    const unsub = signaling.on('connection:change', (data: { connected: boolean }) => {
      if (data.connected && !handled) {
        handled = true;
        setIsRetryingServer(false);
        setServerToast({ message: '⚡ Successfully connected to signaling server! (Mesh Active)', type: 'success' });
        setTimeout(() => setServerToast(null), 3500);
        unsub();
      }
    });

    setTimeout(() => {
      unsub();
      if (!handled) {
        setIsRetryingServer(false);
        if (signaling.getIsConnected()) {
          setServerToast({ message: '⚡ Successfully connected to signaling server!', type: 'success' });
        } else {
          setServerToast({ message: '⚠️ Free hosted server is spinning up. Please click Retry again in 5s.', type: 'error' });
        }
        setTimeout(() => setServerToast(null), 4000);
      }
    }, 3000);
  };

  const handleSaveAndReconnect = () => {
    if (serverUrl.trim()) {
      signaling.setServerUrl(serverUrl.trim());
      setSavedUrl(true);
      setTimeout(() => setSavedUrl(false), 2000);
      handleRetryServerConnection();
    }
  };

  const handleResetDefaultUrl = () => {
    const defaultUrl = 'wss://synqto-server.onrender.com/ws/';
    setServerUrl(defaultUrl);
    signaling.setServerUrl(defaultUrl);
    setSavedUrl(true);
    setTimeout(() => setSavedUrl(false), 2000);
    handleRetryServerConnection();
  };

  const handleUpdateFabMode = (mode: FabDisplayMode) => {
    const updated: FabSettings = { ...fabSettings, mode };
    setFabSettings(updated);
    saveFabSettings(updated);
  };

  const handleUpdatePopupContentMode = (popupContentMode: PopupContentMode) => {
    const updated: FabSettings = {
      ...fabSettings,
      popupContentMode,
      enableWhiteboard: popupContentMode === 'both' || popupContentMode === 'whiteboard_only',
    };
    setFabSettings(updated);
    saveFabSettings(updated);
  };

  const handleUpdateFabClickAction = (clickAction: FabClickAction) => {
    const updated: FabSettings = { ...fabSettings, clickAction };
    setFabSettings(updated);
    saveFabSettings(updated);
  };

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const domain = newDomainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (domain && !fabSettings.customDomains.includes(domain)) {
      const updated: FabSettings = {
        ...fabSettings,
        customDomains: [...fabSettings.customDomains, domain],
      };
      setFabSettings(updated);
      setNewDomainInput('');
      saveFabSettings(updated);
    }
  };

  const handleRemoveDomain = (domain: string) => {
    const updated: FabSettings = {
      ...fabSettings,
      customDomains: fabSettings.customDomains.filter((d) => d !== domain),
    };
    setFabSettings(updated);
    saveFabSettings(updated);
  };

  const saveFabSettings = (settings: FabSettings) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set(
        {
          [FAB_STORAGE_KEY]: settings,
          [SYNQTO_FAB_STORAGE_KEY]: settings,
        },
        () => {
          setSavedFab(true);
          setTimeout(() => setSavedFab(false), 1500);
        }
      );
    }

    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'FAB_SETTINGS_UPDATED',
              payload: settings,
            }).catch(() => {});
          }
        });
      });
    }
  };

  const handleClearData = async () => {
    if (confirm('Are you sure you want to clear local chat history, streaks, and settings?')) {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.clear();
      } else if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
      setClearedData(true);
      setTimeout(() => {
        setClearedData(false);
        window.location.reload();
      }, 1000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* ─── 1. Appearance & Theme Mode (Day / Night / System) ─── */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Sun size={15} color="var(--accent-amber)" />
            <span>Appearance &amp; Theme</span>
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {currentTheme === 'day' ? '☀️ Light' : currentTheme === 'night' ? '🌙 Dark' : '💻 Auto'}
          </span>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Choose your interface theme or automatically match your operating system preferences.
        </div>

        {/* Segmented 3-Way Theme Switcher */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.25)',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {[
            { id: 'day' as const, icon: Sun, label: 'Day (Light)', color: '#f59e0b' },
            { id: 'night' as const, icon: Moon, label: 'Night (Dark)', color: '#6366f1' },
            { id: 'system' as const, icon: Monitor, label: 'System (Auto)', color: '#10b981' },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = currentTheme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTheme(item.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '8px 4px',
                  borderRadius: '6px',
                  border: isSelected ? '1px solid var(--border-focus)' : '1px solid transparent',
                  background: isSelected ? 'var(--bg-surface-elevated)' : 'transparent',
                  boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={16} color={isSelected ? item.color : 'var(--text-muted)'} />
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 2. In-Page Floating Widget & Popup Customization ─── */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <MessageSquare size={15} color="var(--primary)" />
            <span>In-Browser Floating Widget</span>
          </div>
          {savedFab && (
            <span style={{ fontSize: '10px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '2px' }}>
              <Check size={11} /> Saved
            </span>
          )}
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Customize the quick-access floating button on coding and problem pages.
        </div>

        {/* In-Page Popup Content Mode */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            🎯 Popup Content Mode:
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {[
              {
                id: 'both' as const,
                label: '💬 + 🎨 Both (Chat & Board)',
                desc: 'Segmented tabs to switch between chat & whiteboard',
              },
              {
                id: 'chat_only' as const,
                label: '💬 Only Chat',
                desc: 'Direct problem discussion & hints overlay',
              },
              {
                id: 'whiteboard_only' as const,
                label: '🎨 Only Whiteboard',
                desc: 'Direct drawing canvas & visual sketchpad',
              },
              {
                id: 'none' as const,
                label: '🚫 None (Hide Widget)',
                desc: 'Completely hide on-page floating widget',
              },
            ].map((item) => {
              const currentContentMode =
                fabSettings.popupContentMode || (fabSettings.enableWhiteboard ? 'both' : 'chat_only');
              const isSelected = currentContentMode === item.id;
              return (
                <label
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-hover)',
                    border: isSelected ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="popup_content_mode"
                    checked={isSelected}
                    onChange={() => handleUpdatePopupContentMode(item.id)}
                    style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
                  />
                  <div>
                    <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Display Whitelist Mode Selection */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginBottom: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            🌐 Display Locations:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {[
              { mode: 'coding_sites' as const, label: '🟢 Coding Sites Only (Recommended)', desc: 'LeetCode, Codeforces, NeetCode, HackerRank, YouTube...' },
              { mode: 'all_sites' as const, label: '🌐 All Websites', desc: 'Display floating button on every webpage' },
              { mode: 'custom_sites' as const, label: '📋 Whitelisted Domains Only', desc: 'Show only on specified domains' },
              { mode: 'disabled' as const, label: '🚫 Disabled', desc: 'Hide widget completely everywhere' },
            ].map((opt) => (
              <label
                key={opt.mode}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  padding: '5px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: fabSettings.mode === opt.mode ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-hover)',
                  border: fabSettings.mode === opt.mode ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="fab_mode"
                  checked={fabSettings.mode === opt.mode}
                  onChange={() => handleUpdateFabMode(opt.mode)}
                  style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
                />
                <div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Custom Whitelist Domains List */}
        {fabSettings.mode === 'custom_sites' && (
          <div style={{ marginTop: '8px', marginBottom: '8px' }}>
            <form onSubmit={handleAddDomain} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="e.g. github.com, leetcode.com"
                value={newDomainInput}
                onChange={(e) => setNewDomainInput(e.target.value)}
                style={{ fontSize: '11px', padding: '4px 8px', flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!newDomainInput.trim()}>
                <Plus size={12} />
              </button>
            </form>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {fabSettings.customDomains.map((dom) => (
                <span
                  key={dom}
                  className="badge"
                  style={{
                    fontSize: '9.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    background: 'rgba(99, 102, 241, 0.15)',
                    borderColor: 'rgba(99, 102, 241, 0.35)',
                    color: 'var(--primary)',
                  }}
                >
                  <span>{dom}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveDomain(dom)}
                    style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, display: 'flex' }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Draggable Position Mode */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
              📍 Position Persistence:
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const updated: FabSettings = {
                  ...fabSettings,
                  savedPosition: { right: 24, bottom: 24 },
                };
                setFabSettings(updated);
                saveFabSettings(updated);
              }}
              style={{ fontSize: '9.5px', padding: '2px 6px', color: 'var(--primary)' }}
            >
              Reset to Default
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: (fabSettings.positionMode === 'permanent' || !fabSettings.positionMode) ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-hover)',
                border: (fabSettings.positionMode === 'permanent' || !fabSettings.positionMode) ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fab_position_mode"
                checked={fabSettings.positionMode === 'permanent' || !fabSettings.positionMode}
                onChange={() => {
                  const updated: FabSettings = { ...fabSettings, positionMode: 'permanent' };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
              />
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-primary)' }}>📌 Permanent</div>
                <div style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Remember dragged location</div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: fabSettings.positionMode === 'temporary' ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-hover)',
                border: fabSettings.positionMode === 'temporary' ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fab_position_mode"
                checked={fabSettings.positionMode === 'temporary'}
                onChange={() => {
                  const updated: FabSettings = { ...fabSettings, positionMode: 'temporary' };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
              />
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-primary)' }}>⏱️ Temporary</div>
                <div style={{ fontSize: '8.5px', color: 'var(--text-muted)' }}>Reset on reload</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ─── 3. Focus Timer & Pomodoro (Turned on from settings) ─── */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Clock size={15} color="#f43f5e" />
            <span>Focus Timer &amp; Pomodoro</span>
          </div>
          <span style={{ fontSize: '10px', color: timerConfig.enabled ? '#10b981' : 'var(--text-muted)' }}>
            {timerConfig.enabled ? '● Enabled' : '○ Disabled'}
          </span>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Enable a dedicated Pomodoro countdown, intervals (25m/5m/15m), and stopwatch for deep problem solving.
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            marginBottom: timerConfig.enabled ? '12px' : '0',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Enable Pomodoro &amp; Timer Bar
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              Show floating timer buttons and controls across the app
            </div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: '38px', height: '20px', margin: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={timerConfig.enabled}
              onChange={(e) => timerService.setEnabled(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: timerConfig.enabled ? 'var(--primary)' : 'rgba(255, 255, 255, 0.15)',
                borderRadius: '20px',
                transition: '0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  height: '14px',
                  width: '14px',
                  left: timerConfig.enabled ? '20px' : '3px',
                  bottom: '3px',
                  background: '#ffffff',
                  borderRadius: '50%',
                  transition: '0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </span>
          </label>
        </div>

        {timerConfig.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              <div>
                <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>🍅 Work (min)</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  className="input-glass"
                  style={{ width: '100%', fontSize: '11px', padding: '4px 6px' }}
                  value={timerConfig.workDurationMin}
                  onChange={(e) => timerService.updateConfig({ workDurationMin: Math.max(1, parseInt(e.target.value) || 25) })}
                />
              </div>
              <div>
                <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>☕ Break (min)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="input-glass"
                  style={{ width: '100%', fontSize: '11px', padding: '4px 6px' }}
                  value={timerConfig.shortBreakMin}
                  onChange={(e) => timerService.updateConfig({ shortBreakMin: Math.max(1, parseInt(e.target.value) || 5) })}
                />
              </div>
              <div>
                <label style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>🌴 Long Break</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="input-glass"
                  style={{ width: '100%', fontSize: '11px', padding: '4px 6px' }}
                  value={timerConfig.longBreakMin}
                  onChange={(e) => timerService.updateConfig({ longBreakMin: Math.max(1, parseInt(e.target.value) || 15) })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>🔔 Audio chime on session complete</span>
              <input
                type="checkbox"
                checked={timerConfig.soundAlerts}
                onChange={(e) => timerService.updateConfig({ soundAlerts: e.target.checked })}
                style={{ accentColor: 'var(--primary)' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── 4. Go Signaling Server Broker & Retry Connection ─── */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Server size={15} color="var(--primary)" />
            <span>Go Signaling Server Broker</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '10px',
                fontWeight: 700,
                background: isServerConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.18)',
                border: isServerConnected ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
                color: isServerConnected ? '#34d399' : '#fca5a5',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isServerConnected ? '#10b981' : '#ef4444',
                  boxShadow: isServerConnected ? '0 0 6px #10b981' : '0 0 6px #ef4444',
                }}
              />
              <span>{isServerConnected ? 'Connected (Mesh Active)' : 'Disconnected (Offline)'}</span>
            </span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
          WebSocket signaling endpoint used to establish WebRTC peer meshes, negotiate SDP offers/answers, and coordinate cluster leaders.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              className="input-glass"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="wss://synqto-server.onrender.com/ws/"
              style={{ flex: 1, fontSize: '11px', padding: '6px 10px' }}
            />
            <button className="btn btn-primary btn-sm" onClick={handleSaveAndReconnect} title="Save URL &amp; Connect">
              {savedUrl ? <Check size={13} /> : 'Save &amp; Connect'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleResetDefaultUrl}
              style={{ fontSize: '10px', padding: '4px 8px', color: 'var(--text-muted)' }}
              title="Reset URL to default hosted server"
            >
              <RotateCcw size={10} style={{ marginRight: '4px' }} />
              <span>Reset Default (Render)</span>
            </button>

            <button
              type="button"
              className="btn btn-sm"
              onClick={handleRetryServerConnection}
              disabled={isRetryingServer}
              style={{
                fontSize: '11px',
                padding: '4px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                background: isServerConnected
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'linear-gradient(135deg, #ef4444, #dc2626)',
                borderColor: isServerConnected ? 'rgba(16, 185, 129, 0.35)' : 'transparent',
                color: '#ffffff',
                fontWeight: 600,
                cursor: isRetryingServer ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={11} style={{ animation: isRetryingServer ? 'spin 1s linear infinite' : 'none' }} />
              <span>{isRetryingServer ? 'Connecting...' : isServerConnected ? 'Test / Reconnect' : 'Retry Connection Now ⚡'}</span>
            </button>
          </div>

          {serverToast && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '10.5px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: serverToast.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                border: serverToast.type === 'success' ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                color: serverToast.type === 'success' ? '#34d399' : '#fca5a5',
                animation: 'slideDown 0.2s ease',
              }}
            >
              {serverToast.type === 'success' ? <CheckCircle size={13} color="#10b981" /> : <AlertTriangle size={13} color="#ef4444" />}
              <span>{serverToast.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 4. Privacy & Local Storage ─── */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Shield size={15} color="var(--accent-emerald)" />
            <span>Privacy &amp; Data Storage</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Synqto operates 100% peer-to-peer. Messages, streaks, and personal diaries are stored locally in your browser.
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Reset local identity, streaks, and cached history
          </div>
          <button className="btn btn-danger btn-sm" onClick={handleClearData} style={{ fontSize: '11px' }}>
            <Trash2 size={12} />
            <span>Clear Local Data</span>
          </button>
        </div>
        {clearedData && (
          <div style={{ fontSize: '10px', color: 'var(--accent-emerald)', marginTop: '4px' }}>
            ✓ Local data cleared. Reloading...
          </div>
        )}
      </div>

      {/* ─── 5. Diagnostics & Version ─── */}
      <div className="glass-card" style={{ background: 'var(--bg-surface)' }}>
        <div className="glass-card-header">
          <div className="glass-card-title" style={{ fontSize: '12px' }}>
            <Info size={13} color="var(--text-muted)" />
            <span>About Synqto</span>
          </div>
        </div>
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Version: <strong>{typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '0.1.1'} (Phase II Live Stage)</strong><br />
          Network Protocol: <strong>Dual-Leader P2P Mesh with WebRTC DataChannels</strong><br />
          Signaling: <strong>Go / Gorilla WebSocket Broker</strong>
        </div>
      </div>
    </div>
  );
};
