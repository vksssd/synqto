import { FabSettings, DEFAULT_FAB_SETTINGS, FAB_STORAGE_KEY, SYNQTO_FAB_STORAGE_KEY, FabPosition } from '@/features/settings/fab-settings.types';
import { THEME_SETTINGS_STORAGE_KEY } from '@/features/settings/theme.service';
import { detectResource } from './resource-detector';
import { getPlatformBadgeColor, computeRoomId } from '@/features/room/room-utils';
import {
  TimerState,
  PomodoroConfig,
  DEFAULT_POMODORO_CONFIG,
  POMODORO_CONFIG_STORAGE_KEY,
  POMODORO_STATE_STORAGE_KEY,
  TimerMode,
} from '@/features/timer/timer.types';
import { WhiteboardToolType } from '@/features/whiteboard/whiteboard.types';

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
  tool:
    | WhiteboardToolType
    | 'select'
    | 'hand'
    | 'dns_router'
    | 'firewall'
    | 'star'
    | 'rounded_rect'
    | 'triangle'
    | 'decision_diamond'
    | 'sticky_note'
    | 'code_box'
    | 'array_cells'
    | 'stack_lifo'
    | 'queue_fifo'
    | 'hashmap_table'
    | 'two_pointers'
    | 'db_nosql'
    | 'cache_mem'
    | 'cdn_edge'
    | 'object_storage'
    | 'auth_jwt'
    | 'websocket_gw'
    | 'elasticsearch'
    | 'user_client'
    | 'mobile_client'
    | 'async_arrow'
    | 'tradeoff_note';
  color: string;
  width: number;
  opacity: number;
  points: WhiteboardPoint[];
  geometry?: { x1: number; y1: number; x2: number; y2: number; label?: string };
  text?: string;
  expiresAt?: number;
}

// ── Geometric Collision & Bounding Box Helpers ──
function getStrokeBounds(stroke: InPageStroke): { minX: number; minY: number; maxX: number; maxY: number } {
  if (stroke.geometry) {
    const minX = Math.min(stroke.geometry.x1, stroke.geometry.x2);
    const maxX = Math.max(stroke.geometry.x1, stroke.geometry.x2);
    const minY = Math.min(stroke.geometry.y1, stroke.geometry.y2);
    const maxY = Math.max(stroke.geometry.y1, stroke.geometry.y2);
    return { minX, minY, maxX, maxY };
  }
  if (stroke.points && stroke.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function isStrokeInRect(stroke: InPageStroke, rect: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const rMinX = Math.min(rect.x1, rect.x2);
  const rMaxX = Math.max(rect.x1, rect.x2);
  const rMinY = Math.min(rect.y1, rect.y2);
  const rMaxY = Math.max(rect.y1, rect.y2);
  const b = getStrokeBounds(stroke);
  return !(b.maxX < rMinX || b.minX > rMaxX || b.maxY < rMinY || b.minY > rMaxY);
}

function moveStroke(stroke: InPageStroke, dx: number, dy: number): InPageStroke {
  const updated = { ...stroke };
  if (updated.geometry) {
    updated.geometry = {
      ...updated.geometry,
      x1: updated.geometry.x1 + dx,
      y1: updated.geometry.y1 + dy,
      x2: updated.geometry.x2 + dx,
      y2: updated.geometry.y2 + dy,
    };
  }
  if (updated.points && updated.points.length > 0) {
    updated.points = updated.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return updated;
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
  private isServerConnected = true;
  private serverToastMessage: string | null = null;
  private replyingTo: ChatMessageData | null = null;
  private revealedSpoilers: Record<string, boolean> = {};

  // Draggable Position State
  private currentPosition: FabPosition = { right: 24, bottom: 24 };
  private isDragging = false;
  private dragMoved = false;
  private popupSize: 'compact' | 'medium' | 'large' | 'fullscreen' = 'compact';

  // Whiteboard & Chat State
  private activeTab: 'chat' | 'whiteboard' = 'chat';

  // Focus Timer & Pomodoro State (Independent Popup Window)
  private isTimerOpen: boolean = false;
  private timerConfig: PomodoroConfig = DEFAULT_POMODORO_CONFIG;
  private timerState: TimerState = {
    mode: 'pomodoro',
    timeLeftSec: 25 * 60,
    targetDurationSec: 25 * 60,
    isRunning: false,
    sessionsCompleted: 0,
    lastUpdated: Date.now(),
  };
  private timerInterval: any = null;
  private wbTool: WhiteboardToolType = 'pen';
  private wbShowShapesDrawer: boolean = false;
  private wbShowDsaDrawer: boolean = false;
  private wbShowArchDrawer: boolean = false;
  private wbShowThemesDrawer: boolean = false;
  private toolStyles: Record<string, { color: string; width: number }> = {
    select: { color: '#6366f1', width: 3 },
    hand: { color: '#6366f1', width: 3 },
    pen: { color: '#6366f1', width: 3 },
    brush: { color: '#06b6d4', width: 6 },
    highlighter: { color: '#f59e0b', width: 16 },
    temp_pen: { color: '#38bdf8', width: 3 },
    laser: { color: '#ef4444', width: 3 },
    torch: { color: '#facc15', width: 65 },
    eraser: { color: '#ffffff', width: 18 },
    text: { color: '#ffffff', width: 3 },
    code_box: { color: '#38bdf8', width: 2 },
    line: { color: '#6366f1', width: 3 },
    arrow: { color: '#6366f1', width: 3 },
    arrow_bi: { color: '#6366f1', width: 3 },
    rect: { color: '#6366f1', width: 3 },
    rounded_rect: { color: '#6366f1', width: 3 },
    circle: { color: '#6366f1', width: 3 },
    triangle: { color: '#10b981', width: 3 },
    star: { color: '#f59e0b', width: 3 },
    decision_diamond: { color: '#f59e0b', width: 3 },
    tree_node: { color: '#10b981', width: 3 },
    sticky_note: { color: '#fef3c7', width: 2 },
    db_cylinder: { color: '#10b981', width: 2.5 },
    db_nosql: { color: '#34d399', width: 2.5 },
    cloud: { color: '#38bdf8', width: 2.5 },
    load_balancer: { color: '#f59e0b', width: 2.5 },
    message_queue: { color: '#a855f7', width: 2.5 },
    server_box: { color: '#818cf8', width: 2.5 },
    cache_mem: { color: '#f43f5e', width: 2.5 },
    dns_router: { color: '#38bdf8', width: 2.5 },
    firewall: { color: '#f43f5e', width: 2.5 },
    user_client: { color: '#3b82f6', width: 2.5 },
    mobile_client: { color: '#06b6d4', width: 2.5 },
    array_cells: { color: '#38bdf8', width: 2.5 },
    stack_lifo: { color: '#f59e0b', width: 2.5 },
    queue_fifo: { color: '#10b981', width: 2.5 },
    hashmap_table: { color: '#a855f7', width: 2.5 },
    two_pointers: { color: '#ec4899', width: 2 },
    cdn_edge: { color: '#06b6d4', width: 2.5 },
    object_storage: { color: '#f97316', width: 2.5 },
    auth_jwt: { color: '#eab308', width: 2.5 },
    websocket_gw: { color: '#6366f1', width: 2.5 },
    elasticsearch: { color: '#14b8a6', width: 2.5 },
    async_arrow: { color: '#a855f7', width: 2 },
    tradeoff_note: { color: '#facc15', width: 2 },
  };
  private wbColor: string = '#6366f1';
  private wbWidth: number = 3;
  private wbTheme: string = 'grid';
  private wbBgColor: string = '#090d16';
  private wbPrivacyMode: 'collaborative' | 'personal' = 'personal';
  private wbStrokes: InPageStroke[] = [];
  private wbPersonalStrokes: InPageStroke[] = [];
  private wbPersonalTheme: string = 'grid';
  private wbPersonalBgColor: string = '#090d16';
  private wbRedoStack: InPageStroke[] = [];
  private isWbDrawing: boolean = false;
  private wbCurrentPoints: WhiteboardPoint[] = [];
  private wbStartPoint: WhiteboardPoint | null = null;
  private tempDisappearingStrokes: { stroke: InPageStroke; createdAt: number; durationMs: number }[] = [];
  private wbLaserTrails: { x: number; y: number; alpha: number; timestamp: number }[] = [];
  private wbTorchPos: WhiteboardPoint | null = null;
  private wbEraserPos: WhiteboardPoint | null = null;
  private wbSelectedStrokeIds: string[] = [];
  private wbSelectionBox: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private wbClipboardStrokes: InPageStroke[] = [];
  private wbIsMovingSelection: boolean = false;
  private wbDragStartCoords: { x: number; y: number } | null = null;
  private wbIsMarqueeSelecting: boolean = false;
  private wbAnimationRafId: number | null = null;
  private wbDrawRafScheduled: boolean = false;
  private latestPreviewPoints?: WhiteboardPoint[];
  private latestPreviewGeometry?: any;
  private wbPatternCache: Map<string, CanvasPattern> = new Map();
  private themeSettings: any = null;

  constructor() {
    this.init();
  }

  private async init() {
    await this.loadIdentity();
    await this.loadSettings();
    await this.loadInPagePersonalBoard();
    await this.loadServerConnectionStatus();
    await this.loadTimerState();
    this.startTimerTickLoop();
    this.detectCurrentPageProblem();
    this.checkVisibilityAndRender();
    this.listenToStorageChanges();
    this.listenForRuntimeMessages();
    console.log('[Synqto] Floating widget initialized. State:', this.shouldShow() ? 'VISIBLE' : 'HIDDEN', 'Mode:', this.settings.mode);
  }

  private async loadServerConnectionStatus() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_server_connected', 'nerd_buddy_server_connected']);
        this.isServerConnected = Boolean(res.synqto_server_connected ?? res.nerd_buddy_server_connected ?? true);
      } catch (e) {
        this.isServerConnected = true;
      }
    }
  }

  private async loadIdentity() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(['synqto_identity', 'nerd_buddy_identity']);
      this.myIdentity = res.synqto_identity || res.nerd_buddy_identity || null;
    }
  }

  private async loadInPagePersonalBoard() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_inpage_personal_board', 'synqto_wb_privacy_mode']);
        if (res.synqto_inpage_personal_board) {
          const board = res.synqto_inpage_personal_board;
          if (Array.isArray(board.strokes)) this.wbPersonalStrokes = board.strokes;
          if (board.theme) this.wbPersonalTheme = board.theme;
          if (board.bgColor) this.wbPersonalBgColor = board.bgColor;
        }
        if (res.synqto_wb_privacy_mode) {
          this.wbPrivacyMode = res.synqto_wb_privacy_mode;
        }
      } catch (e) {}
    }
  }

  private saveInPagePersonalBoard() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({
          synqto_inpage_personal_board: {
            strokes: this.wbPersonalStrokes,
            theme: this.wbPersonalTheme,
            bgColor: this.wbPersonalBgColor,
          },
          synqto_wb_privacy_mode: this.wbPrivacyMode,
        });
      } catch (e) {}
    }
  }

  private async loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        FAB_STORAGE_KEY,
        SYNQTO_FAB_STORAGE_KEY,
        // Single source of truth for theming across sidepanel, popup card and FAB.
        // This previously read 'synqto_theme_settings', which NOTHING ever writes —
        // ThemeService persists to 'synqto_theme_custom_settings'. So the widget silently
        // ignored every theme change and drifted permanently out of sync with the panel.
        THEME_SETTINGS_STORAGE_KEY,
        'synqto_collab_notebook',
        'synqto_active_problem',
        'nerd_buddy_active_problem',
        'synqto_live_stage',
        'nerd_buddy_live_stage',
        'nerd_buddy_sidepanel_open',
        'nerd_buddy_peer_count',
      ]);

      if (res[THEME_SETTINGS_STORAGE_KEY]) {
        this.themeSettings = res[THEME_SETTINGS_STORAGE_KEY];
      }

      if (res.synqto_collab_notebook && Array.isArray(res.synqto_collab_notebook.pages)) {
        const nb = res.synqto_collab_notebook;
        const activePage = nb.pages.find((p: any) => p.id === nb.activePageId) || nb.pages[0];
        if (activePage) {
          this.wbStrokes = activePage.strokes || [];
          if (activePage.background) this.wbTheme = activePage.background;
          if (activePage.bgColor) this.wbBgColor = activePage.bgColor;
        }
      }

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
      'leetcode.cn',
      'neetcode.io',
      'codeforces.com',
      'codeforces.net',
      'hackerrank.com',
      'geeksforgeeks.org',
      'codechef.com',
      'atcoder.jp',
      'hackerearth.com',
      'topcoder.com',
      'spoj.com',
      'codewars.com',
      'exercism.org',
      'github.com',
      'youtube.com',
      'arxiv.org',
      'localhost',
      '127.0.0.1',
    ];

    const isCodingDomain = codingDomains.some((d) => hostname.includes(d));
    const isDetected = Boolean(this.currentProblem || detectResource(window.location.href, document.title));
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
      // The shadow root is gone, so the injected <style> node is gone with it. Clear the
      // signature or a later re-create would skip re-injecting the stylesheet and render
      // the widget completely unstyled.
      this.lastStyleSignature = '';
    }
  }

  private createWidgetDOM() {
    if (document.getElementById('synqto-floating-host')) return;

    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.checkVisibilityAndRender(), { once: true });
      } else {
        window.addEventListener('load', () => this.checkVisibilityAndRender(), { once: true });
      }
      return;
    }

    const host = document.createElement('div');
    host.id = 'synqto-floating-host';
    const curRight = Number.isFinite(this.currentPosition?.right) ? this.currentPosition.right : 24;
    const curBottom = Number.isFinite(this.currentPosition?.bottom) ? this.currentPosition.bottom : 24;
    host.style.cssText = `
      position: fixed !important;
      bottom: ${curBottom}px !important;
      right: ${curRight}px !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      touch-action: none !important;
      pointer-events: auto !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    `;
    document.body.appendChild(host);
    this.hostElement = host;
    this.shadow = host.attachShadow({ mode: 'open' });

    this.render();
  }

  private applyHostPosition() {
    if (!this.hostElement) return;
    const curRight = Number.isFinite(this.currentPosition?.right) ? this.currentPosition.right : 24;
    const curBottom = Number.isFinite(this.currentPosition?.bottom) ? this.currentPosition.bottom : 24;
    const right = Math.max(10, Math.min(window.innerWidth - 130, curRight));
    const bottom = Math.max(10, Math.min(window.innerHeight - 55, curBottom));
    this.hostElement.style.setProperty('right', `${right}px`, 'important');
    this.hostElement.style.setProperty('bottom', `${bottom}px`, 'important');
  }

  /** Signature of the currently injected stylesheet, so it is only re-parsed on real change. */
  private lastStyleSignature = '';

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
    const fabLabel = 'synqto';

    // Dynamic positioning for popup card based on where the FAB is dragged
    const isNearTop = this.currentPosition.bottom > (window.innerHeight - 540);
    const isNearLeft = this.currentPosition.right > (window.innerWidth - 420);

    // RENDER SPLIT — static stylesheet vs dynamic body.
    //
    // This used to be a single `this.shadow.innerHTML = ...` covering ~53KB of markup,
    // INCLUDING a ~16KB <style> block, and render() is called from ~30 places (every button
    // click). Replacing shadow.innerHTML tears down and re-parses the entire stylesheet each
    // time, which is the visible "blink": for one frame the widget has no styles at all. It
    // also destroys focus, scroll position, in-flight CSS transitions and any text the user
    // was typing, and churns every event listener.
    //
    // The stylesheet only changes when the theme changes, so it is injected once into a
    // dedicated <style> node and left alone. Re-renders now touch only the body container.
    const styleHtml = `
      <style>
        :host {
          ${this.getThemeCSS()}
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
          font-size: var(--font-size-md);
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
          font-size: var(--font-size-sm);
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

        .timer-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #f43f5e;
          box-shadow: 0 0 8px #f43f5e;
          animation: livePulse 1.2s infinite;
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.2); }
        }

        @keyframes rocketThrust {
          0% { transform: translateY(0px) rotate(45deg); }
          100% { transform: translateY(-2px) rotate(52deg); }
        }

        @keyframes flameFlicker {
          0% { opacity: 0.7; transform: scale(0.85); }
          100% { opacity: 1; transform: scale(1.25); }
        }

        @keyframes neonTrackGlow {
          0% { box-shadow: 0 0 5px rgba(244, 63, 94, 0.4); }
          100% { box-shadow: 0 0 15px rgba(244, 63, 94, 0.8), 0 0 25px rgba(99, 102, 241, 0.5); }
        }

        /* Standalone Rocket Racing Focus Timer FAB */
        .timer-fab-button {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #1e1035 0%, #0f172a 100%);
          border: 1px solid rgba(244, 63, 94, 0.55);
          box-shadow: 0 10px 25px -5px rgba(244, 63, 94, 0.45), 0 0 18px rgba(99, 102, 241, 0.3);
          color: #ffffff;
          font-size: var(--font-size-md);
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s, border-color 0.2s;
          user-select: none;
          backdrop-filter: blur(16px);
        }

        .timer-fab-button:hover {
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 14px 28px -5px rgba(244, 63, 94, 0.65), 0 0 25px rgba(244, 63, 94, 0.5);
          border-color: rgba(244, 63, 94, 0.85);
        }

        .timer-fab-track {
          width: 52px;
          height: 6px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.12);
          position: relative;
          overflow: hidden;
        }

        .timer-fab-fill {
          height: 100%;
          background: linear-gradient(90deg, #6366f1, #f43f5e);
          box-shadow: 0 0 8px rgba(244, 63, 94, 0.8);
          transition: width 0.4s ease;
        }

        .timer-fab-rocket {
          font-size: var(--font-size-md);
          display: inline-block;
          filter: drop-shadow(0 0 6px rgba(244, 63, 94, 0.9));
        }

        .fab-badge {
          position: absolute;
          top: -4px;
          right: -4px;
          background: #f59e0b;
          color: #ffffff;
          font-size: var(--font-size-xs);
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

        /* Dedicated Standalone Timer & Pomodoro Popup Window */
        .timer-popup-card {
          display: ${this.isTimerOpen ? 'flex' : 'none'};
          flex-direction: column;
          position: absolute;
          ${isNearTop ? 'top: 52px; bottom: auto;' : 'bottom: 52px; top: auto;'}
          ${isNearLeft ? 'left: 0; right: auto;' : 'right: 0; left: auto;'}
          width: 320px;
          background: rgba(15, 23, 42, 0.98);
          border: 1px solid rgba(244, 63, 94, 0.5);
          border-radius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.95), 0 0 28px rgba(244, 63, 94, 0.3);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          z-index: 100;
          overflow: hidden;
          animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          color: var(--text-primary);
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
          font-size: var(--font-size-md);
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
          font-size: var(--font-size-2xs);
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: ${platformColor}20;
          border: 1px solid ${platformColor}50;
          color: ${platformColor};
          text-transform: uppercase;
        }

        .peer-count-pill {
          font-size: var(--font-size-xs);
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
          font-size: var(--font-size-sm);
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
          max-width: 82%;
          min-width: 80px;
          padding: 6px 9px 4px 10px;
          border-radius: 9px;
          font-size: var(--font-size-md);
          position: relative;
          word-break: break-word;
          line-height: 1.42;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
        }

        .chat-bubble.self {
          align-self: flex-end;
          background: linear-gradient(135deg, rgba(45, 212, 191, 0.18), rgba(20, 184, 166, 0.24));
          border: 1px solid rgba(45, 212, 191, 0.32);
          border-top-right-radius: 2px;
          color: var(--text-primary, #ffffff);
        }

        .chat-bubble.other {
          align-self: flex-start;
          background: var(--bg-surface-elevated, #1e2b2f);
          border: 1px solid var(--border-subtle);
          border-top-left-radius: 2px;
          color: var(--text-primary, #f1f5f9);
        }

        .wa-quote-box {
          background: rgba(0, 0, 0, 0.22);
          border-left: 3px solid var(--primary);
          border-radius: 4px;
          padding: 3px 6px;
          margin-bottom: 4px;
          font-size: var(--font-size-xs);
        }

        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 2px;
          font-size: var(--font-size-xs);
        }

        .chat-author {
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .chat-meta {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          float: right;
          margin-left: 8px;
          margin-top: 3px;
          font-size: var(--font-size-xs);
          color: var(--text-dim, #94a3b8);
          user-select: none;
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
          font-size: var(--font-size-sm);
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
          font-size: var(--font-size-2xs);
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
          font-size: var(--font-size-sm);
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
          font-size: var(--font-size-2xs);
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
      </style>`;

    const bodyHtml = `

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
                <span class="peer-count-pill" title="${this.isServerConnected ? 'Signaling Server: Connected (wss://synqto-server.onrender.com/ws/)' : 'Signaling Server: Disconnected (Offline Mode)'}">
                  <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${this.isServerConnected ? '#10b981' : '#ef4444'};box-shadow:0 0 6px ${this.isServerConnected ? '#10b981' : '#ef4444'};"></span>
                  <span>${this.peerCount} Online ${this.isServerConnected ? '' : '(Offline)'}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="header-actions">
            <!-- Popup Size Mode Switcher Pills -->
            <div class="popup-size-group" style="display:flex;gap:2px;align-items:center;background:rgba(0,0,0,0.35);padding:2px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);margin-right:2px;">
              <button class="size-mode-pill ${this.popupSize === 'compact' ? 'active' : ''}" data-popsize="compact" title="Compact Size (420x540)" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'compact' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'compact' ? '#fff' : 'var(--text-muted)'};">📱 S</button>
              <button class="size-mode-pill ${this.popupSize === 'medium' ? 'active' : ''}" data-popsize="medium" title="Medium Split Size (620x640)" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'medium' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'medium' ? '#fff' : 'var(--text-muted)'};">🌗 M</button>
              <button class="size-mode-pill ${this.popupSize === 'large' ? 'active' : ''}" data-popsize="large" title="Large Widescreen (860x740)" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'large' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'large' ? '#fff' : 'var(--text-muted)'};">🖥️ L</button>
              <button class="size-mode-pill ${this.popupSize === 'fullscreen' ? 'active' : ''}" data-popsize="fullscreen" title="Full Screen View (1180x880)" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:4px;border:none;cursor:pointer;background:${this.popupSize === 'fullscreen' ? 'var(--primary)' : 'transparent'};color:${this.popupSize === 'fullscreen' ? '#fff' : 'var(--text-muted)'};">📺 XL</button>
            </div>

            <!--
              CoFocus entry point.

              CoFocus needs the full side-panel UI (camera tiles, launcher, countdown), so this
              opens the panel with the launcher already showing rather than duplicating the whole
              feature inside the widget's shadow DOM. Without it, users who work entirely from the
              FAB and never open the side panel had NO route to CoFocus at all.
            -->
            <button class="icon-btn" id="nb-open-cofocus" title="CoFocus — find a study partner">
              <span style="font-size:13px;line-height:1;">🎯</span>
            </button>
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

        <!-- Green Vanishing Toast on Server Connection Established -->
        ${this.serverToastMessage ? `
          <div style="background:linear-gradient(135deg, rgba(16, 185, 129, 0.96), rgba(5, 150, 105, 0.96));color:#fff;padding:6px 10px;font-size: var(--font-size-xs);font-weight:600;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(16, 185, 129, 0.4);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span>⚡</span>
              <span>${this.escapeHtml(this.serverToastMessage)}</span>
            </div>
            <span style="font-size: var(--font-size-2xs);background:rgba(0,0,0,0.25);padding:1px 5px;border-radius:3px;">P2P Active</span>
          </div>
        ` : ''}

        <!-- Red Offline Notice Banner when Server is Unreachable -->
        ${!this.isServerConnected ? `
          <div style="background:linear-gradient(135deg, #ef4444, #dc2626);color:#fff;padding:5px 10px;font-size: var(--font-size-xs);font-weight:600;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.2);">
            <div style="display:flex;align-items:center;gap:5px;">
              <span>⚠️</span>
              <span>Server Offline (Local Mode)</span>
            </div>
            <button id="nb-offline-sidepanel-reconnect" style="background:rgba(0,0,0,0.3);color:#fff;border:1px solid rgba(255,255,255,0.25);padding:2px 6px;border-radius:4px;font-size: var(--font-size-2xs);font-weight:700;cursor:pointer;">
              Reconnect in Side Panel ⚡
            </button>
          </div>
        ` : ''}

        <!-- Segmented Switcher for Chat and Whiteboard -->
        <div class="tab-switcher" style="display:flex;border-bottom:1px solid var(--border-subtle);background:rgba(0,0,0,0.25);">
          <button class="tab-btn ${this.activeTab === 'chat' ? 'active' : ''}" id="nb-tab-chat" style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 4px;font-size: var(--font-size-sm);font-weight:600;background:transparent;border:none;border-bottom:2px solid ${this.activeTab === 'chat' ? 'var(--primary)' : 'transparent'};color:${this.activeTab === 'chat' ? '#fff' : 'var(--text-muted)'};cursor:pointer;">
            <span>💬 Live Chat</span>
          </button>
          ${this.settings.enableWhiteboard ? `
            <button class="tab-btn ${this.activeTab === 'whiteboard' ? 'active' : ''}" id="nb-tab-whiteboard" style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:8px 4px;font-size: var(--font-size-sm);font-weight:600;background:transparent;border:none;border-bottom:2px solid ${this.activeTab === 'whiteboard' ? 'var(--primary)' : 'transparent'};color:${this.activeTab === 'whiteboard' ? '#fff' : 'var(--text-muted)'};cursor:pointer;">
              <span>🎨 Whiteboard</span>
            </button>
          ` : ''}
        </div>

        <!-- Multi-Broadcaster Live Streams List -->
        ${isLive ? `
          <div style="background:linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(139, 92, 246, 0.18));border-bottom:1px solid rgba(239, 68, 68, 0.35);padding:6px 10px;display:flex;flex-direction:column;gap:5px;">
            <div style="display:flex;align-items:center;justify-content:space-between;font-size: var(--font-size-xs);color:#fca5a5;">
              <div style="display:flex;align-items:center;gap:5px;font-weight:700;">
                <span class="live-dot"></span>
                <span>LIVE STREAMS (${(this.liveStage.activeStreams && this.liveStage.activeStreams.length) || 1}):</span>
              </div>
              <button id="nb-live-tunein" style="background:#ef4444;color:#fff;border:none;padding:2px 8px;border-radius:4px;font-size: var(--font-size-2xs);font-weight:700;cursor:pointer;">
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
                <div style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);font-size: var(--font-size-xs);color:#f8fafc;white-space:nowrap;">
                  <span>${s.broadcasterIdentity?.avatar || '👤'}</span>
                  <span style="font-weight:600;">${s.broadcasterIdentity?.nickname || 'Streamer'}:</span>
                  <span style="color:#c7d2fe;max-width:110px;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(s.title || 'Live Stream')}</span>
                  <span style="font-size: var(--font-size-2xs);padding:1px 4px;border-radius:3px;background:rgba(239,68,68,0.3);color:#fca5a5;text-transform:uppercase;">${s.broadcastType || 'live'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Main Body: Whiteboard or Problem Chat Stream -->
        ${isWhiteboardTab ? `
          <!-- Whiteboard View -->
          <div class="whiteboard-container">
            <div class="wb-toolbar">
              <div class="wb-tool-group" style="flex-wrap:wrap;gap:2px;">
                <button class="wb-tool-btn ${this.wbTool === 'select' ? 'active' : ''}" data-wbtool="select" title="Select & Move (↖️)">↖️</button>
                <button class="wb-tool-btn ${this.wbTool === 'hand' ? 'active' : ''}" data-wbtool="hand" title="Pan Canvas (✋)">✋</button>
                <button class="wb-tool-btn ${this.wbTool === 'pen' ? 'active' : ''}" data-wbtool="pen" title="Fine Pen (✏️)">✏️</button>
                <button class="wb-tool-btn ${this.wbTool === 'brush' ? 'active' : ''}" data-wbtool="brush" title="Brush Pen (✒️)">✒️</button>
                <button class="wb-tool-btn ${this.wbTool === 'highlighter' ? 'active' : ''}" data-wbtool="highlighter" title="Translucent Highlighter (🖍️)">🖍️</button>
                <button class="wb-tool-btn ${this.wbTool === 'temp_pen' ? 'active' : ''}" data-wbtool="temp_pen" title="⏳ Disappearing Ink (3s Fade)">⏳</button>
                <button class="wb-tool-btn ${this.wbTool === 'laser' ? 'active' : ''}" data-wbtool="laser" title="Live Laser Pointer (🔴)">🔴</button>
                <button class="wb-tool-btn ${this.wbTool === 'torch' ? 'active' : ''}" data-wbtool="torch" title="Spotlight Torch (🔦)">🔦</button>
                <button class="wb-tool-btn ${this.wbTool === 'eraser' ? 'active' : ''}" data-wbtool="eraser" title="Precision Eraser (🧹)">🧹</button>
                <button class="wb-tool-btn ${this.wbTool === 'text' ? 'active' : ''}" data-wbtool="text" title="Text Label (🔤)">🔤</button>

                <div style="width:1px;height:12px;background:var(--border-subtle);margin:0 1px;"></div>

                <!-- Drawer Toggles -->
                <button class="wb-drawer-toggle ${this.wbShowShapesDrawer ? 'active' : ''}" id="nb-wb-toggle-shapes" style="font-size: var(--font-size-2xs);padding:2px 4px;border-radius:4px;border:1px solid var(--border-subtle);background:${this.wbShowShapesDrawer ? 'rgba(99,102,241,0.25)' : 'transparent'};color:${this.wbShowShapesDrawer ? '#fff' : 'var(--text-muted)'};cursor:pointer;">
                  🔷 Shapes ${this.wbShowShapesDrawer ? '▲' : '▼'}
                </button>

                <button class="wb-drawer-toggle ${this.wbShowDsaDrawer ? 'active' : ''}" id="nb-wb-toggle-dsa" style="font-size: var(--font-size-2xs);padding:2px 4px;border-radius:4px;border:1px solid rgba(56,189,248,0.3);background:${this.wbShowDsaDrawer ? 'rgba(56,189,248,0.2)' : 'transparent'};color:${this.wbShowDsaDrawer ? '#38bdf8' : 'var(--text-muted)'};cursor:pointer;">
                  🔲 DSA ${this.wbShowDsaDrawer ? '▲' : '▼'}
                </button>

                <button class="wb-drawer-toggle ${this.wbShowArchDrawer ? 'active' : ''}" id="nb-wb-toggle-arch" style="font-size: var(--font-size-2xs);padding:2px 4px;border-radius:4px;border:1px solid var(--border-subtle);background:${this.wbShowArchDrawer ? 'rgba(99,102,241,0.25)' : 'transparent'};color:${this.wbShowArchDrawer ? '#fff' : 'var(--text-muted)'};cursor:pointer;">
                  🏛️ Arch ${this.wbShowArchDrawer ? '▲' : '▼'}
                </button>

                <button class="wb-drawer-toggle ${this.wbShowThemesDrawer ? 'active' : ''}" id="nb-wb-toggle-themes" style="font-size: var(--font-size-2xs);padding:2px 4px;border-radius:4px;border:1px solid var(--border-subtle);background:${this.wbShowThemesDrawer ? 'rgba(99,102,241,0.25)' : 'transparent'};color:${this.wbShowThemesDrawer ? '#fff' : 'var(--text-muted)'};cursor:pointer;">
                  🎨 Style ${this.wbShowThemesDrawer ? '▲' : '▼'}
                </button>
              </div>

              <!-- Right Controls -->
              <div class="wb-tool-group">
                <div style="display:flex;gap:2px;align-items:center;background:rgba(0,0,0,0.4);padding:2px 4px;border-radius:5px;border:1px solid var(--border-subtle);">
                  <button class="wb-privacy-btn" data-wbprivacy="personal" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:3px;border:none;cursor:pointer;background:${this.wbPrivacyMode === 'personal' ? 'linear-gradient(135deg, #f59e0b, #f43f5e)' : 'transparent'};color:${this.wbPrivacyMode === 'personal' ? '#fff' : 'var(--text-muted)'};" title="🔒 Personal Private Scratchpad (Offline, Independent)">🔒 Private</button>
                  <button class="wb-privacy-btn" data-wbprivacy="collaborative" style="font-size: var(--font-size-2xs);font-weight:700;padding:2px 5px;border-radius:3px;border:none;cursor:pointer;background:${this.wbPrivacyMode === 'collaborative' ? 'linear-gradient(135deg, #10b981, #06b6d4)' : 'transparent'};color:${this.wbPrivacyMode === 'collaborative' ? '#fff' : 'var(--text-muted)'};" title="👥 Collaborative Room Board (Synced across all peers)">👥 Collab</button>
                </div>
                <button class="wb-tool-btn" id="nb-wb-undo" title="Undo">↩️</button>
                <button class="wb-tool-btn" id="nb-wb-redo" title="Redo">↪️</button>
                <button class="wb-tool-btn" id="nb-wb-clear" title="Clear Canvas" style="color:#f87171;">🗑️</button>
                <button class="wb-tool-btn" id="nb-wb-save" title="Export PNG">💾</button>
                <button class="wb-tool-btn" id="nb-wb-popout" title="Open Standalone Popup Window">↗️</button>
              </div>
            </div>

            <!-- Floating Selection Action Bar -->
            <div id="nb-wb-selection-floating-bar" style="display:${this.wbSelectedStrokeIds.length > 0 ? 'flex' : 'none'};align-items:center;gap:4px;padding:3px 8px;background:rgba(15,23,42,0.95);border-bottom:1px solid #6366f1;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-size: var(--font-size-xs);">
              <span style="color:#818cf8;font-weight:700;margin-right:2px;">Selected (${this.wbSelectedStrokeIds.length}):</span>
              <button id="nb-wb-sel-copy" style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#fff;border-radius:3px;padding:2px 6px;cursor:pointer;font-size: var(--font-size-xs);" title="Copy (Ctrl+C)">📋 Copy</button>
              <button id="nb-wb-sel-dup" style="background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#fff;border-radius:3px;padding:2px 6px;cursor:pointer;font-size: var(--font-size-xs);" title="Duplicate (Ctrl+D)">✨ Dup</button>
              <button id="nb-wb-sel-paste" style="background:rgba(56,189,248,0.2);border:1px solid rgba(56,189,248,0.4);color:#fff;border-radius:3px;padding:2px 6px;cursor:pointer;font-size: var(--font-size-xs);" title="Paste (Ctrl+V)">📥 Paste</button>
              <button id="nb-wb-sel-del" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;border-radius:3px;padding:2px 6px;cursor:pointer;font-size: var(--font-size-xs);" title="Delete (Del)">🗑️ Delete</button>
              <button id="nb-wb-sel-clear" style="background:transparent;border:1px solid var(--border-subtle);color:var(--text-muted);border-radius:3px;padding:2px 6px;cursor:pointer;font-size: var(--font-size-xs);" title="Deselect (Esc)">✕</button>
            </div>

            <!-- Drawer: Shapes -->
            <div id="nb-wb-drawer-shapes" style="display:${this.wbShowShapesDrawer ? 'flex' : 'none'};align-items:center;gap:3px;padding:3px 6px;background:rgba(0,0,0,0.85);border-bottom:1px solid var(--border-subtle);overflow-x:auto;">
              <span style="font-size: var(--font-size-2xs);color:var(--text-muted);font-weight:600;">Shapes:</span>
              ${[
                { id: 'line', label: 'Line 📏' },
                { id: 'arrow', label: 'Arrow ➡️' },
                { id: 'arrow_bi', label: 'Bi-Arrow ↔️' },
                { id: 'rect', label: 'Rect 🔲' },
                { id: 'rounded_rect', label: 'Rounded ▢' },
                { id: 'circle', label: 'Circle ⭕' },
                { id: 'triangle', label: 'Triangle ▲' },
                { id: 'star', label: 'Star ⭐' },
                { id: 'decision_diamond', label: 'Diamond 💎' },
                { id: 'sticky_note', label: 'Sticky 📝' },
                { id: 'code_box', label: 'Code &lt;/&gt;' },
              ].map((t) => `
                <button class="wb-tool-btn ${this.wbTool === t.id ? 'active' : ''}" data-wbtool="${t.id}" style="font-size: var(--font-size-2xs);padding:2px 5px;white-space:nowrap;">${t.label}</button>
              `).join('')}
            </div>

            <!-- Drawer: DSA Visualizers -->
            <div id="nb-wb-drawer-dsa" style="display:${this.wbShowDsaDrawer ? 'flex' : 'none'};align-items:center;gap:3px;padding:3px 6px;background:rgba(8,28,44,0.95);border-bottom:1px solid rgba(56,189,248,0.3);overflow-x:auto;">
              <span style="font-size: var(--font-size-2xs);color:#7dd3fc;font-weight:700;">🔲 DSA:</span>
              ${[
                { id: 'array_cells', label: 'Array [0..N]' },
                { id: 'two_pointers', label: 'Two Pointers (L/R)' },
                { id: 'stack_lifo', label: 'Stack (LIFO)' },
                { id: 'queue_fifo', label: 'Queue (FIFO)' },
                { id: 'tree_node', label: 'Tree Node' },
                { id: 'hashmap_table', label: 'HashMap Bucket' },
                { id: 'decision_diamond', label: 'Branch Diamond' },
                { id: 'code_box', label: 'Pseudocode Box' },
              ].map((t) => `
                <button class="wb-tool-btn ${this.wbTool === t.id ? 'active' : ''}" data-wbtool="${t.id}" style="font-size: var(--font-size-2xs);padding:2px 5px;white-space:nowrap;color:#7dd3fc;">${t.label}</button>
              `).join('')}
            </div>

            <!-- Drawer: Architecture Shapes -->
            <div id="nb-wb-drawer-arch" style="display:${this.wbShowArchDrawer ? 'flex' : 'none'};align-items:center;gap:3px;padding:3px 6px;background:rgba(0,0,0,0.9);border-bottom:1px solid var(--border-subtle);overflow-x:auto;">
              <span style="font-size: var(--font-size-2xs);color:var(--text-muted);font-weight:600;">Arch:</span>
              ${[
                { id: 'db_cylinder', label: 'SQL DB' },
                { id: 'db_nosql', label: 'NoSQL' },
                { id: 'cache_mem', label: 'Redis' },
                { id: 'message_queue', label: 'Kafka' },
                { id: 'load_balancer', label: 'LB' },
                { id: 'server_box', label: 'App Server' },
                { id: 'cloud', label: 'API GW' },
                { id: 'cdn_edge', label: 'CDN Edge' },
                { id: 'object_storage', label: 'S3 Bucket' },
                { id: 'auth_jwt', label: 'Auth Shield' },
                { id: 'websocket_gw', label: 'WS Gateway' },
                { id: 'elasticsearch', label: 'ES Search' },
                { id: 'dns_router', label: 'DNS' },
                { id: 'firewall', label: 'Firewall' },
                { id: 'user_client', label: 'Client' },
                { id: 'mobile_client', label: 'Mobile' },
                { id: 'async_arrow', label: 'Async ⇢' },
                { id: 'tradeoff_note', label: '⚖️ CAP Card' },
              ].map((t) => `
                <button class="wb-tool-btn ${this.wbTool === t.id ? 'active' : ''}" data-wbtool="${t.id}" style="font-size: var(--font-size-2xs);padding:2px 5px;white-space:nowrap;">${t.label}</button>
              `).join('')}
            </div>

            <!-- Drawer: Style & Themes -->
            <div id="nb-wb-drawer-themes" class="wb-palette-bar" style="display:${this.wbShowThemesDrawer ? 'flex' : 'none'};flex-wrap:wrap;gap:4px;">
              <div style="display:flex;gap:2px;align-items:center;overflow-x:auto;">
                <button class="size-pill ${this.wbTheme === 'grid' ? 'active' : ''}" data-wbtheme="grid">⬛ Grid</button>
                <button class="size-pill ${this.wbTheme === 'isometric' ? 'active' : ''}" data-wbtheme="isometric">📐 3D Iso</button>
                <button class="size-pill ${this.wbTheme === 'ruled' ? 'active' : ''}" data-wbtheme="ruled">📏 Ruled</button>
                <button class="size-pill ${this.wbTheme === 'plot' ? 'active' : ''}" data-wbtheme="plot">📈 Plot</button>
                <button class="size-pill ${this.wbTheme === 'matrix' ? 'active' : ''}" data-wbtheme="matrix">📊 Matrix</button>
                <button class="size-pill ${this.wbTheme === 'dotted' ? 'active' : ''}" data-wbtheme="dotted">🟦 Dots</button>
                <button class="size-pill ${this.wbTheme === 'blank' ? 'active' : ''}" data-wbtheme="blank">Blank</button>
              </div>

              <div style="display:flex;gap:3px;align-items:center;">
                ${['#090d16', '#0f172a', '#062c24', '#fef3c7', '#ffffff', '#f8fafc', '#1e1035'].map((bg) => `
                  <div class="bg-dot" data-wbbg="${bg}" style="width:12px;height:12px;border-radius:3px;background:${bg};border:${this.wbBgColor === bg ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.25)'};cursor:pointer;" title="Background: ${bg}"></div>
                `).join('')}
              </div>

              <div style="display:flex;gap:4px;align-items:center;">
                ${['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#a855f7', '#ffffff', '#0f172a'].map((c) => `
                  <div class="color-dot ${this.wbColor === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></div>
                `).join('')}
              </div>

              <div style="display:flex;gap:2px;align-items:center;">
                <button class="size-pill ${this.wbWidth === 3 ? 'active' : ''}" data-size="3">S</button>
                <button class="size-pill ${this.wbWidth === 5 ? 'active' : ''}" data-size="5">M</button>
                <button class="size-pill ${this.wbWidth === 9 ? 'active' : ''}" data-size="9">L</button>
                <button class="size-pill ${this.wbWidth === 18 ? 'active' : ''}" data-size="18">XL</button>
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
                <div style="font-size: var(--font-size-md);font-weight:600;color:var(--text-secondary);">No messages yet</div>
                <div style="font-size: var(--font-size-sm);max-width:220px;">Say hello or ask for a hint! Messages are synchronized P2P across all peers.</div>
              </div>
            ` : this.messages.map((m, idx) => `
              <div class="chat-bubble ${m.isSelf ? 'self' : 'other'}" id="nb-msg-${m.id}">
                ${m.replyPreview ? `
                  <div class="wa-quote-box">
                    <div style="font-weight:700;color:var(--primary);">${this.escapeHtml(m.replyPreview.split(':')[0] || 'Reply')}</div>
                    <div style="color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(m.replyPreview)}</div>
                  </div>
                ` : ''}
                
                ${!m.isSelf ? `
                  <div class="chat-header">
                    <div class="chat-author">
                      <span>${m.from?.avatar || '👤'}</span>
                      <span style="color:${m.from?.color || 'var(--primary)'};">
                        ${this.escapeHtml(m.from?.nickname || 'Buddy')}
                      </span>
                    </div>
                    <button class="icon-btn nb-reply-trigger" data-id="${m.id}" data-text="${this.escapeHtml(m.text.slice(0, 35))}" data-nick="${this.escapeHtml(m.from?.nickname || 'Buddy')}" style="padding:0;width:18px;height:18px;" title="Reply">
                      ↩
                    </button>
                  </div>
                ` : ''}

                <div class="chat-body">
                  ${this.renderFormattedText(m.text, idx, m)}
                  
                  <span class="chat-meta">
                    <span>${this.formatTimestamp(m.timestamp)}</span>
                    ${m.isSelf ? `
                      <span class="ack-icon">
                        ${m.status === 'pending' ? '⏳' : ''}
                        ${m.status === 'sent' ? '<span style="color:var(--text-dim);">✓</span>' : ''}
                        ${m.status === 'delivered' ? '<span style="color:var(--text-secondary);">✓✓</span>' : ''}
                        ${m.status === 'read' ? '<span class="ack-read">✓✓</span>' : ''}
                      </span>
                    ` : ''}
                  </span>
                </div>
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

      <!-- Dedicated Standalone Focus Timer & Pomodoro Popup Window -->
      <div class="timer-popup-card" id="nb-timer-popup-card">
        <!-- Timer Header Bar -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);background:linear-gradient(135deg, rgba(30, 16, 53, 0.95), rgba(15, 23, 42, 0.95));">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:16px;">🍅</span>
            <div>
              <div style="font-size: var(--font-size-md);font-weight:700;color:#ffffff;line-height:1.2;">Focus Timer & Pomodoro</div>
              <div style="font-size: var(--font-size-xs);color:#fca5a5;font-weight:600;text-transform:uppercase;">
                ${this.timerState.mode === 'pomodoro' ? 'Deep Focus Session' : this.timerState.mode === 'short_break' ? 'Short Refresh Break' : this.timerState.mode === 'long_break' ? 'Extended Rest' : 'Open Stopwatch'}
              </div>
            </div>
          </div>
          <button class="icon-btn" id="nb-close-timer-popup" title="Minimize Timer" style="width:24px;height:24px;border-radius:6px;background:rgba(255,255,255,0.06);border:none;color:#94a3b8;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            ✕
          </button>
        </div>

        <!-- Timer Body -->
        <div style="padding:16px 14px;display:flex;flex-direction:column;gap:14px;align-items:center;">
          <!-- Mode Switcher Pills -->
          <div style="display:flex;gap:4px;background:rgba(0,0,0,0.4);padding:3px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);width:100%;justify-content:space-between;">
            <button class="timer-mode-btn ${this.timerState.mode === 'pomodoro' ? 'active' : ''}" data-tmode="pomodoro" style="flex:1;font-size: var(--font-size-xs);font-weight:700;padding:6px 2px;border-radius:6px;border:none;cursor:pointer;background:${this.timerState.mode === 'pomodoro' ? '#f43f5e' : 'transparent'};color:${this.timerState.mode === 'pomodoro' ? '#fff' : 'var(--text-muted)'};">🍅 Focus</button>
            <button class="timer-mode-btn ${this.timerState.mode === 'short_break' ? 'active' : ''}" data-tmode="short_break" style="flex:1;font-size: var(--font-size-xs);font-weight:700;padding:6px 2px;border-radius:6px;border:none;cursor:pointer;background:${this.timerState.mode === 'short_break' ? '#10b981' : 'transparent'};color:${this.timerState.mode === 'short_break' ? '#fff' : 'var(--text-muted)'};">☕ Break</button>
            <button class="timer-mode-btn ${this.timerState.mode === 'long_break' ? 'active' : ''}" data-tmode="long_break" style="flex:1;font-size: var(--font-size-xs);font-weight:700;padding:6px 2px;border-radius:6px;border:none;cursor:pointer;background:${this.timerState.mode === 'long_break' ? '#06b6d4' : 'transparent'};color:${this.timerState.mode === 'long_break' ? '#fff' : 'var(--text-muted)'};">🌴 Long</button>
            <button class="timer-mode-btn ${this.timerState.mode === 'stopwatch' ? 'active' : ''}" data-tmode="stopwatch" style="flex:1;font-size: var(--font-size-xs);font-weight:700;padding:6px 2px;border-radius:6px;border:none;cursor:pointer;background:${this.timerState.mode === 'stopwatch' ? '#8b5cf6' : 'transparent'};color:${this.timerState.mode === 'stopwatch' ? '#fff' : 'var(--text-muted)'};">⏱️ Clock</button>
          </div>

          <!-- Digital Clock Display & Rocket Racing Track -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;padding:18px 12px;background:rgba(255,255,255,0.02);border:1px solid ${this.timerState.isRunning ? (this.timerState.mode === 'pomodoro' ? '#f43f5e50' : this.timerState.mode === 'short_break' ? '#10b98150' : this.timerState.mode === 'long_break' ? '#06b6d450' : '#8b5cf650') : 'rgba(255,255,255,0.08)'};border-radius:14px;box-shadow:${this.timerState.isRunning ? '0 10px 30px -10px rgba(0,0,0,0.8)' : 'none'};position:relative;overflow:hidden;box-sizing:border-box;">
            
            <!-- 🚀 Rocket Racing Progress Track -->
            <div style="width:100%;height:8px;background:rgba(255,255,255,0.08);position:relative;overflow:hidden;border-radius:4px;">
              <div id="nb-timer-progress-fill" style="height:100%;width:${this.getTimerProgressPct()}%;background:linear-gradient(90deg, #6366f1, ${this.timerState.mode === 'pomodoro' ? '#f43f5e' : this.timerState.mode === 'short_break' ? '#10b981' : this.timerState.mode === 'long_break' ? '#06b6d4' : '#8b5cf6'});transition:width 0.4s ease;box-shadow:${this.timerState.isRunning ? '0 0 10px rgba(244,63,94,0.8)' : 'none'};"></div>
              <div style="position:absolute;top:-4px;left:calc(${Math.min(94, Math.max(2, this.getTimerProgressPct()))}% - 8px);font-size: var(--font-size-sm);pointer-events:none;transition:left 0.4s ease;">
                <span style="display:inline-block;animation:${this.timerState.isRunning ? 'rocketThrust 0.8s ease-in-out infinite alternate' : 'none'};">🚀</span>
              </div>
            </div>

            <div id="nb-timer-time" style="font-family:var(--font-mono);font-size:42px;font-weight:800;color:#ffffff;letter-spacing:-1px;line-height:1;margin-top:12px;">
              ${this.formatTimerTime(this.timerState.timeLeftSec)}
            </div>

            <!-- Racing Track Waypoints -->
            <div style="display:flex;justify-content:space-between;width:100%;font-size: var(--font-size-2xs);color:var(--text-muted);margin-top:8px;padding:0 2px;">
              <span>🛫 Launchpad</span>
              <span style="font-weight:700;color:#fca5a5;">${Math.round(this.getTimerProgressPct())}% Completed</span>
              <span>🏁 Goal</span>
            </div>

            ${this.timerState.sessionsCompleted > 0 ? `
              <div style="display:flex;align-items:center;gap:4px;margin-top:8px;font-size: var(--font-size-xs);padding:2px 8px;border-radius:10px;background:rgba(244,63,94,0.15);color:#f43f5e;font-weight:600;">
                <span>🎯</span>
                <span>${this.timerState.sessionsCompleted} Sessions Done</span>
              </div>
            ` : ''}
          </div>

          <!-- Timer Action Buttons -->
          <div style="display:flex;align-items:center;gap:8px;width:100%;">
            <button id="nb-timer-toggle" style="flex:2;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:8px;border:none;background:${this.timerState.isRunning ? '#ef4444' : 'linear-gradient(135deg, #4f46e5, #7c3aed)'};color:#ffffff;font-size: var(--font-size-md);font-weight:700;cursor:pointer;box-shadow:0 4px 15px rgba(99,102,241,0.4);">
              <span>${this.timerState.isRunning ? '⏸ Pause' : '▶ Start Focus'}</span>
            </button>
            <button id="nb-timer-add-1m" style="flex:1;padding:10px 4px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#f8fafc;font-size: var(--font-size-sm);font-weight:600;cursor:pointer;" title="Add 1 minute">+1m</button>
            <button id="nb-timer-add-5m" style="flex:1;padding:10px 4px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#f8fafc;font-size: var(--font-size-sm);font-weight:600;cursor:pointer;" title="Add 5 minutes">+5m</button>
            <button id="nb-timer-reset" style="padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#f8fafc;font-size: var(--font-size-md);font-weight:600;cursor:pointer;" title="Reset Timer">🔄</button>
          </div>
        </div>
      </div>

      <!-- FAB Controls Row: Standalone Rocket Racing Timer FAB + Main Synqto FAB -->
      <div class="fab-row" style="display:flex;align-items:center;gap:8px;position:relative;">
        <!-- 1. Separate Standalone Rocket Racing Focus Timer FAB (Shown when timer is on/enabled) -->
        ${(this.timerConfig.enabled || this.timerState.isRunning) ? `
          <button class="timer-fab-button" id="nb-timer-fab-trigger" title="Focus Timer (Click to open, click play icon to toggle)">
            <span style="font-size: var(--font-size-md);">${this.timerState.mode === 'pomodoro' ? '🍅' : this.timerState.mode === 'short_break' ? '☕' : this.timerState.mode === 'long_break' ? '🌴' : '⏱️'}</span>
            <span class="timer-fab-rocket" style="animation:${this.timerState.isRunning ? 'rocketThrust 0.8s ease-in-out infinite alternate' : 'none'};">🚀</span>
            ${this.timerState.isRunning ? `<span style="font-size: var(--font-size-xs);margin-left:-5px;animation:flameFlicker 0.3s ease-in-out infinite alternate;">🔥</span>` : ''}
            <div class="timer-fab-track">
              <div id="nb-timer-fab-fill" class="timer-fab-fill" style="width:${this.getTimerProgressPct()}%;"></div>
            </div>
            <span id="nb-timer-fab-time" style="font-family:var(--font-mono);font-size: var(--font-size-sm);font-weight:800;color:#ffffff;min-width:38px;">
              ${this.formatTimerTime(this.timerState.timeLeftSec)}
            </span>
            <span id="nb-timer-fab-toggle-btn" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${this.timerState.isRunning ? '#ef4444' : 'rgba(255,255,255,0.15)'};color:#ffffff;font-size: var(--font-size-2xs);margin-left:2px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);" title="${this.timerState.isRunning ? 'Pause Timer' : 'Start Timer'}">
              ${this.timerState.isRunning ? '⏸' : '▶'}
            </span>
          </button>
        ` : ''}

        <!-- 2. Main Synqto App FAB -->
        <button class="fab-button" id="nb-fab-trigger" title="Drag anywhere or click to open Synqto">
          <span class="drag-grip">⠿</span>
          ${isLive ? `<span class="live-dot"></span>` : `<span>${fabIcon}</span>`}
          <span>${fabLabel}</span>
          ${this.unreadCount > 0 ? `<span class="fab-badge">${this.unreadCount}</span>` : ''}
        </button>
      </div>
    `;

    // Inject the stylesheet exactly once (and only re-inject when the theme string
    // actually changes), then swap only the body. This is what removes the blink.
    let styleNode = this.shadow.getElementById('synqto-widget-style') as HTMLStyleElement | null;
    if (!styleNode) {
      styleNode = document.createElement('style');
      styleNode.id = 'synqto-widget-style';
      styleNode.textContent = styleHtml.replace(/^\s*<style>/, '').replace(/<\/style>\s*$/, '');
      this.shadow.appendChild(styleNode);
      this.lastStyleSignature = styleHtml.length + ':' + contentMode;
    } else {
      const sig = styleHtml.length + ':' + contentMode;
      if (sig !== this.lastStyleSignature) {
        styleNode.textContent = styleHtml.replace(/^\s*<style>/, '').replace(/<\/style>\s*$/, '');
        this.lastStyleSignature = sig;
      }
    }

    let bodyNode = this.shadow.getElementById('synqto-widget-body') as HTMLDivElement | null;
    if (!bodyNode) {
      bodyNode = document.createElement('div');
      bodyNode.id = 'synqto-widget-body';
      this.shadow.appendChild(bodyNode);
    }
    bodyNode.innerHTML = bodyHtml;

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

    // Separate Standalone Focus Timer FAB Events
    const timerFabBtn = this.shadow.getElementById('nb-timer-fab-trigger');
    const timerFabToggleBtn = this.shadow.getElementById('nb-timer-fab-toggle-btn');

    timerFabToggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTimer();
    });

    timerFabBtn?.addEventListener('click', () => {
      this.isTimerOpen = !this.isTimerOpen;
      this.render();
    });

    // Close Dedicated Timer Popup Button
    const closeTimerBtn = this.shadow.getElementById('nb-close-timer-popup');
    closeTimerBtn?.addEventListener('click', () => {
      this.isTimerOpen = false;
      this.render();
    });

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

    // Close Main Popup Button
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

    // CoFocus: open the side panel with the launcher already up.
    //
    // openCoFocus is a request the panel picks up on mount. It is sent alongside the open
    // rather than written to storage here so the two cannot drift out of order.
    const openCoFocusBtn = this.shadow.getElementById('nb-open-cofocus');
    openCoFocusBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL', openCoFocus: true }).catch(() => {});
      }
    });

    // Tab Switchers (Main Popup: Chat and Whiteboard only)
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

    // Focus Timer Controls
    const timerToggleBtn = this.shadow.getElementById('nb-timer-toggle');
    timerToggleBtn?.addEventListener('click', () => {
      this.toggleTimer();
    });

    const timerResetBtn = this.shadow.getElementById('nb-timer-reset');
    timerResetBtn?.addEventListener('click', () => {
      this.resetTimer();
    });

    const timerAdd1mBtn = this.shadow.getElementById('nb-timer-add-1m');
    timerAdd1mBtn?.addEventListener('click', () => {
      this.addTimerTime(60);
    });

    const timerAdd5mBtn = this.shadow.getElementById('nb-timer-add-5m');
    timerAdd5mBtn?.addEventListener('click', () => {
      this.addTimerTime(300);
    });

    const timerModeBtns = this.shadow.querySelectorAll('.timer-mode-btn[data-tmode]');
    timerModeBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-tmode') as TimerMode;
        if (mode) {
          this.setTimerMode(mode);
        }
      });
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

    // Offline Notice Sidepanel Reconnect Button
    const offlineReconnect = this.shadow.getElementById('nb-offline-sidepanel-reconnect');
    offlineReconnect?.addEventListener('click', () => {
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

    this.triggerWbAnimationLoop();

    // Attach Tool Selector (Direct DOM Active Class Update - Zero Blink)
    const toolBtns = this.shadow.querySelectorAll('.wb-tool-btn[data-wbtool]');
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tool = (e.currentTarget as HTMLElement).getAttribute('data-wbtool') as any;
        if (tool) {
          this.wbTool = tool;
          const style = this.toolStyles[tool] || { color: '#6366f1', width: 3 };
          this.wbColor = style.color;
          this.wbWidth = style.width;
          toolBtns.forEach((b) => b.classList.remove('active'));
          (e.currentTarget as HTMLElement).classList.add('active');

          const colorDots = this.shadow?.querySelectorAll('.color-dot');
          colorDots?.forEach((d) => d.classList.toggle('active', d.getAttribute('data-color') === this.wbColor));

          const sizePills = this.shadow?.querySelectorAll('.size-pill[data-size]');
          sizePills?.forEach((p) => p.classList.toggle('active', Number(p.getAttribute('data-size')) === this.wbWidth));

          if (tool !== 'select') {
            this.wbSelectedStrokeIds = [];
            this.updateSelectionBar();
          }

          this.drawWbCanvas();
        }
      });
    });

    // Drawer Toggles (Direct DOM Toggle - Zero Re-render / Zero Blink)
    const toggleDrawer = (drawerName: 'shapes' | 'dsa' | 'arch' | 'themes') => {
      const wasOpen =
        drawerName === 'shapes'
          ? this.wbShowShapesDrawer
          : drawerName === 'dsa'
          ? this.wbShowDsaDrawer
          : drawerName === 'arch'
          ? this.wbShowArchDrawer
          : this.wbShowThemesDrawer;

      this.wbShowShapesDrawer = false;
      this.wbShowDsaDrawer = false;
      this.wbShowArchDrawer = false;
      this.wbShowThemesDrawer = false;

      if (!wasOpen) {
        if (drawerName === 'shapes') this.wbShowShapesDrawer = true;
        if (drawerName === 'dsa') this.wbShowDsaDrawer = true;
        if (drawerName === 'arch') this.wbShowArchDrawer = true;
        if (drawerName === 'themes') this.wbShowThemesDrawer = true;
      }

      const drawers = {
        shapes: this.shadow?.getElementById('nb-wb-drawer-shapes'),
        dsa: this.shadow?.getElementById('nb-wb-drawer-dsa'),
        arch: this.shadow?.getElementById('nb-wb-drawer-arch'),
        themes: this.shadow?.getElementById('nb-wb-drawer-themes'),
      };
      const btns = {
        shapes: this.shadow?.getElementById('nb-wb-toggle-shapes'),
        dsa: this.shadow?.getElementById('nb-wb-toggle-dsa'),
        arch: this.shadow?.getElementById('nb-wb-toggle-arch'),
        themes: this.shadow?.getElementById('nb-wb-toggle-themes'),
      };

      if (drawers.shapes) drawers.shapes.style.display = this.wbShowShapesDrawer ? 'flex' : 'none';
      if (drawers.dsa) drawers.dsa.style.display = this.wbShowDsaDrawer ? 'flex' : 'none';
      if (drawers.arch) drawers.arch.style.display = this.wbShowArchDrawer ? 'flex' : 'none';
      if (drawers.themes) drawers.themes.style.display = this.wbShowThemesDrawer ? 'flex' : 'none';

      if (btns.shapes) {
        btns.shapes.classList.toggle('active', this.wbShowShapesDrawer);
        btns.shapes.textContent = `🔷 Shapes ${this.wbShowShapesDrawer ? '▲' : '▼'}`;
      }
      if (btns.dsa) {
        btns.dsa.classList.toggle('active', this.wbShowDsaDrawer);
        btns.dsa.textContent = `🔲 DSA ${this.wbShowDsaDrawer ? '▲' : '▼'}`;
      }
      if (btns.arch) {
        btns.arch.classList.toggle('active', this.wbShowArchDrawer);
        btns.arch.textContent = `🏛️ Arch ${this.wbShowArchDrawer ? '▲' : '▼'}`;
      }
      if (btns.themes) {
        btns.themes.classList.toggle('active', this.wbShowThemesDrawer);
        btns.themes.textContent = `🎨 Style ${this.wbShowThemesDrawer ? '▲' : '▼'}`;
      }
    };

    this.shadow.getElementById('nb-wb-toggle-shapes')?.addEventListener('click', () => toggleDrawer('shapes'));
    this.shadow.getElementById('nb-wb-toggle-dsa')?.addEventListener('click', () => toggleDrawer('dsa'));
    this.shadow.getElementById('nb-wb-toggle-arch')?.addEventListener('click', () => toggleDrawer('arch'));
    this.shadow.getElementById('nb-wb-toggle-themes')?.addEventListener('click', () => toggleDrawer('themes'));

    // Popout Standalone Popup Window
    this.shadow.getElementById('nb-wb-popout')?.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.windows?.create) {
        chrome.windows.create({
          url: chrome.runtime.getURL('sidepanel.html?view=whiteboard'),
          type: 'popup',
          width: 900,
          height: 650,
        });
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_STANDALONE_WHITEBOARD' }).catch(() => {});
      }
    });

    // Privacy Mode Selector (Collab vs Personal)
    const privacyBtns = this.shadow.querySelectorAll('.wb-privacy-btn[data-wbprivacy]');
    privacyBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-wbprivacy') as any;
        if (mode) {
          this.wbPrivacyMode = mode;
          this.saveInPagePersonalBoard();
          privacyBtns.forEach((b) => {
            const bMode = (b as HTMLElement).getAttribute('data-wbprivacy');
            (b as HTMLElement).style.background =
              bMode === mode
                ? (bMode === 'personal' ? 'linear-gradient(135deg, #f59e0b, #f43f5e)' : 'linear-gradient(135deg, #10b981, #06b6d4)')
                : 'transparent';
            (b as HTMLElement).style.color = bMode === mode ? '#fff' : 'var(--text-muted)';
          });
          this.wbSelectedStrokeIds = [];
          this.updateSelectionBar();
          this.drawWbCanvas();
        }
      });
    });

    // Board Theme Selector (Grid, Iso, Ruled, Plot, Matrix, Dotted, Blank)
    const themeBtns = this.shadow.querySelectorAll('.size-pill[data-wbtheme]');
    themeBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const theme = (e.currentTarget as HTMLElement).getAttribute('data-wbtheme') as any;
        if (theme) {
          if (this.wbPrivacyMode === 'personal') {
            this.wbPersonalTheme = theme;
            this.saveInPagePersonalBoard();
          } else {
            this.wbTheme = theme;
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_BG_LOCAL', background: theme, bgColor: this.wbBgColor }).catch(() => {});
            }
          }
          themeBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-wbtheme') === theme));
          this.drawWbCanvas();
        }
      });
    });

    // Background Color Selector
    const bgDots = this.shadow.querySelectorAll('.bg-dot[data-wbbg]');
    bgDots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const bg = (e.currentTarget as HTMLElement).getAttribute('data-wbbg');
        if (bg) {
          if (this.wbPrivacyMode === 'personal') {
            this.wbPersonalBgColor = bg;
            this.saveInPagePersonalBoard();
          } else {
            this.wbBgColor = bg;
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_BG_LOCAL', background: this.wbTheme, bgColor: bg }).catch(() => {});
            }
          }
          bgDots.forEach((d) => {
            const colorVal = (d as HTMLElement).getAttribute('data-wbbg');
            (d as HTMLElement).style.border = colorVal === bg ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.25)';
          });
          this.drawWbCanvas();
        }
      });
    });

    // Color Selector (Updates Active Tool's Independent Color)
    const colorDots = this.shadow.querySelectorAll('.color-dot');
    colorDots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const col = (e.currentTarget as HTMLElement).getAttribute('data-color');
        if (col) {
          this.wbColor = col;
          if (this.toolStyles[this.wbTool]) {
            this.toolStyles[this.wbTool].color = col;
          }
          colorDots.forEach((d) => d.classList.toggle('active', d.getAttribute('data-color') === col));
          this.drawWbCanvas();
        }
      });
    });

    // Size Selector (Updates Active Tool's Independent Width)
    const sizePills = this.shadow.querySelectorAll('.size-pill[data-size]');
    sizePills.forEach((p) => {
      p.addEventListener('click', (e) => {
        const sz = Number((e.currentTarget as HTMLElement).getAttribute('data-size'));
        if (sz) {
          this.wbWidth = sz;
          if (this.toolStyles[this.wbTool]) {
            this.toolStyles[this.wbTool].width = sz;
          }
          sizePills.forEach((sp) => sp.classList.toggle('active', Number(sp.getAttribute('data-size')) === sz));
          this.drawWbCanvas();
        }
      });
    });

    // Selection Bar Actions (Copy, Duplicate, Paste, Delete, Deselect)
    this.shadow.getElementById('nb-wb-sel-copy')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      this.wbClipboardStrokes = activeList.filter((s) => this.wbSelectedStrokeIds.includes(s.id));
    });

    this.shadow.getElementById('nb-wb-sel-dup')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      const toDup = activeList.filter((s) => this.wbSelectedStrokeIds.includes(s.id));
      if (toDup.length > 0) {
        const duplicated: InPageStroke[] = toDup.map((s) => ({
          ...moveStroke(s, 20, 20),
          id: 'stroke-' + Math.random().toString(36).slice(2, 10),
        }));
        if (this.wbPrivacyMode === 'personal') {
          this.wbPersonalStrokes.push(...duplicated);
          this.saveInPagePersonalBoard();
        } else {
          this.wbStrokes.push(...duplicated);
          duplicated.forEach((s) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s }).catch(() => {});
            }
          });
        }
        this.wbSelectedStrokeIds = duplicated.map((s) => s.id);
        this.updateSelectionBar();
        this.drawWbCanvas();
      }
    });

    this.shadow.getElementById('nb-wb-sel-paste')?.addEventListener('click', () => {
      if (this.wbClipboardStrokes.length > 0) {
        const pasted: InPageStroke[] = this.wbClipboardStrokes.map((s) => ({
          ...moveStroke(s, 24, 24),
          id: 'stroke-' + Math.random().toString(36).slice(2, 10),
        }));
        if (this.wbPrivacyMode === 'personal') {
          this.wbPersonalStrokes.push(...pasted);
          this.saveInPagePersonalBoard();
        } else {
          this.wbStrokes.push(...pasted);
          pasted.forEach((s) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s }).catch(() => {});
            }
          });
        }
        this.wbSelectedStrokeIds = pasted.map((s) => s.id);
        this.updateSelectionBar();
        this.drawWbCanvas();
      }
    });

    this.shadow.getElementById('nb-wb-sel-del')?.addEventListener('click', () => {
      if (this.wbSelectedStrokeIds.length > 0) {
        const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
        const deleted = activeList.filter((s) => this.wbSelectedStrokeIds.includes(s.id));
        this.wbRedoStack.push(...deleted);
        if (this.wbPrivacyMode === 'personal') {
          this.wbPersonalStrokes = this.wbPersonalStrokes.filter((s) => !this.wbSelectedStrokeIds.includes(s.id));
          this.saveInPagePersonalBoard();
        } else {
          this.wbStrokes = this.wbStrokes.filter((s) => !this.wbSelectedStrokeIds.includes(s.id));
          deleted.forEach((d) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: d.id }).catch(() => {});
            }
          });
        }
        this.wbSelectedStrokeIds = [];
        this.updateSelectionBar();
        this.drawWbCanvas();
      }
    });

    this.shadow.getElementById('nb-wb-sel-clear')?.addEventListener('click', () => {
      this.wbSelectedStrokeIds = [];
      this.updateSelectionBar();
      this.drawWbCanvas();
    });

    // Undo / Redo / Clear / Export
    this.shadow.getElementById('nb-wb-undo')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      if (activeList.length === 0 && this.wbRedoStack.length > 0) {
        if (this.wbPrivacyMode === 'personal') {
          this.wbPersonalStrokes = [...this.wbRedoStack];
          this.saveInPagePersonalBoard();
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
          if (this.wbPrivacyMode === 'personal') {
            this.saveInPagePersonalBoard();
          } else if (this.wbPrivacyMode === 'collaborative' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: removed.id }).catch(() => {});
          }
          this.drawWbCanvas();
        }
      }
    });

    this.shadow.getElementById('nb-wb-redo')?.addEventListener('click', () => {
      if (this.wbRedoStack.length > 0) {
        const restored = this.wbRedoStack.pop();
        if (restored) {
          if (this.wbPrivacyMode === 'personal') {
            this.wbPersonalStrokes.push(restored);
            this.saveInPagePersonalBoard();
          } else {
            this.wbStrokes.push(restored);
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: restored }).catch(() => {});
            }
          }
          this.drawWbCanvas();
        }
      }
    });

    this.shadow.getElementById('nb-wb-clear')?.addEventListener('click', () => {
      const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
      if (activeList.length === 0) return;
      this.wbRedoStack = [...activeList];
      if (this.wbPrivacyMode === 'personal') {
        this.wbPersonalStrokes = [];
        this.saveInPagePersonalBoard();
      } else {
        this.wbStrokes = [];
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'WHITEBOARD_CLEAR_LOCAL' }).catch(() => {});
        }
      }
      this.wbSelectedStrokeIds = [];
      this.updateSelectionBar();
      this.drawWbCanvas();
    });

    this.shadow.getElementById('nb-wb-save')?.addEventListener('click', () => {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = `synqto-whiteboard-${Date.now()}.png`;
      a.href = dataUrl;
      a.click();
    });

    // Setup Canvas Dimensions with High-DPI support
    const setupDimensions = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = (rect.width || 380) * dpr;
      canvas.height = (rect.height || 360) * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
      this.drawWbCanvas();
    };

    setTimeout(setupDimensions, 30);

    // Pointer Event Listeners
    const getCoords = (e: MouseEvent | TouchEvent): WhiteboardPoint => {
      const rect = canvas.getBoundingClientRect();
      let cx = 0, cy = 0;
      if ('touches' in e && e.touches.length > 0) {
        cx = e.touches[0].clientX;
        cy = e.touches[0].clientY;
      } else if ('changedTouches' in e && e.changedTouches.length > 0) {
        cx = e.changedTouches[0].clientX;
        cy = e.changedTouches[0].clientY;
      } else if ('clientX' in e) {
        cx = (e as MouseEvent).clientX;
        cy = (e as MouseEvent).clientY;
      }
      return { x: cx - rect.left, y: cy - rect.top };
    };

    const isGeomTool = (tool: string) => [
      'line', 'arrow', 'arrow_bi', 'rect', 'rounded_rect', 'circle', 'triangle', 'star',
      'decision_diamond', 'tree_node', 'sticky_note', 'text', 'code_box',
      'db_cylinder', 'db_nosql', 'cloud', 'cdn_edge', 'object_storage', 'auth_jwt',
      'websocket_gw', 'elasticsearch', 'load_balancer', 'message_queue', 'server_box',
      'cache_mem', 'dns_router', 'firewall', 'user_client', 'mobile_client', 'async_arrow',
      'tradeoff_note', 'array_cells', 'two_pointers', 'stack_lifo', 'queue_fifo', 'hashmap_table'
    ].includes(tool);

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

      // Select Tool Handlers
      if (this.wbTool === 'select') {
        const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
        const clickedOnSelected =
          this.wbSelectedStrokeIds.length > 0 &&
          activeList.some((s) => {
            if (!this.wbSelectedStrokeIds.includes(s.id)) return false;
            const b = getStrokeBounds(s);
            return pt.x >= b.minX - 6 && pt.x <= b.maxX + 6 && pt.y >= b.minY - 6 && pt.y <= b.maxY + 6;
          });

        if (clickedOnSelected) {
          this.wbIsMovingSelection = true;
          this.wbDragStartCoords = pt;
        } else {
          const clickedStroke = [...activeList].reverse().find((s) => {
            const b = getStrokeBounds(s);
            return pt.x >= b.minX - 4 && pt.x <= b.maxX + 4 && pt.y >= b.minY - 4 && pt.y <= b.maxY + 4;
          });

          if (clickedStroke) {
            this.wbSelectedStrokeIds = [clickedStroke.id];
            this.wbIsMovingSelection = true;
            this.wbDragStartCoords = pt;
          } else {
            this.wbSelectedStrokeIds = [];
            this.wbIsMarqueeSelecting = true;
            this.wbSelectionBox = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
          }
          this.updateSelectionBar();
        }
        this.drawWbCanvas();
        return;
      }

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

      // Select Tool Drag / Marquee
      if (this.wbTool === 'select') {
        if (this.wbIsMovingSelection && this.wbDragStartCoords) {
          const dx = pt.x - this.wbDragStartCoords.x;
          const dy = pt.y - this.wbDragStartCoords.y;
          this.wbDragStartCoords = pt;

          if (this.wbPrivacyMode === 'personal') {
            this.wbPersonalStrokes = this.wbPersonalStrokes.map((s) =>
              this.wbSelectedStrokeIds.includes(s.id) ? moveStroke(s, dx, dy) : s
            );
          } else {
            this.wbStrokes = this.wbStrokes.map((s) =>
              this.wbSelectedStrokeIds.includes(s.id) ? moveStroke(s, dx, dy) : s
            );
          }
          this.requestWbRedraw();
          return;
        }

        if (this.wbIsMarqueeSelecting && this.wbSelectionBox) {
          this.wbSelectionBox.x2 = pt.x;
          this.wbSelectionBox.y2 = pt.y;
          const activeList = this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
          const matching = activeList.filter((s) => isStrokeInRect(s, this.wbSelectionBox!));
          this.wbSelectedStrokeIds = matching.map((s) => s.id);
          this.updateSelectionBar();
          this.requestWbRedraw();
          return;
        }
      }

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
        this.requestWbRedraw();
        return;
      }

      if (this.wbTool === 'laser') {
        this.wbLaserTrails.push({ x: pt.x, y: pt.y, alpha: 1.0, timestamp: Date.now() });
        this.triggerWbAnimationLoop();
        this.requestWbRedraw();
        return;
      }

      if (this.wbTool === 'torch') {
        this.wbTorchPos = pt;
        this.requestWbRedraw();
        return;
      }

      if (!this.isWbDrawing) return;
      const isGeom = isGeomTool(this.wbTool);

      if (isGeom && this.wbStartPoint) {
        this.requestWbRedraw(undefined, {
          x1: this.wbStartPoint.x,
          y1: this.wbStartPoint.y,
          x2: pt.x,
          y2: pt.y,
        });
      } else {
        this.wbCurrentPoints.push(pt);
        this.requestWbRedraw(this.wbCurrentPoints);
      }
    });

    const handleMouseUp = (e: MouseEvent | TouchEvent) => {
      if (this.wbTool === 'select') {
        if (this.wbIsMovingSelection) {
          this.wbIsMovingSelection = false;
          this.wbDragStartCoords = null;
          if (this.wbPrivacyMode === 'collaborative' && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            const updated = this.wbStrokes.filter((s) => this.wbSelectedStrokeIds.includes(s.id));
            if (updated.length > 0) {
              chrome.runtime.sendMessage({ type: 'WHITEBOARD_UPDATE_STROKES_LOCAL', strokes: updated }).catch(() => {});
            }
          }
        }
        if (this.wbIsMarqueeSelecting) {
          this.wbIsMarqueeSelecting = false;
          this.wbSelectionBox = null;
        }
        this.updateSelectionBar();
        this.drawWbCanvas();
        return;
      }

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
      const isGeom = isGeomTool(this.wbTool);
      const width = this.wbTool === 'highlighter' ? 16 : this.wbWidth;

      const stroke: InPageStroke = {
        id: 'stroke-' + Math.random().toString(36).slice(2, 10),
        tool: this.wbTool,
        color: this.wbColor,
        width,
        opacity: this.wbTool === 'highlighter' ? 0.35 : 1.0,
        points: isGeom ? [] : [...this.wbCurrentPoints],
        geometry:
          isGeom && this.wbStartPoint
            ? {
                x1: this.wbStartPoint.x,
                y1: this.wbStartPoint.y,
                x2: endPt.x,
                y2: endPt.y,
              }
            : undefined,
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

  private updateSelectionBar() {
    if (!this.shadow) return;
    const bar = this.shadow.getElementById('nb-wb-selection-floating-bar');
    if (!bar) return;
    const count = this.wbSelectedStrokeIds.length;
    if (count > 0) {
      bar.style.display = 'flex';
      const label = bar.querySelector('span');
      if (label) label.textContent = `Selected (${count}):`;
    } else {
      bar.style.display = 'none';
    }
  }

  private triggerWbAnimationLoop() {
    if (this.wbAnimationRafId !== null) return;
    if (this.activeTab !== 'whiteboard') return;
    if (this.wbLaserTrails.length === 0 && this.tempDisappearingStrokes.length === 0) return;

    const tick = () => {
      if (this.activeTab !== 'whiteboard') {
        this.wbAnimationRafId = null;
        return;
      }

      let needsRedraw = false;
      const now = Date.now();

      if (this.wbLaserTrails.length > 0) {
        this.wbLaserTrails = this.wbLaserTrails
          .map((pt) => ({ ...pt, alpha: pt.alpha - 0.05 }))
          .filter((pt) => pt.alpha > 0);
        needsRedraw = true;
      }

      if (this.tempDisappearingStrokes.length > 0) {
        const initialLen = this.tempDisappearingStrokes.length;
        this.tempDisappearingStrokes = this.tempDisappearingStrokes.filter(
          (item) => now - item.createdAt < item.durationMs
        );
        if (this.tempDisappearingStrokes.length > 0 || initialLen > 0) {
          needsRedraw = true;
        }
      }

      if (needsRedraw) {
        this.drawWbCanvas();
      }

      if (this.wbLaserTrails.length > 0 || this.tempDisappearingStrokes.length > 0) {
        this.wbAnimationRafId = requestAnimationFrame(tick);
      } else {
        this.wbAnimationRafId = null;
      }
    };

    this.wbAnimationRafId = requestAnimationFrame(tick);
  }

  private requestWbRedraw(previewPoints?: WhiteboardPoint[], previewGeometry?: any) {
    this.latestPreviewPoints = previewPoints;
    this.latestPreviewGeometry = previewGeometry;
    if (this.wbDrawRafScheduled) return;
    this.wbDrawRafScheduled = true;
    requestAnimationFrame(() => {
      this.wbDrawRafScheduled = false;
      this.drawWbCanvas(this.latestPreviewPoints, this.latestPreviewGeometry);
    });
  }

  private getOrCreatePattern(theme: string, isLightBg: boolean, ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const key = `${theme}-${isLightBg ? 'light' : 'dark'}`;
    if (this.wbPatternCache.has(key)) {
      return this.wbPatternCache.get(key)!;
    }

    const pCanvas = document.createElement('canvas');
    const pCtx = pCanvas.getContext('2d');
    if (!pCtx) return null;

    if (theme === 'dotted') {
      pCanvas.width = 18;
      pCanvas.height = 18;
      pCtx.fillStyle = isLightBg ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.12)';
      pCtx.beginPath();
      pCtx.arc(9, 9, 1.2, 0, Math.PI * 2);
      pCtx.fill();
    } else if (theme === 'matrix') {
      pCanvas.width = 24;
      pCanvas.height = 24;
      pCtx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';
      pCtx.lineWidth = 1;
      pCtx.strokeRect(0, 0, 24, 24);
    } else if (theme === 'ruled') {
      pCanvas.width = 24;
      pCanvas.height = 24;
      pCtx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.06)';
      pCtx.lineWidth = 1;
      pCtx.beginPath();
      pCtx.moveTo(0, 23);
      pCtx.lineTo(24, 23);
      pCtx.stroke();
    } else if (theme === 'grid') {
      pCanvas.width = 20;
      pCanvas.height = 20;
      pCtx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.04)';
      pCtx.lineWidth = 1;
      pCtx.strokeRect(0, 0, 20, 20);
    } else if (theme === 'isometric') {
      pCanvas.width = 48;
      pCanvas.height = 28;
      pCtx.strokeStyle = isLightBg ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';
      pCtx.lineWidth = 1;
      pCtx.beginPath();
      pCtx.moveTo(0, 0);
      pCtx.lineTo(48, 28);
      pCtx.moveTo(0, 28);
      pCtx.lineTo(48, 0);
      pCtx.stroke();
    } else {
      return null;
    }

    const pattern = ctx.createPattern(pCanvas, 'repeat');
    if (pattern) {
      this.wbPatternCache.set(key, pattern);
    }
    return pattern;
  }

  private drawWbCanvas(previewPoints?: WhiteboardPoint[], previewGeometry?: any) {
    if (!this.shadow) return;
    const canvas = this.shadow.getElementById('nb-whiteboard-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw Background Theme
    ctx.save();
    const isPersonal = this.wbPrivacyMode === 'personal';
    const activeTheme = isPersonal ? (this.wbPersonalTheme || 'grid') : (this.wbTheme || 'grid');
    const activeBgColor = isPersonal ? (this.wbPersonalBgColor || '#090d16') : (this.wbBgColor || '#090d16');
    const isLightBg = activeBgColor === '#ffffff' || activeBgColor === '#f8fafc' || activeBgColor === '#fef3c7';
    ctx.fillStyle = activeBgColor || (isLightBg ? '#f8fafc' : '#090d16');
    ctx.fillRect(0, 0, w, h);

    if (activeTheme && activeTheme !== 'plain' && activeTheme !== 'blank') {
      const pattern = this.getOrCreatePattern(activeTheme, isLightBg, ctx);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
      if (activeTheme === 'ruled') {
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(40, 0);
        ctx.lineTo(40, h);
        ctx.stroke();
      } else if (activeTheme === 'plot') {
        const midX = w / 2;
        const midY = h / 2;
        ctx.strokeStyle = isLightBg ? '#4f46e5' : '#818cf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.moveTo(midX, 0);
        ctx.lineTo(midX, h);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Eraser Indicator
    if (this.wbTool === 'eraser' && this.wbEraserPos) {
      ctx.save();
      const r = (this.wbWidth || 4) * 2.5;
      ctx.strokeStyle = isLightBg ? '#ef4444' : '#f87171';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(this.wbEraserPos.x, this.wbEraserPos.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = isLightBg ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.15)';
      ctx.fill();
      ctx.restore();
    }

    const render = (s: InPageStroke) => {
      if (s.tool === 'eraser') return;
      ctx.save();
      let drawColor = s.color;
      if (isLightBg && (drawColor === '#ffffff' || drawColor === '#fff')) {
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
        const minX = Math.min(x1, x2);
        const minY = Math.min(y1, y2);
        const gw = Math.abs(x2 - x1);
        const gh = Math.abs(y2 - y1);
        const midX = minX + gw / 2;
        const midY = minY + gh / 2;

        if (s.tool === 'line') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px monospace';
            ctx.fillText(s.geometry.label, (x1 + x2) / 2, (y1 + y2) / 2 - 6);
          }
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
        } else if (s.tool === 'arrow_bi') {
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
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI / 6), y1 + headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI / 6), y1 + headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (s.tool === 'rect') {
          ctx.strokeRect(minX, minY, gw, gh);
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, midX, midY);
          }
        } else if (s.tool === 'rounded_rect') {
          ctx.beginPath();
          ctx.roundRect(minX, minY, Math.max(20, gw), Math.max(20, gh), 8);
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, midX, midY);
          }
        } else if (s.tool === 'circle') {
          const rx = gw / 2;
          const ry = gh / 2;
          ctx.beginPath();
          ctx.ellipse(minX + rx, minY + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, midX, midY);
          }
        } else if (s.tool === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + gw, minY + gh);
          ctx.lineTo(minX, minY + gh);
          ctx.closePath();
          ctx.stroke();
        } else if (s.tool === 'star') {
          const spikes = 5;
          const outerR = Math.max(12, Math.min(gw, gh) / 2);
          const innerR = outerR / 2.2;
          let rot = (Math.PI / 2) * 3;
          const step = Math.PI / spikes;
          ctx.beginPath();
          ctx.moveTo(midX, midY - outerR);
          for (let i = 0; i < spikes; i++) {
            let sx = midX + Math.cos(rot) * outerR;
            let sy = midY + Math.sin(rot) * outerR;
            ctx.lineTo(sx, sy);
            rot += step;
            sx = midX + Math.cos(rot) * innerR;
            sy = midY + Math.sin(rot) * innerR;
            ctx.lineTo(sx, sy);
            rot += step;
          }
          ctx.lineTo(midX, midY - outerR);
          ctx.closePath();
          ctx.stroke();
        } else if (s.tool === 'decision_diamond') {
          ctx.beginPath();
          ctx.moveTo(midX, minY);
          ctx.lineTo(minX + gw, midY);
          ctx.lineTo(midX, minY + gh);
          ctx.lineTo(minX, midY);
          ctx.closePath();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, midX, midY);
          }
        } else if (s.tool === 'tree_node') {
          const r = Math.max(16, s.width * 3.5);
          ctx.beginPath();
          ctx.arc(x1, y1, r, 0, Math.PI * 2);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, x1, y1);
          }
        } else if (s.tool === 'sticky_note') {
          const noteW = Math.max(80, gw);
          const noteH = Math.max(60, gh);
          ctx.fillStyle = '#fef3c7';
          ctx.strokeStyle = '#f59e0b';
          ctx.beginPath();
          ctx.roundRect(minX, minY, noteW, noteH, 6);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#78350f';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(s.geometry.label, minX + 6, minY + 6);
          }
        } else if (s.tool === 'text') {
          ctx.fillStyle = drawColor;
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(s.geometry.label || 'Label', x1, y1);
        } else if (s.tool === 'code_box') {
          const boxW = Math.max(80, gw);
          const boxH = Math.max(32, gh);
          ctx.fillStyle = isLightBg ? 'rgba(240, 249, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(minX, minY, boxW, boxH, 4);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = '#0284c7';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + boxW / 2, minY + boxH / 2);
          }
        }

        // DSA Primitives
        else if (s.tool === 'array_cells') {
          const numCells = 5;
          const cellW = Math.max(22, Math.floor(Math.max(100, gw) / numCells));
          const cellH = Math.max(24, Math.min(40, gh || 28));
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
          for (let i = 0; i < numCells; i++) {
            const cx = minX + i * cellW;
            ctx.fillRect(cx, minY, cellW, cellH);
            ctx.strokeRect(cx, minY, cellW, cellH);
            ctx.fillStyle = isLightBg ? '#64748b' : '#94a3b8';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`[${i}]`, cx + cellW / 2, minY - 2);
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 11px monospace';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i * 2 + 1}`, cx + cellW / 2, minY + cellH / 2);
            ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
          }
        } else if (s.tool === 'stack_lifo') {
          const stkW = Math.max(45, gw);
          const stkH = Math.max(70, gh);
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX, minY + stkH);
          ctx.lineTo(minX + stkW, minY + stkH);
          ctx.lineTo(minX + stkW, minY);
          ctx.stroke();
          const items = 3;
          const itemH = Math.floor((stkH - 8) / items);
          for (let i = 0; i < items; i++) {
            const iy = minY + stkH - (i + 1) * itemH;
            ctx.fillStyle = isLightBg ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.25)';
            ctx.fillRect(minX + 3, iy, stkW - 6, itemH - 2);
            ctx.strokeRect(minX + 3, iy, stkW - 6, itemH - 2);
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(i === items - 1 ? 'TOP' : `val_${i + 1}`, minX + stkW / 2, iy + itemH / 2);
          }
        } else if (s.tool === 'queue_fifo') {
          const qW = Math.max(75, gw);
          const qH = Math.max(28, gh);
          ctx.beginPath();
          ctx.moveTo(minX, minY);
          ctx.lineTo(minX + qW, minY);
          ctx.moveTo(minX, minY + qH);
          ctx.lineTo(minX + qW, minY + qH);
          ctx.stroke();
          const qItems = 3;
          const qItemW = Math.floor((qW - 8) / qItems);
          for (let i = 0; i < qItems; i++) {
            const qx = minX + 4 + i * qItemW;
            ctx.fillStyle = isLightBg ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.25)';
            ctx.fillRect(qx, minY + 3, qItemW - 2, qH - 6);
            ctx.strokeRect(qx, minY + 3, qItemW - 2, qH - 6);
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`e${i + 1}`, qx + qItemW / 2, minY + qH / 2);
          }
        } else if (s.tool === 'hashmap_table') {
          const hmW = Math.max(75, gw);
          const hmH = Math.max(50, gh);
          ctx.strokeRect(minX, minY, hmW, hmH);
          const rows = 3;
          const rH = hmH / rows;
          for (let i = 1; i < rows; i++) {
            ctx.beginPath();
            ctx.moveTo(minX, minY + i * rH);
            ctx.lineTo(minX + hmW, minY + i * rH);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(minX + 22, minY);
          ctx.lineTo(minX + 22, minY + hmH);
          ctx.stroke();
          for (let i = 0; i < rows; i++) {
            ctx.fillStyle = isLightBg ? '#64748b' : '#94a3b8';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${i}`, minX + 11, minY + i * rH + rH / 2);
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.fillText(`k${i + 1} ➔ v${i + 1}`, minX + 26 + (hmW - 26) / 2, minY + i * rH + rH / 2);
          }
        } else if (s.tool === 'two_pointers') {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(8, s.width * 2.5);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = drawColor;
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(s.geometry.label, x1, y1 - 4);
          }
        }

        // Architecture Nodes
        else if (s.tool === 'db_cylinder' || s.tool === 'db_nosql') {
          const dbW = Math.max(50, gw);
          const dbH = Math.max(55, gh);
          const ry = Math.min(14, dbH * 0.2);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.ellipse(minX + dbW / 2, minY + ry, dbW / 2, ry, 0, Math.PI, 0);
          ctx.lineTo(minX + dbW, minY + dbH - ry);
          ctx.ellipse(minX + dbW / 2, minY + dbH - ry, dbW / 2, ry, 0, 0, Math.PI);
          ctx.lineTo(minX, minY + ry);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(minX + dbW / 2, minY + ry, dbW / 2, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + dbW / 2, minY + dbH / 2 + 4);
          }
        } else if (s.tool === 'cloud') {
          const cW = Math.max(65, gw);
          const cH = Math.max(40, gh);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, cW, cH, 14);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + cW / 2, minY + cH / 2);
          }
        } else if (s.tool === 'load_balancer') {
          const lbW = Math.max(55, gw);
          const lbH = Math.max(55, gh);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.moveTo(minX + lbW / 2, minY);
          ctx.lineTo(minX + lbW, minY + lbH / 2);
          ctx.lineTo(minX + lbW / 2, minY + lbH);
          ctx.lineTo(minX, minY + lbH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + lbW / 2, minY + lbH / 2);
          }
        } else if (s.tool === 'message_queue') {
          const mqW = Math.max(70, gw);
          const mqH = Math.max(34, gh);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, mqW, mqH, 6);
          ctx.fill();
          ctx.stroke();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + mqW / 2, minY + mqH / 2);
          }
        } else if (s.tool === 'server_box') {
          const sW = Math.max(65, gw);
          const sH = Math.max(40, gh);
          ctx.fillStyle = isLightBg ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, sW, sH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(minX + 10, minY + 10, 3, 0, Math.PI * 2);
          ctx.fill();
          if (s.geometry.label) {
            ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.geometry.label, minX + sW / 2, minY + sH / 2 + 2);
          }
        } else if (s.tool === 'cache_mem') {
          const caW = Math.max(65, gw);
          const caH = Math.max(32, gh);
          ctx.fillStyle = isLightBg ? 'rgba(244, 63, 94, 0.1)' : 'rgba(244, 63, 94, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, caW, caH, 5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '⚡ Redis Cache', minX + caW / 2, minY + caH / 2);
        } else if (s.tool === 'cdn_edge') {
          const cdnW = Math.max(65, gw);
          const cdnH = Math.max(36, gh);
          ctx.fillStyle = isLightBg ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, cdnW, cdnH, 12);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '🌐 CDN Edge', minX + cdnW / 2, minY + cdnH / 2);
        } else if (s.tool === 'object_storage') {
          const obW = Math.max(65, gw);
          const obH = Math.max(45, gh);
          ctx.fillStyle = isLightBg ? 'rgba(249, 115, 22, 0.1)' : 'rgba(249, 115, 22, 0.2)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, obW, obH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '📦 S3 Storage', minX + obW / 2, minY + obH / 2);
        } else if (s.tool === 'auth_jwt') {
          const auW = Math.max(60, gw);
          const auH = Math.max(40, gh);
          ctx.beginPath();
          ctx.moveTo(minX + auW / 2, minY);
          ctx.lineTo(minX + auW, minY + auH * 0.3);
          ctx.lineTo(minX + auW / 2, minY + auH);
          ctx.lineTo(minX, minY + auH * 0.3);
          ctx.closePath();
          ctx.fillStyle = isLightBg ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.25)';
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '🛡️ JWT Auth', minX + auW / 2, minY + auH / 2);
        } else if (s.tool === 'websocket_gw') {
          const wsW = Math.max(65, gw);
          const wsH = Math.max(36, gh);
          ctx.fillStyle = isLightBg ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.25)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, wsW, wsH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '⚡ WS Gateway', minX + wsW / 2, minY + wsH / 2);
        } else if (s.tool === 'elasticsearch') {
          const esW = Math.max(65, gw);
          const esH = Math.max(36, gh);
          ctx.fillStyle = isLightBg ? 'rgba(20, 184, 166, 0.15)' : 'rgba(20, 184, 166, 0.25)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, esW, esH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '🔍 Search / ES', minX + esW / 2, minY + esH / 2);
        } else if (s.tool === 'user_client' || s.tool === 'mobile_client') {
          const clW = Math.max(50, gw);
          const clH = Math.max(34, gh);
          ctx.fillStyle = isLightBg ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.25)';
          ctx.beginPath();
          ctx.roundRect(minX, minY, clW, clH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#0f172a' : '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || (s.tool === 'mobile_client' ? '📱 Mobile' : '💻 Client'), minX + clW / 2, minY + clH / 2);
        } else if (s.tool === 'async_arrow') {
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(10, s.width * 3);
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        } else if (s.tool === 'tradeoff_note') {
          const trW = Math.max(90, gw);
          const trH = Math.max(45, gh);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.18)';
          ctx.strokeStyle = '#facc15';
          ctx.beginPath();
          ctx.roundRect(minX, minY, trW, trH, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isLightBg ? '#78350f' : '#fef08a';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(s.geometry.label || '⚖️ Trade-off / CAP Analysis', minX + trW / 2, minY + trH / 2);
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

    // Render Preview Stroke
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
      ctx.fillRect(0, 0, w, h);

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

    // Render Marquee Selection Box
    if (this.wbSelectionBox) {
      ctx.save();
      const minX = Math.min(this.wbSelectionBox.x1, this.wbSelectionBox.x2);
      const minY = Math.min(this.wbSelectionBox.y1, this.wbSelectionBox.y2);
      const selW = Math.abs(this.wbSelectionBox.x2 - this.wbSelectionBox.x1);
      const selH = Math.abs(this.wbSelectionBox.y2 - this.wbSelectionBox.y1);
      ctx.fillStyle = isLightBg ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.2)';
      ctx.fillRect(minX, minY, selW, selH);
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(minX, minY, selW, selH);
      ctx.restore();
    }

    // Render Selected Strokes Bounding Box & 4 Corner Handles
    if (this.wbSelectedStrokeIds.length > 0) {
      const selected = activeList.filter((s) => this.wbSelectedStrokeIds.includes(s.id));
      if (selected.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selected.forEach((s) => {
          const b = getStrokeBounds(s);
          if (b.minX < minX) minX = b.minX;
          if (b.maxX > maxX) maxX = b.maxX;
          if (b.minY < minY) minY = b.minY;
          if (b.maxY > maxY) maxY = b.maxY;
        });
        const pad = 6;
        const bbX = minX - pad;
        const bbY = minY - pad;
        const bbW = maxX - minX + pad * 2;
        const bbH = maxY - minY + pad * 2;

        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bbX, bbY, bbW, bbH);
        ctx.setLineDash([]);

        const handles = [
          { x: bbX, y: bbY },
          { x: bbX + bbW, y: bbY },
          { x: bbX, y: bbY + bbH },
          { x: bbX + bbW, y: bbY + bbH },
        ];
        handles.forEach((hPos) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(hPos.x - 3.5, hPos.y - 3.5, 7, 7);
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hPos.x - 3.5, hPos.y - 3.5, 7, 7);
        });
        ctx.restore();
      }
    }
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
        } else if (msg.type === 'WHITEBOARD_UPDATE_STROKES_LOCAL' && msg.strokes) {
          const map = new Map<string, InPageStroke>(msg.strokes.map((s: any) => [s.id, s]));
          this.wbStrokes = this.wbStrokes.map((s) => (map.has(s.id) ? (map.get(s.id) as InPageStroke) : s));
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_TEMP_STROKE_LOCAL' && msg.stroke) {
          this.tempDisappearingStrokes.push({
            stroke: msg.stroke,
            createdAt: Date.now(),
            durationMs: msg.durationMs || 3000,
          });
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_CLEAR_LOCAL') {
          this.wbStrokes = [];
          this.wbRedoStack = [];
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_UNDO_LOCAL' && msg.strokeId) {
          this.wbStrokes = this.wbStrokes.filter((s) => s.id !== msg.strokeId);
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_BG_LOCAL') {
          if (msg.background) this.wbTheme = msg.background;
          if (msg.bgColor) this.wbBgColor = msg.bgColor;
          if (this.activeTab === 'whiteboard') this.drawWbCanvas();
        } else if (msg.type === 'WHITEBOARD_SNAPSHOT' && msg.notebook?.pages) {
          const activePage = msg.notebook.pages.find((p: any) => p.id === msg.notebook.activePageId) || msg.notebook.pages[0];
          if (activePage) {
            this.wbStrokes = activePage.strokes || [];
            if (activePage.background) this.wbTheme = activePage.background;
            if (activePage.bgColor) this.wbBgColor = activePage.bgColor;
            if (this.activeTab === 'whiteboard') this.drawWbCanvas();
          }
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
          <div style="background:rgba(0,0,0,0.45);padding:6px 8px;border-radius:6px;margin:4px 0;font-family:var(--font-mono);font-size: var(--font-size-sm);position:relative;">
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
    return escapedStr.replace(/(@everyone|@all)/g, '<span style="background:rgba(245,158,11,0.25);border:1px solid rgba(245,158,11,0.5);color:#fbbf24;padding:1px 4px;border-radius:3px;font-weight:700;font-size: var(--font-size-xs);">📣 $1</span>')
      .replace(/(@[a-zA-Z0-9_-]+)/g, '<span style="background:rgba(99,102,241,0.25);border:1px solid rgba(99,102,241,0.4);color:#c7d2fe;padding:1px 4px;border-radius:3px;font-weight:600;font-size: var(--font-size-xs);">$1</span>');
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
          if (changes.synqto_server_connected || changes.nerd_buddy_server_connected) {
            const raw = (changes.synqto_server_connected || changes.nerd_buddy_server_connected);
            const isConn = Boolean(raw.newValue);
            const wasConn = Boolean(raw.oldValue);
            this.isServerConnected = isConn;
            if (isConn && !wasConn) {
              this.showServerConnectedToast('⚡ Connected to Synqto Server');
            }
            this.render();
          }
          if (changes[THEME_SETTINGS_STORAGE_KEY]) {
            this.themeSettings = changes[THEME_SETTINGS_STORAGE_KEY].newValue;
            this.render();
          }
          if (changes.synqto_collab_notebook) {
            const nb = changes.synqto_collab_notebook.newValue;
            if (nb && Array.isArray(nb.pages)) {
              const activePage = nb.pages.find((p: any) => p.id === nb.activePageId) || nb.pages[0];
              if (activePage) {
                this.wbStrokes = activePage.strokes || [];
                if (activePage.background) this.wbTheme = activePage.background;
                if (activePage.bgColor) this.wbBgColor = activePage.bgColor;
                if (this.activeTab === 'whiteboard') this.drawWbCanvas();
              }
            }
          }
          if (changes.synqto_inpage_personal_board) {
            const board = changes.synqto_inpage_personal_board.newValue;
            if (board) {
              if (Array.isArray(board.strokes)) this.wbPersonalStrokes = board.strokes;
              if (board.theme) this.wbPersonalTheme = board.theme;
              if (board.bgColor) this.wbPersonalBgColor = board.bgColor;
              if (this.activeTab === 'whiteboard' && this.wbPrivacyMode === 'personal') {
                this.drawWbCanvas();
              }
            }
          }
          if (changes[POMODORO_CONFIG_STORAGE_KEY]) {
            const newCfg = changes[POMODORO_CONFIG_STORAGE_KEY].newValue;
            if (newCfg) {
              this.timerConfig = { ...DEFAULT_POMODORO_CONFIG, ...newCfg };
              this.render();
            }
          }
          if (changes[POMODORO_STATE_STORAGE_KEY]) {
            const incomingState = changes[POMODORO_STATE_STORAGE_KEY].newValue;
            if (incomingState) {
              this.timerState = incomingState;
              this.updateTimerDisplay();
              if (this.isOpen) {
                this.render();
              }
            }
          }
        }
      });
    }
  }

  private showServerConnectedToast(msg: string) {
    this.serverToastMessage = msg;
    this.render();
    setTimeout(() => {
      this.serverToastMessage = null;
      this.render();
    }, 3200);
  }

  // ─── Pomodoro & Focus Timer Helpers ───

  private async loadTimerState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([
          POMODORO_CONFIG_STORAGE_KEY,
          POMODORO_STATE_STORAGE_KEY,
        ]);
        if (res[POMODORO_CONFIG_STORAGE_KEY]) {
          this.timerConfig = { ...DEFAULT_POMODORO_CONFIG, ...res[POMODORO_CONFIG_STORAGE_KEY] };
        }
        if (res[POMODORO_STATE_STORAGE_KEY]) {
          const saved: TimerState = res[POMODORO_STATE_STORAGE_KEY];
          if (saved.isRunning) {
            const elapsed = Math.floor((Date.now() - saved.lastUpdated) / 1000);
            if (saved.mode === 'stopwatch') {
              saved.timeLeftSec += elapsed;
            } else {
              saved.timeLeftSec = Math.max(0, saved.timeLeftSec - elapsed);
              if (saved.timeLeftSec === 0) {
                saved.isRunning = false;
              }
            }
          }
          this.timerState = saved;
        }
      } catch (e) {}
    }
  }

  private saveTimerState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [POMODORO_STATE_STORAGE_KEY]: this.timerState,
      });
    }
  }

  private startTimerTickLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.timerState.isRunning) {
        if (this.timerState.mode === 'stopwatch') {
          this.timerState.timeLeftSec += 1;
          this.timerState.lastUpdated = Date.now();
          this.updateTimerDisplay();
        } else {
          if (this.timerState.timeLeftSec > 0) {
            this.timerState.timeLeftSec -= 1;
            this.timerState.lastUpdated = Date.now();
            this.updateTimerDisplay();

            if (this.timerState.timeLeftSec === 0) {
              this.handleTimerSessionComplete();
            } else if (this.timerState.timeLeftSec % 5 === 0) {
              this.saveTimerState();
            }
          }
        }
      }
    }, 1000);
  }

  private updateTimerDisplay() {
    if (!this.shadow) return;
    const timeEl = this.shadow.getElementById('nb-timer-time');
    if (timeEl) {
      timeEl.textContent = this.formatTimerTime(this.timerState.timeLeftSec);
    }
    const timerFabTime = this.shadow.getElementById('nb-timer-fab-time');
    if (timerFabTime) {
      timerFabTime.textContent = this.formatTimerTime(this.timerState.timeLeftSec);
    }
    const timerFabFill = this.shadow.getElementById('nb-timer-fab-fill') as HTMLElement;
    if (timerFabFill) {
      const pct = this.getTimerProgressPct();
      timerFabFill.style.width = `${pct}%`;
    }
    const barEl = this.shadow.getElementById('nb-timer-progress-fill') as HTMLElement;
    if (barEl) {
      const pct = this.getTimerProgressPct();
      barEl.style.width = `${pct}%`;
    }
  }

  private getTimerProgressPct(): number {
    if (this.timerState.mode === 'stopwatch' || this.timerState.targetDurationSec === 0) return 100;
    const progress = 1 - this.timerState.timeLeftSec / this.timerState.targetDurationSec;
    return Math.min(100, Math.max(0, progress * 100));
  }

  private handleTimerSessionComplete() {
    this.timerState.isRunning = false;
    this.timerState.lastUpdated = Date.now();

    if (this.timerConfig.soundAlerts) {
      this.playTimerChime();
    }

    if (this.timerState.mode === 'pomodoro') {
      this.timerState.sessionsCompleted += 1;
      const isLongBreak = this.timerState.sessionsCompleted % 4 === 0;
      const nextMode: TimerMode = isLongBreak ? 'long_break' : 'short_break';
      this.resetTimerToMode(nextMode);

      if (this.timerConfig.autoStartBreaks) {
        this.timerState.isRunning = true;
      }
    } else {
      this.resetTimerToMode('pomodoro');
    }

    this.saveTimerState();
    this.render();
  }

  private resetTimerToMode(mode: TimerMode) {
    this.timerState.mode = mode;
    let durationSec = 25 * 60;
    if (mode === 'pomodoro') {
      durationSec = (this.timerConfig.workDurationMin || 25) * 60;
    } else if (mode === 'short_break') {
      durationSec = (this.timerConfig.shortBreakMin || 5) * 60;
    } else if (mode === 'long_break') {
      durationSec = (this.timerConfig.longBreakMin || 15) * 60;
    } else if (mode === 'stopwatch') {
      durationSec = 0;
    }
    this.timerState.timeLeftSec = durationSec;
    this.timerState.targetDurationSec = durationSec;
    this.timerState.lastUpdated = Date.now();
  }

  private toggleTimer() {
    this.timerState.isRunning = !this.timerState.isRunning;
    this.timerState.lastUpdated = Date.now();
    this.saveTimerState();
    this.render();
  }

  private resetTimer() {
    this.timerState.isRunning = false;
    this.resetTimerToMode(this.timerState.mode);
    this.saveTimerState();
    this.render();
  }

  private setTimerMode(mode: TimerMode) {
    this.timerState.isRunning = false;
    this.resetTimerToMode(mode);
    this.saveTimerState();
    this.render();
  }

  private addTimerTime(seconds: number) {
    if (this.timerState.mode !== 'stopwatch') {
      this.timerState.timeLeftSec = Math.max(0, this.timerState.timeLeftSec + seconds);
      this.timerState.targetDurationSec = Math.max(this.timerState.timeLeftSec, this.timerState.targetDurationSec + seconds);
    } else {
      this.timerState.timeLeftSec = Math.max(0, this.timerState.timeLeftSec + seconds);
    }
    this.saveTimerState();
    this.render();
  }

  private formatTimerTime(sec: number): string {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private playTimerChime() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playTone(523.25, 0, 1.2);
      playTone(659.25, 0.15, 1.2);
      playTone(783.99, 0.3, 1.5);
      playTone(1046.5, 0.45, 2.0);
    } catch (e) {}
  }

  private getThemeCSS(): string {
    const mode = this.themeSettings?.mode || 'system';
    const isLight =
      mode === 'day' ||
      mode === 'light' ||
      mode === 'leetcode_light' ||
      mode === 'solarized_light' ||
      mode === 'sakura' ||
      (mode === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches);

    let bgCard = 'rgba(26, 38, 41, 0.96)';
    let bgElevated = 'rgba(38, 55, 59, 0.95)';
    let borderSubtle = 'rgba(45, 212, 191, 0.18)';
    let textPrimary = '#ecfdf5';
    let textSecondary = '#a7f3d0';
    let primary = '#2dd4bf';
    let primaryHover = '#14b8a6';

    if (this.themeSettings?.customPaletteEnabled) {
      bgCard = this.themeSettings.customBgSurface || '#1e2b2f';
      bgElevated = this.themeSettings.customBgSurface || '#26373b';
      primary = this.themeSettings.customPrimary || '#2dd4bf';
      primaryHover = this.themeSettings.customPrimary || '#14b8a6';
      textPrimary = this.themeSettings.customTextPrimary || '#ecfdf5';
      textSecondary = this.themeSettings.customTextSecondary || '#94a3b8';
      borderSubtle = `${textSecondary}33`;
    } else if (mode === 'nordic_forest') {
      bgCard = 'rgba(26, 38, 41, 0.96)';
      bgElevated = 'rgba(38, 55, 59, 0.95)';
      borderSubtle = 'rgba(45, 212, 191, 0.22)';
      textPrimary = '#ecfdf5';
      textSecondary = '#a7f3d0';
      primary = '#2dd4bf';
      primaryHover = '#14b8a6';
    } else if (mode === 'leetcode_dark') {
      bgCard = 'rgba(38, 38, 38, 0.96)';
      bgElevated = 'rgba(48, 48, 48, 0.95)';
      borderSubtle = 'rgba(255, 161, 22, 0.25)';
      textPrimary = '#eff1f6';
      textSecondary = '#abb2bf';
      primary = '#FFA116';
      primaryHover = '#f59e0b';
    } else if (mode === 'leetcode_light') {
      bgCard = '#ffffff';
      bgElevated = '#f7f7f8';
      borderSubtle = 'rgba(230, 138, 0, 0.25)';
      textPrimary = '#262626';
      textSecondary = '#595959';
      primary = '#e68a00';
      primaryHover = '#cc7a00';
    } else if (mode === 'oled') {
      bgCard = 'rgba(10, 10, 10, 0.98)';
      bgElevated = 'rgba(24, 24, 24, 0.95)';
      borderSubtle = 'rgba(255, 255, 255, 0.18)';
      textPrimary = '#ffffff';
      textSecondary = '#e2e8f0';
    } else if (mode === 'espresso') {
      bgCard = 'rgba(32, 21, 14, 0.96)';
      bgElevated = 'rgba(48, 32, 22, 0.95)';
      borderSubtle = 'rgba(245, 158, 11, 0.2)';
      textPrimary = '#fef3c7';
      textSecondary = '#fde68a';
      primary = '#f59e0b';
      primaryHover = '#d97706';
    } else if (mode === 'forest') {
      bgCard = 'rgba(8, 28, 17, 0.96)';
      bgElevated = 'rgba(14, 42, 27, 0.95)';
      borderSubtle = 'rgba(16, 185, 129, 0.2)';
      textPrimary = '#ecfdf5';
      textSecondary = '#a7f3d0';
      primary = '#10b981';
      primaryHover = '#059669';
    } else if (mode === 'nord') {
      bgCard = 'rgba(46, 52, 64, 0.96)';
      bgElevated = 'rgba(59, 66, 82, 0.95)';
      borderSubtle = 'rgba(136, 192, 208, 0.2)';
      textPrimary = '#eceff4';
      textSecondary = '#e5e9f0';
      primary = '#88c0d0';
      primaryHover = '#81a1c1';
    } else if (mode === 'dracula') {
      bgCard = 'rgba(40, 42, 54, 0.96)';
      bgElevated = 'rgba(68, 71, 90, 0.95)';
      borderSubtle = 'rgba(189, 147, 249, 0.2)';
      textPrimary = '#f8f8f2';
      textSecondary = '#bd93f9';
      primary = '#bd93f9';
      primaryHover = '#a855f7';
    } else if (mode === 'synthwave') {
      bgCard = 'rgba(38, 20, 71, 0.96)';
      bgElevated = 'rgba(54, 28, 102, 0.95)';
      borderSubtle = 'rgba(244, 114, 182, 0.25)';
      textPrimary = '#fff0f5';
      textSecondary = '#f472b6';
      primary = '#f472b6';
      primaryHover = '#ec4899';
    } else if (mode === 'solarized_dark') {
      bgCard = 'rgba(0, 43, 54, 0.96)';
      bgElevated = 'rgba(7, 54, 66, 0.95)';
      borderSubtle = 'rgba(42, 161, 152, 0.25)';
      textPrimary = '#fdf6e3';
      textSecondary = '#eee8d5';
      primary = '#2aa198';
      primaryHover = '#268bd2';
    } else if (mode === 'solarized_light') {
      bgCard = '#fdf6e3';
      bgElevated = '#eee8d5';
      borderSubtle = 'rgba(7, 54, 66, 0.2)';
      textPrimary = '#073642';
      textSecondary = '#586e75';
      primary = '#268bd2';
      primaryHover = '#1e6ea8';
    } else if (mode === 'sakura') {
      bgCard = '#ffffff';
      bgElevated = '#fff0f3';
      borderSubtle = 'rgba(244, 63, 94, 0.2)';
      textPrimary = '#4c0519';
      textSecondary = '#881337';
      primary = '#f43f5e';
      primaryHover = '#e11d48';
    } else if (isLight) {
      bgCard = '#ffffff';
      bgElevated = '#f6f8fa';
      borderSubtle = 'rgba(31, 35, 40, 0.15)';
      textPrimary = '#1f2328';
      textSecondary = '#4b5563';
      primary = '#4f46e5';
      primaryHover = '#4338ca';
    } else if (mode === 'night') {
      bgCard = 'rgba(22, 27, 34, 0.96)';
      bgElevated = 'rgba(33, 38, 45, 0.95)';
      borderSubtle = 'rgba(255, 255, 255, 0.12)';
      textPrimary = '#f0f6fc';
      textSecondary = '#c9d1d9';
      primary = '#6366f1';
      primaryHover = '#4f46e5';
    }

    if (!this.themeSettings?.customPaletteEnabled) {
      if (this.themeSettings?.accent === 'leetcode') {
        primary = '#FFA116';
        primaryHover = '#f59e0b';
      } else if (this.themeSettings?.accent === 'emerald') {
        primary = '#10b981';
        primaryHover = '#059669';
      } else if (this.themeSettings?.accent === 'cyan') {
        primary = '#06b6d4';
        primaryHover = '#0891b2';
      } else if (this.themeSettings?.accent === 'rose') {
        primary = '#f43f5e';
        primaryHover = '#e11d48';
      } else if (this.themeSettings?.accent === 'amber') {
        primary = '#f59e0b';
        primaryHover = '#d97706';
      } else if (this.themeSettings?.accent === 'purple') {
        primary = '#a855f7';
        primaryHover = '#9333ea';
      }
    }

    // TYPE SCALE — must mirror ThemeService.applySettings exactly.
    //
    // The widget lives in the PAGE's document, not the side panel's, so it cannot inherit
    // the :root custom properties ThemeService sets. Without emitting the scale here the
    // widget's ~75 hardcoded font sizes ignored the user's font-size preference entirely:
    // enlarging text in Settings changed the panel and left the popup card and FAB
    // unchanged, which is the visible half of the "theme in one place" problem.
    //
    // Floors match theme.service (9.5 / 10.5 / 11.5) so text is never smaller in the popup
    // than in the panel at the same setting.
    const base = this.themeSettings?.fontSize || 13;
    const f2xs = Math.max(9.5, base - 3.5);
    const fxs = Math.max(10.5, base - 2.5);
    const fsm = Math.max(11.5, base - 1.5);

    return `
      --primary: ${primary};
      --primary-hover: ${primaryHover};
      --bg-card: ${bgCard};
      --bg-surface-elevated: ${bgElevated};
      --border-subtle: ${borderSubtle};
      --text-primary: ${textPrimary};
      --text-secondary: ${textSecondary};
      --text-muted: ${isLight ? '#6b7280' : '#8b949e'};
      --text-dim: ${isLight ? '#9ca3af' : '#6e7681'};
      --font-size-2xs: ${f2xs}px;
      --font-size-xs: ${fxs}px;
      --font-size-sm: ${fsm}px;
      --font-size-md: ${base}px;
      --font-size-base: ${base}px;
      --font-size-lg: ${base + 2}px;
      --font-size-xl: ${base + 5}px;
      --font-size-title: ${base + 8}px;
      --font-scale: ${base / 13};
    `;
  }
}
