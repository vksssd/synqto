// ─── Collaborative & Personal Whiteboard Service (Multi-Page Notebook, Multi-Window Sync & P2P Collab Mesh) ───

import { NetworkService } from '@/core/network/network.service';
import { globalClock, compareHLC } from '@/core/network/hybrid-clock';
import { IdentityService } from '@/features/identity/identity.service';
import {
  WhiteboardStroke,
  WhiteboardToolType,
  WhiteboardBackgroundType,
  WhiteboardPrivacyMode,
  WhiteboardPage,
  WhiteboardNotebook,
  Point,
  LaserPointerPosition,
} from './whiteboard.types';
import { uuid } from '@/shared/utils';

/**
 * Catmull-Rom spline / Bezier curve smoothing for natural, pressure-friendly pen strokes.
 */
export function smoothStrokePoints(rawPoints: Point[]): Point[] {
  if (rawPoints.length <= 2) return rawPoints;

  const smoothed: Point[] = [];
  smoothed.push(rawPoints[0]);

  for (let i = 1; i < rawPoints.length - 1; i++) {
    const p0 = rawPoints[i - 1];
    const p1 = rawPoints[i];
    const p2 = rawPoints[i + 1];

    // Midpoints for smooth quadratic bezier transition
    const mid1X = (p0.x + p1.x) / 2;
    const mid1Y = (p0.y + p1.y) / 2;
    const mid2X = (p1.x + p2.x) / 2;
    const mid2Y = (p1.y + p2.y) / 2;

    smoothed.push({
      x: (mid1X + p1.x * 2 + mid2X) / 4,
      y: (mid1Y + p1.y * 2 + mid2Y) / 4,
      pressure: p1.pressure,
    });
  }

  smoothed.push(rawPoints[rawPoints.length - 1]);
  return smoothed;
}

export class WhiteboardService {
  private static instance: WhiteboardService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  // Unique instance ID to differentiate Sidepanel Draw tab, Standalone Popup window, and in-page tabs
  private instanceId: string = uuid();
  private localBus: BroadcastChannel | null = null;

  private privacyMode: WhiteboardPrivacyMode = 'personal';

  // Collaborative Notebook State
  private collabNotebook: WhiteboardNotebook = {
    activePageId: 'page-1',
    pages: [
      {
        id: 'page-1',
        title: 'Page 1: Architecture & Ideas',
        strokes: [],
        undoStack: [],
        redoStack: [],
        background: 'grid',
        bgColor: '#090d16',
        createdAt: Date.now(),
      },
    ],
  };

  // Personal Private Notebook State
  private personalNotebook: WhiteboardNotebook = {
    activePageId: 'personal-1',
    pages: [
      {
        id: 'personal-1',
        title: 'Scratchpad 1: Problem Dry Run',
        strokes: [],
        undoStack: [],
        redoStack: [],
        background: 'grid',
        bgColor: '#090d16',
        createdAt: Date.now(),
      },
    ],
  };

  private listeners: Set<(strokes: WhiteboardStroke[]) => void> = new Set();
  private notebookListeners: Set<(notebook: WhiteboardNotebook) => void> = new Set();
  private backgroundListeners: Set<(bg: WhiteboardBackgroundType) => void> = new Set();
  private bgColorListeners: Set<(color: string) => void> = new Set();
  private privacyListeners: Set<(mode: WhiteboardPrivacyMode) => void> = new Set();
  private laserListeners: Set<(laser: LaserPointerPosition) => void> = new Set();
  private tempStrokeListeners: Set<(stroke: WhiteboardStroke, durationMs: number) => void> = new Set();

  private lastLaserTime = 0;

  private constructor() {
    this.network = NetworkService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.setupLocalBus();
    this.setupRuntimeMessageListener();
    this.setupNetworkListeners();
    this.loadPrivacyMode();
    this.loadPersonalNotebook();
    this.loadCollabNotebook();
  }

  public static getInstance(): WhiteboardService {
    if (!WhiteboardService.instance) {
      WhiteboardService.instance = new WhiteboardService();
    }
    return WhiteboardService.instance;
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  // ─── Local Multi-Window IPC Bus (Sidepanel Draw Tab & Standalone Popup Window) ───
  private setupLocalBus(): void {
    try {
      this.localBus = new BroadcastChannel('synqto:wb:local_bus');
      this.localBus.onmessage = (event) => {
        const data = event.data;
        if (!data || data.fromInstanceId === this.instanceId) return;

        if (data.action === 'stroke' && data.stroke) {
          const { stroke, pageId } = data;
          const notebook = this.getActiveNotebook();
          const targetPage = notebook.pages.find((p) => p.id === pageId) || this.getActivePage();
          if (!targetPage.strokes.some((s) => s.id === stroke.id)) {
            targetPage.strokes.push(stroke);
            if (notebook.activePageId === targetPage.id) {
              this.notifyListeners();
            }
          }
        } else if (data.action === 'temp_stroke' && data.stroke) {
          this.tempStrokeListeners.forEach((fn) => fn(data.stroke, data.durationMs || 3000));
        } else if (data.action === 'undo' && data.strokeId) {
          const notebook = this.getActiveNotebook();
          const targetPage = notebook.pages.find((p) => p.id === data.pageId) || this.getActivePage();
          targetPage.strokes = targetPage.strokes.filter((s) => s.id !== data.strokeId);
          if (notebook.activePageId === targetPage.id) {
            this.notifyListeners();
          }
        } else if (data.action === 'clear') {
          const notebook = this.getActiveNotebook();
          const targetPage = notebook.pages.find((p) => p.id === data.pageId) || this.getActivePage();
          targetPage.strokes = [];
          targetPage.redoStack = [];
          if (notebook.activePageId === targetPage.id) {
            this.notifyListeners();
          }
        } else if (data.action === 'background') {
          const page = this.getActivePage();
          if (data.background) page.background = data.background;
          if (data.bgColor) page.bgColor = data.bgColor;
          this.backgroundListeners.forEach((fn) => fn(page.background));
          if (page.bgColor) this.bgColorListeners.forEach((fn) => fn(page.bgColor));
        } else if (data.action === 'laser' && data.laser) {
          this.laserListeners.forEach((fn) => fn(data.laser));
        } else if (data.action === 'page_sync') {
          const notebook = this.getActiveNotebook();
          if (data.pageSyncAction === 'add' && data.page) {
            if (!notebook.pages.some((p) => p.id === data.page.id)) {
              notebook.pages.push(data.page);
              this.notifyNotebookListeners();
            }
          } else if (data.pageSyncAction === 'switch' && data.pageId) {
            if (notebook.pages.some((p) => p.id === data.pageId)) {
              notebook.activePageId = data.pageId;
              this.notifyNotebookListeners();
              this.notifyListeners();
            }
          } else if (data.pageSyncAction === 'rename' && data.pageId && data.newTitle) {
            const page = notebook.pages.find((p) => p.id === data.pageId);
            if (page) {
              page.title = data.newTitle;
              this.notifyNotebookListeners();
            }
          } else if (data.pageSyncAction === 'delete' && data.pageId) {
            notebook.pages = notebook.pages.filter((p) => p.id !== data.pageId);
            if (notebook.activePageId === data.pageId) {
              notebook.activePageId = notebook.pages[0]?.id || 'page-1';
            }
            this.notifyNotebookListeners();
            this.notifyListeners();
          }
        } else if (data.action === 'full_snapshot' && data.notebook) {
          if (this.privacyMode === 'collaborative') {
            this.collabNotebook = data.notebook;
            this.notifyNotebookListeners();
            this.notifyListeners();
          }
        }
      };
    } catch (e) {
      console.warn('[WhiteboardService] BroadcastChannel not supported in this environment');
    }
  }

  private broadcastLocal(action: string, payload: Record<string, any>): void {
    if (this.localBus) {
      try {
        this.localBus.postMessage({
          fromInstanceId: this.instanceId,
          action,
          ...payload,
        });
      } catch (e) {}
    }
  }

  public broadcastRuntime(msg: Record<string, any>): void {
    if (typeof chrome !== 'undefined') {
      if (chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg).catch(() => {});
      }
      if (chrome.tabs?.query) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
            }
          });
        });
      }
    }
  }

  // ─── Chrome Runtime Message Relay (In-Page Floating Widget Shadow DOM & Extension Views) ───
  private setupRuntimeMessageListener(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'WHITEBOARD_GET_SNAPSHOT') {
          sendResponse({
            collabNotebook: this.collabNotebook,
            personalNotebook: this.personalNotebook,
            privacyMode: this.privacyMode,
          });
          return true;
        } else if (msg.type === 'WHITEBOARD_STROKE_LOCAL' && msg.stroke) {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          const existingIdx = targetPage.strokes.findIndex((s) => s.id === msg.stroke.id);
          if (existingIdx !== -1) {
            targetPage.strokes[existingIdx] = msg.stroke;
          } else {
            targetPage.strokes.push(msg.stroke);
          }
          this.saveCollabNotebook();
          this.network.broadcast('whiteboard:stroke', { pageId: targetPage.id, stroke: msg.stroke });
          if (this.privacyMode === 'collaborative') {
            this.notifyListeners();
          }
          this.broadcastLocal('stroke', { stroke: msg.stroke, pageId: targetPage.id });
        } else if (msg.type === 'WHITEBOARD_STROKES_LOCAL' && Array.isArray(msg.strokes)) {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          targetPage.strokes.push(...msg.strokes);
          this.saveCollabNotebook();
          if (this.privacyMode === 'collaborative') {
            this.notifyListeners();
          }
        } else if (msg.type === 'WHITEBOARD_UPDATE_STROKES_LOCAL' && Array.isArray(msg.strokes)) {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          const map = new Map<string, WhiteboardStroke>(msg.strokes.map((s: any) => [s.id, s]));
          targetPage.strokes = targetPage.strokes.map((s) => (map.has(s.id) ? map.get(s.id)! : s));
          this.saveCollabNotebook();
          this.network.broadcast('whiteboard:strokes_batch', { pageId: targetPage.id, strokes: msg.strokes });
          if (this.privacyMode === 'collaborative') {
            this.notifyListeners();
          }
          this.broadcastLocal('strokes_batch', { strokes: msg.strokes, pageId: targetPage.id });
        } else if (msg.type === 'WHITEBOARD_UNDO_LOCAL' && msg.strokeId) {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          targetPage.strokes = targetPage.strokes.filter((s) => s.id !== msg.strokeId);
          this.saveCollabNotebook();
          this.network.broadcast('whiteboard:undo', { pageId: targetPage.id, strokeId: msg.strokeId });
          if (this.privacyMode === 'collaborative') {
            this.notifyListeners();
          }
          this.broadcastLocal('undo', { strokeId: msg.strokeId, pageId: targetPage.id });
        } else if (msg.type === 'WHITEBOARD_CLEAR_LOCAL') {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          targetPage.strokes = [];
          targetPage.redoStack = [];
          this.saveCollabNotebook();
          this.network.broadcast('whiteboard:clear', { pageId: targetPage.id });
          if (this.privacyMode === 'collaborative') {
            this.notifyListeners();
          }
          this.broadcastLocal('clear', { pageId: targetPage.id });
        } else if (msg.type === 'WHITEBOARD_BG_LOCAL' && msg.background) {
          const targetPage =
            this.collabNotebook.pages.find((p) => p.id === (msg.pageId || this.collabNotebook.activePageId)) ||
            this.collabNotebook.pages[0];
          targetPage.background = msg.background;
          if (msg.bgColor) targetPage.bgColor = msg.bgColor;
          this.saveCollabNotebook();
          this.network.broadcast('whiteboard:background', { background: msg.background, bgColor: targetPage.bgColor });
          if (this.privacyMode === 'collaborative') {
            this.backgroundListeners.forEach((fn) => fn(targetPage.background));
            if (targetPage.bgColor) this.bgColorListeners.forEach((fn) => fn(targetPage.bgColor!));
          }
          this.broadcastLocal('background', { background: targetPage.background, bgColor: targetPage.bgColor, pageId: targetPage.id });
        }
      });
    }
  }

  // ─── Storage Persistence ───
  private async loadPrivacyMode() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_whiteboard_privacy_mode']);
        if (res.synqto_whiteboard_privacy_mode) {
          this.privacyMode = res.synqto_whiteboard_privacy_mode;
          this.privacyListeners.forEach((fn) => fn(this.privacyMode));
          this.notifyNotebookListeners();
          this.notifyListeners();
        }
      } catch (e) {}
    }
  }

  private savePrivacyMode() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({
          synqto_whiteboard_privacy_mode: this.privacyMode,
        });
      } catch (e) {}
    }
  }

  private async loadPersonalNotebook() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_personal_notebook']);
        if (res.synqto_personal_notebook && Array.isArray(res.synqto_personal_notebook.pages)) {
          this.personalNotebook = res.synqto_personal_notebook;
        }
      } catch (e) {}
    }
  }

  private savePersonalNotebook() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({
          synqto_personal_notebook: this.personalNotebook,
        });
      } catch (e) {}
    }
  }

  private async loadCollabNotebook() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_collab_notebook']);
        if (res.synqto_collab_notebook && Array.isArray(res.synqto_collab_notebook.pages)) {
          this.collabNotebook = res.synqto_collab_notebook;
        }
      } catch (e) {}
    }
  }

  private saveCollabNotebook() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({
          synqto_collab_notebook: this.collabNotebook,
        });
      } catch (e) {}
    }
  }

  // ─── Network Protocol Listeners for P2P Mesh Synchronization ───
  private setupNetworkListeners(): void {
    // 0. Automatic Catch-up sync on presence join in collaborative mode
    this.network.on('presence:join', () => {
      if (this.privacyMode === 'collaborative') {
        // Always ask. This was gated on the local notebook being EMPTY, so anyone who had
        // drawn even one stroke before joining never requested the room's history and sat
        // on a permanently partial board.
        this.network.broadcast('whiteboard:sync_request', { timestamp: Date.now() });
      }
    });

    // 0a. Handle incoming full sync request from a newly joined peer
    this.network.on('whiteboard:sync_request', (_, packet) => {
      if (this.privacyMode !== 'collaborative') return;
      const strokeCount = this.collabNotebook.pages.reduce((acc, p) => acc + p.strokes.length, 0);
      if (strokeCount > 0 && packet.from?.peerId) {
        this.network.send(
          packet.from.peerId,
          'whiteboard:sync_response',
          { notebook: this.collabNotebook },
          { channelPriority: 'bulk' }
        );
      }
    });

    // 0b. Handle incoming full sync response from existing peer in room
    this.network.on<{ notebook: WhiteboardNotebook }>('whiteboard:sync_response', (payload) => {
      if (this.privacyMode !== 'collaborative' || !payload?.notebook?.pages) return;
      // MERGE by stroke id rather than replacing the notebook wholesale.
      //
      // The old rule was "whichever side has more strokes wins", which silently discarded
      // every local stroke whenever the remote happened to have more. Strokes are an
      // append-only set with stable ids, so a union is both safe and order-independent —
      // no peer can lose work by being the one who had drawn less.
      let changed = false;
      for (const incomingPage of payload.notebook.pages) {
        const localPage = this.collabNotebook.pages.find((p) => p.id === incomingPage.id);
        if (!localPage) {
          this.collabNotebook.pages.push(incomingPage);
          changed = true;
          continue;
        }
        const seen = new Set(localPage.strokes.map((st) => st.id));
        for (const st of incomingPage.strokes || []) {
          if (!seen.has(st.id)) {
            localPage.strokes.push(st);
            seen.add(st.id);
            changed = true;
          }
        }
      }

      if (changed) {
        // Restore a deterministic z-order. Union-merge appends in arrival order, which
        // differs per peer; sorting on the stroke stamp makes overlapping strokes paint
        // identically everywhere.
        for (const pg of this.collabNotebook.pages) {
          pg.strokes.sort((x, y) =>
            compareHLC(
              { hlc: x.hlc, timestamp: x.timestamp, peerId: x.peerId },
              { hlc: y.hlc, timestamp: y.timestamp, peerId: y.peerId }
            )
          );
        }
        this.saveCollabNotebook();
        this.notifyNotebookListeners();
        this.notifyListeners();
        this.broadcastLocal('full_snapshot', { notebook: this.collabNotebook });
        this.broadcastRuntime({ type: 'WHITEBOARD_SNAPSHOT', notebook: this.collabNotebook });
      }
    });

    // 1. Receive incoming remote stroke
    this.network.on<{ pageId?: string; stroke: WhiteboardStroke }>('whiteboard:stroke', (payload) => {
      const stroke = payload?.stroke || (payload as any);
      if (!stroke || !stroke.id) return;

      const pageId = payload?.pageId || this.collabNotebook.activePageId;
      const targetPage = this.collabNotebook.pages.find((p) => p.id === pageId) || this.getActivePage();

      if (!targetPage.strokes.some((s) => s.id === stroke.id)) {
        targetPage.strokes.push(stroke);
        this.saveCollabNotebook();
        this.broadcastLocal('stroke', { stroke, pageId: targetPage.id });
        this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke, pageId: targetPage.id });
        if (this.privacyMode === 'collaborative' && this.collabNotebook.activePageId === targetPage.id) {
          this.notifyListeners();
        }
      }
    });

    // 1b. Receive remote strokes batch (moving/transforming selections)
    this.network.on<{ pageId?: string; strokes: WhiteboardStroke[] }>('whiteboard:strokes_batch', (payload) => {
      if (!payload || !Array.isArray(payload.strokes) || payload.strokes.length === 0) return;
      const pageId = payload.pageId || this.collabNotebook.activePageId;
      const targetPage = this.collabNotebook.pages.find((p) => p.id === pageId) || this.getActivePage();

      const strokeMap = new Map<string, WhiteboardStroke>(payload.strokes.map((s) => [s.id, s]));
      targetPage.strokes = targetPage.strokes.map((s) => (strokeMap.has(s.id) ? strokeMap.get(s.id)! : s));
      this.saveCollabNotebook();
      this.broadcastLocal('strokes_batch', { strokes: payload.strokes, pageId: targetPage.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_UPDATE_STROKES_LOCAL', strokes: payload.strokes, pageId: targetPage.id });
      if (this.privacyMode === 'collaborative' && this.collabNotebook.activePageId === targetPage.id) {
        this.notifyListeners();
      }
    });

    // 2. Receive temporary disappearing stroke
    this.network.on<{ stroke: WhiteboardStroke; durationMs: number }>('whiteboard:temp_stroke', (payload) => {
      if (payload?.stroke && this.privacyMode === 'collaborative') {
        this.tempStrokeListeners.forEach((fn) => fn(payload.stroke, payload.durationMs || 3000));
        this.broadcastLocal('temp_stroke', { stroke: payload.stroke, durationMs: payload.durationMs || 3000 });
        this.broadcastRuntime({ type: 'WHITEBOARD_TEMP_STROKE_LOCAL', stroke: payload.stroke, durationMs: payload.durationMs || 3000 });
      }
    });

    // 3. Receive remote canvas clear
    this.network.on<{ pageId?: string; timestamp: number }>('whiteboard:clear', (payload) => {
      const pageId = payload?.pageId || this.collabNotebook.activePageId;
      const page = this.collabNotebook.pages.find((p) => p.id === pageId);
      if (page) {
        page.strokes = [];
        page.redoStack = [];
        this.saveCollabNotebook();
        this.broadcastLocal('clear', { pageId: page.id });
        this.broadcastRuntime({ type: 'WHITEBOARD_CLEAR_LOCAL', pageId: page.id });
        if (this.privacyMode === 'collaborative' && this.collabNotebook.activePageId === page.id) {
          this.notifyListeners();
        }
      }
    });

    // 4. Receive remote undo
    this.network.on<{ pageId?: string; strokeId: string }>('whiteboard:undo', (payload) => {
      if (payload?.strokeId) {
        const pageId = payload?.pageId || this.collabNotebook.activePageId;
        const page = this.collabNotebook.pages.find((p) => p.id === pageId);
        if (page) {
          page.strokes = page.strokes.filter((s) => s.id !== payload.strokeId);
          this.saveCollabNotebook();
          this.broadcastLocal('undo', { strokeId: payload.strokeId, pageId: page.id });
          this.broadcastRuntime({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: payload.strokeId, pageId: page.id });
          if (this.privacyMode === 'collaborative' && this.collabNotebook.activePageId === page.id) {
            this.notifyListeners();
          }
        }
      }
    });

    // 5. Receive remote background pattern change
    this.network.on<{ background: WhiteboardBackgroundType; bgColor?: string }>('whiteboard:background', (payload) => {
      if (payload?.background) {
        const page = this.getActivePage();
        page.background = payload.background;
        if (payload.bgColor) page.bgColor = payload.bgColor;
        this.saveCollabNotebook();
        this.broadcastLocal('background', { background: page.background, bgColor: page.bgColor, pageId: page.id });
        this.broadcastRuntime({ type: 'WHITEBOARD_BG_LOCAL', background: page.background, bgColor: page.bgColor, pageId: page.id });
        this.backgroundListeners.forEach((fn) => fn(page.background));
        if (payload.bgColor) this.bgColorListeners.forEach((fn) => fn(payload.bgColor!));
      }
    });

    // 6. Receive remote laser pointer
    this.network.on<LaserPointerPosition>('whiteboard:laser', (laser) => {
      if (laser && laser.peerId && this.privacyMode === 'collaborative') {
        this.laserListeners.forEach((fn) => fn(laser));
        this.broadcastLocal('laser', { laser });
      }
    });

    // 7. Receive remote page creation / page switch in collaborative mode
    this.network.on<{ action: 'add' | 'switch'; page?: WhiteboardPage; pageId?: string }>('whiteboard:page_sync', (payload) => {
      if (this.privacyMode !== 'collaborative') return;

      if (payload.action === 'add' && payload.page) {
        if (!this.collabNotebook.pages.some((p) => p.id === payload.page!.id)) {
          this.collabNotebook.pages.push(payload.page);
          this.saveCollabNotebook();
          this.broadcastLocal('page_sync', { pageSyncAction: 'add', page: payload.page });
          this.notifyNotebookListeners();
        }
      } else if (payload.action === 'switch' && payload.pageId) {
        if (this.collabNotebook.pages.some((p) => p.id === payload.pageId)) {
          this.collabNotebook.activePageId = payload.pageId;
          this.broadcastLocal('page_sync', { pageSyncAction: 'switch', pageId: payload.pageId });
          this.notifyNotebookListeners();
          this.notifyListeners();
        }
      }
    });
  }

  // ─── Notebook Management API ───

  public getActiveNotebook(): WhiteboardNotebook {
    return this.privacyMode === 'personal' ? this.personalNotebook : this.collabNotebook;
  }

  public getActivePage(): WhiteboardPage {
    const notebook = this.getActiveNotebook();
    const page = notebook.pages.find((p) => p.id === notebook.activePageId);
    return page || notebook.pages[0];
  }

  public addPage(title?: string): WhiteboardPage {
    const notebook = this.getActiveNotebook();
    const pageNumber = notebook.pages.length + 1;
    const newPage: WhiteboardPage = {
      id: `page-${uuid()}`,
      title: title || (this.privacyMode === 'personal' ? `Scratchpad ${pageNumber}` : `Page ${pageNumber}: Diagrams`),
      strokes: [],
      undoStack: [],
      redoStack: [],
      background: 'grid',
      bgColor: '#090d16',
      createdAt: Date.now(),
    };

    notebook.pages.push(newPage);
    notebook.activePageId = newPage.id;

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:page_sync', { action: 'add', page: newPage });
    }

    this.broadcastLocal('page_sync', { pageSyncAction: 'add', page: newPage });
    this.notifyNotebookListeners();
    this.notifyListeners();
    return newPage;
  }

  public switchPage(pageId: string): void {
    const notebook = this.getActiveNotebook();
    if (notebook.pages.some((p) => p.id === pageId)) {
      notebook.activePageId = pageId;
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
        this.network.broadcast('whiteboard:page_sync', { action: 'switch', pageId });
      }
      this.broadcastLocal('page_sync', { pageSyncAction: 'switch', pageId });
      this.notifyNotebookListeners();
      this.notifyListeners();
    }
  }

  public renamePage(pageId: string, newTitle: string): void {
    const notebook = this.getActiveNotebook();
    const page = notebook.pages.find((p) => p.id === pageId);
    if (page && newTitle.trim()) {
      page.title = newTitle.trim();
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
      }
      this.broadcastLocal('page_sync', { pageSyncAction: 'rename', pageId, newTitle: page.title });
      this.notifyNotebookListeners();
    }
  }

  public deletePage(pageId: string): void {
    const notebook = this.getActiveNotebook();
    if (notebook.pages.length <= 1) return; // Keep at least 1 page

    notebook.pages = notebook.pages.filter((p) => p.id !== pageId);
    if (notebook.activePageId === pageId) {
      notebook.activePageId = notebook.pages[0].id;
    }

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
    }
    this.broadcastLocal('page_sync', { pageSyncAction: 'delete', pageId });
    this.notifyNotebookListeners();
    this.notifyListeners();
  }

  public duplicatePage(pageId: string): WhiteboardPage | null {
    const notebook = this.getActiveNotebook();
    const page = notebook.pages.find((p) => p.id === pageId);
    if (!page) return null;

    const newPage: WhiteboardPage = {
      id: `page-${uuid()}`,
      title: `${page.title} (Copy)`,
      strokes: JSON.parse(JSON.stringify(page.strokes)),
      undoStack: [],
      redoStack: [],
      background: page.background,
      bgColor: page.bgColor,
      createdAt: Date.now(),
    };

    notebook.pages.push(newPage);
    notebook.activePageId = newPage.id;

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:page_sync', { action: 'add', page: newPage });
    }

    this.broadcastLocal('page_sync', { pageSyncAction: 'add', page: newPage });
    this.notifyNotebookListeners();
    this.notifyListeners();
    return newPage;
  }

  // ─── Privacy Mode API ───

  public setPrivacyMode(mode: WhiteboardPrivacyMode): void {
    this.privacyMode = mode;
    this.savePrivacyMode();
    this.privacyListeners.forEach((fn) => fn(mode));
    this.notifyNotebookListeners();
    this.notifyListeners();
  }

  public getPrivacyMode(): WhiteboardPrivacyMode {
    return this.privacyMode;
  }

  // ─── Background & Custom Colors API ───

  public setBackground(bg: WhiteboardBackgroundType): void {
    const page = this.getActivePage();
    page.background = bg;
    this.backgroundListeners.forEach((fn) => fn(bg));
    if (this.privacyMode === 'collaborative') {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:background', { background: bg, bgColor: page.bgColor });
    } else {
      this.savePersonalNotebook();
    }
    this.broadcastLocal('background', { background: bg, bgColor: page.bgColor, pageId: page.id });
    this.broadcastRuntime({ type: 'WHITEBOARD_BG_LOCAL', background: bg, bgColor: page.bgColor, pageId: page.id });
  }

  public getBackground(): WhiteboardBackgroundType {
    return this.getActivePage().background;
  }

  public setBgColor(color: string): void {
    const page = this.getActivePage();
    page.bgColor = color;
    this.bgColorListeners.forEach((fn) => fn(color));
    if (this.privacyMode === 'collaborative') {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:background', { background: page.background, bgColor: color });
    } else {
      this.savePersonalNotebook();
    }
    this.broadcastLocal('background', { background: page.background, bgColor: color, pageId: page.id });
    this.broadcastRuntime({ type: 'WHITEBOARD_BG_LOCAL', background: page.background, bgColor: color, pageId: page.id });
  }

  public getBgColor(): string {
    return this.getActivePage().bgColor || '#090d16';
  }

  // ─── Laser & Temporary Ink API ───

  public broadcastLaser(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastLaserTime < 30) return;
    this.lastLaserTime = now;

    const identity = this.identityService.getCachedIdentity();
    const payload: LaserPointerPosition = {
      peerId: identity?.peerId || 'local',
      nickname: identity?.nickname || 'Laser',
      color: identity?.color || '#ef4444',
      x,
      y,
      timestamp: now,
    };

    this.laserListeners.forEach((fn) => fn(payload));
    this.broadcastLocal('laser', { laser: payload });
    if (this.privacyMode === 'collaborative') {
      this.network.broadcast('whiteboard:laser', payload);
    }
  }

  public broadcastTempStroke(stroke: WhiteboardStroke, durationMs = 3000): void {
    this.tempStrokeListeners.forEach((fn) => fn(stroke, durationMs));
    this.broadcastLocal('temp_stroke', { stroke, durationMs });
    if (this.privacyMode === 'collaborative') {
      this.network.broadcast('whiteboard:temp_stroke', { stroke, durationMs });
    }
  }

  // ─── Stroke Management API ───

  public addStroke(
    tool: WhiteboardToolType,
    color: string,
    width: number,
    points: Point[],
    geometry?: { x1: number; y1: number; x2: number; y2: number; label?: string; subLabel?: string },
    text?: string
  ): WhiteboardStroke {
    const identity = this.identityService.getCachedIdentity();
    const opacity = tool === 'highlighter' ? 0.35 : 1.0;
    const page = this.getActivePage();

    // Auto-smooth freehand pen points for organic bezier lines
    const processedPoints = tool === 'pen' || tool === 'brush' ? smoothStrokePoints(points) : points;

    const stroke: WhiteboardStroke = {
      id: `stroke-${uuid()}`,
      peerId: identity?.peerId || 'local',
      nickname: identity?.nickname || 'Anonymous',
      tool,
      color,
      width,
      opacity,
      points: processedPoints,
      geometry,
      text,
      timestamp: Date.now(),
      hlc: globalClock.tick(),
    };

    if (tool === 'temp_pen') {
      // Disappearing ink handled separately by temporary animation pool
      this.broadcastTempStroke(stroke, 3000);
      return stroke;
    }

    page.strokes.push(stroke);
    page.redoStack = [];

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke });
    }

    this.broadcastLocal('stroke', { stroke, pageId: page.id });
    this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke, pageId: page.id });
    this.notifyListeners();
    return stroke;
  }

  public deleteStroke(strokeId: string): void {
    const page = this.getActivePage();
    const index = page.strokes.findIndex((s) => s.id === strokeId);
    if (index !== -1) {
      const [removed] = page.strokes.splice(index, 1);
      page.redoStack.push(removed);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
        this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId });
      }
      this.broadcastLocal('undo', { strokeId, pageId: page.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId, pageId: page.id });
      this.notifyListeners();
    }
  }

  public deleteStrokes(strokeIds: string[]): void {
    if (!strokeIds || strokeIds.length === 0) return;
    const page = this.getActivePage();
    const idSet = new Set(strokeIds);
    const removedStrokes: WhiteboardStroke[] = [];
    page.strokes = page.strokes.filter((s) => {
      if (idSet.has(s.id)) {
        removedStrokes.push(s);
        return false;
      }
      return true;
    });

    if (removedStrokes.length > 0) {
      page.redoStack.push(...removedStrokes);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
        removedStrokes.forEach((s) => {
          this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId: s.id });
        });
      }
      removedStrokes.forEach((s) => {
        this.broadcastLocal('undo', { strokeId: s.id, pageId: page.id });
        this.broadcastRuntime({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: s.id, pageId: page.id });
      });
      this.notifyListeners();
    }
  }

  public addStrokes(strokes: WhiteboardStroke[]): void {
    if (strokes.length === 0) return;
    const page = this.getActivePage();
    page.strokes.push(...strokes);
    page.redoStack = [];

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      // Restoring an undo/clear used to broadcast EVERY stroke as its own packet, so a

      // 500-stroke board emitted 500 packets in one burst — the single biggest amplifier

      // of client send pressure in the app. whiteboard:strokes_batch already exists and is

      // handled by peers, so the whole restore travels as one message.

      this.network.broadcast('whiteboard:strokes_batch', { pageId: page.id, strokes: strokes }, { channelPriority: 'bulk' });
    }

    strokes.forEach((s) => {
      this.broadcastLocal('stroke', { stroke: s, pageId: page.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s, pageId: page.id });
    });
    this.notifyListeners();
  }

  public updateStrokes(updatedStrokes: WhiteboardStroke[]): void {
    if (updatedStrokes.length === 0) return;
    const page = this.getActivePage();
    const updateMap = new Map(updatedStrokes.map((s) => [s.id, s]));

    page.strokes = page.strokes.map((s) => updateMap.get(s.id) || s);

    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      updatedStrokes.forEach((s) => {
        this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke: s });
      });
    }

    updatedStrokes.forEach((s) => {
      this.broadcastLocal('stroke', { stroke: s, pageId: page.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s, pageId: page.id });
    });
    this.notifyListeners();
  }

  public undo(): void {
    const page = this.getActivePage();
    if (page.strokes.length === 0) {
      if (page.redoStack.length > 0) {
        // If everything was cleared, undo restores the strokes
        page.strokes = [...page.redoStack];
        page.redoStack = [];
        if (this.privacyMode === 'personal') {
          this.savePersonalNotebook();
        } else {
          this.saveCollabNotebook();
          // Restoring an undo/clear used to broadcast EVERY stroke as its own packet, so a

          // 500-stroke board emitted 500 packets in one burst — the single biggest amplifier

          // of client send pressure in the app. whiteboard:strokes_batch already exists and is

          // handled by peers, so the whole restore travels as one message.

          this.network.broadcast('whiteboard:strokes_batch', { pageId: page.id, strokes: page.strokes }, { channelPriority: 'bulk' });
        }
        page.strokes.forEach((s) => {
          this.broadcastLocal('stroke', { stroke: s, pageId: page.id });
          this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: s, pageId: page.id });
        });
        this.notifyListeners();
      }
      return;
    }
    // Undo removes only YOUR most recent stroke, not simply the last stroke on the page.
    //
    // This used to be page.strokes.pop(), which takes whatever was drawn last by anyone —
    // so pressing Ctrl+Z while a friend was drawing deleted THEIR stroke, and the undo was
    // then broadcast so it vanished for them too. Undo is a per-author operation in every
    // collaborative editor, and strokes already carry peerId, so scope it properly.
    const myPeerId = this.identityService.getCachedIdentity()?.peerId;
    let removeIdx = -1;
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      // In personal mode there is only one author, so fall back to the last stroke.
      if (this.privacyMode === 'personal' || !myPeerId || page.strokes[i].peerId === myPeerId) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) return; // nothing of ours left to undo
    const removed = page.strokes.splice(removeIdx, 1)[0];
    if (removed) {
      page.redoStack.push(removed);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
        this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId: removed.id });
      }
      this.broadcastLocal('undo', { strokeId: removed.id, pageId: page.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_UNDO_LOCAL', strokeId: removed.id, pageId: page.id });
      this.notifyListeners();
    }
  }

  public redo(): void {
    const page = this.getActivePage();
    if (page.redoStack.length === 0) return;
    const restored = page.redoStack.pop();
    if (restored) {
      page.strokes.push(restored);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.saveCollabNotebook();
        this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke: restored });
      }
      this.broadcastLocal('stroke', { stroke: restored, pageId: page.id });
      this.broadcastRuntime({ type: 'WHITEBOARD_STROKE_LOCAL', stroke: restored, pageId: page.id });
      this.notifyListeners();
    }
  }

  public clearAll(): void {
    const page = this.getActivePage();
    if (page.strokes.length === 0) return;
    // Save cleared strokes to redoStack so Undo can restore them!
    page.redoStack = [...page.strokes];
    page.strokes = [];
    if (this.privacyMode === 'personal') {
      this.savePersonalNotebook();
    } else {
      this.saveCollabNotebook();
      this.network.broadcast('whiteboard:clear', { pageId: page.id, timestamp: Date.now() });
    }
    this.broadcastLocal('clear', { pageId: page.id });
    this.broadcastRuntime({ type: 'WHITEBOARD_CLEAR_LOCAL', pageId: page.id });
    this.notifyListeners();
  }

  public getStrokes(): WhiteboardStroke[] {
    return this.getActivePage().strokes;
  }

  public onStrokesChange(listener: (strokes: WhiteboardStroke[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStrokes());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onNotebookChange(listener: (notebook: WhiteboardNotebook) => void): () => void {
    this.notebookListeners.add(listener);
    listener(this.getActiveNotebook());
    return () => {
      this.notebookListeners.delete(listener);
    };
  }

  public onBackgroundChange(listener: (bg: WhiteboardBackgroundType) => void): () => void {
    this.backgroundListeners.add(listener);
    listener(this.getBackground());
    return () => {
      this.backgroundListeners.delete(listener);
    };
  }

  public onBgColorChange(listener: (color: string) => void): () => void {
    this.bgColorListeners.add(listener);
    listener(this.getBgColor());
    return () => {
      this.bgColorListeners.delete(listener);
    };
  }

  public onPrivacyModeChange(listener: (mode: WhiteboardPrivacyMode) => void): () => void {
    this.privacyListeners.add(listener);
    listener(this.privacyMode);
    return () => {
      this.privacyListeners.delete(listener);
    };
  }

  public onLaser(listener: (laser: LaserPointerPosition) => void): () => void {
    this.laserListeners.add(listener);
    return () => {
      this.laserListeners.delete(listener);
    };
  }

  public onTempStroke(listener: (stroke: WhiteboardStroke, durationMs: number) => void): () => void {
    this.tempStrokeListeners.add(listener);
    return () => {
      this.tempStrokeListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const list = this.getStrokes();
    this.listeners.forEach((fn) => fn(list));
  }

  private notifyNotebookListeners(): void {
    const nb = this.getActiveNotebook();
    this.notebookListeners.forEach((fn) => fn(nb));
  }
}
