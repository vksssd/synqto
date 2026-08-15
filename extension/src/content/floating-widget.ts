// ─── In-Browser Floating Action Button, Problem Chat, Draggable Positioning & Collaborative Whiteboard Popup ───

import { FabSettings, DEFAULT_FAB_SETTINGS, FAB_STORAGE_KEY, SYNQTO_FAB_STORAGE_KEY, FabPosition } from '@/features/settings/fab-settings.types';
import { detectResource } from './resource-detector';
import { getPlatformBadgeColor, computeRoomId } from '@/features/room/room-utils';

interface ChatMessageData {
  id: string;
  from: {
    nickname: string;
    avatar: string;
    color: string;
    peerId: string;
  };
  text: string;
  timestamp: number;
  replyTo?: string;
  replyPreview?: string;
  status?: 'pending' | 'sent' | 'delivered' | 'read';
  isSelf?: boolean;
}

interface WhiteboardPoint {
  x: number;
  y: number;
}

interface InPageStroke {
  id: string;
  tool: 'pen' | 'brush' | 'highlighter' | 'temp_pen' | 'laser' | 'torch' | 'eraser' | 'line' | 'arrow' | 'rect' | 'circle' | 'tree_node' | 'db_cylinder' | 'cloud' | 'load_balancer' | 'message_queue' | 'server_box' | 'text';
  color: string;
  width: number;
  opacity: number;
  points: WhiteboardPoint[];
  geometry?: { x1: number; y1: number; x2: number; y2: number; label?: string };
  text?: string;
  expiresAt?: number;
}

export class FloatingWidget {
  private hostElement: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private isOpen = false;
  private settings: FabSettings = DEFAULT_FAB_SETTINGS;
  private currentProblem: { platform: string; slug: string; title: string; canonicalUrl: string; roomId: string } | null = null;
  private messages: ChatMessageData[] = [];
  private unreadCount = 0;
  private currentRoomStorageKey = '';
  private myIdentity: { nickname: string; avatar: string; color: string; peerId: string } | null = null;
  private liveStage: any = null;
  private peerCount = 1;
  private replyingTo: ChatMessageData | null = null;
  private revealedSpoilers: Record<string, boolean> = {};

  // Draggable Position State
  private currentPosition: FabPosition = { right: 24, bottom: 24 };
  private isDragging = false;
  private dragMoved = false;
  private popupSize: 'compact' | 'medium' | 'large' | 'fullscreen' = 'compact';

  // Whiteboard State
  private activeTab: 'chat' | 'whiteboard' = 'chat';
  private wbTool: 'pen' | 'brush' | 'highlighter' | 'temp_pen' | 'laser' | 'torch' | 'eraser' | 'line' | 'arrow' | 'rect' | 'circle' | 'tree_node' | 'db_cylinder' | 'cloud' | 'load_balancer' | 'message_queue' | 'server_box' | 'text' = 'pen';
  private toolStyles: Record<string, { color: string; width: number }> = {
    pen: { color: '#6366f1', width: 3 },
    brush: { color: '#06b6d4', width: 6 },
    highlighter: { color: '#f59e0b', width: 16 },
    temp_pen: { color: '#38bdf8', width: 3 },
    laser: { color: '#ef4444', width: 3 },
    torch: { color: '#facc15', width: 65 },
    eraser: { color: '#ffffff', width: 18 },
    text: { color: '#ffffff', width: 3 },
    line: { color: '#6366f1', width: 3 },
    arrow: { color: '#6366f1', width: 3 },
    rect: { color: '#6366f1', width: 3 },
    circle: { color: '#6366f1', width: 3 },
    tree_node: { color: '#10b981', width: 3 },
    db_cylinder: { color: '#10b981', width: 2.5 },
    cloud: { color: '#38bdf8', width: 2.5 },
    load_balancer: { color: '#f59e0b', width: 2.5 },
    message_queue: { color: '#a855f7', width: 2.5 },
    server_box: { color: '#818cf8', width: 2.5 },
  };
  private wbColor: string = '#6366f1';
  private wbWidth: number = 3;
  private wbTheme: 'grid' | 'ruled' | 'blank' | 'dotted' | 'plot' | 'matrix' | 'white_blank' = 'grid';
  private wbBgColor: string = '#090d16';
  private wbPrivacyMode: 'collaborative' | 'personal' = 'collaborative';
  private wbStrokes: InPageStroke[] = [];
  private wbPersonalStrokes: InPageStroke[] = [];
  private wbRedoStack: InPageStroke[] = [];
  private isWbDrawing: boolean = false;
  private wbCurrentPoints: WhiteboardPoint[] = [];
  private wbStartPoint: WhiteboardPoint | null = null;
  private tempDisappearingStrokes: { stroke: InPageStroke; createdAt: number; durationMs: number }[] = [];
  private wbLaserTrails: { x: number; y: number; alpha: number; timestamp: number }[] = [];
  private wbTorchPos: WhiteboardPoint | null = null;
  private wbEraserPos: WhiteboardPoint | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    await this.loadIdentity();
    await this.loadSettings();
    this.detectCurrentPageProblem();
    this.checkVisibilityAndRender();
    this.listenToStorageChanges();
    this.listenForRuntimeMessages();
  }

  private async loadIdentity() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(['synqto_identity', 'nerd_buddy_identity']);
      if (res.synqto_identity || res.nerd_buddy_identity) {
        this.myIdentity = res.synqto_identity || res.nerd_buddy_identity;
      }
    }

    if (!this.myIdentity) {
      this.myIdentity = {
        peerId: 'peer-' + Math.random().toString(36).slice(2, 10),
        nickname: 'Coder' + Math.floor(Math.random() * 900 + 100),
        avatar: '⚡',
        color: '#6366f1',
      };
    }
  }

  private async loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        FAB_STORAGE_KEY,
        SYNQTO_FAB_STORAGE_KEY,
        'synqto_active_problem',
        'nerd_buddy_active_problem',
        'synqto_live_stage',
        'nerd_buddy_live_stage',
        'nerd_buddy_sidepanel_open',
        'nerd_buddy_peer_count',
      ]);

      if (res[SYNQTO_FAB_STORAGE_KEY] || res[FAB_STORAGE_KEY]) {
        this.settings = { ...DEFAULT_FAB_SETTINGS, ...(res[SYNQTO_FAB_STORAGE_KEY] || res[FAB_STORAGE_KEY]) };
      }

      // Initialize position based on persistence mode
      if (this.settings.positionMode === 'permanent' && this.settings.savedPosition) {
        this.currentPosition = { ...this.settings.savedPosition };
      } else {
        this.currentPosition = { right: 24, bottom: 24 };
      }

      const problem = res.synqto_active_problem || res.nerd_buddy_active_problem;
      if (problem) {
        this.currentProblem = problem;
        this.currentRoomStorageKey = `synqto_chat_${this.currentProblem?.roomId || ''}`;
        await this.loadMessages();
      }
      if (res.synqto_live_stage || res.nerd_buddy_live_stage) {
        this.liveStage = res.synqto_live_stage || res.nerd_buddy_live_stage;
      }
      if (typeof res.nerd_buddy_peer_count === 'number') {
        this.peerCount = Math.max(1, res.nerd_buddy_peer_count);
      }
    }
  }

  private detectCurrentPageProblem() {
    const detected = detectResource(window.location.href, document.title);
    if (detected) {
      const roomId = computeRoomId(detected.slug, detected.canonicalUrl);
      this.currentProblem = {
        platform: detected.platform,
        slug: detected.slug,
        title: detected.title,
        canonicalUrl: detected.canonicalUrl,
        roomId,
      };
      this.currentRoomStorageKey = `synqto_chat_${roomId}`;
      this.loadMessages();
    }
  }

  private shouldShow(): boolean {
    if (this.settings.mode === 'disabled' || this.settings.popupContentMode === 'none') return false;
    if (this.settings.mode === 'all_sites') return true;

    const hostname = window.location.hostname.toLowerCase();

    if (this.settings.mode === 'custom_sites') {
      return this.settings.customDomains.some((d) => hostname.includes(d.toLowerCase()));
    }

    // Default 'coding_sites' mode
    const codingDomains = [
      'leetcode.com',
      'neetcode.io',
      'codeforces.com',
      'hackerrank.com',
      'geeksforgeeks.org',
      'codechef.com',
      'atcoder.jp',
      'github.com',
      'youtube.com',
      'arxiv.org',
    ];

    const isCodingDomain = codingDomains.some((d) => hostname.includes(d));
    const isDetected = Boolean(this.currentProblem || detectResource(window.location.href));
    return isCodingDomain || isDetected;
  }

  private checkVisibilityAndRender() {
    const shouldDisplay = this.shouldShow();

    if (shouldDisplay && !this.hostElement) {
      this.createWidgetDOM();
    } else if (!shouldDisplay && this.hostElement) {
      this.destroyWidgetDOM();
    }
  }

  private destroyWidgetDOM() {
    if (this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
      this.shadow = null;
    }
  }

  private createWidgetDOM() {
    if (document.getElementById('synqto-floating-host')) return;

    const host = document.createElement('div');
    host.id = 'synqto-floating-host';
    host.style.cssText = `
      position: fixed;
      bottom: ${this.currentPosition.bottom}px;
      right: ${this.currentPosition.right}px;
      z-index: 2147483640;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      touch-action: none;
    `;
    document.body.appendChild(host);
    this.hostElement = host;
    this.shadow = host.attachShadow({ mode: 'open' });

    this.render();
  }

  private applyHostPosition() {
    if (!this.hostElement) return;
    const right = Math.max(10, Math.min(window.innerWidth - 130, this.currentPosition.right));
    const bottom = Math.max(10, Math.min(window.innerHeight - 55, this.currentPosition.bottom));
    this.hostElement.style.right = `${right}px`;
    this.hostElement.style.bottom = `${bottom}px`;
  }

  private render() {
    if (!this.shadow) return;
    const contentMode = this.settings.popupContentMode || (this.settings.enableWhiteboard ? 'both' : 'chat_only');
    if (contentMode === 'none' || this.settings.mode === 'disabled') {
      this.destroyWidgetDOM();
      return;
    }
    this.applyHostPosition();

    const isLive = Boolean(this.liveStage && this.liveStage.isActive);
    const tutorName = this.liveStage?.tutorIdentity?.nickname || 'Tutor';
    const problemTitle = this.currentProblem?.title || 'Global Problem Lobby';
    const platform = this.currentProblem?.platform || 'LeetCode';
    const platformColor = getPlatformBadgeColor(platform);
    const isWhiteboardTab = contentMode === 'whiteboard_only' || (contentMode === 'both' && this.activeTab === 'whiteboard');

    const fabIcon = contentMode === 'whiteboard_only' ? '🎨' : '⚡';
    const fabLabel = isLive
      ? `LIVE (${tutorName})`
      : contentMode === 'whiteboard_only'
      ? 'Board'
      : contentMode === 'chat_only'
      ? `Chat (${this.peerCount})`
      : `Synqto (${this.peerCount})`;

    // Dynamic positioning for popup card based on where the FAB is dragged
    const isNearTop = this.currentPosition.bottom > (window.innerHeight - 540);
    const isNearLeft = this.currentPosition.right > (window.innerWidth - 420);

    this.shadow.innerHTML = `
      <style>
        :host {
          --primary: #6366f1;
          --primary-hover: #4f46e5;
          --bg-card: rgba(15, 23, 42, 0.96);
          --bg-surface-elevated: rgba(30, 41, 59, 0.85);
          --border-subtle: rgba(255, 255, 255, 0.1);
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --text-dim: #475569;
          --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        /* Floating Action Button (FAB) */
        .fab-button {
          position: relative;
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 10px 14px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #4f46e5, #7c3aed);
          border: 1px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.5), 0 0 15px rgba(124, 58, 237, 0.3);
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
          cursor: grab;
          transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s;
          user-select: none;
        }

        .fab-button:active {
          cursor: grabbing;
        }

        .fab-button:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 14px 28px -5px rgba(99, 102, 241, 0.65), 0 0 20px rgba(124, 58, 237, 0.4);
        }

        .drag-grip {
          opacity: 0.5;
          font-size: 11px;
          cursor: grab;
        }

        .live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 10px #ef4444;
          animation: livePulse 1.5s infinite;
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.2); }
        }

        .fab-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          background: #f59e0b;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 9999px;
        }

        /* In-Page Popup Card */
        .popup-card {
          display: ${this.isOpen ? 'flex' : 'none'};
          flex-direction: column;
          position: absolute;
          ${isNearTop ? 'top: 52px; bottom: auto;' : 'bottom: 52px; top: auto;'}
          ${isNearLeft ? 'left: 0; right: auto;' : 'right: 0; left: auto;'}
          width: ${this.popupSize === 'fullscreen' ? 'min(1180px, 95vw)' : this.popupSize === 'large' ? 'min(860px, 92vw)' : this.popupSize === 'medium' ? 'min(620px, 88vw)' : '420px'};
          height: ${this.popupSize === 'fullscreen' ? 'min(880px, 92vh)' : this.popupSize === 'large' ? 'min(740px, 88vh)' : this.popupSize === 'medium' ? 'min(640px, 84vh)' : '540px'};
          max-height: 94vh;
          max-width: 96vw;
          background: rgba(15, 23, 42, 0.97);
          border: 1px solid ${isLive ? 'rgba(239, 68, 68, 0.45)' : 'rgba(99, 102, 241, 0.35)'};
          border-radius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 28px ${isLive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(99, 102, 241, 0.25)'};
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          overflow: hidden;
          animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          color: var(--text-primary);
          transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Room Header */
        .room-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
          border-bottom: 1px solid var(--border-subtle);
        }

        .room-info {
          display: flex;
          align-items: center;
          gap: 10px;
          overflow: hidden;
        }

        .platform-icon-box {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          flex-shrink: 0;
        }

        .problem-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 170px;
        }

        .badges-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .platform-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: ${platformColor}20;
          border: 1px solid ${platformColor}50;
          color: ${platformColor};
          text-transform: uppercase;
        }

        .peer-count-pill {
          font-size: 10px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .icon-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 5px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }

        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        /* Segmented View Switcher */
        .tab-switcher {
          display: flex;
          background: rgba(15, 23, 42, 0.9);
          padding: 3px 6px;
          border-bottom: 1px solid var(--border-subtle);
          gap: 4px;
        }

        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 5px 8px;
          font-size: 11px;
          font-weight: 600;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          transition: all 0.15s;
          background: transparent;
          color: var(--text-muted);
        }

        .tab-btn.active {
          background: var(--primary);
          color: #ffffff;
        }

        /* Messages List */
        .message-list {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .chat-bubble {
          display: flex;
          flex-direction: column;
          max-width: 86%;
          padding: 8px 12px;
          border-radius: 14px;
          font-size: 12px;
          position: relative;
          word-break: break-word;
          line-height: 1.45;
        }

        .chat-bubble.self {
          align-self: flex-end;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.28), rgba(139, 92, 246, 0.22));
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-bottom-right-radius: 4px;
          color: #ffffff;
        }

        .chat-bubble.other {
          align-self: flex-start;
          background: var(--bg-surface-elevated);
          border: 1px solid var(--border-subtle);
          border-bottom-left-radius: 4px;
          color: #f1f5f9;
        }

        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
          font-size: 11px;
        }

        .chat-author {
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .chat-timestamp {
          color: var(--text-dim);
          font-size: 10px;
        }

        .chat-footer {
          margin-top: 3px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          font-size: 10px;
        }

        .ack-read {
          color: #38bdf8;
          font-weight: 700;
        }

        /* Whiteboard Toolbar & Canvas */
        .whiteboard-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: #090d16;
          overflow: hidden;
          position: relative;
        }

        .wb-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          background: rgba(15, 23, 42, 0.95);
          border-bottom: 1px solid var(--border-subtle);
          flex-wrap: wrap;
          gap: 4px;
        }

        .wb-tool-group {
          display: flex;
          gap: 3px;
          align-items: center;
        }

        .wb-tool-btn {
          padding: 4px 6px;
          border-radius: 4px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .wb-tool-btn.active {
          border-color: var(--primary);
          background: rgba(99, 102, 241, 0.25);
          color: #c7d2fe;
        }

        .wb-palette-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 3px 8px;
          background: rgba(0, 0, 0, 0.3);
          border-bottom: 1px solid var(--border-subtle);
        }

        .color-dot {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.2);
          cursor: pointer;
        }

        .color-dot.active {
          border: 2px solid #ffffff;
          box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
        }

        .size-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid transparent;
          color: var(--text-dim);
          cursor: pointer;
        }

        .size-pill.active {
          background: rgba(99, 102, 241, 0.3);
          border-color: var(--primary);
          color: #ffffff;
        }

        #nb-whiteboard-canvas {
          flex-grow: 1;
          width: 100%;
          height: 100%;
          cursor: crosshair;
          touch-action: none;
        }

        /* Input Composer */
        .composer-box {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: rgba(15, 23, 42, 0.95);
          border-top: 1px solid var(--border-subtle);
        }

        .input-glass {
          flex: 1;
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 7px 10px;
          color: #ffffff;
          font-size: 11px;
          outline: none;
        }

        .input-glass:focus {
          border-color: var(--primary);
        }

        .btn-send {
          background: var(--primary);
          border: none;
          color: #ffffff;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .prompt-pills-row {
          display: flex;
          gap: 4px;
          padding: 4px 8px;
          overflow-x: auto;
          background: rgba(0, 0, 0, 0.3);
          border-top: 1px solid var(--border-subtle);
        }

        .prompt-pill {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          white-space: nowrap;
        }

        .prompt-pill:hover {
          background: rgba(99, 102, 241, 0.2);
          color: #ffffff;
        }
      </style>

      <!-- In-Page Popup Card Window -->
      <div class="popup-card" id="nb-popup-card">
        <!-- Room Header Bar -->
        <div class="room-header">
          <div class="room-info">
            <div class="platform-icon-box">⚡</div>
            <div>
              <div class="problem-title">${this.escapeHtml(problemTitle)}</div>
              <div class="badges-row">
                <span class="platform-pill">${platform}</span>
                <span class="peer-count-pill">
                  <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
                  <span>${this.peerCount} Online</span>
                </span>
              </div>
            </div>
          </div>

          <div class="header-actions">
            <!-- Popup Size Mode Switcher Pills -->
            <div class="popup-size-group" style="display:flex;gap:2px;align-items:center;background:rgba(0,0,0,0.35);padding:2px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);margin-right:2px;">
              <button class="size-mode-pill ${this.popupSize === 'compact' ? 'active' : ''}" data-popsize="compact" title="Compact Size (420x540)" style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'compact' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'compact' ? '#fff' : 'var(--text-muted)'};">📱 S</button>
              <button class="size-mode-pill ${this.popupSize === 'medium' ? 'active' : ''}" data-popsize="medium" title="Medium Split Size (620x640)" style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'medium' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'medium' ? '#fff' : 'var(--text-muted)'};">🌗 M</button>
              <button class="size-mode-pill ${this.popupSize === 'large' ? 'active' : ''}" data-popsize="large" title="Large Widescreen (860x740)" style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'large' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'large' ? '#fff' : 'var(--text-muted)'};">🖥️ L</button>
              <button class="size-mode-pill ${this.popupSize === 'fullscreen' ? 'active' : ''}" data-popsize="fullscreen" title="Full Screen View (1180x880)" style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'fullscreen' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'fullscreen' ? '#fff' : 'var(--text-muted)'};">📺 XL</button>
            </div>

            <button class="icon-btn" id="nb-open-sidepanel" title="Open complete extension in side panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              </svg>
            </button>
            <button class="icon-btn" id="nb-close-popup" title="Minimize">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Segmented Switcher when Both Chat and Whiteboard are Enabled -->
        ${contentMode === 'both' ? `
          <div class="tab-switcher">
            <button class="tab-btn ${this.activeTab === 'chat' ? 'active' : ''}" id="nb-tab-chat">
              <span>💬 Live Chat</span>
            </button>
            <button class="tab-btn ${this.activeTab === 'whiteboard' ? 'active' : ''}" id="nb-tab-whiteboard">
              <span>🎨 Whiteboard</span>
            </button>
          </div>
        ` : ''}

        <!-- Multi-Broadcaster Live Streams List -->
        ${isLive ? `
          <div style="background:linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(139, 92, 246, 0.18));border-bottom:1px solid rgba(239, 68, 68, 0.35);padding:6px 10px;display:flex;flex-direction:column;gap:5px;">
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#fca5a5;">
              <div style="display:flex;align-items:center;gap:5px;font-weight:700;">
                <span class="live-dot"></span>
                <span>LIVE STREAMS (${(this.liveStage.activeStreams && this.liveStage.activeStreams.length) || 1}):</span>
              </div>
              <button id="nb-live-tunein" style="background:#ef4444;color:#fff;border:none;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;cursor:pointer;">
                Open Side Panel 📺
              </button>
            </div>

            <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:2px;">
              ${((this.liveStage.activeStreams && this.liveStage.activeStreams.length > 0)
                ? this.liveStage.activeStreams
                : [{
                    broadcasterIdentity: this.liveStage.tutorIdentity || { nickname: tutorName, avatar: '👑' },
                    title: `${tutorName}'s Walkthrough`,
                    broadcastType: this.liveStage.broadcastType || 'screen',
                  }]
              ).map((s: any) => `
                <div style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);font-size:10px;color:#f8fafc;white-space:nowrap;">
                  <span>${s.broadcasterIdentity?.avatar || '👤'}</span>
                  <span style="font-weight:600;">${s.broadcasterIdentity?.nickname || 'Streamer'}:</span>
                  <span style="color:#c7d2fe;max-width:110px;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(s.title || 'Live Stream')}</span>
                  <span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(239,68,68,0.3);color:#fca5a5;text-transform:uppercase;">${s.broadcastType || 'live'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Main Body: Chat or Whiteboard -->
        ${isWhiteboardTab ? `
          <!-- Whiteboard View -->
          <div class="whiteboard-container">
            <div class="wb-toolbar">
              <div class="wb-tool-group">
                <button class="wb-tool-btn ${this.wbTool === 'pen' ? 'active' : ''}" data-wbtool="pen" title="Fine Pen">✏️</button>
                <button class="wb-tool-btn ${this.wbTool === 'brush' ? 'active' : ''}" data-wbtool="brush" title="Brush Pen">✒️</button>
                <button class="wb-tool-btn ${this.wbTool === 'highlighter' ? 'active' : ''}" data-wbtool="highlighter" title="Highlighter">🖍️</button>
                <button class="wb-tool-btn ${this.wbTool === 'temp_pen' ? 'active' : ''}" data-wbtool="temp_pen" title="⏳ Disappearing Ink (Fades in 3s)">⏳</button>
                <button class="wb-tool-btn ${this.wbTool === 'laser' ? 'active' : ''}" data-wbtool="laser" title="Laser Pointer">🔴</button>
                <button class="wb-tool-btn ${this.wbTool === 'torch' ? 'active' : ''}" data-wbtool="torch" title="Spotlight Torch">🔦</button>
                <button class="wb-tool-btn ${this.wbTool === 'eraser' ? 'active' : ''}" data-wbtool="eraser" title="Eraser">🧹</button>
                <button class="wb-tool-btn ${this.wbTool === 'line' ? 'active' : ''}" data-wbtool="line" title="Line">📏</button>
                <button class="wb-tool-btn ${this.wbTool === 'arrow' ? 'active' : ''}" data-wbtool="arrow" title="Arrow">➡️</button>
                <button class="wb-tool-btn ${this.wbTool === 'rect' ? 'active' : ''}" data-wbtool="rect" title="Box">🔲</button>
                <button class="wb-tool-btn ${this.wbTool === 'circle' ? 'active' : ''}" data-wbtool="circle" title="Node">⭕</button>
                <button class="wb-tool-btn ${this.wbTool === 'tree_node' ? 'active' : ''}" data-wbtool="tree_node" title="Tree Node">🌳</button>
                <button class="wb-tool-btn ${this.wbTool === 'db_cylinder' ? 'active' : ''}" data-wbtool="db_cylinder" title="Database Cylinder">🗄️</button>
                <button class="wb-tool-btn ${this.wbTool === 'cloud' ? 'active' : ''}" data-wbtool="cloud" title="Cloud Gateway">☁️</button>
                <button class="wb-tool-btn ${this.wbTool === 'load_balancer' ? 'active' : ''}" data-wbtool="load_balancer" title="Load Balancer">⚖️</button>
                <button class="wb-tool-btn ${this.wbTool === 'message_queue' ? 'active' : ''}" data-wbtool="message_queue" title="Message Queue">📨</button>
                <button class="wb-tool-btn ${this.wbTool === 'server_box' ? 'active' : ''}" data-wbtool="server_box" title="Server Box">📦</button>
              </div>

              <div class="wb-tool-group">
                <div style="display:flex;gap:2px;align-items:center;background:rgba(0,0,0,0.3);padding:2px 3px;border-radius:4px;">
                  <button class="wb-privacy-btn" data-wbprivacy="collaborative" style="font-size:9px;font-weight:700;padding:2px 4px;border-radius:3px;border:none;cursor:pointer;background:${this.wbPrivacyMode === 'collaborative' ? 'var(--primary)' : 'transparent'};color:${this.wbPrivacyMode === 'collaborative' ? '#fff' : 'var(--text-muted)'};" title="👥 Collaborative with Room Peers">👥 Collab</button>
                  <button class="wb-privacy-btn" data-wbprivacy="personal" style="font-size:9px;font-weight:700;padding:2px 4px;border-radius:3px;border:none;cursor:pointer;background:${this.wbPrivacyMode === 'personal' ? 'var(--primary)' : 'transparent'};color:${this.wbPrivacyMode === 'personal' ? '#fff' : 'var(--text-muted)'};" title="🔒 Personal Private Scratchpad">🔒 Personal</button>
                </div>
                <button class="wb-tool-btn" id="nb-wb-undo" title="Undo">↩️</button>
                <button class="wb-tool-btn" id="nb-wb-redo" title="Redo">↪️</button>
                <button class="wb-tool-btn" id="nb-wb-clear" title="Clear Canvas" style="color:#f87171;">🗑️</button>
                <button class="wb-tool-btn" id="nb-wb-save" title="Export PNG">💾</button>
              </div>
            </div>

            <!-- Color Palette, Widths, BG Colors & Background Patterns -->
            <div class="wb-palette-bar">
              <div style="display:flex;gap:2px;align-items:center;overflow-x:auto;">
                <button class="size-pill ${this.wbTheme === 'grid' ? 'active' : ''}" data-wbtheme="grid" title="Square Graph Grid">⬛ Grid</button>
                <button class="size-pill ${this.wbTheme === 'ruled' ? 'active' : ''}" data-wbtheme="ruled" title="Ruled Lined Paper">📏 Ruled</button>
                <button class="size-pill ${this.wbTheme === 'plot' ? 'active' : ''}" data-wbtheme="plot" title="Coordinate Plot (X,Y)">📈 Plot</button>
                <button class="size-pill ${this.wbTheme === 'dotted' ? 'active' : ''}" data-wbtheme="dotted" title="Dot Grid">🟦 Dots</button>
                <button class="size-pill ${this.wbTheme === 'matrix' ? 'active' : ''}" data-wbtheme="matrix" title="Matrix Table">📐 Matrix</button>
              </div>

              <!-- BG Colors -->
              <div style="display:flex;gap:3px;align-items:center;">
                ${['#090d16', '#0f172a', '#062c24', '#fef3c7', '#ffffff', '#f8fafc', '#1e1035'].map((bg) => `
                  <div class="bg-dot" data-wbbg="${bg}" style="width:10px;height:10px;border-radius:2px;background:${bg};border:${this.wbBgColor === bg ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)'};cursor:pointer;" title="Background Color"></div>
                `).join('')}
              </div>

              <div style="display:flex;gap:4px;align-items:center;">
                ${['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#ffffff'].map((c) => `
                  <div class="color-dot ${this.wbColor === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></div>
                `).join('')}
              </div>

              <div style="display:flex;gap:2px;align-items:center;">
                <button class="size-pill ${this.wbWidth === 2 ? 'active' : ''}" data-size="2">S</button>
                <button class="size-pill ${this.wbWidth === 4 ? 'active' : ''}" data-size="4">M</button>
                <button class="size-pill ${this.wbWidth === 8 ? 'active' : ''}" data-size="8">L</button>
              </div>
            </div>

            <!-- HTML5 Interactive Canvas -->
            <canvas id="nb-whiteboard-canvas"></canvas>
          </div>
        ` : `
          <!-- Chat Messages View -->
          <div class="message-list" id="nb-messages">
            ${this.messages.length === 0 ? `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);gap:8px;padding:30px 10px;text-align:center;">
                <div style="font-size:28px;">💬</div>
                <div style="font-size:13px;font-weight:600;color:var(--text-secondary);">No messages yet</div>
                <div style="font-size:11px;max-width:220px;">Say hello or ask for a hint! Messages are synchronized P2P across all peers.</div>
              </div>
            ` : this.messages.map((m, idx) => `
              <div class="chat-bubble ${m.isSelf ? 'self' : 'other'}">
                ${m.replyPreview ? `<div style="border-left:2px solid var(--primary);padding-left:6px;margin-bottom:4px;font-size:10px;color:var(--text-muted);">${this.escapeHtml(m.replyPreview)}</div>` : ''}
                
                <div class="chat-header">
                  <div class="chat-author">
                    <span>${m.from?.avatar || '👤'}</span>
                    <span style="color:${m.isSelf ? '#ffffff' : m.from?.color || '#a5b4fc'}">
                      ${m.isSelf ? 'You' : m.from?.nickname || 'Buddy'}
                    </span>
                  </div>
                  <div style="display:flex;align-items:center;gap:4px;">
                    <span class="chat-timestamp">${this.formatTimestamp(m.timestamp)}</span>
                    <button class="icon-btn nb-reply-trigger" data-id="${m.id}" data-text="${this.escapeHtml(m.text.slice(0, 35))}" data-nick="${this.escapeHtml(m.from?.nickname || 'Buddy')}" style="padding:0;width:18px;height:18px;" title="Reply">
                      ↩
                    </button>
                  </div>
                </div>

                <div class="chat-body">${this.renderFormattedText(m.text, idx, m)}</div>

                ${m.isSelf ? `
                  <div class="chat-footer">
                    ${m.status === 'pending' ? '<span>⏳</span>' : ''}
                    ${m.status === 'sent' ? '<span style="color:var(--text-dim);">✓</span>' : ''}
                    ${m.status === 'delivered' ? '<span style="color:var(--text-secondary);">✓✓</span>' : ''}
                    ${m.status === 'read' ? '<span class="ack-read">✓✓</span>' : ''}
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>

          <!-- Quick Strategy Prompt Pills -->
          <div class="prompt-pills-row">
            <button class="prompt-pill" data-text="⚡ O(N) Time">⚡ O(N) Time</button>
            <button class="prompt-pill" data-text="💾 O(1) Space">💾 O(1) Space</button>
            <button class="prompt-pill" data-text="👉 Two Pointers">👉 Two Pointers</button>
            <button class="prompt-pill" data-text="🔍 Binary Search">🔍 Binary Search</button>
            <button class="prompt-pill" data-text="🧠 DP / Memo">🧠 DP / Memo</button>
            <button class="prompt-pill" data-text="💡 Sliding Window">💡 Sliding Window</button>
          </div>

          <!-- Input Box & Composer -->
          <form class="composer-box" id="nb-composer">
            <button type="button" class="icon-btn" id="nb-spoiler-insert" title="Insert Spoiler Blur ||text||" style="width:28px;height:28px;flex-shrink:0;">
              👁️
            </button>
            <input type="text" class="input-glass" id="nb-input" placeholder="Type a hint, code snippet, or ||spoiler||..." />
            <button type="submit" class="btn-send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        `}
      </div>

      <!-- Draggable Floating Action Button (FAB) -->
      <button class="fab-button" id="nb-fab-trigger" title="Drag anywhere or click to open">
        <span class="drag-grip">⠿</span>
        ${isLive ? `<span class="live-dot"></span>` : `<span>${fabIcon}</span>`}
        <span>${fabLabel}</span>
        ${this.unreadCount > 0 ? `<span class="fab-badge">${this.unreadCount}</span>` : ''}
      </button>
    `;

    this.attachEventListeners();
    if (isWhiteboardTab) {
      this.initWhiteboardCanvas();
    }
  }

  private attachEventListeners() {
    if (!this.shadow) return;

    // Draggable FAB Implementation
    const fabBtn = this.shadow.getElementById('nb-fab-trigger');
    if (fabBtn) {
      let startX = 0;
      let startY = 0;
      let initialRight = 24;
      let initialBottom = 24;

      const onPointerMove = (e: MouseEvent | TouchEvent) => {
        if (!this.isDragging) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        if (Math.hypot(dx, dy) > 4) {
          this.dragMoved = true;
          const newRight = initialRight - dx;
          const newBottom = initialBottom - dy;

          this.currentPosition = {
            right: Math.max(10, Math.min(window.innerWidth - 130, newRight)),
            bottom: Math.max(10, Math.min(window.innerHeight - 55, newBottom)),
          };
          this.applyHostPosition();
        }
      };

      const onPointerUp = () => {
        if (this.isDragging) {
          this.isDragging = false;
          window.removeEventListener('mousemove', onPointerMove);
          window.removeEventListener('mouseup', onPointerUp);
          window.removeEventListener('touchmove', onPointerMove);
          window.removeEventListener('touchend', onPointerUp);

          if (this.dragMoved) {
            // If permanent mode, persist to storage
            if (this.settings.positionMode === 'permanent') {
              const updatedSettings: FabSettings = {
                ...this.settings,
                savedPosition: { ...this.currentPosition },
              };
              this.settings = updatedSettings;
              if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                chrome.storage.local.set({ [FAB_STORAGE_KEY]: updatedSettings });
              }
            }

            // Prevent immediate toggle click after dragging
            setTimeout(() => {
              this.dragMoved = false;
            }, 60);
          }
        }
      };

      const onPointerDown = (e: MouseEvent | TouchEvent) => {
        this.isDragging = true;
        this.dragMoved = false;
        startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        initialRight = this.currentPosition.right;
        initialBottom = this.currentPosition.bottom;

        window.addEventListener('mousemove', onPointerMove, { passive: true });
        window.addEventListener('mouseup', onPointerUp);
        window.addEventListener('touchmove', onPointerMove, { passive: true });
        window.addEventListener('touchend', onPointerUp);
      };

      fabBtn.addEventListener('mousedown', onPointerDown);
      fabBtn.addEventListener('touchstart', onPointerDown, { passive: true });

      // Click to toggle (only if not dragged)
      fabBtn.addEventListener('click', () => {
        if (this.dragMoved) return;

        if (this.settings.clickAction === 'open_extension') {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
          }
          return;
        }

        this.isOpen = !this.isOpen;
        this.unreadCount = 0;
        this.render();
        if (this.isOpen && this.activeTab === 'chat') {
          this.scrollToBottom();
        }
      });
    }

    // Size Mode Switcher (S, M, L, XL)
    const sizePillBtns = this.shadow.querySelectorAll('.size-mode-pill[data-popsize]');
    sizePillBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const sz = (e.currentTarget as HTMLElement).getAttribute('data-popsize') as any;
        if (sz) {
          this.popupSize = sz;
          this.render();
        }
      });
    });

    // Close Popup Button
    const closeBtn = this.shadow.getElementById('nb-close-popup');
    closeBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
    });

    // Open Full Side Panel Button
    const openPanelBtn = this.shadow.getElementById('nb-open-sidepanel');
    openPanelBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
      }
    });

    // Tab Switchers
    const tabChat = this.shadow.getElementById('nb-tab-chat');
    tabChat?.addEventListener('click', () => {
      this.activeTab = 'chat';
      this.render();
      this.scrollToBottom();
    });

    const tabWb = this.shadow.getElementById('nb-tab-whiteboard');
    tabWb?.addEventListener('click', () => {
      this.activeTab = 'whiteboard';
      this.render();
    });

    // Live Tune In Button
    const liveTuneIn = this.shadow.getElementById('nb-live-tunein');
    liveTuneIn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
      }
    });

    // Quick Strategy Pills
    const pills = this.shadow.querySelectorAll('.prompt-pill');
    pills.forEach((p) => {
      p.addEventListener('click', (e) => {
        const text = (e.target as HTMLElement).getAttribute('data-text');
        if (text) {
          this.sendMessage(text);
        }
      });
    });

    // Insert Spoiler Shortcut
    const spoilerBtn = this.shadow.getElementById('nb-spoiler-insert');
    const input = this.shadow.getElementById('nb-input') as HTMLInputElement;
    spoilerBtn?.addEventListener('click', () => {
      if (input) {
        input.value = `${input.value}||hint solution||`;
        input.focus();
      }
    });

    if (input) {
      const stopProp = (e: Event) => e.stopPropagation();
      input.addEventListener('keydown', stopProp);
      input.addEventListener('keyup', stopProp);
      input.addEventListener('keypress', stopProp);
    }

    // Composer Form Submit
    const composer = this.shadow.getElementById('nb-composer') as HTMLFormElement;
    composer?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input?.value.trim();
      if (val) {
        this.sendMessage(val, this.replyingTo ? { id: this.replyingTo.id, preview: `${this.replyingTo.from.nickname}: ${this.replyingTo.text.slice(0, 30)}` } : undefined);
        if (input) input.value = '';
        this.replyingTo = null;
      }
    });
  }

  // In-Page Canvas Whiteboard Initialization & Event Handling
  private initWhiteboardCanvas() {
    if (!this.shadow) return;
    const canvas = this.shadow.getElementById('nb-whiteboard-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    // Attach Tool Selector
    const toolBtns = this.shadow.querySelectorAll('.wb-tool-btn[data-wbtool]');
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tool = (e.currentTarget as HTMLElement).getAttribute('data-wbtool') as any;
        if (tool) {
          this.wbTool = tool;
          const style = this.toolStyles[tool] || { color: '#6366f1', width: 3 };
          this.wbColor = style.color;
          this.wbWidth = style.width;
          this.render();
        }
      });
    });

    // Attach Privacy Mode Selector (Collab vs Personal)
    const privacyBtns = this.shadow.querySelectorAll('.wb-privacy-btn[data-wbprivacy]');
    privacyBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-wbprivacy') as any;
        if (mode) {
          this.wbPrivacyMode = mode;
          this.render();
        }
      });
    });

    // Attach Board Theme Selector
    const themeBtns = this.shadow.querySelectorAll('.size-pill[data-wbtheme]');
    themeBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const theme = (e.currentTarget as HTMLElement).getAttribute('data-wbtheme') as any;
        if (theme) {
          this.wbTheme = theme;
          if (theme === 'clean_white' && this.wbColor === '#ffffff') {
            this.wbColor = '#0f172a';
          }
          this.render();
        }
      });
    });

    // Attach Background Color Selector
    const bgDots = this.shadow.querySelectorAll('.bg-dot[data-wbbg]');
    bgDots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const bg = (e.currentTarget as HTMLElement).getAttribute('data-wbbg');
        if (bg) {
          this.wbBgColor = bg;
          this.render();
        }
      });
    });

    // Attach Color Selector (Updates Active Tool's Independent Color)
    const colorDots = this.shadow.querySelectorAll('.color-dot');
    colorDots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const col = (e.currentTarget as HTMLElement).getAttribute('data-color');
        if (col) {
          this.wbColor = col;
          if (this.toolStyles[this.wbTool]) {
            this.toolStyles[this.wbTool].color = col;
          }
          this.render();
        }
      });
    });

    // Attach Size Selector (Updates Active Tool's Independent Width)
    const sizePills = this.shadow.querySelectorAll('.size-pill[data-size]');
    sizePills.forEach((p) => {
      p.addEventListener('click', (e) => {
        const sz = Number((e.currentTarget as HTMLElement).getAttribute('data-size'));
        if (sz) {
          this.wbWidth = sz;
          if (this.toolStyles[this.wbTool]) {
            this.toolStyles[this.wbTool].width = sz;
          }
          this.render();
        }
      });
    });

    // Undo / Redo / Clear / Export
    this.shadow.getElementById('nb-wb-undo')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      if (activeList.length === 0 && this.wbRedoStack.length > 0) {
        if (this.wbPrivacyMode === 'personal') {
          this.wbPersonalStrokes = [...this.wbRedoStack];
        } else {
          this.wbStrokes = [...this.wbRedoStack];
          this.wbStrokes.forEach((s) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s }).catch(() => {});
            }
          });
        }
        this.wbRedoStack = [];
        this.drawWbCanvas();
        return;
      }
      if (activeList.length > 0) {
        const removed = activeList.pop();
        if (removed) {
          this.wbRedoStack.push(removed);
          this.drawWbCanvas();
          if (this.wbPrivacyMode === 'collaborative' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: removed.id }).catch(() => {});
          }
        }
      }
    });

    this.shadow.getElementById('nb-wb-redo')?.addEventListener('click', () => {
      if (this.wbRedoStack.length > 0) {
        const restored = this.wbRedoStack.pop();
        if (restored) {
          const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
          activeList.push(restored);
          this.drawWbCanvas();
          if (this.wbPrivacyMode === 'collaborative' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: restored }).catch(() => {});
          }
        }
      }
    });

    this.shadow.getElementById('nb-wb-clear')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      if (activeList.length === 0) return;
      this.wbRedoStack = [...activeList];
      if (this.wbPrivacyMode === 'personal') {
        this.wbPersonalStrokes = [];
      } else {
        this.wbStrokes = [];
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'WHITEBOARD_CLEAR_LOCAL' }).catch(() => {});
        }
      }
      this.drawWbCanvas();
    });

    this.shadow.getElementById('nb-wb-save')?.addEventListener('click', () => {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = `synqto-whiteboard-${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
    });

    // Setup Canvas Dimensions
    setTimeout(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = (rect.width || 380) * dpr;
      canvas.height = (rect.height || 360) * dpr;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);

      this.drawWbCanvas();
    }, 30);

    // Pointer Event Listeners
    const getCoords = (e: MouseEvent | TouchEvent): WhiteboardPoint => {
      const rect = canvas.getBoundingClientRect();
      let cx = 0, cy = 0;
      if ('touches' in e && e.touches.length > 0) {
        cx = e.touches[0].clientX;
        cy = e.touches[0].clientY;
      } else if ('clientX' in e) {
        cx = (e as MouseEvent).clientX;
        cy = (e as MouseEvent).clientY;
      }
      return { x: cx - rect.left, y: cy - rect.top };
    };

    const isStrokeIntersecting = (s: InPageStroke, eraserPt: WhiteboardPoint, radius: number): boolean => {
      if (s.geometry) {
        const { x1, y1, x2, y2 } = s.geometry;
        const minX = Math.min(x1, x2) - radius;
        const maxX = Math.max(x1, x2) + radius;
        const minY = Math.min(y1, y2) - radius;
        const maxY = Math.max(y1, y2) + radius;
        return eraserPt.x >= minX && eraserPt.x <= maxX && eraserPt.y >= minY && eraserPt.y <= maxY;
      }
      if (s.points && s.points.length > 0) {
        const hitRadius = radius + s.width / 2;
        return s.points.some((p) => Math.hypot(p.x - eraserPt.x, p.y - eraserPt.y) <= hitRadius);
      }
      return false;
    };

    canvas.addEventListener('mousedown', (e) => {
      const pt = getCoords(e);

      if (this.wbTool === 'eraser') {
        this.isWbDrawing = true;
        this.wbEraserPos = pt;
        const radius = (this.wbWidth || 4) * 3;
        const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
        const remaining = activeList.filter((s) => !isStrokeIntersecting(s, pt, radius));
        if (remaining.length !== activeList.length) {
          const deleted = activeList.filter((s) => isStrokeIntersecting(s, pt, radius));
          this.wbRedoStack.push(...deleted);
          if (this.wbPrivacyMode === 'personal') {
            this.wbPersonalStrokes = remaining;
          } else {
            this.wbStrokes = remaining;
            deleted.forEach((d) => {
              if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: d.id }).catch(() => {});
              }
            });
          }
        }
        this.drawWbCanvas();
        return;
      }

      if (this.wbTool === 'laser') {
        this.wbLaserTrails.push({ x: pt.x, y: pt.y, alpha: 1.0, timestamp: Date.now() });
        this.drawWbCanvas();
        return;
      }

      if (this.wbTool === 'torch') {
        this.wbTorchPos = pt;
        this.drawWbCanvas();
        return;
      }

      this.isWbDrawing = true;
      this.wbStartPoint = pt;
      this.wbCurrentPoints = [pt];
    });

    canvas.addEventListener('mousemove', (e) => {
      const pt = getCoords(e);

      if (this.wbTool === 'eraser') {
        this.wbEraserPos = pt;
        if (this.isWbDrawing) {
          const radius = (this.wbWidth || 4) * 3;
          const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
          const remaining = activeList.filter((s) => !isStrokeIntersecting(s, pt, radius));
          if (remaining.length !== activeList.length) {
            const deleted = activeList.filter((s) => isStrokeIntersecting(s, pt, radius));
            this.wbRedoStack.push(...deleted);
            if (this.wbPrivacyMode === 'personal') {
              this.wbPersonalStrokes = remaining;
            } else {
              this.wbStrokes = remaining;
              deleted.forEach((d) => {
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                  chrome.runtime.sendMessage({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: d.id }).catch(() => {});
                }
              });
            }
          }
        }
        this.drawWbCanvas();
        return;
      }

      if (this.wbTool === 'laser') {
        this.wbLaserTrails.push({ x: pt.x, y: pt.y, alpha: 1.0, timestamp: Date.now() });
        this.drawWbCanvas();
        return;
      }

      if (this.wbTool === 'torch') {
        this.wbTorchPos = pt;
        this.drawWbCanvas();
        return;
      }

      if (!this.isWbDrawing) return;
      const isGeom = ['line', 'arrow', 'rect', 'circle', 'tree_node', 'db_cylinder', 'cloud', 'load_balancer', 'message_queue', 'server_box'].includes(this.wbTool);

      if (isGeom && this.wbStartPoint) {
        this.drawWbCanvas(undefined, {
          x1: this.wbStartPoint.x,
          y1: this.wbStartPoint.y,
          x2: pt.x,
          y2: pt.y,
        });
      } else {
        this.wbCurrentPoints.push(pt);
        this.drawWbCanvas(this.wbCurrentPoints);
      }
    });

    const handleMouseUp = (e: MouseEvent | TouchEvent) => {
      if (this.wbTool === 'eraser') {
        this.isWbDrawing = false;
        this.wbEraserPos = null;
        this.drawWbCanvas();
        return;
      }

      if (this.wbTool === 'torch') {
        this.wbTorchPos = null;
        this.drawWbCanvas();
        return;
      }

      if (!this.isWbDrawing) return;
      this.isWbDrawing = false;
      const endPt = getCoords(e);
      const isGeom = ['line', 'arrow', 'rect', 'circle', 'tree_node', 'db_cylinder', 'cloud', 'load_balancer', 'message_queue', 'server_box'].includes(this.wbTool);
      const width = this.wbTool === 'highlighter' ? 16 : this.wbWidth;

      const stroke: InPageStroke = {
        id: 'stroke-' + Math.random().toString(36).slice(2, 10),
        tool: this.wbTool,
        color: this.wbColor,
        width,
        opacity: this.wbTool === 'highlighter' ? 0.35 : 1.0,
        points: isGeom ? [] : [...this.wbCurrentPoints],
        geometry: isGeom && this.wbStartPoint ? {
          x1: this.wbStartPoint.x,
          y1: this.wbStartPoint.y,
          x2: endPt.x,
          y2: endPt.y,
        } : undefined,
      };

      if (this.wbTool === 'temp_pen') {
        this.tempDisappearingStrokes.push({ stroke, createdAt: Date.now(), durationMs: 3000 });
      } else if (this.wbPrivacyMode === 'personal') {
        this.wbPersonalStrokes.push(stroke);
      } else {
        this.wbStrokes.push(stroke);
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke }).catch(() => {});
        }
      }

      this.wbRedoStack = [];
      this.wbCurrentPoints = [];
      this.wbStartPoint = null;
      this.drawWbCanvas();
    };

    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
  }

  private drawWbCanvas(previewPoints?: WhiteboardPoint[], previewGeometry?: any) {
    if (!this.shadow) return;
    const canvas = this.shadow.getElementById('nb-whiteboard-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background Theme
    ctx.save();
    const isLightBg = this.wbBgColor === '#ffffff' || this.wbBgColor === '#f8fafc' || this.wbBgColor === '#fef3c7';
    ctx.fillStyle = this.wbBgColor || (isLightBg ? '#f8fafc' : '#090d16');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.wbTheme === 'ruled') {
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.18)';
      ctx.lineWidth = 1;
      for (let y = 28; y < canvas.height; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(40, 0);
      ctx.lineTo(40, canvas.height);
      ctx.stroke();
    } else if (this.wbTheme === 'plot') {
      const midX = Math.floor(canvas.width / 2);
      const midY = Math.floor(canvas.height / 2);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(canvas.width, midY);
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, canvas.height);
      ctx.stroke();
    } else if (this.wbTheme === 'dotted') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      for (let x = 8; x < canvas.width; x += 18) {
        for (let y = 8; y < canvas.height; y += 18) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (this.wbTheme === 'matrix') {
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.lineWidth = 1;
      const cell = 26;
      for (let x = 0; x < canvas.width; x += cell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += cell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    } else if (this.wbTheme === 'grid') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const gridSize = 20;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Eraser Indicator
    if (this.wbTool === 'eraser' && this.wbEraserPos) {
      ctx.save();
      const r = (this.wbWidth || 4) * 3;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(this.wbEraserPos.x, this.wbEraserPos.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const render = (s: InPageStroke) => {
      if (s.tool === 'eraser') return;
      ctx.save();
      let drawColor = s.color;
      if (this.wbTheme === 'white_blank' && (drawColor === '#ffffff' || drawColor === '#fff')) {
        drawColor = '#0f172a';
      }
      ctx.strokeStyle = drawColor;
      ctx.fillStyle = drawColor;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = s.opacity;

      if (s.geometry) {
        const { x1, y1, x2, y2 } = s.geometry;
        if (s.tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (s.tool === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(10, s.width * 3);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (s.tool === 'rect') {
          ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        } else if (s.tool === 'circle') {
          const rx = Math.abs(x2 - x1) / 2;
          const ry = Math.abs(y2 - y1) / 2;
          ctx.beginPath();
          ctx.ellipse(Math.min(x1, x2) + rx, Math.min(y1, y2) + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (s.tool === 'tree_node') {
          const r = Math.max(16, s.width * 3.5);
          ctx.beginPath();
          ctx.arc(x1, y1, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, x1, y1);
          }
        } else if (s.tool === 'db_cylinder') {
          const w = Math.max(50, Math.abs(x2 - x1));
          const h = Math.max(55, Math.abs(y2 - y1));
          const minX = Math.min(x1, x2);
          const minY = Math.min(y1, y2);
          const ry = Math.min(14, h * 0.2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, Math.PI, 0);
          ctx.lineTo(minX + w, minY + h - ry);
          ctx.ellipse(minX + w / 2, minY + h - ry, w / 2, ry, 0, 0, Math.PI);
          ctx.lineTo(minX, minY + ry);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(minX + w / 2, minY + ry, w / 2, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + w / 2, minY + h / 2 + 4);
          }
        } else if (s.tool === 'cloud') {
          const w = Math.max(65, Math.abs(x2 - x1));
          const h = Math.max(40, Math.abs(y2 - y1));
          const minX = Math.min(x1, x2);
          const minY = Math.min(y1, y2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 14);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + w / 2, minY + h / 2);
          }
        } else if (s.tool === 'load_balancer') {
          const w = Math.max(55, Math.abs(x2 - x1));
          const h = Math.max(55, Math.abs(y2 - y1));
          const minX = Math.min(x1, x2);
          const minY = Math.min(y1, y2);
          const midX = minX + w / 2;
          const midY = minY + h / 2;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + w, midY);
          ctx.lineTo(midX, minY + h);
          ctx.lineTo(minX, midY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, midX, midY);
          }
        } else if (s.tool === 'message_queue') {
          const w = Math.max(70, Math.abs(x2 - x1));
          const h = Math.max(34, Math.abs(y2 - y1));
          const minX = Math.min(x1, x2);
          const minY = Math.min(y1, y2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + w / 2, minY + h / 2);
          }
        } else if (s.tool === 'server_box') {
          const w = Math.max(65, Math.abs(x2 - x1));
          const h = Math.max(40, Math.abs(y2 - y1));
          const minX = Math.min(x1, x2);
          const minY = Math.min(y1, y2);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, w, h, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 10, minY + 10, 3, 0, Math.PI * 2);
          ctx.fill();
          if (s.geometry.label) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + w / 2, minY + h / 2 + 2);
          }
        }
      } else if (s.points && s.points.length > 0) {
        if (s.points.length === 1) {
          ctx.beginPath();
          ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (let i = 1; i < s.points.length - 1; i++) {
            const midX = (s.points[i].x + s.points[i + 1].x) / 2;
            const midY = (s.points[i].y + s.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, midX, midY);
          }
          ctx.lineTo(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
    activeList.forEach(render);

    // Render Disappearing Temporary Ink Strokes
    const now = Date.now();
    this.tempDisappearingStrokes.forEach((item) => {
      const alpha = Math.max(0, 1 - (now - item.createdAt) / item.durationMs);
      render({
        ...item.stroke,
        opacity: alpha,
      });
    });

    if (previewGeometry) {
      render({
        id: 'preview',
        tool: this.wbTool,
        color: this.wbColor,
        width: this.wbTool === 'highlighter' ? 14 : this.wbWidth,
        opacity: this.wbTool === 'highlighter' ? 0.35 : 1.0,
        points: [],
        geometry: previewGeometry,
      });
    } else if (previewPoints && previewPoints.length > 1) {
      render({
        id: 'preview',
        tool: this.wbTool,
        color: this.wbColor,
        width: this.wbTool === 'highlighter' ? 14 : this.wbWidth,
        opacity: this.wbTool === 'highlighter' ? 0.35 : 1.0,
        points: previewPoints,
      });
    }

    // Render Spotlight Torch
    if (this.wbTool === 'torch' && this.wbTorchPos) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(this.wbTorchPos.x, this.wbTorchPos.y, 55, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#fde047';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(this.wbTorchPos.x, this.wbTorchPos.y, 55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Render Laser Pointer Trails
    this.wbLaserTrails.forEach((pt) => {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5 * pt.alpha, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  private listenForRuntimeMessages() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'FAB_SETTINGS_UPDATED' && msg.payload) {
          this.settings = { ...DEFAULT_FAB_SETTINGS, ...msg.payload };
          if (this.settings.positionMode === 'permanent' && this.settings.savedPosition) {
            this.currentPosition = { ...this.settings.savedPosition };
          }
          this.checkVisibilityAndRender();
          if (this.hostElement) {
            this.render();
          }
        } else if (msg.type === 'WHITEBOARD_STROKE_LOCAL' && msg.stroke) {
          if (!this.wbStrokes.some((s) => s.id === msg.stroke.id)) {
            this.wbStrokes.push(msg.stroke);
            if (this.activeTab === 'whiteboard') this.drawWbCanvas();
          }
        } else if (msg.type === 'WHITEBOARD_CLEAR_LOCAL') {
          this.wbStrokes = [];
          this.wbRedoStack = [];
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_UNDO_LOCAL' && msg.strokeId) {
          this.wbStrokes = this.wbStrokes.filter((s) => s.id !== msg.strokeId);
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        }
      });
    }
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private renderFormattedText(text: string, msgIdx: number, msgObj?: any): string {
    let output = '';

    // If image attached
    if (msgObj?.imageUrl) {
      output += `
        <div style="margin:4px 0;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
          <img src="${msgObj.imageUrl}" alt="Shared image" style="width:100%;max-height:180px;object-fit:cover;display:block;" />
        </div>
      `;
    }

    const lines = text.split('\n');

    const renderedLines = lines.map((line, lIdx) => {
      if (line.startsWith('```') && line.endsWith('```') && line.length > 6) {
        const codeText = line.slice(3, -3);
        return `
          <div style="background:rgba(0,0,0,0.45);padding:6px 8px;border-radius:6px;margin:4px 0;font-family:var(--font-mono);font-size:11px;position:relative;">
            <pre style="margin:0;white-space:pre-wrap;word-break:break-all;">${this.escapeHtml(codeText)}</pre>
          </div>
        `;
      }

      if (line.includes('||')) {
        const parts = line.split(/(\|\|.*?\|\|)/g);
        const renderedParts = parts.map((part, pIdx) => {
          if (part.startsWith('||') && part.endsWith('||') && part.length > 4) {
            const spoilerContent = part.slice(2, -2);
            const sKey = `${msgIdx}-${lIdx}-${pIdx}`;
            const isRevealed = Boolean(this.revealedSpoilers[sKey]);

            return `
              <span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${isRevealed ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.15)'};filter:${isRevealed ? 'none' : 'blur(4px)'};cursor:pointer;">
                ${this.escapeHtml(spoilerContent)}
              </span>
            `;
          }
          return this.renderMentionsHtml(this.escapeHtml(part));
        }).join('');

        return `<p style="margin:2px 0;">${renderedParts}</p>`;
      }

      return `<p style="margin:2px 0;">${this.renderMentionsHtml(this.escapeHtml(line))}</p>`;
    }).join('');

    return output + renderedLines;
  }

  private renderMentionsHtml(escapedStr: string): string {
    if (!escapedStr.includes('@')) return escapedStr;
    return escapedStr.replace(/(@everyone|@all)/g, '<span style="background:rgba(245,158,11,0.25);border:1px solid rgba(245,158,11,0.5);color:#fbbf24;padding:1px 4px;border-radius:3px;font-weight:700;font-size:10px;">📣 $1</span>')
      .replace(/(@[a-zA-Z0-9_-]+)/g, '<span style="background:rgba(99,102,241,0.25);border:1px solid rgba(99,102,241,0.4);color:#c7d2fe;padding:1px 4px;border-radius:3px;font-weight:600;font-size:10px;">$1</span>');
  }

  private deduplicateMessages(raw: any[]): ChatMessageData[] {
    const seen = new Set<string>();
    const unique: ChatMessageData[] = [];

    for (const m of raw) {
      if (!m || !m.id) continue;
      if (!seen.has(m.id)) {
        seen.add(m.id);
        unique.push({
          ...m,
          isSelf: m.from?.peerId === this.myIdentity?.peerId || m.isSelf,
        });
      }
    }
    return unique;
  }

  private async sendMessage(text: string, replyTo?: { id: string; preview: string }) {
    if (!text.trim()) return;

    if (!this.currentRoomStorageKey && this.currentProblem?.roomId) {
      this.currentRoomStorageKey = `synqto_chat_${this.currentProblem.roomId}`;
    }

    const trimmed = text.trim();
    const messageId = 'msg-' + Math.random().toString(36).slice(2, 10) + Date.now();
    const myMsg: ChatMessageData = {
      id: messageId,
      from: this.myIdentity || { nickname: 'You', avatar: '⚡', color: '#6366f1', peerId: 'self' },
      text: trimmed,
      timestamp: Date.now(),
      replyTo: replyTo?.id,
      replyPreview: replyTo?.preview,
      status: 'sent',
      isSelf: true,
    };

    this.messages.push(myMsg);
    this.messages = this.deduplicateMessages(this.messages);
    this.render();
    this.scrollToBottom();

    if (this.currentRoomStorageKey && typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([this.currentRoomStorageKey]);
        const existing = (res[this.currentRoomStorageKey] && Array.isArray(res[this.currentRoomStorageKey]))
          ? res[this.currentRoomStorageKey]
          : [];
        const updated = this.deduplicateMessages([...existing, myMsg]).slice(-150);
        await chrome.storage.local.set({ [this.currentRoomStorageKey]: updated });
      } catch (e) {}
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SEND_PAGE_CHAT_MESSAGE',
        messageId,
        text: myMsg.text,
        replyTo: myMsg.replyTo,
        replyPreview: myMsg.replyPreview,
        roomId: this.currentProblem?.roomId,
      }).catch(() => {});
    }
  }

  private async loadMessages() {
    if (!this.currentRoomStorageKey) return;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([this.currentRoomStorageKey]);
      if (res[this.currentRoomStorageKey] && Array.isArray(res[this.currentRoomStorageKey])) {
        this.messages = this.deduplicateMessages(res[this.currentRoomStorageKey]);
        if (this.isOpen && this.activeTab === 'chat') {
          this.render();
          this.scrollToBottom();
        }
      }
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const list = this.shadow?.getElementById('nb-messages');
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    }, 40);
  }

  private listenToStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.nerd_buddy_sidepanel_open) {
            if (changes.nerd_buddy_sidepanel_open.newValue === true && this.isOpen) {
              this.isOpen = false;
              this.render();
            }
          }
          if (changes.synqto_live_stage || changes.nerd_buddy_live_stage) {
            this.liveStage = (changes.synqto_live_stage || changes.nerd_buddy_live_stage).newValue;
            this.render();
          }
          if (changes.synqto_identity || changes.nerd_buddy_identity) {
            this.myIdentity = (changes.synqto_identity || changes.nerd_buddy_identity).newValue;
          }
          if (changes[SYNQTO_FAB_STORAGE_KEY] || changes[FAB_STORAGE_KEY]) {
            const raw = (changes[SYNQTO_FAB_STORAGE_KEY] || changes[FAB_STORAGE_KEY])?.newValue;
            if (raw) {
              this.settings = { ...DEFAULT_FAB_SETTINGS, ...raw };
              if (this.settings.positionMode === 'permanent' && this.settings.savedPosition) {
                this.currentPosition = { ...this.settings.savedPosition };
              }
              this.checkVisibilityAndRender();
              if (this.hostElement) {
                this.render();
              }
            }
          }
          if (changes.synqto_active_problem || changes.nerd_buddy_active_problem) {
            this.currentProblem = (changes.synqto_active_problem || changes.nerd_buddy_active_problem).newValue;
            this.currentRoomStorageKey = `synqto_chat_${this.currentProblem?.roomId || ''}`;
            this.loadMessages();
            this.checkVisibilityAndRender();
          }
          if (changes.nerd_buddy_peer_count) {
            this.peerCount = Math.max(1, changes.nerd_buddy_peer_count.newValue || 1);
            this.render();
          }
          if (this.currentRoomStorageKey && changes[this.currentRoomStorageKey]) {
            const raw = changes[this.currentRoomStorageKey].newValue || [];
            this.messages = this.deduplicateMessages(raw);
            if (!this.isOpen && changes[this.currentRoomStorageKey].newValue?.length > (changes[this.currentRoomStorageKey].oldValue?.length || 0)) {
              this.unreadCount++;
            }
            this.render();
            if (this.isOpen && this.activeTab === 'chat') {
              this.scrollToBottom();
            }
          }
        }
      });
    }
  }
}
