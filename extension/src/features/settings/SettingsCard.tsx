// ─── Extension Settings & Diagnostics Card (Clean UI + Day/Night/System Themes) ───

import React, { useState, useEffect } from 'react';
import { Server, Trash2, Shield, Info, Check, MessageSquare, Plus, X, Sun, Layout, Palette, Sparkles, Clock, RefreshCw, CheckCircle, AlertTriangle, RotateCcw, Search, Type, Eye, SlidersHorizontal, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { SignalingService } from '@/core/network/signaling.service';
import {
  ThemeService,
  ThemeMode,
  AccentColor,
  CustomThemeSettings,
  THEME_MODE_DETAILS,
  ACCENT_PALETTES,
  FIVE_COLOR_PALETTES,
  FiveColorPalette,
  FONT_SIZE_PRESETS,
  RADIUS_PRESETS,
  FONT_FAMILY_DETAILS,
  FontFamilyDetails,
  FontSizeOption,
  UiDensity,
  BorderRadiusOption,
  FontFamilyOption,
} from './theme.service';
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

  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    theme: false,
    widget: false,
    timer: false,
    server: false,
    privacy: false,
    about: false,
  });

  const toggleCard = (key: string) => {
    setExpandedCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const allExpanded = Object.values(expandedCards).every(Boolean);

  const handleToggleAll = () => {
    const next = !allExpanded;
    setExpandedCards({
      theme: next,
      widget: next,
      timer: next,
      server: next,
      privacy: next,
      about: next,
    });
  };

  const [customTheme, setCustomTheme] = useState<CustomThemeSettings>(themeService.getSettings());
  const [themeFilterTab, setThemeFilterTab] = useState<'all' | 'dark' | 'light' | 'auto'>('all');
  const [paletteTab, setPaletteTab] = useState<'all' | 'standard' | 'leetcode' | 'creative'>('all');
  const [showCustomStudio, setShowCustomStudio] = useState(customTheme.customPaletteEnabled || false);
  const [customHexInput, setCustomHexInput] = useState(customTheme.customAccentHex || '#6366f1');

  const [customColors, setCustomColors] = useState({
    bgApp: customTheme.customBgApp || '#0d1117',
    bgSurface: customTheme.customBgSurface || '#161b22',
    primary: customTheme.customPrimary || '#6366f1',
    textPrimary: customTheme.customTextPrimary || '#f0f6fc',
    textSecondary: customTheme.customTextSecondary || '#8b949e',
  });

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
    return themeService.onChange((settings) => {
      setCustomTheme(settings);
      if (settings.customAccentHex) {
        setCustomHexInput(settings.customAccentHex);
      }
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

  const handleSelectPalette = (pal: FiveColorPalette) => {
    themeService.applyFiveColorPalette(pal);
    setCustomColors({
      bgApp: pal.colors.bgApp,
      bgSurface: pal.colors.bgSurface,
      primary: pal.colors.primary,
      textPrimary: pal.colors.textPrimary,
      textSecondary: pal.colors.textSecondary,
    });
    setShowCustomStudio(false);
  };

  const handleUpdateCustomColor = (key: 'bgApp' | 'bgSurface' | 'primary' | 'textPrimary' | 'textSecondary', val: string) => {
    const updated = { ...customColors, [key]: val };
    setCustomColors(updated);
    themeService.setCustomPaletteColors(updated);
  };

  const handleToggleCustomOverride = (enabled: boolean) => {
    setShowCustomStudio(enabled);
    themeService.setCustomPaletteEnabled(enabled);
    if (enabled) {
      themeService.setCustomPaletteColors(customColors);
    }
  };

  const handleRandomizePalette = () => {
    const randomPal = FIVE_COLOR_PALETTES[Math.floor(Math.random() * FIVE_COLOR_PALETTES.length)];
    handleSelectPalette(randomPal);
  };

  const handleSelectAccent = (accent: AccentColor) => {
    themeService.setAccentColor(accent);
  };

  const handleApplyCustomHex = (e: React.FormEvent) => {
    e.preventDefault();
    if (/^#[0-9A-Fa-f]{6}$/.test(customHexInput) || /^#[0-9A-Fa-f]{3}$/.test(customHexInput)) {
      themeService.setCustomAccentHex(customHexInput);
    }
  };

  const handleColorPickerChange = (color: string) => {
    setCustomHexInput(color);
    themeService.setCustomAccentHex(color);
  };

  const handleSelectFontSize = (preset: FontSizeOption) => {
    const size = FONT_SIZE_PRESETS[preset].size;
    themeService.setFontSize(size, preset);
  };

  const handleFontSizeSlider = (size: number) => {
    themeService.setFontSize(size, 'custom');
  };

  const THEME_MODE_OPTIONS: Array<{ id: ThemeMode; label: string; icon: string; desc: string }> = [
    { id: 'night', label: 'Midnight Dark', icon: '🌙', desc: 'Deep navy glass theme' },
    { id: 'day', label: 'Day Light', icon: '☀️', desc: 'Clean high-contrast daylight' },
    { id: 'system', label: 'System Auto', icon: '💻', desc: 'Matches device settings' },
    { id: 'oled', label: 'OLED Black', icon: '🌌', desc: 'Pitch black #000000' },
    { id: 'espresso', label: 'Warm Espresso', icon: '☕', desc: 'Mocha amber dark room' },
    { id: 'forest', label: 'Forest Green', icon: '🌲', desc: 'Emerald slate matrix' },
  ];

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

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'theme' | 'widget' | 'timer' | 'server' | 'privacy'>('all');

  const matchSearch = (category: string, keywords: string[], text: string) => {
    if (activeCategory !== 'all' && activeCategory !== category) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      category.toLowerCase().includes(q) ||
      text.toLowerCase().includes(q) ||
      keywords.some((k) => k.toLowerCase().includes(q))
    );
  };

  const hasTheme = matchSearch('theme', ['color', 'accent', 'palette', 'dark', 'light', 'oled', 'espresso', 'forest', 'indigo', 'cyan', 'emerald', 'rose', 'amber', 'purple', 'slate', 'background', 'mode'], 'theme accent background color appearance');
  const hasWidget = matchSearch('widget', ['floating', 'button', 'fab', 'popup', 'domain', 'whitelist', 'overlay', 'chat', 'whiteboard', 'website'], 'widget floating button popup domain whitelist');
  const hasTimer = matchSearch('timer', ['pomodoro', 'focus', 'break', 'sound', 'interval', 'minutes', 'clock', 'notification'], 'timer pomodoro focus break sound minutes');
  const hasServer = matchSearch('server', ['signaling', 'websocket', 'network', 'mesh', 'render', 'reconnect', 'url', 'latency', 'ping', 'connection', 'host'], 'server signaling websocket network mesh url');
  const hasPrivacy = matchSearch('privacy', ['data', 'storage', 'clear', 'reset', 'cache', 'history', 'identity', 'local'], 'privacy data storage clear reset');
  const hasAbout = matchSearch('about', ['version', 'protocol', 'manifest', 'info', 'diagnostics', 'webrtc'], 'about version info diagnostics');

  const anyMatch = hasTheme || hasWidget || hasTimer || hasServer || hasPrivacy || hasAbout;

  const isSearching = searchQuery.trim().length > 0;
  const isThemeExpanded = isSearching || expandedCards.theme;
  const isWidgetExpanded = isSearching || expandedCards.widget;
  const isTimerExpanded = isSearching || expandedCards.timer;
  const isServerExpanded = isSearching || expandedCards.server;
  const isPrivacyExpanded = isSearching || expandedCards.privacy;
  const isAboutExpanded = isSearching || expandedCards.about;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ─── 0. Sticky Settings Search & Quick Filter Bar ─── */}
      <div
        className="glass-card"
        style={{
          padding: '8px 10px',
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Search Input Box */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '10px',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            className="input-glass"
            placeholder="Search settings (e.g. theme, timer, server, widget, data)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: '32px',
              paddingRight: searchQuery ? '28px' : '10px',
              fontSize: 'var(--font-size-sm)',
              height: '32px',
              background: 'rgba(0, 0, 0, 0.35)',
              borderRadius: '8px',
            }}
           aria-label="Search settings (e.g. theme, timer, server, widget, data)"/>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
              }}
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Quick Category Filter Pills */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'theme' as const, label: '🎨 Themes & Colors' },
            { id: 'widget' as const, label: '💬 Floating Widget' },
            { id: 'timer' as const, label: '⏱️ Pomodoro Timer' },
            { id: 'server' as const, label: '⚡ Network Server' },
            { id: 'privacy' as const, label: '🔒 Privacy & Data' },
          ].map((cat) => {
            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: isSelected ? 700 : 500,
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isSelected ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                  color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleToggleAll}
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
              marginLeft: 'auto',
              transition: 'all 0.15s ease',
            }}
            title={allExpanded ? 'Collapse all settings cards' : 'Expand all settings cards'}
          >
            <ChevronsUpDown size={11} color="var(--primary)" />
            <span>{allExpanded ? 'Collapse All' : 'Expand All'}</span>
          </button>
        </div>
      </div>

      {/* ─── Search Empty State ─── */}
      {!anyMatch && (
        <div
          className="glass-card"
          style={{
            padding: '32px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Search size={28} color="var(--text-muted)" />
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>
            No settings found
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', maxWidth: '260px' }}>
            No settings matched &quot;<strong>{searchQuery}</strong>&quot;. Try searching for &quot;theme&quot;, &quot;timer&quot;, &quot;server&quot;, or &quot;widget&quot;.
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearchQuery('');
              setActiveCategory('all');
            }}
            style={{ marginTop: '8px', fontSize: 'var(--font-size-sm)' }}
          >
            Clear Search Filter
          </button>
        </div>
      )}

      {/* ─── 1. Appearance, Themes & Typography Customization Suite ─── */}
      {hasTheme && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: isThemeExpanded ? '14px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('theme')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isThemeExpanded ? '4px' : 0,
            }}
          >
            <div className="glass-card-title">
              <Palette size={16} color="var(--primary)" />
              <span>Appearance, Themes &amp; Typography</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid var(--border-focus)',
                  color: 'var(--text-primary)',
                }}
              >
                {THEME_MODE_DETAILS[customTheme.mode]?.icon} {THEME_MODE_DETAILS[customTheme.mode]?.name}
              </span>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isThemeExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isThemeExpanded && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                Fully customize background themes, high-contrast text palettes, brand accents, font scaling, and UI layout density.
              </div>

              {/* ─── 1A. Curated 5-Color Complete Palettes (Standard & LeetCode) ─── */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={13} color="var(--primary)" />
                    <span>🎯 Curated 5-Color Complete Palettes ({FIVE_COLOR_PALETTES.length} Presets):</span>
                  </div>

                  {/* Palette Category Filter Tabs */}
                  <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '6px' }}>
                    {[
                      { id: 'all' as const, label: 'All' },
                      { id: 'standard' as const, label: '🌙 Standard' },
                      { id: 'leetcode' as const, label: '🧡 LeetCode' },
                      { id: 'creative' as const, label: '🎨 Creative' },
                    ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPaletteTab(tab.id)}
                    style={{
                      fontSize: 'var(--font-size-2xs)',
                      padding: '2px 5px',
                      borderRadius: '4px',
                      border: 'none',
                      background: paletteTab === tab.id ? 'var(--primary)' : 'transparent',
                      color: paletteTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: paletteTab === tab.id ? 700 : 500,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 5-Color Palette Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginBottom: '10px' }}>
              {FIVE_COLOR_PALETTES
                .filter((p) => {
                  if (paletteTab === 'all') return true;
                  return p.category === paletteTab;
                })
                .map((pal) => {
                  const isSelected = !customTheme.customPaletteEnabled && customTheme.mode === pal.themeMode;
                  return (
                    <button
                      key={pal.id}
                      type="button"
                      onClick={() => handleSelectPalette(pal)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '5px',
                        padding: '8px 9px',
                        borderRadius: '8px',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(99, 102, 241, 0.16)' : 'rgba(0, 0, 0, 0.25)',
                        boxShadow: isSelected ? '0 0 12px var(--primary-glow)' : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: 'var(--font-size-md)' }}>{pal.emoji}</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: isSelected ? 700 : 600, color: 'var(--text-primary)' }}>
                            {pal.name}
                          </span>
                        </div>
                        {isSelected ? (
                          <span style={{ fontSize: 'var(--font-size-2xs)', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <Check size={11} /> Active
                          </span>
                        ) : (
                          <span style={{ fontSize: 'var(--font-size-2xs)', padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                            {pal.category}
                          </span>
                        )}
                      </div>

                      {/* 5-Swatch Horizontal Color Bar */}
                      <div
                        style={{
                          width: '100%',
                          height: '16px',
                          borderRadius: '4px',
                          display: 'flex',
                          overflow: 'hidden',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                        }}
                        title={`Canvas: ${pal.colors.bgApp} | Surface: ${pal.colors.bgSurface} | Accent: ${pal.colors.primary} | Text: ${pal.colors.textPrimary} | Meta: ${pal.colors.textSecondary}`}
                      >
                        <div style={{ flex: 1, background: pal.colors.bgApp }} title="Canvas BG" />
                        <div style={{ flex: 1, background: pal.colors.bgSurface }} title="Surface Card" />
                        <div style={{ flex: 1, background: pal.colors.primary }} title="Brand Accent" />
                        <div style={{ flex: 1, background: pal.colors.textPrimary }} title="Primary Text" />
                        <div style={{ flex: 1, background: pal.colors.textSecondary }} title="Muted Text" />
                      </div>

                      <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                        {pal.desc}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* ─── 1B. Custom 5-Color Palette Studio (Interactive DIY Creator) ─── */}
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.28)',
              border: customTheme.customPaletteEnabled ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <SlidersHorizontal size={14} color="var(--primary)" />
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  🛠️ Custom 5-Color Studio (DIY Creator)
                </span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={customTheme.customPaletteEnabled}
                  onChange={(e) => handleToggleCustomOverride(e.target.checked)}
                />
                <span style={{ fontWeight: customTheme.customPaletteEnabled ? 700 : 500, color: customTheme.customPaletteEnabled ? 'var(--primary)' : 'inherit' }}>
                  {customTheme.customPaletteEnabled ? '✨ Active' : 'Enable Custom'}
                </span>
              </label>
            </div>

            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              Independently calibrate each of the 5 core project layers with live hex codes &amp; native color pickers:
            </div>

            {/* 5-Color Editor Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
              {[
                { key: 'bgApp' as const, label: '1. Canvas', color: customColors.bgApp, desc: 'App background' },
                { key: 'bgSurface' as const, label: '2. Cards', color: customColors.bgSurface, desc: 'Surface panels' },
                { key: 'primary' as const, label: '3. Accent', color: customColors.primary, desc: 'Active buttons' },
                { key: 'textPrimary' as const, label: '4. Text', color: customColors.textPrimary, desc: 'Headings & body' },
                { key: 'textSecondary' as const, label: '5. Muted', color: customColors.textSecondary, desc: 'Subtitles & meta' },
              ].map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 4px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: 'var(--font-size-2xs)', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>
                    {item.label}
                  </span>
                  <label
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '50%',
                      background: item.color,
                      border: '2px solid rgba(255, 255, 255, 0.4)',
                      boxShadow: `0 0 6px ${item.color}66`,
                      cursor: 'pointer',
                      display: 'inline-block',
                      position: 'relative',
                    }}
                  >
                    <input
                      type="color"
                      value={item.color}
                      onChange={(e) => handleUpdateCustomColor(item.key, e.target.value)}
                      style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
                    />
                  </label>
                  <input
                    type="text"
                    value={item.color}
                    onChange={(e) => handleUpdateCustomColor(item.key, e.target.value)}
                    style={{
                      width: '100%',
                      maxWidth: '52px',
                      fontSize: 'var(--font-size-2xs)',
                      fontFamily: 'var(--font-mono)',
                      textAlign: 'center',
                      padding: '2px',
                      borderRadius: '3px',
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid var(--border-subtle)',
                      color: '#ffffff',
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Quick Actions for Custom Palette */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRandomizePalette}
                style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '4px 6px' }}
              >
                ✨ Randomize Palette
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => handleToggleCustomOverride(false)}
                style={{ fontSize: 'var(--font-size-xs)', padding: '4px 6px' }}
              >
                🔄 Reset to Presets
              </button>
            </div>
          </div>

          {/* ─── 1C. Prebuilt Theme Modes (14 Audited Themes) ─── */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Sun size={13} color="var(--primary)" />
                <span>🌓 Individual Background Themes ({Object.keys(THEME_MODE_DETAILS).length} Options):</span>
              </div>

              {/* Theme Filter Tabs */}
              <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '6px' }}>
                {[
                  { id: 'all' as const, label: 'All' },
                  { id: 'dark' as const, label: '🌙 Dark' },
                  { id: 'light' as const, label: '☀️ Light' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setThemeFilterTab(tab.id)}
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: 'none',
                      background: themeFilterTab === tab.id ? 'var(--primary)' : 'transparent',
                      color: themeFilterTab === tab.id ? '#ffffff' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: themeFilterTab === tab.id ? 700 : 500,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Theme Mode Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {Object.values(THEME_MODE_DETAILS)
                .filter((t) => {
                  if (themeFilterTab === 'all') return true;
                  if (themeFilterTab === 'dark') return t.type === 'dark';
                  if (themeFilterTab === 'light') return t.type === 'light';
                  return true;
                })
                .map((item) => {
                  const isSelected = !customTheme.customPaletteEnabled && customTheme.mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectTheme(item.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '4px',
                        padding: '7px 9px',
                        borderRadius: '8px',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(99, 102, 241, 0.16)' : 'rgba(0, 0, 0, 0.25)',
                        boxShadow: isSelected ? '0 0 12px var(--primary-glow)' : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{ fontSize: 'var(--font-size-lg)' }}>{item.icon}</span>
                          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: isSelected ? 700 : 600, color: 'var(--text-primary)' }}>
                            {item.name}
                          </span>
                        </div>
                        {isSelected && <Check size={12} color="var(--primary)" />}
                      </div>

                      <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                        {item.desc}
                      </div>

                      {/* Swatch preview bar */}
                      <div
                        style={{
                          width: '100%',
                          height: '14px',
                          borderRadius: '4px',
                          background: item.sampleBg,
                          border: `1px solid ${item.sampleBorder}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0 6px',
                          marginTop: '2px',
                        }}
                      >
                        <span style={{ fontSize: 'var(--font-size-2xs)', color: item.sampleText, fontWeight: 700, letterSpacing: '0.5px' }}>
                          Aa 123
                        </span>
                        <span style={{ fontSize: 'var(--font-size-2xs)', color: item.sampleText, opacity: 0.75 }}>
                          {item.type.toUpperCase()}
                        </span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* ─── 1D. Brand Accent Colors & Custom Color Picker ─── */}
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sparkles size={13} color="var(--primary)" />
              <span>🎨 Brand Accent &amp; Custom Hex Picker:</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px', marginBottom: '8px' }}>
              {Object.values(ACCENT_PALETTES)
                .filter((p) => p.id !== 'custom')
                .map((pal) => {
                  const isSelected = customTheme.accent === pal.id;
                  return (
                    <button
                      key={pal.id}
                      type="button"
                      onClick={() => handleSelectAccent(pal.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        padding: '6px 4px',
                        borderRadius: '6px',
                        border: isSelected ? `2px solid ${pal.primary}` : '1px solid var(--border-subtle)',
                        background: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.25)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={pal.name}
                    >
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: pal.primary,
                          boxShadow: isSelected ? `0 0 8px ${pal.primaryGlow}` : 'none',
                        }}
                      />
                      <span style={{ fontSize: 'var(--font-size-2xs)', fontWeight: isSelected ? 700 : 500, color: isSelected ? '#ffffff' : 'var(--text-muted)' }}>
                        {pal.name.split(' ')[1] || pal.name}
                      </span>
                    </button>
                  );
                })}
            </div>

            {/* Custom HEX Color Picker Bar */}
            <form
              onSubmit={handleApplyCustomHex}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '6px 8px',
                borderRadius: '8px',
                border: customTheme.accent === 'custom' ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }}
              >
                <input
                  type="color"
                  value={customHexInput.startsWith('#') ? customHexInput : '#6366f1'}
                  onChange={(e) => handleColorPickerChange(e.target.value)}
                  style={{
                    width: '24px',
                    height: '24px',
                    padding: 0,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: 'transparent',
                  }}
                />
                <span>Custom Color:</span>
              </label>

              <input
                type="text"
                className="input-glass"
                value={customHexInput}
                onChange={(e) => setCustomHexInput(e.target.value)}
                placeholder="#6366f1"
                style={{
                  flex: 1,
                  fontSize: 'var(--font-size-sm)',
                  padding: '3px 8px',
                  height: '26px',
                  fontFamily: 'var(--font-mono)',
                }}
               aria-label="#6366f1"/>

              <button
                type="submit"
                className="btn btn-primary btn-sm"
                style={{ padding: '3px 10px', fontSize: 'var(--font-size-xs)' }}
              >
                Apply
              </button>
            </form>
          </div>

          {/* ─── 1C. Side-by-Side Typography & Font Sizing Studio ─── */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Type size={14} color="var(--primary)" />
                <span>🔤 Typography &amp; Font Sizing Studio:</span>
              </div>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', background: 'rgba(45, 212, 191, 0.15)', border: '1px solid var(--border-focus)' }}>
                {customTheme.fontSize}px • {Math.round((customTheme.fontSize / 13) * 100)}%
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Left Column: Font Family Dropdown & Specimen Preview */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    🔠 Font Family:
                  </span>
                  <span style={{ fontSize: 'var(--font-size-2xs)', padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                    {FONT_FAMILY_DETAILS[customTheme.fontFamily]?.category || 'Sans-Serif'}
                  </span>
                </div>

                <select
                  className="input-glass"
                  value={customTheme.fontFamily}
                  onChange={(e) => themeService.setFontFamily(e.target.value as FontFamilyOption)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    fontSize: 'var(--font-size-sm)',
                    cursor: 'pointer',
                    fontFamily: FONT_FAMILY_DETAILS[customTheme.fontFamily]?.fontFamily || 'inherit',
                  }}
                >
                  <optgroup label="Sans-Serif / Clean">
                    <option value="system">💻 System Modern</option>
                    <option value="inter">✨ Inter Pro</option>
                    <option value="roboto">📱 Roboto Clean</option>
                  </optgroup>
                  <optgroup label="Monospace / Code">
                    <option value="jetbrains">⚡ JetBrains Mono</option>
                    <option value="fira">⌨️ Fira Code</option>
                    <option value="cascadia">🪄 Cascadia Code</option>
                  </optgroup>
                  <optgroup label="Geometric / Modern">
                    <option value="poppins">🎯 Poppins Geometric</option>
                    <option value="outfit">💎 Outfit Minimal</option>
                    <option value="space_grotesk">🚀 Space Grotesk</option>
                  </optgroup>
                  <optgroup label="Serif / Editorial">
                    <option value="merriweather">📖 Merriweather Serif</option>
                  </optgroup>
                </select>

                {/* Live Font Specimen Preview Box */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontFamily: FONT_FAMILY_DETAILS[customTheme.fontFamily]?.fontFamily || 'inherit',
                    fontSize: `${Math.max(10, customTheme.fontSize - 1.5)}px`,
                    color: 'var(--text-primary)',
                    lineHeight: 1.3,
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {FONT_FAMILY_DETAILS[customTheme.fontFamily]?.preview || 'The quick brown fox jumps over the lazy dog'}
                </div>
              </div>

              {/* Right Column: Font Size Preset Dropdown + Quick +/- Stepper + Slider */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    📏 Font Size:
                  </span>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleFontSizeSlider(Math.max(10, customTheme.fontSize - 1))}
                      style={{ padding: '1px 5px', fontSize: 'var(--font-size-xs)', height: '18px' }}
                      title="Decrease 1px"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleFontSizeSlider(Math.min(22, customTheme.fontSize + 1))}
                      style={{ padding: '1px 5px', fontSize: 'var(--font-size-xs)', height: '18px' }}
                      title="Increase 1px"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Preset Dropdown */}
                <select
                  className="input-glass"
                  value={customTheme.fontSizeOption}
                  onChange={(e) => handleSelectFontSize(e.target.value as FontSizeOption)}
                  style={{
                    width: '100%',
                    padding: '4px 6px',
                    fontSize: 'var(--font-size-sm)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="compact">Compact (11px) — High Density</option>
                  <option value="normal">Default (13px) — Standard</option>
                  <option value="medium">Medium (14.5px) — Comfortable</option>
                  <option value="large">Large (16px) — High Visibility</option>
                  <option value="xlarge">Extra Large (18px) — Maximum Legibility</option>
                  <option value="custom">Custom Fine Slider ({customTheme.fontSize}px)</option>
                </select>

                {/* Smooth Continuous Slider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>10px</span>
                  <input
                    type="range"
                    min="10"
                    max="22"
                    step="0.5"
                    value={customTheme.fontSize}
                    onChange={(e) => handleFontSizeSlider(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer', height: '14px' }}
                  />
                  <span style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>22px</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
                  <span>Smaller</span>
                  <span>Base: {customTheme.fontSize}px</span>
                  <span>Larger</span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── 1D. UI Layout Density & Corner Rounding ─── */}
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Layout size={13} color="var(--primary)" />
              <span>📐 Layout Density &amp; Corner Rounding:</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              {/* Density Options */}
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '3px' }}>UI Density:</div>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[
                    { id: 'compact' as const, label: '⚡ Tight' },
                    { id: 'normal' as const, label: '🎯 Normal' },
                    { id: 'comfortable' as const, label: '🛋️ Relaxed' },
                  ].map((d) => {
                    const isSelected = customTheme.density === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => themeService.setDensity(d.id)}
                        style={{
                          flex: 1,
                          fontSize: 'var(--font-size-2xs)',
                          padding: '4px 2px',
                          borderRadius: '5px',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(0, 0, 0, 0.2)',
                          color: isSelected ? '#ffffff' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Corner Rounding Options */}
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '3px' }}>Corner Radius:</div>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[
                    { id: 'sharp' as const, label: '2px' },
                    { id: 'subtle' as const, label: '6px' },
                    { id: 'smooth' as const, label: '10px' },
                    { id: 'rounded' as const, label: '16px' },
                    { id: 'pill' as const, label: 'Pill' },
                  ].map((r) => {
                    const isSelected = customTheme.borderRadius === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => themeService.setBorderRadius(r.id)}
                        style={{
                          flex: 1,
                          fontSize: 'var(--font-size-2xs)',
                          padding: '4px 2px',
                          borderRadius: '5px',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(0, 0, 0, 0.2)',
                          color: isSelected ? '#ffffff' : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ─── 1E. Glass Opacity & High Contrast Mode ─── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0, 0, 0, 0.2)', padding: '8px 10px', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  👓 High Contrast Mode (Accessible)
                </div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
                  Thickens card outlines and boosts text contrast for crystal-clear readability
                </div>
              </div>
              <input
                type="checkbox"
                checked={customTheme.highContrast}
                onChange={(e) => themeService.setHighContrast(e.target.checked)}
                style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                ✨ Card Glass Blur: {customTheme.glassOpacity}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                value={customTheme.glassOpacity}
                onChange={(e) => themeService.setGlassOpacity(parseInt(e.target.value))}
                style={{ width: '120px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* ─── 1F. Live Interactive Visual Sandbox Preview ─── */}
          <div
            style={{
              padding: '10px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Eye size={12} color="var(--primary)" />
                <span>Live UI Preview:</span>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => themeService.resetToDefaults()}
                style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 6px' }}
                title="Reset all colors and typography to default"
              >
                <RotateCcw size={9} style={{ marginRight: '3px' }} />
                Reset Defaults
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="badge badge-platform">LeetCode #42</span>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                Trapping Rain Water
              </span>
            </div>

            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-secondary)',
                background: 'var(--bg-glass-input)',
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              💬 Buddy: &quot;Let&apos;s solve this with two pointers in O(1) space!&quot;
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                Primary Action
              </button>
              <button type="button" className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                Secondary Button
              </button>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* ─── 2. In-Page Floating Widget & Popup Customization ─── */}
      {hasWidget && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: isWidgetExpanded ? '10px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('widget')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isWidgetExpanded ? '4px' : 0,
            }}
          >
            <div className="glass-card-title">
              <MessageSquare size={15} color="var(--primary)" />
              <span>In-Browser Floating Widget</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '2px 7px',
                  borderRadius: '10px',
                  background: 'rgba(45, 212, 191, 0.12)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                FAB: {fabSettings.mode === 'disabled' ? 'Hidden' : 'Floating Pill'}
              </span>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isWidgetExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isWidgetExpanded && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Customize the quick-access floating button on coding and problem pages.
              </div>

        {/* In-Page Popup Content Mode */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
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
                    <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>{item.label}</div>
                    <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Display Whitelist Mode Selection */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginBottom: '10px' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
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
                  <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>{opt.desc}</div>
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
                style={{ fontSize: 'var(--font-size-sm)', padding: '4px 8px', flex: 1 }}
               aria-label="Blocked site domain"/>
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
                    fontSize: 'var(--font-size-xs)',
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

        {/* Independent FAB Visibility Controls */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginBottom: '10px' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            🎛️ Independent FAB Toggles:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Main Synqto FAB Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  ⚡ Main Synqto FAB (Chat &amp; Whiteboard)
                </div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
                  Toggle the main floating button on web pages
                </div>
              </div>
              <input
                type="checkbox"
                checked={fabSettings.showMainFab !== false}
                onChange={(e) => {
                  const updated: FabSettings = { ...fabSettings, showMainFab: e.target.checked };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>

            {/* Focus Timer FAB Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  🚀 Focus Timer FAB (Rocket Racing &amp; Pomodoro)
                </div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
                  Toggle the standalone floating timer pill
                </div>
              </div>
              <input
                type="checkbox"
                checked={fabSettings.showTimerFab !== false}
                onChange={(e) => {
                  const updated: FabSettings = { ...fabSettings, showTimerFab: e.target.checked };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>

            {/* CodeTogether In-Page Dock Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-hover)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  👥 Code Together In-Page Dock (Draggable Sync Badge)
                </div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
                  Show floating collaborative editor sync dock on LeetCode/coding tabs (Off by default)
                </div>
              </div>
              <input
                type="checkbox"
                checked={Boolean(fabSettings.showCodeTogetherDock)}
                onChange={(e) => {
                  const updated: FabSettings = { ...fabSettings, showCodeTogetherDock: e.target.checked };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ synqto_code_together_dock_visible: e.target.checked });
                  }
                }}
                style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>

        {/* Draggable Position Mode */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
              📍 Independent Position Persistence:
            </div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const updated: FabSettings = {
                    ...fabSettings,
                    savedMainPosition: { right: 24, bottom: 24 },
                    savedPosition: { right: 24, bottom: 24 },
                  };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 5px', color: 'var(--primary)' }}
                title="Reset Main FAB position to bottom right"
              >
                Reset Main Pos
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const updated: FabSettings = {
                    ...fabSettings,
                    savedTimerPosition: { right: 140, bottom: 24 },
                  };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 5px', color: '#f43f5e' }}
                title="Reset Focus Timer FAB position"
              >
                Reset Timer Pos
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const updated: FabSettings = {
                    ...fabSettings,
                    savedCodeTogetherPosition: { top: 16, right: 90 },
                  };
                  setFabSettings(updated);
                  saveFabSettings(updated);
                }}
                style={{ fontSize: 'var(--font-size-2xs)', padding: '2px 5px', color: '#818cf8' }}
                title="Reset Code Together Dock position to top right"
              >
                Reset Dock Pos
              </button>
            </div>
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
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>📌 Permanent</div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Remember dragged locations independently</div>
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
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>⏱️ Temporary</div>
                <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Reset positions on reload</div>
              </div>
            </label>
          </div>
        </div>
            </>
          )}
        </div>
      )}

      {/* ─── 3. Focus Timer & Pomodoro (Turned on from settings) ─── */}
      {hasTimer && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: isTimerExpanded ? '10px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('timer')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isTimerExpanded ? '4px' : 0,
            }}
          >
            <div className="glass-card-title">
              <Clock size={15} color="#f43f5e" />
              <span>Focus Timer &amp; Pomodoro</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '2px 7px',
                  borderRadius: '10px',
                  background: timerConfig.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: timerConfig.enabled ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-subtle)',
                  color: timerConfig.enabled ? '#10b981' : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {timerConfig.enabled ? '● 25m Focus' : '○ Disabled'}
              </span>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isTimerExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isTimerExpanded && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '12px' }}>
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
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Enable Pomodoro &amp; Timer Bar
                  </div>
                  <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>
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
                      <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>🍅 Work (min)</label>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        className="input-glass"
                        style={{ width: '100%', fontSize: 'var(--font-size-sm)', padding: '4px 6px' }}
                        value={timerConfig.workDurationMin}
                        onChange={(e) => timerService.updateConfig({ workDurationMin: Math.max(1, parseInt(e.target.value) || 25) })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>☕ Break (min)</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        className="input-glass"
                        style={{ width: '100%', fontSize: 'var(--font-size-sm)', padding: '4px 6px' }}
                        value={timerConfig.shortBreakMin}
                        onChange={(e) => timerService.updateConfig({ shortBreakMin: Math.max(1, parseInt(e.target.value) || 5) })}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>🌴 Long Break</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        className="input-glass"
                        style={{ width: '100%', fontSize: 'var(--font-size-sm)', padding: '4px 6px' }}
                        value={timerConfig.longBreakMin}
                        onChange={(e) => timerService.updateConfig({ longBreakMin: Math.max(1, parseInt(e.target.value) || 15) })}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>🔔 Audio chime on session complete</span>
                    <input
                      type="checkbox"
                      checked={timerConfig.soundAlerts}
                      onChange={(e) => timerService.updateConfig({ soundAlerts: e.target.checked })}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── 4. Go Signaling Server Broker & Retry Connection ─── */}
      {hasServer && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: isServerExpanded ? '10px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('server')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isServerExpanded ? '4px' : 0,
            }}
          >
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
                  fontSize: 'var(--font-size-xs)',
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
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isServerExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isServerExpanded && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
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
                    style={{ flex: 1, fontSize: 'var(--font-size-sm)', padding: '6px 10px' }}
                   aria-label="wss://synqto-server.onrender.com/ws/"/>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveAndReconnect} title="Save URL &amp; Connect">
                    {savedUrl ? <Check size={13} /> : 'Save &amp; Connect'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleResetDefaultUrl}
                    style={{ fontSize: 'var(--font-size-xs)', padding: '4px 8px', color: 'var(--text-muted)' }}
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
                      fontSize: 'var(--font-size-sm)',
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
                      fontSize: 'var(--font-size-xs)',
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
            </>
          )}
        </div>
      )}

      {/* ─── 5. Privacy & Local Storage ─── */}
      {hasPrivacy && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: isPrivacyExpanded ? '10px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('privacy')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isPrivacyExpanded ? '4px' : 0,
            }}
          >
            <div className="glass-card-title">
              <Shield size={15} color="var(--accent-emerald)" />
              <span>Privacy &amp; Data Storage</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                Local P2P
              </span>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isPrivacyExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isPrivacyExpanded && (
            <>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Synqto operates 100% peer-to-peer. Messages, streaks, and personal diaries are stored locally in your browser.
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                  Reset local identity, streaks, and cached history
                </div>
                <button className="btn btn-danger btn-sm" onClick={handleClearData} style={{ fontSize: 'var(--font-size-sm)' }}>
                  <Trash2 size={12} />
                  <span>Clear Local Data</span>
                </button>
              </div>
              {clearedData && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-emerald)', marginTop: '4px' }}>
                  ✓ Local data cleared. Reloading...
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── 6. Diagnostics & Version ─── */}
      {hasAbout && (
        <div className="glass-card" style={{ background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: isAboutExpanded ? '8px' : '0' }}>
          <div
            className="glass-card-header"
            onClick={() => toggleCard('about')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
              marginBottom: isAboutExpanded ? '4px' : 0,
            }}
          >
            <div className="glass-card-title" style={{ fontSize: 'var(--font-size-md)' }}>
              <Info size={13} color="var(--text-muted)" />
              <span>About Synqto</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px' }}>
                v0.2.0
              </span>
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '4px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {isAboutExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>
          </div>

          {isAboutExpanded && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Version: <strong>{typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '0.2.0'} (The Trinity Architecture)</strong><br />
              Network Protocol: <strong>Dual-Leader P2P Mesh with WebRTC DataChannels</strong><br />
              Signaling: <strong>Go / Gorilla WebSocket Broker</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
