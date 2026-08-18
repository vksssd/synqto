// ─── Synqto Root App Shell ───

import React, { useState, useEffect } from 'react';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService } from '@/features/room/room.service';
import { GroupService } from '@/features/group/group.service';
import { DiscoveryService, OnlinePeer } from '@/features/discovery/discovery.service';
import { ChatService } from '@/features/chat/chat.service';
import { TopologyService } from '@/core/network/topology.service';
import { WhiteboardService } from '@/features/whiteboard/whiteboard.service';
import { NetworkService } from '@/core/network/network.service';
import { SignalingService } from '@/core/network/signaling.service';
import { GamificationService } from '@/features/gamification/gamification.service';
import { detectResource } from '@/content/resource-detector';
import { PeerIdentity } from '@/core/network/packet';
import { RoomContext } from '@/features/room/room-utils';

import { NavBar, NavTabType } from '@/features/navigation/NavBar';
import { ProblemRoomChatView } from '@/features/room/ProblemRoomChatView';
import { BoardAndDiaryContainer } from '@/features/whiteboard/BoardAndDiaryContainer';
import { GroupHubView } from '@/features/group/GroupHubView';
import { ProfileSettingsView } from '@/features/settings/ProfileSettingsView';
import { PeerListModal } from '@/features/discovery/PeerListModal';
import { ThemeService } from '@/features/settings/theme.service';
import { FocusTimerBar } from '@/features/timer/FocusTimerBar';
import { TimerService } from '@/features/timer/timer.service';
import { TimerState, PomodoroConfig } from '@/features/timer/timer.types';
import { Sparkles, RefreshCw, Palette, Crown, AlertTriangle, CheckCircle, Clock, Users } from 'lucide-react';

import { MicPermissionTab } from '@/features/voice/MicPermissionTab';
import { CoFocusLauncherModal } from '@/features/cofocus/CoFocusLauncherModal';
import { CoFocusWatcherView } from '@/features/cofocus/CoFocusWatcherView';
import { CoFocusSessionBar } from '@/features/cofocus/CoFocusSessionBar';

export const App: React.FC = () => {
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isMicPermission = urlParams?.get('requestMic') === '1' || urlParams?.get('micPermission') === '1';

  if (isMicPermission) {
    return <MicPermissionTab />;
  }

  return <MainApp />;
};

const MainApp: React.FC = () => {
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const themeService = ThemeService.getInstance();
  const identityService = IdentityService.getInstance();
  const roomService = RoomService.getInstance();
  const groupService = GroupService.getInstance();
  const discoveryService = DiscoveryService.getInstance();
  const chatService = ChatService.getInstance();
  const topologyService = TopologyService.getInstance();
  const gamificationService = GamificationService.getInstance();
  const signalingService = SignalingService.getInstance();
  const timerService = TimerService.getInstance();
  const whiteboardService = WhiteboardService.getInstance();
  const networkService = NetworkService.getInstance();

  const initialTab = (urlParams?.get('view') as NavTabType) || 'chat';
  const [currentTab, setCurrentTab] = useState<NavTabType>(initialTab);
  const [isConnected, setIsConnected] = useState(signalingService.getIsConnected());
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [serverToast, setServerToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [room, setRoom] = useState<RoomContext | null>(null);
  const [peers, setPeers] = useState<OnlinePeer[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLeader, setIsLeader] = useState(false);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [isPeerModalOpen, setIsPeerModalOpen] = useState(false);
  const [isCoFocusOpen, setIsCoFocusOpen] = useState(false);
  const [alertToast, setAlertToast] = useState<string | null>(null);
  const [currentStreak, setCurrentStreak] = useState(gamificationService.getStats().currentStreak);
  const [isDetecting, setIsDetecting] = useState(false);
  const [timerConfig, setTimerConfig] = useState<PomodoroConfig>(timerService.getConfig());
  const [timerState, setTimerState] = useState<TimerState>(timerService.getState());
  const [chatToast, setChatToast] = useState<{
    id: string;
    sender: { nickname: string; avatar: string; color?: string };
    text: string;
    isMention: boolean;
  } | null>(null);

  // Listen for Signaling connection changes
  useEffect(() => {
    let wasConnected = signalingService.getIsConnected();
    return signalingService.on('connection:change', (data: { connected: boolean }) => {
      setIsConnected(data.connected);
      if (data.connected && !wasConnected) {
        setServerToast({
          message: '⚡ Connected to Synqto Server! Mesh Active',
          type: 'success',
        });
        setTimeout(() => {
          setServerToast(null);
        }, 3200);
      }
      wasConnected = data.connected;
    });
  }, []);

  // 1. Initialize identity & listen for changes
  useEffect(() => {
    identityService.getOrCreateIdentity().then((id) => setIdentity(id));
    return identityService.onChange((id) => {
      setIdentity(id);

      // Push the new identity onto the wire.
      //
      // Identity is cached at init() time by NetworkService, PacketPipeline and
      // TopologyService. Without this, renaming yourself updated only local UI: every packet
      // you sent afterwards still carried the old nickname, so peers kept seeing the previous
      // name in chat, presence and cursors until a room switch happened to re-init.
      networkService.updateIdentity(id);

      // Presence is the field peers actually render in the roster, and it is only refreshed on
      // ping. Nudging it here means the rename shows up for others within a beat rather than
      // waiting up to the 5s heartbeat interval.
      discoveryService.refreshPresence();
    });
  }, []);

  // 2. Listen for Room context changes
  useEffect(() => {
    return roomService.onChange((r) => {
      setRoom(r);

      // Point the SHARED whiteboard at this room.
      //
      // The collaborative notebook was previously global and never re-scoped, so strokes drawn
      // in one room stayed in memory and — because a newly joined peer's sync_request is
      // answered with the whole local notebook — were transmitted into the next room the user
      // entered. Binding it to the room here is what keeps a board private to its room.
      void whiteboardService.setRoom(r?.roomId || '');

      if (r) {
        gamificationService.recordProblemVisit(r.slug);
        groupService.registerProblemGroup({
          platform: r.platform,
          slug: r.slug,
          title: r.title,
          canonicalUrl: r.canonicalUrl,
          roomId: r.roomId,
        });
      }
    });
  }, []);

  // 3. Listen for Online Peers
  useEffect(() => {
    return discoveryService.onChange((p) => {
      setPeers(p);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({
          synqto_peer_count: p.length + 1,
          nerd_buddy_peer_count: p.length + 1,
        });
      }
    });
  }, []);

  // 4. Listen for unread chat messages and rich toast notifications
  useEffect(() => {
    const unsubUnread = chatService.onUnreadChange((count) => setUnreadCount(count));
    const unsubToast = chatService.onNotificationToast((notif) => {
      if (currentTab !== 'chat' || notif.isMention) {
        setChatToast({
          id: notif.id,
          sender: notif.sender,
          text: notif.text,
          isMention: notif.isMention,
        });

        setTimeout(() => {
          setChatToast((prev) => (prev?.id === notif.id ? null : prev));
        }, 4500);
      }
    });

    return () => {
      unsubUnread();
      unsubToast();
    };
  }, [currentTab]);

  // 5. Listen for Topology state (Role & Leader ID)
  useEffect(() => {
    return topologyService.onStateChange((state) => {
      setIsLeader(state.isLeader);
      setLeaderId(state.assignedLeader);
      if (state.isLeader) {
        gamificationService.unlockCustomBadge('mesh_leader');
      }
    });
  }, []);

  // 6. Listen for Streak updates
  useEffect(() => {
    return gamificationService.onChange((stats) => {
      setCurrentStreak(stats.currentStreak);
    });
  }, []);

  // 6.1 Listen for Focus Timer & Pomodoro changes
  useEffect(() => {
    return timerService.onChange((state, config) => {
      setTimerState(state);
      setTimerConfig(config);
    });
  }, []);

  const showToast = (msg: string) => {
    setAlertToast(msg);
    setTimeout(() => {
      setAlertToast(null);
    }, 3000);
  };

  // 7. Listen for incoming Alerts (Wave / Poke)
  useEffect(() => {
    return discoveryService.onAlert((alert) => {
      showToast(alert.text);
    });
  }, []);

  // 8. Track active problem from Chrome storage
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        synqto_sidepanel_open: true,
        nerd_buddy_sidepanel_open: true,
      });

      chrome.storage.local.get(['synqto_active_problem', 'nerd_buddy_active_problem'], (res) => {
        const p = res.synqto_active_problem || res.nerd_buddy_active_problem;
        if (p) {
          roomService.joinProblemRoom(p.platform, p.slug, p.title, p.canonicalUrl);
        }
      });

      const handleStorageChange = (changes: any, area: string) => {
        if (area === 'local') {
          const problemChange = changes.synqto_active_problem || changes.nerd_buddy_active_problem;
          if (problemChange?.newValue) {
            // Never auto-switch rooms out from under a live CoFocus session.
            //
            // Hiding the Detect button was not sufficient: this listener fires on ordinary
            // browsing, so someone 20 minutes into a Together session who opens a LeetCode tab
            // in the background would be silently pulled out of it — camera and partner gone,
            // no prompt, no explanation. Auto-detection is a convenience and must yield to an
            // explicit session the user deliberately started.
            if (roomService.getCurrentRoom()?.cofocusMode) return;

            const p = problemChange.newValue;
            roomService.joinProblemRoom(p.platform, p.slug, p.title, p.canonicalUrl);
          }
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.local.set({
          synqto_sidepanel_open: false,
          nerd_buddy_sidepanel_open: false,
        });
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  // 8.1 Honour a "open CoFocus" request from the in-page FAB.
  //
  // FAB-only users never open the side panel by hand, so without a route from the widget the
  // whole feature was unreachable for them. The FAB asks the service worker to open the panel
  // with this flag; we consume it once on mount and again if it arrives while the panel is
  // already open, then clear it so it cannot re-trigger on later opens.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    const consume = (value: unknown) => {
      if (!value) return;
      setIsCoFocusOpen(true);
      chrome.storage.local.remove('synqto_open_cofocus');
    };

    chrome.storage.local.get(['synqto_open_cofocus'], (res) => consume(res.synqto_open_cofocus));

    const onChanged = (changes: any, area: string) => {
      if (area === 'local' && changes.synqto_open_cofocus?.newValue) {
        consume(changes.synqto_open_cofocus.newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // 9. Listen for in-page chat messages from floating widget
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      const handleRuntimeMsg = (msg: any) => {
        if (msg.type === 'SEND_PAGE_CHAT_MESSAGE' && msg.text) {
          identityService.getOrCreateIdentity().then((myId) => {
            chatService.sendMessage(
              msg.text,
              myId,
              msg.replyTo ? { id: msg.replyTo, preview: msg.replyPreview } : undefined,
              msg.messageId
            );
            gamificationService.recordMessageSent();
          });
        }
      };
      chrome.runtime.onMessage.addListener(handleRuntimeMsg);
      return () => {
        chrome.runtime.onMessage.removeListener(handleRuntimeMsg);
      };
    }
  }, []);

  // Force Detect Problem on Active Foreground Tab
  const handleForceDetectProblem = () => {
    setIsDetecting(true);

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url) {
          const resource = detectResource(activeTab.url, activeTab.title);
          if (resource) {
            await roomService.joinProblemRoom(
              resource.platform,
              resource.slug,
              resource.title,
              resource.canonicalUrl
            );
            groupService.registerProblemGroup({
              platform: resource.platform,
              slug: resource.slug,
              title: resource.title,
              canonicalUrl: resource.canonicalUrl,
              roomId: roomService.getCurrentRoom()?.roomId || `room:${resource.slug}`,
            });
            setCurrentTab('chat');
            showToast(`✨ Detected ${resource.platform}: ${resource.title}`);
          } else {
            try {
              const host = new URL(activeTab.url).hostname;
              showToast(`ℹ️ No standard problem on ${host}. Created lounge.`);
              await roomService.joinCustomRoom(host.replace(/\./g, '-'));
              setCurrentTab('chat');
            } catch (e) {
              showToast('ℹ️ Open a LeetCode or Codeforces tab to auto-detect.');
            }
          }
        } else {
          showToast('ℹ️ No active tab detected.');
        }
        setTimeout(() => setIsDetecting(false), 500);
      });
    } else {
      showToast('✨ Test problem detection active');
      setIsDetecting(false);
    }
  };

  const handleManualReconnect = () => {
    if (isReconnecting) return;
    setIsReconnecting(true);
    showToast('🔄 Connecting to signaling server...');
    signalingService.reconnect(room?.roomId, identity?.peerId, identity?.nickname);
    setTimeout(() => {
      setIsReconnecting(false);
      if (signalingService.getIsConnected()) {
        setServerToast({
          message: '⚡ Connected to Synqto Server! Mesh Active',
          type: 'success',
        });
        setTimeout(() => setServerToast(null), 3200);
      } else {
        showToast('⚠️ Unable to connect to server. Running in local mode.');
      }
    }, 1800);
  };

  return (
    <div className="app-container">
      {/* Top Header Bar with Red Highlight when Disconnected */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: isConnected ? '1px solid var(--border-subtle)' : '1px solid rgba(239, 68, 68, 0.45)',
          background: isConnected
            ? 'var(--bg-surface)'
            : 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(185, 28, 28, 0.16))',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
          transition: 'all 0.3s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: 'var(--font-size-lg)' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Synqto
          </span>
          <span
            className={`status-dot ${isConnected ? 'pulse' : ''}`}
            style={{
              width: '7px',
              height: '7px',
              background: isConnected ? '#10b981' : '#ef4444',
              boxShadow: isConnected ? '0 0 8px #10b981' : '0 0 8px #ef4444',
              marginLeft: '2px',
            }}
            title={isConnected ? 'Signaling Server: Connected (wss://synqto-server.onrender.com/ws/)' : 'Signaling Server: Disconnected (Offline Mode)'}
          />
          <span
            onClick={!isConnected ? handleManualReconnect : undefined}
            style={{
              fontSize: 'var(--font-size-2xs)',
              padding: '1px 5px',
              borderRadius: '4px',
              background: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.2)',
              border: isConnected ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.4)',
              color: isConnected ? '#34d399' : '#fca5a5',
              fontWeight: 700,
              cursor: isConnected ? 'default' : 'pointer',
            }}
            title={isConnected ? 'Signaling Server: Connected' : 'Server Offline - Click to Reconnect ⚡'}
          >
            {isConnected ? 'Server Online' : (isReconnecting ? 'Connecting...' : 'Offline (Retry ⚡)')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Top Bar Quick-Launch Focus Timer & Pomodoro Button */}
          <button
            type="button"
            className={`btn ${timerConfig.enabled ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => timerService.setEnabled(!timerConfig.enabled)}
            title={timerConfig.enabled ? 'Focus Timer is Active (Click to Hide)' : 'Enable Pomodoro Focus Timer & Stopwatch'}
            style={{
              fontSize: 'var(--font-size-sm)',
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: timerConfig.enabled ? 'linear-gradient(135deg, #f43f5e, #e11d48)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: timerConfig.enabled ? 'transparent' : 'rgba(244, 63, 94, 0.35)',
              color: timerConfig.enabled ? '#ffffff' : '#fca5a5',
            }}
          >
            <Clock size={12} />
            <span>
              {timerConfig.enabled
                ? timerState.isRunning
                  ? `🍅 ${Math.floor(timerState.timeLeftSec / 60)}:${(timerState.timeLeftSec % 60).toString().padStart(2, '0')}`
                  : 'Timer 🍅'
                : 'Timer ⏱️'}
            </span>
          </button>

          {/*
            Top Bar Quick-Launch Whiteboard Button.

            Hidden during a Watcher session for the same reason the bottom nav is: that view
            replaces the whole tabbed surface, so this would set a tab that cannot render —
            a control that visibly does nothing.
          */}
          {room?.cofocusMode !== 'WATCHER' && (
          <button
            type="button"
            className={`btn ${currentTab === 'whiteboard' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setCurrentTab(currentTab === 'whiteboard' ? 'chat' : 'whiteboard')}
            title="Open Collaborative Whiteboard & Private Diary"
            style={{
              fontSize: 'var(--font-size-sm)',
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: currentTab === 'whiteboard' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: currentTab === 'whiteboard' ? 'transparent' : 'rgba(99, 102, 241, 0.35)',
              color: currentTab === 'whiteboard' ? '#ffffff' : '#c4b5fd',
            }}
          >
            <Palette size={12} />
            <span>{currentTab === 'whiteboard' ? 'Exit Board' : 'Board 🎨'}</span>
          </button>
          )}

          {/* Top Bar Quick-Launch CoFocus (Study Partner Matchmaking) Button */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsCoFocusOpen(true)}
            title="CoFocus — find a study partner (Watcher or Together)"
            style={{
              fontSize: 'var(--font-size-sm)',
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: room?.cofocusMode ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: room?.cofocusMode ? 'transparent' : 'rgba(99, 102, 241, 0.35)',
              color: room?.cofocusMode ? '#ffffff' : '#c4b5fd',
            }}
          >
            <Users size={12} />
            <span>CoFocus 🎯</span>
          </button>

          {/*
            Detect Active Tab Button.

            Hidden during ANY CoFocus session (Watcher or Together), because detecting joins a
            problem room — which tears down the CoFocus room out from under a live session with
            no warning and no confirmation. That is destructive rather than merely dead, so it
            is removed for the duration rather than left to surprise someone mid-session.
          */}
          {!room?.cofocusMode && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleForceDetectProblem}
            disabled={isDetecting}
            title="Force scan active tab to auto-detect and join problem room"
            style={{
              fontSize: 'var(--font-size-sm)',
              padding: '3px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: isDetecting ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
              borderColor: 'rgba(99, 102, 241, 0.35)',
              color: '#c4b5fd',
            }}
          >
            <RefreshCw
              size={12}
              color="var(--primary)"
              style={{
                animation: isDetecting ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>{isDetecting ? 'Scanning...' : 'Detect'}</span>
          </button>
          )}
        </div>
      </header>

      {/* ─── Server Disconnected Red Banner with "Try Again" Click ─── */}
      {!isConnected && (
        <div
          onClick={handleManualReconnect}
          style={{
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            color: '#ffffff',
            padding: '7px 12px',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.2s ease',
          }}
          title="Click to reconnect to the signaling server"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Unable to connect to server (Offline Mode)
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '2px 8px',
              borderRadius: '5px',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <RefreshCw size={10} style={{ animation: isReconnecting ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isReconnecting ? 'Connecting...' : 'Try again'}</span>
          </div>
        </div>
      )}

      {/* ─── Green Vanishing Toast on Server Connection Established ─── */}
      {serverToast && (
        <div
          style={{
            position: 'absolute',
            top: '46px',
            left: '12px',
            right: '12px',
            zIndex: 70,
            background: serverToast.type === 'success'
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.96), rgba(5, 150, 105, 0.96))'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.96), rgba(220, 38, 38, 0.96))',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            boxShadow: serverToast.type === 'success'
              ? '0 10px 25px -5px rgba(16, 185, 129, 0.5), 0 0 15px rgba(16, 185, 129, 0.3)'
              : '0 10px 25px -5px rgba(239, 68, 68, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 600,
            animation: 'slideDown 0.2s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {serverToast.type === 'success' ? <CheckCircle size={14} color="#ffffff" /> : <AlertTriangle size={14} color="#ffffff" />}
            <span>{serverToast.message}</span>
          </div>
          <span style={{ fontSize: 'var(--font-size-xs)', background: 'rgba(0,0,0,0.25)', padding: '2px 6px', borderRadius: '4px', color: '#fff' }}>
            P2P Active 🌐
          </span>
        </div>
      )}

      {/* Alert Banner / Toast */}
      {alertToast && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            left: '12px',
            right: '12px',
            zIndex: 60,
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(139, 92, 246, 0.95))',
            color: '#ffffff',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: 'var(--font-size-md)',
            fontWeight: 500,
            animation: 'slideUp 0.2s ease-out',
          }}
        >
          <Sparkles size={14} color="#fef08a" />
          <span>{alertToast}</span>
        </div>
      )}

      {/* Rich Chat & Mention Toast Notification */}
      {chatToast && (
        <div
          onClick={() => {
            setCurrentTab('chat');
            setChatToast(null);
            chatService.markAsRead();
          }}
          style={{
            position: 'absolute',
            top: '46px',
            left: '10px',
            right: '10px',
            zIndex: 65,
            background: chatToast.isMention
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95))'
              : 'var(--bg-surface-elevated)',
            border: chatToast.isMention ? '1px solid #fde68a' : '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            padding: '8px 12px',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            cursor: 'pointer',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: chatToast.sender.color || '#6366f1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--font-size-lg)',
                flexShrink: 0,
              }}
            >
              {chatToast.sender.avatar}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-sm)', color: '#f8fafc' }}>
                  {chatToast.sender.nickname}
                </span>
                {chatToast.isMention && (
                  <span
                    style={{
                      background: 'rgba(0,0,0,0.3)',
                      color: '#fef08a',
                      fontSize: 'var(--font-size-2xs)',
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      textTransform: 'uppercase',
                    }}
                  >
                    📣 Mention
                  </span>
                )}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-sm)',
                  color: 'rgba(255,255,255,0.85)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '200px',
                }}
              >
                {chatToast.text}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setChatToast(null);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              padding: '2px',
              fontSize: 'var(--font-size-md)',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="main-content">
        {/* Floating Focus Timer / Pomodoro (Visible only when enabled in Settings) */}
        <FocusTimerBar />

        {/*
          0. CoFocus Watcher takes over the whole surface.

          Watcher is silent camera-only body doubling, so it deliberately bypasses the tabbed
          room UI entirely — mounting chat/whiteboard/voice here would contradict the mode's
          entire promise. TOGETHER sessions are NOT special-cased: they fall through to
          ProblemRoomChatView below and get the full existing collaboration surface unchanged,
          which is exactly the intent (CoFocus decides how a room is reached, not what a
          collaborative room can do).
        */}
        {room?.cofocusMode === 'WATCHER' ? (
          <CoFocusWatcherView room={room} identity={identity} />
        ) : (
          <>
            {/*
              Together sessions reuse the whole normal room surface, which has no concept of a
              CoFocus session — so the countdown the user chose in the launcher would otherwise
              be invisible. This thin bar surfaces the timer, partner presence and a way out
              without touching ProblemRoomChatView's internals.
            */}
            {room?.cofocusMode === 'TOGETHER' && <CoFocusSessionBar />}

            {/* 1. Default Screen: Active Problem Room & Real-time P2P Chat */}
            {currentTab === 'chat' && (
              <ProblemRoomChatView
                room={room}
                identity={identity}
                peers={peers}
                isLeader={isLeader}
                onOpenPeers={() => setIsPeerModalOpen(true)}
              />
            )}

        {/* 2. Full Collaborative Whiteboard & Personal Diary Screen */}
        {currentTab === 'whiteboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <BoardAndDiaryContainer />
          </div>
        )}

        {/* 2. Squads / Communities Hub */}
        {currentTab === 'groups' && (
          <GroupHubView
            currentRoom={room}
            onOpenChat={() => {
              setCurrentTab('chat');
              chatService.markAsRead();
            }}
          />
        )}

        {/* 3. Online Buddies Roster */}
        {currentTab === 'peers' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="glass-card-title">
              <span>Online Study Buddies ({peers.length + 1})</span>
            </div>

            {/* 1. Self Entry (You) */}
            <div
              className="glass-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.12))',
                border: '1px solid rgba(99, 102, 241, 0.45)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: identity?.color || '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                  }}
                >
                  {identity?.avatar || '⚡'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 700, color: '#ffffff', fontSize: 'var(--font-size-md)' }}>
                      {identity?.nickname || 'You'}
                    </span>
                    <span
                      style={{
                        background: 'rgba(16, 185, 129, 0.2)',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        color: '#34d399',
                        fontSize: 'var(--font-size-2xs)',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                      }}
                    >
                      You
                    </span>
                    {isLeader && (
                      <span title="Cluster Mesh Leader" style={{ color: '#fbbf24' }}>
                        <Crown size={13} />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                    Status: Active • You
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 'var(--font-size-sm)', color: '#a5b4fc', fontWeight: 600 }}>
                (Self)
              </span>
            </div>

            {peers.map((peer) => (
              <div
                key={peer.identity.peerId}
                className="glass-card"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: peer.identity.color || '#6366f1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                    }}
                  >
                    {peer.identity.avatar}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: 'var(--font-size-md)' }}>
                      {peer.identity.nickname}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
                      Status: {peer.status}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => discoveryService.sendWave(peer.identity.peerId)}
                    title="Wave"
                  >
                    👋
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => discoveryService.sendPoke(peer.identity.peerId)}
                    title="Poke"
                  >
                    👉
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 4. Merged Profile, GitHub-style Streak Board, Badges & Settings */}
        {currentTab === 'profile' && (
          <ProfileSettingsView isLeader={isLeader} />
        )}
          </>
        )}
      </main>

      {/* CoFocus Launcher (Watcher / Together / Invite) */}
      <CoFocusLauncherModal isOpen={isCoFocusOpen} onClose={() => setIsCoFocusOpen(false)} />

      {/* Online Peer Roster Modal */}
      <PeerListModal
        isOpen={isPeerModalOpen}
        onClose={() => setIsPeerModalOpen(false)}
        peers={peers}
        myPeerId={identity?.peerId || ''}
        myIdentity={identity}
        leaderId={leaderId}
      />

      {/*
        Persistent Bottom Nav (4-Tab Layout).

        Hidden during a Watcher session: that view replaces the entire tabbed surface, so the
        tabs would be dead controls that change state without rendering anything. Together
        sessions keep the nav, since they use the normal room surface.
      */}
      {room?.cofocusMode !== 'WATCHER' && (
        <NavBar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setCurrentTab(tab);
            if (tab === 'chat') {
              chatService.markAsRead();
            }
          }}
          unreadCount={unreadCount}
          peerCount={peers.length}
        />
      )}
    </div>
  );
};
