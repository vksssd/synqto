// ─── Collaborative & Personal Whiteboard Service (P2P Mesh + Local Private Scratchpad) ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import {
  WhiteboardStroke,
  WhiteboardToolType,
  WhiteboardBackgroundType,
  WhiteboardPrivacyMode,
  Point,
  LaserPointerPosition,
} from './whiteboard.types';
import { uuid } from '@/shared/utils';

export class WhiteboardService {
  private static instance: WhiteboardService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  private privacyMode: WhiteboardPrivacyMode = 'collaborative';
  private collaborativeStrokes: WhiteboardStroke[] = [];
  private collaborativeRedoStack: WhiteboardStroke[] = [];
  private personalStrokes: WhiteboardStroke[] = [];
  private personalRedoStack: WhiteboardStroke[] = [];
  private background: WhiteboardBackgroundType = 'grid';

  private listeners: Set<(strokes: WhiteboardStroke[]) => void> = new Set();
  private backgroundListeners: Set<(bg: WhiteboardBackgroundType) => void> = new Set();
  private privacyListeners: Set<(mode: WhiteboardPrivacyMode) => void> = new Set();
  private laserListeners: Set<(laser: LaserPointerPosition) => void> = new Set();

  private lastLaserTime = 0;

  private constructor() {
    this.network = NetworkService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.setupNetworkListeners();
    this.loadPersonalStrokes();
  }

  public static getInstance(): WhiteboardService {
    if (!WhiteboardService.instance) {
      WhiteboardService.instance = new WhiteboardService();
    }
    return WhiteboardService.instance;
  }

  private async loadPersonalStrokes() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get(['synqto_personal_whiteboard']);
        if (Array.isArray(res.synqto_personal_whiteboard)) {
          this.personalStrokes = res.synqto_personal_whiteboard;
        }
      } catch (e) {}
    }
  }

  private savePersonalStrokes() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.set({
          synqto_personal_whiteboard: this.personalStrokes.slice(-200),
        });
      } catch (e) {}
    }
  }

  private setupNetworkListeners(): void {
    // 1. Receive incoming remote stroke (only applies to Collaborative mode)
    this.network.on<WhiteboardStroke>('whiteboard:stroke', (stroke) => {
      if (!stroke || !stroke.id) return;
      if (!this.collaborativeStrokes.some((s) => s.id === stroke.id)) {
        this.collaborativeStrokes.push(stroke);
        if (this.privacyMode === 'collaborative') {
          this.notifyListeners();
        }
      }
    });

    // 2. Receive remote canvas clear
    this.network.on<{ timestamp: number }>('whiteboard:clear', () => {
      this.collaborativeStrokes = [];
      this.collaborativeRedoStack = [];
      if (this.privacyMode === 'collaborative') {
        this.notifyListeners();
      }
    });

    // 3. Receive remote undo
    this.network.on<{ strokeId: string }>('whiteboard:undo', (payload) => {
      if (payload?.strokeId) {
        this.collaborativeStrokes = this.collaborativeStrokes.filter((s) => s.id !== payload.strokeId);
        if (this.privacyMode === 'collaborative') {
          this.notifyListeners();
        }
      }
    });

    // 4. Receive remote background change
    this.network.on<{ background: WhiteboardBackgroundType }>('whiteboard:background', (payload) => {
      if (payload?.background) {
        this.background = payload.background;
        this.backgroundListeners.forEach((fn) => fn(this.background));
      }
    });

    // 5. Receive remote laser pointer
    this.network.on<LaserPointerPosition>('whiteboard:laser', (laser) => {
      if (laser && laser.peerId && this.privacyMode === 'collaborative') {
        this.laserListeners.forEach((fn) => fn(laser));
      }
    });
  }

  public setPrivacyMode(mode: WhiteboardPrivacyMode): void {
    this.privacyMode = mode;
    this.privacyListeners.forEach((fn) => fn(mode));
    this.notifyListeners();
  }

  public getPrivacyMode(): WhiteboardPrivacyMode {
    return this.privacyMode;
  }

  public setBackground(bg: WhiteboardBackgroundType): void {
    this.background = bg;
    this.backgroundListeners.forEach((fn) => fn(bg));
    if (this.privacyMode === 'collaborative') {
      this.network.broadcast('whiteboard:background', { background: bg });
    }
  }

  public getBackground(): WhiteboardBackgroundType {
    return this.background;
  }

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

  public addStroke(
    tool: WhiteboardToolType,
    color: string,
    width: number,
    points: Point[],
    geometry?: { x1: number; y1: number; x2: number; y2: number; label?: string },
    text?: string
  ): WhiteboardStroke {
    const identity = this.identityService.getCachedIdentity();
    const opacity = tool === 'highlighter' ? 0.35 : 1.0;

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

    if (this.privacyMode === 'personal') {
      this.personalStrokes.push(stroke);
      this.personalRedoStack = [];
      this.savePersonalStrokes();
    } else {
      this.collaborativeStrokes.push(stroke);
      this.collaborativeRedoStack = [];
      // Broadcast over WebRTC DataChannel to room peers
      this.network.broadcast('whiteboard:stroke', stroke);
    }

    this.notifyListeners();
    return stroke;
  }

  public undo(): void {
    if (this.privacyMode === 'personal') {
      if (this.personalStrokes.length === 0) return;
      const removed = this.personalStrokes.pop();
      if (removed) {
        this.personalRedoStack.push(removed);
        this.savePersonalStrokes();
        this.notifyListeners();
      }
    } else {
      if (this.collaborativeStrokes.length === 0) return;
      const removed = this.collaborativeStrokes.pop();
      if (removed) {
        this.collaborativeRedoStack.push(removed);
        this.notifyListeners();
        this.network.broadcast('whiteboard:undo', { strokeId: removed.id });
      }
    }
  }

  public redo(): void {
    if (this.privacyMode === 'personal') {
      if (this.personalRedoStack.length === 0) return;
      const restored = this.personalRedoStack.pop();
      if (restored) {
        this.personalStrokes.push(restored);
        this.savePersonalStrokes();
        this.notifyListeners();
      }
    } else {
      if (this.collaborativeRedoStack.length === 0) return;
      const restored = this.collaborativeRedoStack.pop();
      if (restored) {
        this.collaborativeStrokes.push(restored);
        this.notifyListeners();
        this.network.broadcast('whiteboard:stroke', restored);
      }
    }
  }

  public clearAll(): void {
    if (this.privacyMode === 'personal') {
      this.personalStrokes = [];
      this.personalRedoStack = [];
      this.savePersonalStrokes();
      this.notifyListeners();
    } else {
      this.collaborativeStrokes = [];
      this.collaborativeRedoStack = [];
      this.notifyListeners();
      this.network.broadcast('whiteboard:clear', { timestamp: Date.now() });
    }
  }

  public getStrokes(): WhiteboardStroke[] {
    return this.privacyMode === 'personal' ? [...this.personalStrokes] : [...this.collaborativeStrokes];
  }

  public onStrokesChange(listener: (strokes: WhiteboardStroke[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStrokes());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onBackgroundChange(listener: (bg: WhiteboardBackgroundType) => void): () => void {
    this.backgroundListeners.add(listener);
    listener(this.background);
    return () => {
      this.backgroundListeners.delete(listener);
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

  private notifyListeners(): void {
    const list = this.getStrokes();
    this.listeners.forEach((fn) => fn(list));
  }
}
