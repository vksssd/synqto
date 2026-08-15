// ─── Real-time Chat Service (3-Level ACKs + History Sync + Local Persistence) ───

import { NetworkService } from '@/core/network/network.service';
import {
  ChatMessagePayload,
  ChatAckPayload,
  ChatHistoryPayload,
  ChatHistoryResponsePayload,
  PeerIdentity,
  StoredChatMessage,
} from '@/core/network/packet';
import { uuid, debounce } from '@/shared/utils';

export type MessageAckStatus = 'pending' | 'sent' | 'delivered' | 'read';

export interface ChatMessageItem extends StoredChatMessage {
  status: MessageAckStatus;
  isSelf: boolean;
  expectedAcks?: number;
  receivedAcks?: Set<string>;
}

const STORAGE_PREFIX = 'nerd_buddy_chat_';
const MAX_STORED_MESSAGES = 200;
const HISTORY_SYNC_LIMIT = 50;

export class ChatService {
  private static instance: ChatService | null = null;
  private network: NetworkService;

  private currentRoomId = '';
  private myPeerId = '';
  private messages: ChatMessageItem[] = [];
  private unackedQueue: Map<string, { message: ChatMessageItem; attempts: number; timer: any }> = new Map();

  private listeners: Set<(messages: ChatMessageItem[]) => void> = new Set();
  private unreadCount = 0;
  private unreadListeners: Set<(count: number) => void> = new Set();

  private constructor() {
    this.network = NetworkService.getInstance();
    this.setupListeners();
  }

  public static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService();
    }
    return ChatService.instance;
  }

  public init(roomId: string, myPeerId: string) {
    if (this.currentRoomId === roomId && this.myPeerId === myPeerId) {
      return;
    }

    this.currentRoomId = roomId;
    this.myPeerId = myPeerId;
    this.messages = [];
    this.unreadCount = 0;
    this.clearUnackedQueue();

    // 1. Load local cached messages
    this.loadCachedMessages();

    // 2. Request history catch-up from live peers
    this.requestHistorySync();
  }

  private setupListeners() {
    // 1. Inbound chat message
    this.network.on<ChatMessagePayload>('chat:message', (payload, packet) => {
      if (packet.roomId !== this.currentRoomId) return;

      const incomingId = payload.messageId || packet.id;
      // Deduplicate
      if (this.messages.some((m) => m.id === incomingId)) {
        return;
      }

      const msg: ChatMessageItem = {
        id: incomingId,
        from: packet.from,
        text: payload.text,
        timestamp: packet.timestamp,
        replyTo: payload.replyTo,
        replyPreview: payload.replyPreview,
        status: 'delivered',
        isSelf: packet.from.peerId === this.myPeerId,
      };

      this.messages.push(msg);
      this.messages.sort((a, b) => a.timestamp - b.timestamp);
      this.saveMessagesDebounced();
      this.emitMessages();

      if (!msg.isSelf) {
        this.unreadCount++;
        this.emitUnread();

        // Send ACK back to sender
        this.network.send(packet.from.peerId, 'chat:ack', { messageId: incomingId });
      }
    });

    // 2. Inbound chat ACK (Delivery receipt)
    this.network.on<ChatAckPayload>('chat:ack', (payload, packet) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (msg && msg.isSelf) {
        msg.status = 'delivered';
        if (!msg.receivedAcks) msg.receivedAcks = new Set();
        msg.receivedAcks.add(packet.from.peerId);

        // Remove from unacked retry queue
        this.removeUnacked(payload.messageId);
        this.emitMessages();
      }
    });

    // 3. Inbound chat read receipt
    this.network.on<ChatAckPayload>('chat:read', (payload) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (msg && msg.isSelf) {
        msg.status = 'read';
        this.emitMessages();
      }
    });

    // 4. Inbound history request
    this.network.on<ChatHistoryPayload>('chat:history:request', (payload, packet) => {
      if (this.messages.length === 0) return;

      const since = payload?.sinceTimestamp || 0;
      const recent = this.messages
        .filter((m) => m.timestamp > since)
        .slice(-HISTORY_SYNC_LIMIT)
        .map((m) => ({
          id: m.id,
          from: m.from,
          text: m.text,
          timestamp: m.timestamp,
          replyTo: m.replyTo,
          replyPreview: m.replyPreview,
        }));

      if (recent.length > 0) {
        this.network.send(packet.from.peerId, 'chat:history:response', {
          messages: recent,
        });
      }
    });

    // 5. Inbound history response
    this.network.on<ChatHistoryResponsePayload>('chat:history:response', (payload) => {
      if (!payload?.messages || payload.messages.length === 0) return;

      let added = false;
      payload.messages.forEach((remoteMsg) => {
        if (!this.messages.some((m) => m.id === remoteMsg.id)) {
          this.messages.push({
            ...remoteMsg,
            status: 'delivered',
            isSelf: remoteMsg.from.peerId === this.myPeerId,
          });
          added = true;
        }
      });

      if (added) {
        this.messages.sort((a, b) => a.timestamp - b.timestamp);
        this.saveMessagesDebounced();
        this.emitMessages();
      }
    });
  }

  public sendMessage(
    text: string,
    fromIdentity: PeerIdentity,
    replyTo?: { id: string; preview: string },
    existingMessageId?: string
  ): ChatMessageItem {
    const messageId = existingMessageId || uuid();

    const existing = this.messages.find((m) => m.id === messageId);
    if (existing) {
      return existing;
    }

    const msg: ChatMessageItem = {
      id: messageId,
      from: fromIdentity,
      text: text.trim(),
      timestamp: Date.now(),
      replyTo: replyTo?.id,
      replyPreview: replyTo?.preview,
      status: 'sent',
      isSelf: true,
      receivedAcks: new Set(),
    };

    this.messages.push(msg);
    this.saveMessagesDebounced();
    this.emitMessages();

    // Broadcast to room
    const payload: ChatMessagePayload = {
      messageId,
      text: msg.text,
      replyTo: msg.replyTo,
      replyPreview: msg.replyPreview,
    };
    this.network.broadcast('chat:message', payload);

    // Queue for ACK retry
    this.queueUnacked(msg, payload);

    return msg;
  }

  private queueUnacked(msg: ChatMessageItem, payload: ChatMessagePayload) {
    const entry = {
      message: msg,
      attempts: 0,
      timer: null as any,
    };

    const retry = () => {
      if (entry.attempts >= 8) {
        this.removeUnacked(msg.id);
        return;
      }
      entry.attempts++;
      const delay = Math.min(1000 * Math.pow(2, entry.attempts), 15000);

      entry.timer = setTimeout(() => {
        if (msg.status === 'sent') {
          this.network.broadcast('chat:message', payload);
          retry();
        }
      }, delay);
    };

    retry();
    this.unackedQueue.set(msg.id, entry);
  }

  private removeUnacked(messageId: string) {
    const entry = this.unackedQueue.get(messageId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.unackedQueue.delete(messageId);
    }
  }

  private clearUnackedQueue() {
    this.unackedQueue.forEach((entry) => {
      if (entry.timer) clearTimeout(entry.timer);
    });
    this.unackedQueue.clear();
  }

  public markAsRead() {
    this.unreadCount = 0;
    this.emitUnread();

    // Send read receipts to other peers for their recent messages
    const recentOthers = this.messages.filter((m) => !m.isSelf).slice(-10);
    recentOthers.forEach((m) => {
      this.network.send(m.from.peerId, 'chat:read', { messageId: m.id });
    });
  }

  private requestHistorySync() {
    const latestTimestamp =
      this.messages.length > 0 ? this.messages[this.messages.length - 1].timestamp : 0;
    this.network.broadcast('chat:history:request', {
      sinceTimestamp: latestTimestamp,
    });
  }

  private saveMessagesDebounced = debounce(() => {
    if (!this.currentRoomId) return;

    const trimmed = this.messages.slice(-MAX_STORED_MESSAGES).map((m) => ({
      id: m.id,
      from: m.from,
      text: m.text,
      timestamp: m.timestamp,
      replyTo: m.replyTo,
      replyPreview: m.replyPreview,
    }));

    const key = `${STORAGE_PREFIX}${this.currentRoomId}`;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: trimmed });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(trimmed));
    }
  }, 150);

  private async loadCachedMessages() {
    if (!this.currentRoomId) return;
    const key = `${STORAGE_PREFIX}${this.currentRoomId}`;

    try {
      let stored: StoredChatMessage[] = [];
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get([key]);
        if (res[key]) stored = res[key];
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(key);
        if (raw) stored = JSON.parse(raw);
      }

      if (stored && stored.length > 0) {
        this.messages = stored.map((s) => ({
          ...s,
          status: 'delivered',
          isSelf: s.from.peerId === this.myPeerId,
        }));
        this.emitMessages();
      }
    } catch (e) {
      console.warn('[ChatService] Failed to load cached chat messages:', e);
    }
  }

  public getMessages(): ChatMessageItem[] {
    return this.messages;
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  public onChange(listener: (messages: ChatMessageItem[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.messages);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onUnreadChange(listener: (count: number) => void): () => void {
    this.unreadListeners.add(listener);
    listener(this.unreadCount);
    return () => {
      this.unreadListeners.delete(listener);
    };
  }

  private emitMessages() {
    const list = [...this.messages];
    this.listeners.forEach((fn) => fn(list));
  }

  private emitUnread() {
    this.unreadListeners.forEach((fn) => fn(this.unreadCount));
  }
}
