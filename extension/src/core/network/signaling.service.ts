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
  /** Signaling wire-protocol version. Present on join; echoed by the server on roster. */
  v?: number;
}

interface QueuedSignalingMessage {
  raw: string;
  timestamp: number;
}

/** Reconnect backoff bounds (true full jitter — see scheduleReconnect). */
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_MIN_DELAY_MS = 250;

/**
 * Signaling wire-protocol version advertised on join.
 *
 * The extension auto-updates independently of the server, so at any moment a deployed
 * server faces a spread of installed client versions. Without a version on the wire there
 * is no negotiation path and a payload-shape change silently breaks older clients.
 */
export const SIGNALING_PROTOCOL_VERSION = 1;

export class SignalingService {
  private static instance: SignalingService | null = null;
  private ws: WebSocket | null = null;
  private serverUrl = 'wss://synqto-server.onrender.com/ws/';
  private currentRoomId = '';
  private peerId = '';
  private nickname = '';
  private isConnected = false;
  private reconnectAttempts = 0;
  private connectionGeneration = 0;
  private activeAttemptId: string | null = null;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private pongTimeoutTimer: any = null;
  private messageQueue: QueuedSignalingMessage[] = [];
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

  public isServerConnected(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
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

  public reconnect(roomId?: string, peerId?: string, nickname?: string) {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupState(true);

    if (roomId) this.currentRoomId = roomId;
    if (peerId) this.peerId = peerId;
    if (nickname) this.nickname = nickname;

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

    const currentGen = ++this.connectionGeneration;
    const attemptId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.activeAttemptId = attemptId;

    try {
      const url = `${this.serverUrl.replace(/\/$/, '')}/${encodeURIComponent(this.currentRoomId)}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.connectionGeneration !== currentGen || this.activeAttemptId !== attemptId) {
          try { ws.close(); } catch (e) {}
          return;
        }

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
          v: SIGNALING_PROTOCOL_VERSION,
          payload: {
            peerId: this.peerId,
            nickname: this.nickname,
            protocolVersion: SIGNALING_PROTOCOL_VERSION,
          },
        });

        // Flush any valid queued signaling messages (drop stale items older than 30 seconds)
        const now = Date.now();
        while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
          const item = this.messageQueue.shift();
          if (item && now - item.timestamp < 30000) {
            this.ws.send(item.raw);
          }
        }

        this.startHeartbeat();
      };

      ws.onmessage = (event) => {
        if (this.connectionGeneration !== currentGen || this.activeAttemptId !== attemptId) {
          return;
        }

        // The server coalesces queued messages into one frame, newline-delimited.
        // Each line MUST be parsed and dispatched independently: a single try/catch
        // around the whole loop meant one malformed line aborted the rest of the
        // batch, silently discarding every message behind it — including rosters and
        // SDP. Isolating per line means one bad frame can never cascade.
        let lines: string[];
        try {
          lines = String(event.data).split('\n');
        } catch (err) {
          console.warn('[SignalingService] Unreadable frame:', err);
          return;
        }

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: ServerMessage;
          try {
            msg = JSON.parse(line);
          } catch (err) {
            console.warn('[SignalingService] Skipping unparseable line in batch:', err, line.slice(0, 200));
            continue;
          }
          try {
            this.handleIncomingMessage(msg);
          } catch (err) {
            // A throwing handler must not prevent delivery of later messages.
            console.error('[SignalingService] Handler error for', msg?.type, err);
          }
        }
      };

      ws.onclose = () => {
        if (this.connectionGeneration !== currentGen || this.activeAttemptId !== attemptId) {
          return;
        }

        this.cleanupState(true);
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({
            synqto_server_connected: false,
            nerd_buddy_server_connected: false,
          });
        }
        this.emit('connection:change', { connected: false, roomId: this.currentRoomId, serverUrl: this.serverUrl });
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        if (this.connectionGeneration !== currentGen || this.activeAttemptId !== attemptId) {
          return;
        }

        if (this.reconnectAttempts === 0) {
          console.info(`[SignalingService] Signaling server not reachable at ${this.serverUrl}. Operating in offline/local peer mode.`);
        }
      };
    } catch (err) {
      if (this.connectionGeneration === currentGen) {
        console.info(`[SignalingService] WebSocket connection attempt failed for ${this.serverUrl}.`);
        this.scheduleReconnect();
      }
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
      case 'relay:packet':
        if (msg.payload) {
          this.emit('relay:packet', msg.payload);
        }
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

  public sendRelayPacket(packet: any): boolean {
    return this.sendRaw({
      type: 'relay:packet',
      from: this.peerId,
      to: packet.to,
      roomId: this.currentRoomId,
      payload: packet,
    });
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

  private sendRaw(msg: ServerMessage): boolean {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
      return true;
    } else {
      if (this.messageQueue.length < 100) {
        this.messageQueue.push({ raw, timestamp: Date.now() });
      }
      return false;
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

    // TRUE full-jitter exponential backoff (AWS "Full Jitter"): sleep = random(0, window),
    // where window grows exponentially and is capped.
    //
    // The previous formula was `exponential + random(0..1500)`, which is NOT full jitter:
    // once the exponential term saturated at its 10s cap, every client reconnected inside
    // the same 1.5s window. That is precisely the thundering herd the comment claimed to
    // prevent, and it is at its worst exactly when it matters — a mass reconnect after a
    // redeploy, when every tab of every user has been retrying long enough to saturate.
    // Drawing uniformly across the whole window spreads the same load over 10s instead.
    const cappedAttempt = Math.min(this.reconnectAttempts, 6);
    const window = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * Math.pow(2, cappedAttempt));
    // Keep a small floor so the first retry is not effectively instantaneous.
    const delay = Math.floor(RECONNECT_MIN_DELAY_MS + Math.random() * Math.max(0, window - RECONNECT_MIN_DELAY_MS));

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.prewarmServer();
      this.establishConnection();
    }, delay);
  }

  private cleanupState(preserveRecentQueue = false) {
    this.isConnected = false;
    this.stopHeartbeat();
    if (!preserveRecentQueue) {
      this.messageQueue = [];
    } else {
      // Retain messages within 30-second window across brief reconnects
      const now = Date.now();
      this.messageQueue = this.messageQueue.filter((item) => now - item.timestamp < 30000);
    }
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
    this.cleanupState(false);
    this.currentRoomId = '';
    this.emit('connection:change', { connected: false, roomId: '' });
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }
}
