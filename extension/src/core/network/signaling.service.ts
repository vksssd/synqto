// ─── Signaling Service (WebSocket client to Go Server) ───

import { backoffDelay } from '@/shared/utils';

export interface RosterPeer {
  peerId: string;
  nickname: string;
  isLeader: boolean;
}

export interface RosterData {
  peers: RosterPeer[];
  leaders: string[];
  yourLeader: string;
}

export interface PromoteData {
  clusterPeers: string[];
  backboneLeaders: string[];
}

export interface DemoteData {
  newLeader: string;
}

export interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface ServerMessage {
  type: string;
  from: string;
  to?: string;
  roomId: string;
  payload?: any;
}

export type SignalingEventHandler = (event: string, data: any) => void;

export class SignalingService {
  private static instance: SignalingService | null = null;
  private ws: WebSocket | null = null;
  private serverUrl = 'ws://localhost:8080/ws';
  private currentRoomId = '';
  private peerId = '';
  private nickname = '';
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  private constructor() {
    // Load custom server URL from storage if configured
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['nerd_buddy_server_url'], (res) => {
        if (res.nerd_buddy_server_url) {
          this.serverUrl = res.nerd_buddy_server_url;
        }
      });
    }
  }

  public static getInstance(): SignalingService {
    if (!SignalingService.instance) {
      SignalingService.instance = new SignalingService();
    }
    return SignalingService.instance;
  }

  public setServerUrl(url: string) {
    this.serverUrl = url;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ nerd_buddy_server_url: url });
    }
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  public on(event: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private emit(event: string, data: any) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error(`[SignalingService] Error in handler for event '${event}':`, err);
        }
      });
    }
  }

  public connect(roomId: string, peerId: string, nickname: string) {
    if (
      this.ws &&
      this.currentRoomId === roomId &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.disconnect();

    this.currentRoomId = roomId;
    this.peerId = peerId;
    this.nickname = nickname;
    this.reconnectAttempts = 0;

    this.establishConnection();
  }

  private establishConnection() {
    if (!this.currentRoomId || !this.peerId) return;

    try {
      const url = `${this.serverUrl.replace(/\/$/, '')}/${encodeURIComponent(this.currentRoomId)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connection:change', { connected: true, roomId: this.currentRoomId });

        // First message MUST be room:join
        this.sendRaw({
          type: 'room:join',
          from: this.peerId,
          roomId: this.currentRoomId,
          payload: {
            peerId: this.peerId,
            nickname: this.nickname,
          },
        });

        // Start heartbeat ping
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const lines = event.data.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            const msg: ServerMessage = JSON.parse(line);
            this.handleIncomingMessage(msg);
          }
        } catch (err) {
          console.warn('[SignalingService] Failed to parse message:', err, event.data);
        }
      };

      this.ws.onclose = () => {
        this.cleanupState();
        this.emit('connection:change', { connected: false, roomId: this.currentRoomId });
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[SignalingService] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[SignalingService] Failed to open WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  private handleIncomingMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'room:roster':
        this.emit('roster', msg.payload as RosterData);
        break;
      case 'leader:promote':
        this.emit('promote', msg.payload as PromoteData);
        break;
      case 'leader:demote':
        this.emit('demote', msg.payload as DemoteData);
        break;
      case 'signal:offer':
        this.emit('signal:offer', { from: msg.from, sdp: msg.payload?.sdp });
        break;
      case 'signal:answer':
        this.emit('signal:answer', { from: msg.from, sdp: msg.payload?.sdp });
        break;
      case 'signal:ice':
        this.emit('signal:ice', { from: msg.from, candidate: msg.payload?.candidate });
        break;
      case 'pong':
        // Heartbeat acknowledged
        break;
      default:
        console.log('[SignalingService] Unhandled server message:', msg);
    }
  }

  public sendOffer(targetPeerId: string, sdp: RTCSessionDescriptionInit) {
    this.sendRaw({
      type: 'signal:offer',
      from: this.peerId,
      to: targetPeerId,
      roomId: this.currentRoomId,
      payload: { sdp },
    });
  }

  public sendAnswer(targetPeerId: string, sdp: RTCSessionDescriptionInit) {
    this.sendRaw({
      type: 'signal:answer',
      from: this.peerId,
      to: targetPeerId,
      roomId: this.currentRoomId,
      payload: { sdp },
    });
  }

  public sendIce(targetPeerId: string, candidate: RTCIceCandidateInit) {
    this.sendRaw({
      type: 'signal:ice',
      from: this.peerId,
      to: targetPeerId,
      roomId: this.currentRoomId,
      payload: { candidate },
    });
  }

  private sendRaw(msg: ServerMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      this.sendRaw({
        type: 'ping',
        from: this.peerId,
        roomId: this.currentRoomId,
      });
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (!this.currentRoomId) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const delay = backoffDelay(this.reconnectAttempts, 1000, 15000, 500);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.establishConnection();
    }, delay);
  }

  private cleanupState() {
    this.isConnected = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws = null;
    }
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && this.isConnected) {
      this.sendRaw({
        type: 'room:leave',
        from: this.peerId,
        roomId: this.currentRoomId,
      });
    }
    this.cleanupState();
    this.currentRoomId = '';
    this.emit('connection:change', { connected: false, roomId: '' });
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
