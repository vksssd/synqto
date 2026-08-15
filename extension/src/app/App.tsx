// ─── Nerd Buddy Root App Shell ───

import React, { useState, useEffect } from 'react';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService } from '@/features/room/room.service';
import { GroupService } from '@/features/group/group.service';
import { DiscoveryService, OnlinePeer } from '@/features/discovery/discovery.service';
import { ChatService } from '@/features/chat/chat.service';
import { TopologyService } from '@/core/network/topology.service';
import { GamificationService } from '@/features/gamification/gamification.service';
import { detectResource } from '@/content/resource-detector';
import { PeerIdentity } from '@/core/network/packet';
import { RoomContext } from '@/features/room/room-utils';

import { NavBar, NavTabType } from '@/features/navigation/NavBar';
import { ProblemRoomChatView } from '@/features/room/ProblemRoomChatView';
import { WhiteboardCanvas } from '@/features/whiteboard/WhiteboardCanvas';
import { GroupHubView } from '@/features/group/GroupHubView';
import { ProfileSettingsView } from '@/features/settings/ProfileSettingsView';
import { PeerListModal } from '@/features/discovery/PeerListModal';
import { Sparkles, RefreshCw, Radio, Palette } from 'lucide-react';

export const App: React.FC = () => {
  const identityService = IdentityService.getInstance();
  const roomService = RoomService.getInstance();
  const groupService = GroupService.getInstance();
  const discoveryService = DiscoveryService.getInstance();
  const chatService = ChatService.getInstance();
  const topologyService = TopologyService.getInstance();
  const gamificationService = GamificationService.getInstance();

  const [currentTab, setCurrentTab] = useState<NavTabType>('chat');
  const [identity, setIdentity] = useState<PeerIdentity | null>(null);
  const [room, setRoom] = useState<RoomContext | null>(null);
  const [peers, setPeers] = useState<OnlinePeer[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLeader, setIsLeader] = useState(false);
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [isPeerModalOpen, setIsPeerModalOpen] = useState(false);
  const [alertToast, setAlertToast] = useState<string | null>(null);
  const [currentStreak, setCurrentStreak] = useState(gamificationService.getStats().currentStreak);
  const [isDetecting, setIsDetecting] = useState(false);

  // 1. Initialize identity & listen for changes
  useEffect(() => {
    identityService.getOrCreateIdentity().then((id) => setIdentity(id));
    return identityService.onChange((id) => setIdentity(id));
  }, []);

  // 2. Listen for Room context changes
  useEffect(() => {
    return roomService.onChange((r) => {
      setRoom(r);
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
        chrome.storage.local.set({ nerd_buddy_peer_count: p.length + 1 });
      }
    });
  }, []);

  // 4. Listen for unread chat messages
  useEffect(() => {
    return chatService.onUnreadChange((count) => setUnreadCount(count));
  }, []);

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
      chrome.storage.local.set({ nerd_buddy_sidepanel_open: true });

      chrome.storage.local.get(['nerd_buddy_active_problem'], (res) => {
        if (res.nerd_buddy_active_problem) {
          const p = res.nerd_buddy_active_problem;
          roomService.joinProblemRoom(p.platform, p.slug, p.title, p.canonicalUrl);
        }
      });

      const handleStorageChange = (changes: any, area: string) => {
        if (area === 'local' && changes.nerd_buddy_active_problem?.newValue) {
          const p = changes.nerd_buddy_active_problem.newValue;
          roomService.joinProblemRoom(p.platform, p.slug, p.title, p.canonicalUrl);
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.local.set({ nerd_buddy_sidepanel_open: false });
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
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

  return (
    <div className="app-container">
      {/* Top Header Bar with Brand, Whiteboard & Force Detect Button */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '15px' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc', letterSpacing: '-0.01em' }}>
            Synqto
          </span>
          <span
            className="status-dot pulse"
            style={{ width: '6px', height: '6px', background: '#10b981', marginLeft: '2px' }}
            title="P2P Mesh Network Ready"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Top Bar Quick-Launch Whiteboard Button */}
          <button
            type="button"
            className={`btn ${currentTab === 'whiteboard' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setCurrentTab(currentTab === 'whiteboard' ? 'chat' : 'whiteboard')}
            title="Open Collaborative Whiteboard"
            style={{
              fontSize: '11px',
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
            <span>{currentTab === 'whiteboard' ? 'Exit Board' : 'Whiteboard 🎨'}</span>
          </button>

          {/* Detect Active Tab Button */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleForceDetectProblem}
            disabled={isDetecting}
            title="Force scan active tab to auto-detect and join problem room"
            style={{
              fontSize: '11px',
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
        </div>
      </header>

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
            fontSize: '12px',
            fontWeight: 500,
            animation: 'slideUp 0.2s ease-out',
          }}
        >
          <Sparkles size={14} color="#fef08a" />
          <span>{alertToast}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="main-content">
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

        {/* 2. Full Collaborative Whiteboard Screen */}
        {currentTab === 'whiteboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px' }}>
            <WhiteboardCanvas />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="glass-card-title">
              <span>Online Study Buddies ({peers.length + 1})</span>
            </div>
            {peers.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                You are currently the only one in this room.
              </div>
            ) : (
              peers.map((peer) => (
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
                      <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '13px' }}>
                        {peer.identity.nickname}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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
              ))
            )}
          </div>
        )}

        {/* 4. Merged Profile, GitHub-style Streak Board, Badges & Settings */}
        {currentTab === 'profile' && (
          <ProfileSettingsView isLeader={isLeader} />
        )}
      </main>

      {/* Online Peer Roster Modal */}
      <PeerListModal
        isOpen={isPeerModalOpen}
        onClose={() => setIsPeerModalOpen(false)}
        peers={peers}
        myPeerId={identity?.peerId || ''}
        leaderId={leaderId}
      />

      {/* Persistent Bottom Nav (4-Tab Layout) */}
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
        currentStreak={currentStreak}
      />
    </div>
  );
};
