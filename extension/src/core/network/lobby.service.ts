// ─── CoFocus Lobby Service (WebSocket client for matchmaking) ───
//
// Talks to the server's /ws/lobby endpoint, which is deliberately separate from the per-room
// /ws/{roomId} endpoint SignalingService uses. The lobby connection is short-lived: it exists
// only between "find me a partner" and "here is your room", then closes. The room that results
// is joined through the ordinary signaling path, so this service is never involved in an
// established session.
//
// It intentionally does NOT reconnect on drop. A dropped lobby socket means the queue entry is
// already gone server-side (the server dequeues on disconnect), so silently reconnecting would
// re-queue a user who may have navigated away. Drops surface as an error and the user decides.

import { SignalingService, SIGNALING_PROTOCOL_VERSION } from './signaling.service';

/** Domain-level mode. Uppercase by convention; the wire form is lowercase. */
export type CoFocusMode = 'WATCHER' | 'TOGETHER';

/** Converts a domain mode to its lowercase wire representation. */
export function toWireMode(mode: CoFocusMode): string {
  return mode === 'WATCHER' ? 'watcher' : 'together';
}

/** Converts a lowercase wire mode to the domain type. Returns null if unrecognised. */
export function fromWireMode(raw: string | undefined): CoFocusMode | null {
  if (typeof raw !== 'string') return null;
  switch (raw.toLowerCase()) {
    case 'watcher':
      return 'WATCHER';
    case 'together':
      return 'TOGETHER';
    default:
      return null;
  }
}

const COFOCUS_ROOM_ID_RE = /^cofocus:[A-Za-z0-9._:-]{8,128}$/;

function isBoundedLobbyToken(value: unknown, max = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export interface LobbyMatchedData {
  roomId: string;
  partnerPeerId: string;
  partnerNickname?: string;
  mode: CoFocusMode;
  subjectTag?: string;
  /** This peer's OWN preferred duration, echoed back. Not a matching constraint. */
  sessionLengthSec?: number;
}

export interface LobbyWaitingData {
  mode: CoFocusMode | null;
  subjectTag?: string;
  queuePosition?: number;
  /** Seconds the server will hold the queue slot before giving up. */
  timeoutSec?: number;
}

export interface LobbyErrorData {
  reason: string;
  message?: string;
}

export interface LobbyJoinRequest {
  peerId: string;
  nickname: string;
  mode: CoFocusMode;
  subjectTag?: string;
  /** Preferred duration in seconds. Metadata only — the server does not match on it. */
  sessionLengthSec?: number;
}

type LobbyEvent = 'matched' | 'waiting' | 'error' | 'timeout' | 'closed';

export class LobbyService {
  private static instance: LobbyService | null = null;

  private ws: WebSocket | null = null;
  private listeners: Map<LobbyEvent, Set<(data: any) => void>> = new Map();
  private currentRequest: LobbyJoinRequest | null = null;
  /** Set once a match arrives, so the close handler knows the socket closed for a good reason. */
  private matched = false;

  private constructor() {}

  public static getInstance(): LobbyService {
    if (!LobbyService.instance) {
      LobbyService.instance = new LobbyService();
    }
    return LobbyService.instance;
  }

  /**
   * Derives the lobby endpoint from whatever server SignalingService is configured against, so
   * switching between localhost and production in settings moves both endpoints together.
   * Re-deriving it independently here would let the two drift apart.
   */
  private getLobbyUrl(): string {
    const base = SignalingService.getInstance().getServerUrl();
    return base.replace(/\/ws\/?$/, '') + '/ws/lobby';
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public on(event: LobbyEvent, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  private emit(event: LobbyEvent, data?: any) {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[LobbyService] listener error for '${event}':`, err);
      }
    });
  }

  /**
   * Opens the lobby connection and enqueues for matchmaking.
   * Any previous lobby connection is closed first — a client is only ever in one queue.
   */
  public joinQueue(req: LobbyJoinRequest) {
    this.leaveQueue();

    this.currentRequest = req;
    this.matched = false;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.getLobbyUrl());
    } catch (err) {
      console.error('[LobbyService] failed to open lobby socket:', err);
      this.emit('error', { reason: 'connect_failed', message: 'Could not reach the matchmaking server.' });
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      socket.send(
        JSON.stringify({
          type: 'lobby:join',
          from: req.peerId,
          roomId: 'lobby',
          v: SIGNALING_PROTOCOL_VERSION,
          payload: {
            peerId: req.peerId,
            nickname: req.nickname,
            mode: toWireMode(req.mode),
            subjectTag: req.subjectTag || '',
            sessionLengthSec: req.sessionLengthSec || 0,
            protocolVersion: SIGNALING_PROTOCOL_VERSION,
          },
        })
      );
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.emit('error', { reason: 'socket_error', message: 'Lost connection to the matchmaking server.' });
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      // A close AFTER a match is the normal, expected end of a lobby connection — the server
      // closes it once both peers have their room ID. Only an unexpected close is an error.
      if (!this.matched) {
        this.emit('closed', { wasMatched: false });
      }
      this.ws = null;
    };
  }

  private handleMessage(msg: any) {
    // Matchmaking frames are untrusted protocol input. Fail closed before a malformed match
    // can navigate this client into an empty/attacker-chosen room or silently change modes.
    if (
      !msg ||
      msg.from !== 'server' ||
      msg.roomId !== 'lobby' ||
      typeof msg.payload !== 'object' ||
      msg.payload === null ||
      Array.isArray(msg.payload)
    ) return;

    const payload = msg.payload;

    switch (msg?.type) {
      case 'lobby:matched': {
        const mode = fromWireMode(payload.mode);
        const request = this.currentRequest;
        if (
          !request ||
          !mode ||
          mode !== request.mode ||
          !isBoundedLobbyToken(payload.roomId) ||
          !COFOCUS_ROOM_ID_RE.test(payload.roomId) ||
          !isBoundedLobbyToken(payload.partnerPeerId) ||
          payload.partnerPeerId === request.peerId ||
          (payload.partnerNickname !== undefined &&
            (typeof payload.partnerNickname !== 'string' || payload.partnerNickname.length > 120)) ||
          (payload.subjectTag !== undefined &&
            (typeof payload.subjectTag !== 'string' || payload.subjectTag.length > 120)) ||
          (payload.sessionLengthSec !== undefined &&
            (!Number.isInteger(payload.sessionLengthSec) ||
              payload.sessionLengthSec < 0 ||
              payload.sessionLengthSec > 86_400))
        ) {
          this.emit('error', {
            reason: 'invalid_match',
            message: 'The matchmaking server returned an invalid match.',
          } as LobbyErrorData);
          this.close();
          break;
        }
        this.matched = true;
        this.emit('matched', {
          roomId: payload.roomId,
          partnerPeerId: payload.partnerPeerId,
          partnerNickname: payload.partnerNickname,
          mode,
          subjectTag: payload.subjectTag,
          sessionLengthSec: payload.sessionLengthSec,
        } as LobbyMatchedData);
        // The server closes its side after matching; close ours so no half-open socket lingers.
        this.close();
        break;
      }

      case 'lobby:waiting': {
        const mode = fromWireMode(payload.mode);
        if (
          !mode ||
          mode !== this.currentRequest?.mode ||
          (payload.subjectTag !== undefined &&
            (typeof payload.subjectTag !== 'string' || payload.subjectTag.length > 120)) ||
          (payload.queuePosition !== undefined &&
            (!Number.isInteger(payload.queuePosition) || payload.queuePosition < 1 || payload.queuePosition > 100_000)) ||
          (payload.timeoutSec !== undefined &&
            (!Number.isInteger(payload.timeoutSec) || payload.timeoutSec < 1 || payload.timeoutSec > 86_400))
        ) return;
        this.emit('waiting', {
          mode,
          subjectTag: payload.subjectTag,
          queuePosition: payload.queuePosition,
          timeoutSec: payload.timeoutSec,
        } as LobbyWaitingData);
        break;
      }

      case 'lobby:timeout':
        this.emit('timeout', {});
        this.close();
        break;

      case 'lobby:error':
        if (
          !isBoundedLobbyToken(payload.reason, 80) ||
          (payload.message !== undefined &&
            (typeof payload.message !== 'string' || payload.message.length > 300))
        ) return;
        this.emit('error', {
          reason: payload.reason,
          message: payload.message,
        } as LobbyErrorData);
        this.close();
        break;

      default:
        // Unknown lobby message types are ignored rather than treated as errors, so the server
        // can add advisory messages without breaking older extension builds.
        break;
    }
  }

  /** Cancels matchmaking, telling the server so the queue slot is freed immediately. */
  public leaveQueue() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'lobby:leave',
            from: this.currentRequest?.peerId || '',
            roomId: 'lobby',
            v: SIGNALING_PROTOCOL_VERSION,
          })
        );
      } catch {
        // Socket already dying; the server dequeues on close regardless.
      }
    }
    this.close();
    this.currentRequest = null;
  }

  private close() {
    if (!this.ws) return;
    const socket = this.ws;
    this.ws = null;
    // Detach handlers before closing so our own close() does not re-emit 'closed'.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }
}
