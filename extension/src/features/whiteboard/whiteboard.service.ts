// ─── Collaborative & Personal Whiteboard Service (Multi-Page Notebook, Custom BG Colors & Temp Ink) ───

import { NetworkService } from '@/core/network/network.service';
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

export class WhiteboardService {
  private static instance: WhiteboardService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  private privacyMode: WhiteboardPrivacyMode = 'collaborative';

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
    this.setupNetworkListeners();
    this.loadPersonalNotebook();
  }

  public static getInstance(): WhiteboardService {
    if (!WhiteboardService.instance) {
      WhiteboardService.instance = new WhiteboardService();
    }
    return WhiteboardService.instance;
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

  private setupNetworkListeners(): void {
    // 1. Receive incoming remote stroke
    this.network.on<{ pageId?: string; stroke: WhiteboardStroke }>('whiteboard:stroke', (payload) => {
      const stroke = payload?.stroke || (payload as any);
      if (!stroke || !stroke.id) return;

      const pageId = payload?.pageId || this.collabNotebook.activePageId;
      const targetPage = this.collabNotebook.pages.find((p) => p.id === pageId) || this.getActivePage();

      if (!targetPage.strokes.some((s) => s.id === stroke.id)) {
        targetPage.strokes.push(stroke);
        if (this.privacyMode === 'collaborative' && this.collabNotebook.activePageId === targetPage.id) {
          this.notifyListeners();
        }
      }
    });

    // 2. Receive temporary disappearing stroke
    this.network.on<{ stroke: WhiteboardStroke; durationMs: number }>('whiteboard:temp_stroke', (payload) => {
      if (payload?.stroke && this.privacyMode === 'collaborative') {
        this.tempStrokeListeners.forEach((fn) => fn(payload.stroke, payload.durationMs || 3000));
      }
    });

    // 3. Receive remote canvas clear
    this.network.on<{ pageId?: string; timestamp: number }>('whiteboard:clear', (payload) => {
      const pageId = payload?.pageId || this.collabNotebook.activePageId;
      const page = this.collabNotebook.pages.find((p) => p.id === pageId);
      if (page) {
        page.strokes = [];
        page.redoStack = [];
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
        this.backgroundListeners.forEach((fn) => fn(page.background));
        if (payload.bgColor) this.bgColorListeners.forEach((fn) => fn(payload.bgColor!));
      }
    });

    // 6. Receive remote laser pointer
    this.network.on<LaserPointerPosition>('whiteboard:laser', (laser) => {
      if (laser && laser.peerId && this.privacyMode === 'collaborative') {
        this.laserListeners.forEach((fn) => fn(laser));
      }
    });

    // 7. Receive remote page creation / page switch in collaborative mode
    this.network.on<{ action: 'add' | 'switch'; page?: WhiteboardPage; pageId?: string }>('whiteboard:page_sync', (payload) => {
      if (this.privacyMode !== 'collaborative') return;

      if (payload.action === 'add' && payload.page) {
        if (!this.collabNotebook.pages.some((p) => p.id === payload.page!.id)) {
          this.collabNotebook.pages.push(payload.page);
          this.notifyNotebookListeners();
        }
      } else if (payload.action === 'switch' && payload.pageId) {
        if (this.collabNotebook.pages.some((p) => p.id === payload.pageId)) {
          this.collabNotebook.activePageId = payload.pageId;
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
      this.network.broadcast('whiteboard:page_sync', { action: 'add', page: newPage });
    }

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
        this.network.broadcast('whiteboard:page_sync', { action: 'switch', pageId });
      }
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
      }
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
    }
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
      this.network.broadcast('whiteboard:page_sync', { action: 'add', page: newPage });
    }

    this.notifyNotebookListeners();
    this.notifyListeners();
    return newPage;
  }

  // ─── Privacy Mode API ───

  public setPrivacyMode(mode: WhiteboardPrivacyMode): void {
    this.privacyMode = mode;
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
      this.network.broadcast('whiteboard:background', { background: bg, bgColor: page.bgColor });
    } else {
      this.savePersonalNotebook();
    }
  }

  public getBackground(): WhiteboardBackgroundType {
    return this.getActivePage().background;
  }

  public setBgColor(color: string): void {
    const page = this.getActivePage();
    page.bgColor = color;
    this.bgColorListeners.forEach((fn) => fn(color));
    if (this.privacyMode === 'collaborative') {
      this.network.broadcast('whiteboard:background', { background: page.background, bgColor: color });
    } else {
      this.savePersonalNotebook();
    }
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
    if (this.privacyMode === 'collaborative') {
      this.network.broadcast('whiteboard:laser', payload);
    }
  }

  public broadcastTempStroke(stroke: WhiteboardStroke, durationMs = 3000): void {
    this.tempStrokeListeners.forEach((fn) => fn(stroke, durationMs));
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

    const stroke: WhiteboardStroke = {
      id: `stroke-${uuid()}`,
      peerId: identity?.peerId || 'local',
      nickname: identity?.nickname || 'Anonymous',
      tool,
      color,
      width,
      opacity,
      points,
      geometry,
      text,
      timestamp: Date.now(),
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
      this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke });
    }

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
        this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId });
      }
      this.notifyListeners();
    }
  }

  public deleteStrokes(strokeIds: string[]): void {
    if (strokeIds.length === 0) return;
    const page = this.getActivePage();
    const idSet = new Set(strokeIds);
    const removed: WhiteboardStroke[] = [];
    page.strokes = page.strokes.filter((s) => {
      if (idSet.has(s.id)) {
        removed.push(s);
        return false;
      }
      return true;
    });

    if (removed.length > 0) {
      page.redoStack.push(...removed);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        removed.forEach((s) => {
          this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId: s.id });
        });
      }
      this.notifyListeners();
    }
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
          page.strokes.forEach((s) => {
            this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke: s });
          });
        }
        this.notifyListeners();
      }
      return;
    }
    const removed = page.strokes.pop();
    if (removed) {
      page.redoStack.push(removed);
      if (this.privacyMode === 'personal') {
        this.savePersonalNotebook();
      } else {
        this.network.broadcast('whiteboard:undo', { pageId: page.id, strokeId: removed.id });
      }
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
        this.network.broadcast('whiteboard:stroke', { pageId: page.id, stroke: restored });
      }
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
      this.network.broadcast('whiteboard:clear', { pageId: page.id, timestamp: Date.now() });
    }
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
