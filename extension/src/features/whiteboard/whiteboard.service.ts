// ─── Collaborative Whiteboard Service (P2P Real-Time Synchronization & Laser Sync) ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import {
  WhiteboardStroke,
  WhiteboardToolType,
  WhiteboardBackgroundType,
  Point,
  LaserPointerPosition,
} from './whiteboard.types';
import { uuid } from '@/shared/utils';

export class WhiteboardService {
  private static instance: WhiteboardService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  private strokes: WhiteboardStroke[] = [];
  private redoStack: WhiteboardStroke[] = [];
  private background: WhiteboardBackgroundType = 'grid';

  private listeners: Set<(strokes: WhiteboardStroke[]) => void> = new Set();
  private backgroundListeners: Set<(bg: WhiteboardBackgroundType) => void> = new Set();
  private laserListeners: Set<(laser: LaserPointerPosition) => void> = new Set();

  private lastLaserTime = 0;

  private constructor() {
    this.network = NetworkService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.setupNetworkListeners();
  }

  public static getInstance(): WhiteboardService {
    if (!WhiteboardService.instance) {
      WhiteboardService.instance = new WhiteboardService();
    }
    return WhiteboardService.instance;
  }

  private setupNetworkListeners(): void {
    // 1. Receive incoming remote stroke
    this.network.on<WhiteboardStroke>('whiteboard:stroke', (stroke) => {
      if (!stroke || !stroke.id) return;
      if (!this.strokes.some((s) => s.id === stroke.id)) {
        this.strokes.push(stroke);
        this.notifyListeners();
      }
    });

    // 2. Receive remote canvas clear
    this.network.on<{ timestamp: number }>('whiteboard:clear', () => {
      this.strokes = [];
      this.redoStack = [];
      this.notifyListeners();
    });

    // 3. Receive remote undo
    this.network.on<{ strokeId: string }>('whiteboard:undo', (payload) => {
      if (payload?.strokeId) {
        this.strokes = this.strokes.filter((s) => s.id !== payload.strokeId);
        this.notifyListeners();
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
      if (laser && laser.peerId) {
        this.laserListeners.forEach((fn) => fn(laser));
      }
    });
  }

  public setBackground(bg: WhiteboardBackgroundType): void {
    this.background = bg;
    this.backgroundListeners.forEach((fn) => fn(bg));
    this.network.broadcast('whiteboard:background', { background: bg });
  }

  public getBackground(): WhiteboardBackgroundType {
    return this.background;
  }

  public broadcastLaser(x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastLaserTime < 30) return; // 33fps throttle
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
    this.network.broadcast('whiteboard:laser', payload);
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

    this.strokes.push(stroke);
    this.redoStack = [];
    this.notifyListeners();

    // Broadcast over WebRTC DataChannel to room peers
    this.network.broadcast('whiteboard:stroke', stroke);

    return stroke;
  }

  public undo(): void {
    if (this.strokes.length === 0) return;
    const removed = this.strokes.pop();
    if (removed) {
      this.redoStack.push(removed);
      this.notifyListeners();
      this.network.broadcast('whiteboard:undo', { strokeId: removed.id });
    }
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    const restored = this.redoStack.pop();
    if (restored) {
      this.strokes.push(restored);
      this.notifyListeners();
      this.network.broadcast('whiteboard:stroke', restored);
    }
  }

  public clearAll(): void {
    this.strokes = [];
    this.redoStack = [];
    this.notifyListeners();
    this.network.broadcast('whiteboard:clear', { timestamp: Date.now() });
  }

  public getStrokes(): WhiteboardStroke[] {
    return [...this.strokes];
  }

  public onStrokesChange(listener: (strokes: WhiteboardStroke[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.strokes]);
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

  public onLaser(listener: (laser: LaserPointerPosition) => void): () => void {
    this.laserListeners.add(listener);
    return () => {
      this.laserListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const list = [...this.strokes];
    this.listeners.forEach((fn) => fn(list));
  }
}
