// ─── Collaborative Whiteboard Service (P2P Real-Time Synchronization) ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { WhiteboardStroke, WhiteboardToolType, Point } from './whiteboard.types';
import { uuid } from '@/shared/utils';

export class WhiteboardService {
  private static instance: WhiteboardService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  private strokes: WhiteboardStroke[] = [];
  private redoStack: WhiteboardStroke[] = [];
  private listeners: Set<(strokes: WhiteboardStroke[]) => void> = new Set();

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
  }

  public addStroke(
    tool: WhiteboardToolType,
    color: string,
    width: number,
    points: Point[],
    geometry?: { x1: number; y1: number; x2: number; y2: number; label?: string }
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
      timestamp: Date.now(),
    };

    this.strokes.push(stroke);
    this.redoStack = []; // Reset redo on new action
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

  private notifyListeners(): void {
    const copy = [...this.strokes];
    this.listeners.forEach((fn) => fn(copy));
  }
}
