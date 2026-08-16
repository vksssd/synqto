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
  yourStandbyLeader?: string;
}

export interface PromoteData {
  clusterPeers: string[];
  backboneLeaders: string[];
  standbyPeers?: string[];
}

export interface DemoteData {
  newLeader: string;
  newStandbyLeader?: string;
}

export interface ServerMessage {
  type: string;
  from: string;
  to?: string;
  roomId: string;
  payload?: any;
}

export class SignalingService {
  private static instance: SignalingService | null = null;
  private ws: WebSocket | null = null;
  private serverUrl = 'wss://synqto-server.onrender.com/ws/';
  private currentRoomId = '';
  private peerId = '';
  private nickname = '';
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private pongTimeoutTimer: any = null;
  private messageQueue: string[] = [];
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  private constructor() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['nerd_buddy_server_url', 'synqto_server_url'], (res) => {
        const stored = res.synqto_server_url || res.nerd_buddy_server_url;
        if (stored && stored !== 'ws://localhost:8080/ws') {
          this.serverUrl = stored;
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
      chrome.storage.local.set({
        synqto_server_url: url,
        nerd_buddy_server_url: url,
      });
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
      this.peerId === peerId &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.disconnect();

    this.currentRoomId = roomId;
    this.peerId = peerId;
    this.nickname = nickname;
    this.reconnectAttempts = 0;

    // Fire non-blocking prewarm ping to wake up dormant Render services
    this.prewarmServer();

    this.establishConnection();
  }

  /**
   * Fast non-blocking HTTP ping to wake up dormant Render container before WebSocket connection
   */
  private prewarmServer() {
    try {
      const httpUrl = this.serverUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws\/?$/, '');
      fetch(`${httpUrl}/ping`, { method: 'GET', mode: 'cors' }).catch(() => {});
    } catch (e) {}
  }

  public reconnect() {
    this.reconnectAttempts = 0;
    this.disconnect();
    if (!this.currentRoomId) {
      this.currentRoomId = 'room:lobby';
    }
    if (!this.peerId) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        this.peerId = `peer-${crypto.randomUUID().slice(0, 8)}`;
      } else {
        this.peerId = `peer-${Math.random().toString(36).slice(2, 10)}`;
      }
    }
    if (!this.nickname) {
      this.nickname = 'Buddy';
    }
    this.prewarmServer();
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
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({
            synqto_server_connected: true,
            nerd_buddy_server_connected: true,
          });
        }
        this.emit('connection:change', { connected: true, roomId: this.currentRoomId, serverUrl: this.serverUrl });

        // Join room immediately
        this.sendRaw({
          type: 'room:join',
          from: this.peerId,
          roomId: this.currentRoomId,
          payload: {
            peerId: this.peerId,
            nickname: this.nickname,
          },
        });

        // Flush any queued signaling messages
        while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          const raw = this.messageQueue.shift();
          if (raw) this.ws.send(raw);
        }

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
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({
            synqto_server_connected: false,
            nerd_buddy_server_connected: false,
          });
        }
        this.emit('connection:change', { connected: false, roomId: this.currentRoomId, serverUrl: this.serverUrl });
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        if (this.reconnectAttempts === 0) {
          console.info(`[SignalingService] Signaling server not reachable at ${this.serverUrl}. Operating in offline/local peer mode.`);
        }
      };
    } catch (err) {
      console.info(`[SignalingService] WebSocket connection attempt failed for ${this.serverUrl}.`);
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
        if (this.pongTimeoutTimer) {
          clearTimeout(this.pongTimeoutTimer);
          this.pongTimeoutTimer = null;
        }
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
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      if (this.messageQueue.length < 100) {
        this.messageQueue.push(raw);
      }
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

      // 10s watchdog for dead socket detection
      this.pongTimeoutTimer = setTimeout(() => {
        console.warn('[SignalingService] Heartbeat pong timeout. Reconnecting...');
        if (this.ws) {
          try { this.ws.close(); } catch (e) {}
        }
      }, 10000);
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.currentRoomId) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // Full Jitter Exponential Backoff: spreads reconnection spikes during Render redeploys
    // to prevent thundering herd CPU saturation.
    const cappedAttempt = Math.min(this.reconnectAttempts, 6);
    const exponential = Math.min(10000, 500 * Math.pow(1.8, cappedAttempt));
    const jitter = Math.floor(Math.random() * 1500);
    const delay = Math.floor(exponential + jitter);

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.prewarmServer();
      this.establishConnection();
    }, delay);
  }

  private cleanupState() {
    this.isConnected = false;
    this.stopHeartbeat();
    this.messageQueue = [];
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (e) {}
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
