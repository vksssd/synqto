// ─── Extension Settings & Diagnostics Card ───

import React, { useState, useEffect } from 'react';
import { Server, Trash2, Shield, Info, Check, MessageSquare, Plus, X, Layers, ExternalLink } from 'lucide-react';
import { SignalingService } from '@/core/network/signaling.service';
import { FabSettings, DEFAULT_FAB_SETTINGS, FAB_STORAGE_KEY, SYNQTO_FAB_STORAGE_KEY, FabDisplayMode, FabClickAction } from './fab-settings.types';

export const SettingsCard: React.FC = () => {
  const signaling = SignalingService.getInstance();

  const [serverUrl, setServerUrl] = useState(signaling.getServerUrl());
  const [savedUrl, setSavedUrl] = useState(false);
  const [clearedData, setClearedData] = useState(false);

  // Floating Button Settings
  const [fabSettings, setFabSettings] = useState<FabSettings>(DEFAULT_FAB_SETTINGS);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [savedFab, setSavedFab] = useState(false);

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

  const handleSaveUrl = () => {
    if (serverUrl.trim()) {
      signaling.setServerUrl(serverUrl.trim());
      setSavedUrl(true);
      setTimeout(() => setSavedUrl(false), 2000);
    }
  };

  const handleUpdateFabMode = (mode: FabDisplayMode) => {
    const updated: FabSettings = { ...fabSettings, mode };
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
      chrome.storage.local.set({
        [FAB_STORAGE_KEY]: settings,
        [SYNQTO_FAB_STORAGE_KEY]: settings,
      }, () => {
        setSavedFab(true);
        setTimeout(() => setSavedFab(false), 1500);
      });
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
    if (confirm('Are you sure you want to clear local chat history and settings?')) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* In-Page Floating Button Controls */}
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
          Display a floating ⚡ Nerd Buddy button directly on websites for immediate access.
        </div>

        {/* Display Mode Selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
          {[
            { mode: 'coding_sites' as const, label: '🟢 Coding Sites Only (Recommended)', desc: 'LeetCode, Codeforces, NeetCode, HackerRank, YouTube...' },
            { mode: 'all_sites' as const, label: '🌐 All Websites', desc: 'Display floating button on every webpage' },
            { mode: 'custom_sites' as const, label: '📋 Whitelisted Domains Only', desc: 'Show only on domains specified below' },
            { mode: 'disabled' as const, label: '🚫 Disabled', desc: 'Hide in-browser floating button completely' },
          ].map((opt) => (
            <label
              key={opt.mode}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: fabSettings.mode === opt.mode ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: fabSettings.mode === opt.mode ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
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
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>{opt.label}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Click Action Selection (Open Popup vs Open Directly Extension) */}
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
            🖱️ Floating Button Click Action:
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: (fabSettings.clickAction === 'open_popup' || !fabSettings.clickAction) ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: (fabSettings.clickAction === 'open_popup' || !fabSettings.clickAction) ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fab_click_action"
                checked={fabSettings.clickAction === 'open_popup' || !fabSettings.clickAction}
                onChange={() => handleUpdateFabClickAction('open_popup')}
                style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
              />
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>💬 Open Chat Popup</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>In-page chat & hints overlay</div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: fabSettings.clickAction === 'open_extension' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: fabSettings.clickAction === 'open_extension' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="fab_click_action"
                checked={fabSettings.clickAction === 'open_extension'}
                onChange={() => handleUpdateFabClickAction('open_extension')}
                style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
              />
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>⤢ Open Extension</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Directly open side panel</div>
              </div>
            </label>
          </div>
        </div>

        {/* Draggable Position Persistence Mode */}
        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>
              📍 Draggable Position Persistence:
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
              style={{ fontSize: '9px', padding: '2px 6px', color: 'var(--primary)' }}
              title="Reset position back to bottom-right"
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
                background: (fabSettings.positionMode === 'permanent' || !fabSettings.positionMode) ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: (fabSettings.positionMode === 'permanent' || !fabSettings.positionMode) ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
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
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>📌 Permanent</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Remember dragged spot everywhere</div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                background: fabSettings.positionMode === 'temporary' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: fabSettings.positionMode === 'temporary' ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
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
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>⏱️ Temporary</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Reset on reload/new tab</div>
              </div>
            </label>
          </div>
        </div>

        {/* Custom Whitelist Domains Section */}
        {fabSettings.mode === 'custom_sites' && (
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Whitelisted Domains:
            </div>

            <form onSubmit={handleAddDomain} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                className="input-glass"
                placeholder="e.g. github.com, leetcode.com"
                value={newDomainInput}
                onChange={(e) => setNewDomainInput(e.target.value)}
                style={{ fontSize: '11px', padding: '4px 8px' }}
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
                    fontSize: '10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    background: 'rgba(99, 102, 241, 0.15)',
                    borderColor: 'rgba(99, 102, 241, 0.35)',
                    color: '#c4b5fd',
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

        {/* In-Page Popup Content Mode: Both / Only Chat / Only Whiteboard / None */}
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
            🎯 In-Page Popup Content:
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Choose what opens when clicking the on-screen floating button on problem pages.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {[
              {
                id: 'both' as const,
                label: '💬 + 🎨 Both (Chat & Board)',
                desc: 'Tabs to toggle between chat and whiteboard',
              },
              {
                id: 'chat_only' as const,
                label: '💬 Only Chat',
                desc: 'Direct peer discussion & live hints overlay',
              },
              {
                id: 'whiteboard_only' as const,
                label: '🎨 Only Whiteboard',
                desc: 'Direct drawing canvas & system scratchpad',
              },
              {
                id: 'none' as const,
                label: '🚫 None (Hide Widget)',
                desc: 'Completely hide on-page popup widget',
              },
            ].map((item) => {
              const currentContentMode = fabSettings.popupContentMode || (fabSettings.enableWhiteboard ? 'both' : 'chat_only');
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
                    background: isSelected ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.02)',
                    border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="popup_content_mode"
                    checked={isSelected}
                    onChange={() => {
                      const updated: FabSettings = {
                        ...fabSettings,
                        popupContentMode: item.id,
                        enableWhiteboard: item.id === 'both' || item.id === 'whiteboard_only',
                      };
                      setFabSettings(updated);
                      saveFabSettings(updated);
                    }}
                    style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
                  />
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>{item.label}</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Whiteboard Preferences Sub-Panel */}
        {(fabSettings.popupContentMode === 'both' || fabSettings.popupContentMode === 'whiteboard_only' || fabSettings.enableWhiteboard) && (
          <div style={{ marginTop: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#c7d2fe', marginBottom: '8px' }}>
              ⚙️ Default Whiteboard &amp; Notebook Settings
            </div>

              {/* 1. Default Privacy Mode */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
                  Default Board Mode:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {[
                    { id: 'collaborative', label: '👥 Collaborative', desc: 'Sync live with room peers' },
                    { id: 'personal', label: '🔒 Personal Scratchpad', desc: 'Private offline notes' },
                  ].map((m) => {
                    const currentMode = fabSettings.whiteboardPrefs?.defaultPrivacyMode || 'collaborative';
                    return (
                      <label
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '6px',
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: currentMode === m.id ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.02)',
                          border: currentMode === m.id ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="wb_pref_mode"
                          checked={currentMode === m.id}
                          onChange={() => {
                            const updated: FabSettings = {
                              ...fabSettings,
                              whiteboardPrefs: {
                                ...(fabSettings.whiteboardPrefs || {
                                  defaultPrivacyMode: 'collaborative',
                                  defaultBackgroundType: 'grid',
                                  defaultBgColor: '#090d16',
                                  defaultPenColor: '#6366f1',
                                  defaultPenWidth: 4,
                                  disappearingInkDurationSec: 3,
                                  autoSavePersonalNotebook: true,
                                }),
                                defaultPrivacyMode: m.id as any,
                              },
                            };
                            setFabSettings(updated);
                            saveFabSettings(updated);
                          }}
                          style={{ marginTop: '2px', accentColor: 'var(--primary)' }}
                        />
                        <div>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: '#fff' }}>{m.label}</div>
                          <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{m.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 2. Default Canvas Background Color */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
                  Default Canvas Background Color:
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[
                    { color: '#090d16', label: 'Dark Obsidian' },
                    { color: '#0f172a', label: 'Midnight Slate' },
                    { color: '#062c24', label: 'Deep Forest' },
                    { color: '#fef3c7', label: 'Vintage Sepia' },
                    { color: '#ffffff', label: 'Pure White' },
                    { color: '#f8fafc', label: 'Soft Cream' },
                    { color: '#1e1035', label: 'Deep Violet' },
                  ].map((c) => {
                    const currentBg = fabSettings.whiteboardPrefs?.defaultBgColor || '#090d16';
                    return (
                      <button
                        key={c.color}
                        type="button"
                        onClick={() => {
                          const updated: FabSettings = {
                            ...fabSettings,
                            whiteboardPrefs: {
                              ...(fabSettings.whiteboardPrefs || {
                                defaultPrivacyMode: 'collaborative',
                                defaultBackgroundType: 'grid',
                                defaultBgColor: '#090d16',
                                defaultPenColor: '#6366f1',
                                defaultPenWidth: 4,
                                disappearingInkDurationSec: 3,
                                autoSavePersonalNotebook: true,
                              }),
                              defaultBgColor: c.color,
                            },
                          };
                          setFabSettings(updated);
                          saveFabSettings(updated);
                        }}
                        title={c.label}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '4px',
                          background: c.color,
                          border: currentBg === c.color ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)',
                          boxShadow: currentBg === c.color ? '0 0 6px rgba(99, 102, 241, 0.8)' : 'none',
                          cursor: 'pointer',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* 3. Disappearing Ink Fade Duration */}
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
                  ⏳ Disappearing Ink Fade Duration:
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {[2, 3, 5].map((sec) => {
                    const currentSec = fabSettings.whiteboardPrefs?.disappearingInkDurationSec || 3;
                    return (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => {
                          const updated: FabSettings = {
                            ...fabSettings,
                            whiteboardPrefs: {
                              ...(fabSettings.whiteboardPrefs || {
                                defaultPrivacyMode: 'collaborative',
                                defaultBackgroundType: 'grid',
                                defaultBgColor: '#090d16',
                                defaultPenColor: '#6366f1',
                                defaultPenWidth: 4,
                                disappearingInkDurationSec: 3,
                                autoSavePersonalNotebook: true,
                              }),
                              disappearingInkDurationSec: sec,
                            },
                          };
                          setFabSettings(updated);
                          saveFabSettings(updated);
                        }}
                        style={{
                          flex: 1,
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '4px',
                          borderRadius: '4px',
                          background: currentSec === sec ? 'var(--primary)' : 'rgba(255,255,255,0.04)',
                          border: currentSec === sec ? '1px solid transparent' : '1px solid var(--border-subtle)',
                          color: currentSec === sec ? '#fff' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {sec} Seconds
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
      </div>

      {/* Signaling Server Configuration */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Server size={15} color="var(--primary)" />
            <span>Go Signaling Server URL</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
          Minimal Go broker used solely for initial SDP offer/answer exchanges and room registration.
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            className="input-glass"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="ws://localhost:8080/ws"
          />
          <button className="btn btn-primary" onClick={handleSaveUrl}>
            {savedUrl ? <Check size={14} /> : 'Save'}
          </button>
        </div>
      </div>

      {/* Storage & Privacy Management */}
      <div className="glass-card">
        <div className="glass-card-header">
          <div className="glass-card-title">
            <Shield size={15} color="#10b981" />
            <span>Privacy &amp; Data Storage</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
          Nerd Buddy operates 100% peer-to-peer. Messages and state are stored strictly locally in your browser.
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Reset local identity, streaks, badges and history
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

      {/* System Diagnostics Info */}
      <div className="glass-card" style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
        <div className="glass-card-header">
          <div className="glass-card-title" style={{ fontSize: '12px' }}>
            <Info size={13} color="var(--text-dim)" />
            <span>About Nerd Buddy</span>
          </div>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Version: <strong>0.1.0 (Phase II Live Stage)</strong><br />
          Network Protocol: <strong>Dual-Leader P2P Mesh with WebRTC DataChannels</strong><br />
          Signaling: <strong>Go / Gorilla WebSocket Server</strong>
        </div>
      </div>
    </div>
  );
};
