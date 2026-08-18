// ─── Real-time Chat Service (WhatsApp-style Rich Chat + Reliable Delivery + ACKs + Reactions + Polls + Quizzes) ───

import { NetworkService } from '@/core/network/network.service';
import {
  ChatMessagePayload,
  ChatAckPayload,
  ChatHistoryPayload,
  ChatHistoryResponsePayload,
  ChatReactionPayload,
  ChatPollVotePayload,
  ChatQuizAnswerPayload,
  SyncDigestPayload,
  SyncDeltaRequestPayload,
  SyncDeltaResponsePayload,
  PeerIdentity,
  StoredChatMessage,
  ChatMessageType,
  CodeSnippetData,
  PollData,
  QuizData,
  FileAttachmentData,
} from '@/core/network/packet';
import { HLC, compareHLC } from '@/core/network/hybrid-clock';
import { uuid, debounce } from '@/shared/utils';

export type MessageAckStatus = 'pending' | 'sent' | 'delivered' | 'read';

export interface ChatMessageItem extends StoredChatMessage {
  status: MessageAckStatus;
  isSelf: boolean;
  expectedAcks?: number;
  receivedAcks?: Set<string>;
  seq?: number;
  lamportTime?: number;
  /** Hybrid logical timestamp — the ordering key. See orderMessages below. */
  hlc?: HLC;
}

/**
 * The single ordering comparator for the message list.
 *
 * There were previously three different comparators in this file, and two of them were
 * actively wrong:
 *
 *     (a.lamportTime || a.timestamp) - (b.lamportTime || b.timestamp)
 *
 * That expression compares values from two scales twelve orders of magnitude apart. A
 * Lamport counter is a small integer (1, 2, 3...); a timestamp is epoch milliseconds
 * (~1.79e12). So any message missing `lamportTime` was compared as a number ~1.79e12 and
 * sorted after *every* message that had one — permanently, no matter when it was actually
 * sent. Messages arriving via `chat:history:response` were exactly that case, because the
 * history projection dropped seq/lamportTime on the way out. The visible symptom: pull in
 * history, then receive one new message, and the entire history jumps to the bottom of the
 * conversation. The `||` also meant a legitimate lamportTime of 0 fell through to the
 * timestamp branch.
 *
 * Ordering is now HLC-based everywhere, with one comparator used by every code path.
 */
function orderMessages(list: ChatMessageItem[]): void {
  list.sort((a, b) =>
    compareHLC(
      { hlc: a.hlc, timestamp: a.timestamp, peerId: a.from?.peerId },
      { hlc: b.hlc, timestamp: b.timestamp, peerId: b.from?.peerId }
    )
  );
}

export interface ChatNotificationData {
  id: string;
  sender: PeerIdentity;
  roomId: string;
  text: string;
  messageType?: ChatMessageType;
  isMention: boolean;
  timestamp: number;
}

const STORAGE_PREFIX = 'synqto_chat_';
const MAX_STORED_MESSAGES = 250;
const HISTORY_SYNC_LIMIT = 60;

export class ChatService {
  private static instance: ChatService | null = null;
  private network: NetworkService;

  private currentRoomId = '';
  private myPeerId = '';
  private myNickname = '';
  private mySeq = 0;
  private peerSeqs: Map<string, number> = new Map();
  private lamportClock = 0;
  private messages: ChatMessageItem[] = [];
  private unackedQueue: Map<string, { message: ChatMessageItem; payload: ChatMessagePayload; attempts: number; timer: any }> = new Map();

  private listeners: Set<(messages: ChatMessageItem[]) => void> = new Set();
  private unreadCount = 0;
  private unreadListeners: Set<(count: number) => void> = new Set();
  private toastListeners: Set<(notif: ChatNotificationData) => void> = new Set();

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

  public init(roomId: string, myPeerId: string, myNickname = '') {
    if (this.currentRoomId === roomId && this.myPeerId === myPeerId) {
      return;
    }

    this.currentRoomId = roomId;
    this.myPeerId = myPeerId;
    if (myNickname) this.myNickname = myNickname;
    this.messages = [];
    this.unreadCount = 0;
    this.clearUnackedQueue();

    // 1. Load local cached messages
    this.loadCachedMessages();

    // 2. Request history catch-up & broadcast anti-entropy sync digest
    this.requestHistorySync();
    this.broadcastSyncDigest();

    // 3. Retry history sync after initial WebRTC channel negotiation
    setTimeout(() => {
      if (this.messages.length < 5) {
        this.requestHistorySync();
        this.broadcastSyncDigest();
      }
    }, 1500);
  }

  private setupListeners() {
    // Catch-up on new peer join
    this.network.on('presence:join', () => {
      if (this.messages.length < 30) {
        this.requestHistorySync();
        this.broadcastSyncDigest();
      }
    });

    // 0. Anti-entropy Sync Digest listener
    this.network.on<SyncDigestPayload>('sync:digest', (payload, packet) => {
      if (packet.from.peerId === this.myPeerId) return;

      this.lamportClock = Math.max(this.lamportClock, payload.latestLamport || 0) + 1;

      // Find messages from this client that the remote peer might have missed
      const remoteLastSeqForMe = payload.lastSeqByPeer?.[this.myPeerId] || 0;
      const missing = this.messages.filter((m) => m.isSelf && (m.seq || 0) > remoteLastSeqForMe);

      if (missing.length > 0) {
        this.network.send<SyncDeltaResponsePayload>(
          packet.from.peerId,
          'sync:delta_response',
          {
            messages: missing,
            latestLamport: this.lamportClock,
          },
          { channelPriority: 'bulk' }
        );
      }
    });

    // 0b. Anti-entropy Delta Response listener
    this.network.on<SyncDeltaResponsePayload>('sync:delta_response', (payload) => {
      if (!payload?.messages || payload.messages.length === 0) return;

      this.lamportClock = Math.max(this.lamportClock, payload.latestLamport || 0) + 1;
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
        orderMessages(this.messages);
        this.saveMessagesDebounced();
        this.emitMessages();
      }
    });

    // 1. Inbound chat message
    this.network.on<ChatMessagePayload>('chat:message', (payload, packet) => {
      if (packet.roomId !== this.currentRoomId) return;

      // Update Lamport clock and sequence tracking
      this.lamportClock = Math.max(this.lamportClock, packet.lamportTime || 0) + 1;
      if (packet.seq) {
        this.peerSeqs.set(packet.from.peerId, Math.max(this.peerSeqs.get(packet.from.peerId) || 0, packet.seq));
      }

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
        seq: packet.seq,
        lamportTime: packet.lamportTime,
        hlc: packet.hlc,
        messageType: payload.messageType || 'text',
        replyTo: payload.replyTo,
        replyPreview: payload.replyPreview,
        imageUrl: payload.imageUrl,
        imageCaption: payload.imageCaption,
        codeSnippet: payload.codeSnippet,
        poll: payload.poll,
        quiz: payload.quiz,
        fileAttachment: payload.fileAttachment,
        mentions: payload.mentions || [],
        reactions: payload.reactions || {},
        status: 'delivered',
        isSelf: packet.from.peerId === this.myPeerId,
      };

      this.messages.push(msg);
      orderMessages(this.messages);
      this.saveMessagesDebounced();
      this.emitMessages();

      if (!msg.isSelf) {
        this.unreadCount++;
        this.emitUnread();

        // Check if mention
        const isMention = Boolean(
          msg.mentions?.includes('everyone') ||
          msg.mentions?.includes('all') ||
          (this.myNickname && msg.mentions?.includes(this.myNickname)) ||
          (this.myPeerId && msg.mentions?.includes(this.myPeerId))
        );

        this.emitToast({
          id: incomingId,
          sender: packet.from,
          roomId: packet.roomId,
          text: msg.text,
          messageType: msg.messageType,
          isMention,
          timestamp: msg.timestamp,
        });

        // Send ACK back to sender
        this.network.send(packet.from.peerId, 'chat:ack', { messageId: incomingId });
      }
    });

    // 2. Inbound chat ACK (Delivery receipt)
    this.network.on<ChatAckPayload>('chat:ack', (payload, packet) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (msg && msg.isSelf) {
        if (msg.status !== 'read') {
          msg.status = 'delivered';
        }
        if (!msg.receivedAcks) msg.receivedAcks = new Set();
        msg.receivedAcks.add(packet.from.peerId);

        // Remove from unacked retry queue
        this.removeUnacked(payload.messageId);
        this.saveMessagesDebounced();
        this.emitMessages();
      }
    });

    // 3. Inbound chat read receipt
    this.network.on<ChatAckPayload>('chat:read', (payload) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (msg && msg.isSelf) {
        msg.status = 'read';
        this.removeUnacked(payload.messageId);
        this.saveMessagesDebounced();
        this.emitMessages();
      }
    });

    // 4. Inbound Reactions
    this.network.on<ChatReactionPayload>('chat:reaction', (payload, packet) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (!msg) return;

      if (!msg.reactions) msg.reactions = {};
      const currentReactors = msg.reactions[payload.emoji] || [];
      const senderPeerId = packet.from.peerId;

      if (payload.remove) {
        msg.reactions[payload.emoji] = currentReactors.filter((p) => p !== senderPeerId);
        if (msg.reactions[payload.emoji].length === 0) {
          delete msg.reactions[payload.emoji];
        }
      } else {
        if (!currentReactors.includes(senderPeerId)) {
          msg.reactions[payload.emoji] = [...currentReactors, senderPeerId];
        }
      }

      this.saveMessagesDebounced();
      this.emitMessages();
    });

    // 5. Inbound Poll Vote
    this.network.on<ChatPollVotePayload>('chat:poll:vote', (payload, packet) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (!msg || !msg.poll) return;

      const voterPeerId = packet.from.peerId;
      msg.poll.options.forEach((opt) => {
        if (opt.id === payload.optionId) {
          if (!opt.votes.includes(voterPeerId)) {
            opt.votes.push(voterPeerId);
          }
        } else if (!payload.isMultiChoice) {
          // Single choice removes vote from other options
          opt.votes = opt.votes.filter((p) => p !== voterPeerId);
        }
      });

      this.saveMessagesDebounced();
      this.emitMessages();
    });

    // 6. Inbound Quiz Answer
    this.network.on<ChatQuizAnswerPayload>('chat:quiz:answer', (payload, packet) => {
      const msg = this.messages.find((m) => m.id === payload.messageId);
      if (!msg || !msg.quiz) return;

      const voterPeerId = packet.from.peerId;
      if (!msg.quiz.answers) msg.quiz.answers = {};
      msg.quiz.answers[voterPeerId] = payload.selectedOptionIndex;

      this.saveMessagesDebounced();
      this.emitMessages();
    });

    // 7. Inbound history request
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
          // seq/lamportTime/hlc were omitted here, which is what broke history ordering:
          // the receiver had no ordering key for these messages and sorted them by raw
          // epoch-ms against other messages' Lamport counters. They must survive the trip.
          seq: m.seq,
          lamportTime: m.lamportTime,
          hlc: m.hlc,
          messageType: m.messageType,
          replyTo: m.replyTo,
          replyPreview: m.replyPreview,
          imageUrl: m.imageUrl,
          imageCaption: m.imageCaption,
          codeSnippet: m.codeSnippet,
          poll: m.poll,
          quiz: m.quiz,
          fileAttachment: m.fileAttachment,
          mentions: m.mentions,
          reactions: m.reactions,
        }));

      if (recent.length > 0) {
        this.network.send(packet.from.peerId, 'chat:history:response', {
          messages: recent,
        });
      }
    });

    // 8. Inbound history response
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
        orderMessages(this.messages);
        this.saveMessagesDebounced();
        this.emitMessages();
      }
    });
  }

  /**
   * Generates a deterministic messageId based on timestamp and payload size
   */
  private generateMessageId(textLength = 0): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 7);
    return `msg_${ts}_${textLength}_${rand}`;
  }

  /**
   * Send standard text message or rich item
   */
  // public sendMessage(
  //   text: string,
  //   fromIdentity: PeerIdentity,
  //   optionsOrReplyTo?:
  //     | {
  //         replyTo?: { id: string; preview: string };
  //         messageId?: string;
  //         messageType?: ChatMessageType;
  //         imageUrl?: string;
  //         imageCaption?: string;
  //         codeSnippet?: CodeSnippetData;
  //         poll?: PollData;
  //         quiz?: QuizData;
  //         fileAttachment?: FileAttachmentData;
  //         mentions?: string[];
  //       }
  //     | { id: string; preview: string },
  //   existingMessageId?: string
  // ): ChatMessageItem {
  //   const rawText = text.trim();
  //   const isOptionsObject =
  //     optionsOrReplyTo &&
  //     ('messageType' in optionsOrReplyTo ||
  //       'imageUrl' in optionsOrReplyTo ||
  //       'codeSnippet' in optionsOrReplyTo ||
  //       'poll' in optionsOrReplyTo ||
  //       'quiz' in optionsOrReplyTo ||
  //       'fileAttachment' in optionsOrReplyTo ||
  //       'mentions' in optionsOrReplyTo);

  //   const options = isOptionsObject ? (optionsOrReplyTo as any) : undefined;
  //   const replyTo = !isOptionsObject && optionsOrReplyTo ? (optionsOrReplyTo as { id: string; preview: string }) : options?.replyTo;
  //   const customMessageId = options?.messageId || existingMessageId;
  //   const messageId = customMessageId || this.generateMessageId(rawText.length);

  //   // Extract @mentions if not explicitly provided
  //   let mentions = options?.mentions || [];
  //   if (mentions.length === 0 && rawText.includes('@')) {
  //     if (rawText.includes('@everyone') || rawText.includes('@all')) {
  //       mentions.push('everyone');
  //     }
  //   }

  //   this.mySeq++;
  //   this.lamportClock++;

  //   const msg: ChatMessageItem = {
  //     id: messageId,
  //     from: fromIdentity,
  //     text: rawText,
  //     timestamp: Date.now(),
  //     seq: this.mySeq,
  //     lamportTime: this.lamportClock,
  //     messageType: options?.messageType || 'text',
  //     replyTo: replyTo?.id,
  //     replyPreview: replyTo?.preview,
  //     imageUrl: options?.imageUrl,
  //     imageCaption: options?.imageCaption,
  //     codeSnippet: options?.codeSnippet,
  //     poll: options?.poll,
  //     quiz: options?.quiz,
  //     fileAttachment: options?.fileAttachment,
  //     mentions,
  //     reactions: {},
  //     status: 'sent',
  //     isSelf: true,
  //     receivedAcks: new Set(),
  //   };

  //   this.messages.push(msg);
  //   this.saveMessagesDebounced();
  //   this.emitMessages();

  //   // Determine channel priority (Bulk for screenshots/files/large images, Control for fast chat)
  //   const isBulk = msg.messageType === 'image' || msg.messageType === 'screenshot' || msg.messageType === 'file';
  //   const channelPriority = isBulk ? 'bulk' : 'control';

  //   // Broadcast to room with sequence tracking & clocking
  //   const payload: ChatMessagePayload = {
  //     messageId,
  //     text: msg.text,
  //     messageType: msg.messageType,
  //     replyTo: msg.replyTo,
  //     replyPreview: msg.replyPreview,
  //     imageUrl: msg.imageUrl,
  //     imageCaption: msg.imageCaption,
  //     codeSnippet: msg.codeSnippet,
  //     poll: msg.poll,
  //     quiz: msg.quiz,
  //     fileAttachment: msg.fileAttachment,
  //     mentions: msg.mentions,
  //     reactions: msg.reactions,
  //   };
  //   this.network.broadcast('chat:message', payload, {
  //     channelPriority,
  //     seq: this.mySeq,
  //     lamportTime: this.lamportClock,
  //   });

  //   // Queue for reliable ACK retry with exponential backoff
  //   this.queueUnacked(msg, payload);

  //   return msg;
  // }

  /**
 * Send standard text message or rich item.
 *
 * The preferred API is:
 *
 * sendMessage(text, identity, {
 *   replyTo: { id, preview },
 *   messageType: ...,
 *   ...
 * })
 *
 * The legacy direct reply form
 *
 * sendMessage(text, identity, { id, preview })
 *
 * is also supported for compatibility.
 */
public sendMessage(
  text: string,
  fromIdentity: PeerIdentity,
  optionsOrReplyTo?:
    | {
        replyTo?: {
          id: string;
          preview: string;
        };
        messageId?: string;
        messageType?: ChatMessageType;
        imageUrl?: string;
        imageCaption?: string;
        codeSnippet?: CodeSnippetData;
        poll?: PollData;
        quiz?: QuizData;
        fileAttachment?: FileAttachmentData;
        mentions?: string[];
      }
    | {
        id: string;
        preview: string;
      },
  existingMessageId?: string
): ChatMessageItem {
  const rawText = text.trim();

  /*
   * Normalize the overloaded input.
   *
   * IMPORTANT:
   * The old implementation only detected an options object
   * when messageType/image/etc. existed. That caused:
   *
   * { replyTo: { id, preview } }
   *
   * to be incorrectly interpreted as the reply itself.
   */
  const isOptionsObject =
    !!optionsOrReplyTo &&
    (
      'replyTo' in optionsOrReplyTo ||
      'messageId' in optionsOrReplyTo ||
      'messageType' in optionsOrReplyTo ||
      'imageUrl' in optionsOrReplyTo ||
      'imageCaption' in optionsOrReplyTo ||
      'codeSnippet' in optionsOrReplyTo ||
      'poll' in optionsOrReplyTo ||
      'quiz' in optionsOrReplyTo ||
      'fileAttachment' in optionsOrReplyTo ||
      'mentions' in optionsOrReplyTo
    );

  const options = isOptionsObject
    ? (optionsOrReplyTo as {
        replyTo?: {
          id: string;
          preview: string;
        };
        messageId?: string;
        messageType?: ChatMessageType;
        imageUrl?: string;
        imageCaption?: string;
        codeSnippet?: CodeSnippetData;
        poll?: PollData;
        quiz?: QuizData;
        fileAttachment?: FileAttachmentData;
        mentions?: string[];
      })
    : undefined;

  /*
   * Support both APIs:
   *
   * Preferred:
   *   { replyTo: { id, preview } }
   *
   * Legacy:
   *   { id, preview }
   */
  const replyTo = options
    ? options.replyTo
    : optionsOrReplyTo as
        | {
            id: string;
            preview: string;
          }
        | undefined;

  const customMessageId =
    options?.messageId || existingMessageId;

  const messageId =
    customMessageId ||
    this.generateMessageId(
      rawText.length
    );

  // ─────────────────────────────────────────────
  // Mentions
  // ─────────────────────────────────────────────

  const mentions = [
    ...(options?.mentions || []),
  ];

  if (
    mentions.length === 0 &&
    rawText.includes('@')
  ) {
    if (
      rawText.includes('@everyone') ||
      rawText.includes('@all')
    ) {
      mentions.push('everyone');
    }
  }

  // ─────────────────────────────────────────────
  // Logical clocks
  // ─────────────────────────────────────────────

  this.mySeq++;
  this.lamportClock++;

  // ─────────────────────────────────────────────
  // Local message
  // ─────────────────────────────────────────────

  const msg: ChatMessageItem = {
    id: messageId,
    from: fromIdentity,
    text: rawText,
    timestamp: Date.now(),

    seq: this.mySeq,
    lamportTime: this.lamportClock,

    messageType:
      options?.messageType || 'text',

    /*
     * THIS IS THE IMPORTANT FIX.
     */
    replyTo: replyTo?.id,
    replyPreview: replyTo?.preview,

    imageUrl: options?.imageUrl,
    imageCaption: options?.imageCaption,

    codeSnippet:
      options?.codeSnippet,

    poll:
      options?.poll,

    quiz:
      options?.quiz,

    fileAttachment:
      options?.fileAttachment,

    mentions,

    reactions: {},

    status: 'sent',
    isSelf: true,

    receivedAcks: new Set(),
  };

  // Add locally immediately so the sender sees it instantly.
  this.messages.push(msg);

  this.saveMessagesDebounced();
  this.emitMessages();

  // ─────────────────────────────────────────────
  // Channel priority
  // ─────────────────────────────────────────────

  const isBulk =
    msg.messageType === 'image' ||
    msg.messageType === 'screenshot' ||
    msg.messageType === 'file';

  const channelPriority = isBulk
    ? 'bulk'
    : 'control';

  // ─────────────────────────────────────────────
  // Network payload
  // ─────────────────────────────────────────────

  const payload: ChatMessagePayload = {
    messageId,

    text: msg.text,

    messageType:
      msg.messageType,

    /*
     * Reply data now travels correctly.
     */
    replyTo:
      msg.replyTo,

    replyPreview:
      msg.replyPreview,

    imageUrl:
      msg.imageUrl,

    imageCaption:
      msg.imageCaption,

    codeSnippet:
      msg.codeSnippet,

    poll:
      msg.poll,

    quiz:
      msg.quiz,

    fileAttachment:
      msg.fileAttachment,

    mentions:
      msg.mentions,

    reactions:
      msg.reactions,
  };

  const sentPacket = this.network.broadcast(
    'chat:message',
    payload,
    {
      channelPriority,
      seq: this.mySeq,
      lamportTime:
        this.lamportClock,
    }
  );

  // Adopt the exact stamp that went out on the wire.
  //
  // The local copy is built before the broadcast, so it has no HLC yet. It must not be
  // stamped independently: a second globalClock.tick() would yield a *different* value from
  // the one every other peer sees, so the sender's own message list could order differently
  // from everyone else's — the one view where an inconsistency is most obvious. Taking the
  // packet's stamp keeps all replicas identical.
  if (sentPacket?.hlc) {
    msg.hlc = sentPacket.hlc;
    const mine = this.messages.find((m) => m.id === msg.id);
    if (mine) mine.hlc = sentPacket.hlc;
    orderMessages(this.messages);
    this.emitMessages();
  }

  // ─────────────────────────────────────────────
  // Reliable retry
  // ─────────────────────────────────────────────

  this.queueUnacked(
    msg,
    payload
  );

  return msg;
}

  /**
   * Broadcasts an anti-entropy sync digest to discover missing messages after failover
   */
  public broadcastSyncDigest() {
    if (!this.myPeerId || !this.currentRoomId) return;

    const digest: Record<string, number> = {};
    if (this.mySeq > 0) {
      digest[this.myPeerId] = this.mySeq;
    }
    this.peerSeqs.forEach((seq, peerId) => {
      digest[peerId] = seq;
    });

    this.network.broadcast<SyncDigestPayload>(
      'sync:digest',
      {
        lastSeqByPeer: digest,
        latestLamport: this.lamportClock,
      },
      { channelPriority: 'control' }
    );
  }

  /**
   * Helper to send an image (file upload or clipboard paste)
   */
  public sendImage(dataUrl: string, caption = '', fromIdentity: PeerIdentity, replyTo?: { id: string; preview: string }) {
    return this.sendMessage(caption || '📸 Shared an image', fromIdentity, {
      messageType: 'image',
      imageUrl: dataUrl,
      imageCaption: caption,
      replyTo,
    });
  }

  /**
   * Helper to capture and send active tab screenshot
   */
  public async captureAndSendScreenshot(fromIdentity: PeerIdentity, caption = '📸 Tab Screenshot'): Promise<ChatMessageItem | null> {
    try {
      let dataUrl: string | null = null;

      // 1. Primary: Capture via background service worker (most reliable in MV3 side panel context)
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const res = await new Promise<{ success: boolean; dataUrl?: string; error?: string }>((resolve) => {
            chrome.runtime.sendMessage({ type: 'CAPTURE_ACTIVE_TAB' }, (response) => {
              if (chrome.runtime.lastError || !response) {
                resolve({ success: false, error: chrome.runtime.lastError?.message });
              } else {
                resolve(response);
              }
            });
          });

          if (res?.success && res.dataUrl) {
            dataUrl = res.dataUrl;
          }
        } catch (err) {
          console.warn('[ChatService] Service worker capture attempt failed, trying direct:', err);
        }
      }

      // 2. Fallback: Direct captureVisibleTab call
      if (!dataUrl && typeof chrome !== 'undefined' && chrome.tabs?.captureVisibleTab) {
        dataUrl = await new Promise<string | null>((resolve) => {
          chrome.windows.getLastFocused({ populate: false }, (win) => {
            const winId = win?.id;
            const cb = (capturedUrl?: string) => {
              if (chrome.runtime.lastError || !capturedUrl) {
                console.warn('[ChatService] Direct captureVisibleTab failed:', chrome.runtime.lastError);
                resolve(null);
              } else {
                resolve(capturedUrl);
              }
            };
            if (winId !== undefined) {
              chrome.tabs.captureVisibleTab(winId, { format: 'png' }, cb);
            } else {
              chrome.tabs.captureVisibleTab({ format: 'png' }, cb);
            }
          });
        });
      }

      if (dataUrl) {
        const msg = this.sendMessage(caption, fromIdentity, {
          messageType: 'screenshot',
          imageUrl: dataUrl,
          imageCaption: caption,
        });
        return msg;
      }
    } catch (err) {
      console.warn('[ChatService] Failed to capture screenshot:', err);
    }
    return null;
  }

  /**
   * Helper to send syntax-highlighted code snippet
   */
  public sendCodeSnippet(code: string, language: string, title = '', fromIdentity: PeerIdentity) {
    return this.sendMessage(`💻 Code: ${title || language}`, fromIdentity, {
      messageType: 'code',
      codeSnippet: { code, language, title },
    });
  }

  /**
   * Helper to send interactive poll
   */
  public sendPoll(question: string, options: string[], isMultiChoice = false, fromIdentity: PeerIdentity) {
    const poll: PollData = {
      id: uuid(),
      question: question.trim(),
      options: options.map((opt) => ({ id: uuid(), text: opt.trim(), votes: [] })),
      isMultiChoice,
    };

    return this.sendMessage(`📊 Poll: ${question}`, fromIdentity, {
      messageType: 'poll',
      poll,
    });
  }

  /**
   * Helper to send interactive DSA Quiz
   */
  public sendQuiz(
    question: string,
    options: string[],
    correctOptionIndex: number,
    explanation = '',
    fromIdentity: PeerIdentity
  ) {
    const quiz: QuizData = {
      id: uuid(),
      question: question.trim(),
      options: options.map((o) => o.trim()),
      correctOptionIndex,
      explanation: explanation.trim(),
      answers: {},
    };

    return this.sendMessage(`🧠 Quiz: ${question}`, fromIdentity, {
      messageType: 'quiz',
      quiz,
    });
  }

  /**
   * Helper to send document or file attachment
   */
  public sendFileAttachment(file: FileAttachmentData, fromIdentity: PeerIdentity) {
    return this.sendMessage(`📄 Attached: ${file.name}`, fromIdentity, {
      messageType: 'file',
      fileAttachment: file,
    });
  }

  /**
   * Toggle emoji reaction on any message
   */
  public toggleReaction(messageId: string, emoji: string, fromIdentity: PeerIdentity) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    const reactors = msg.reactions[emoji] || [];
    const alreadyReacted = reactors.includes(fromIdentity.peerId);

    if (alreadyReacted) {
      msg.reactions[emoji] = reactors.filter((p) => p !== fromIdentity.peerId);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji] = [...reactors, fromIdentity.peerId];
    }

    this.saveMessagesDebounced();
    this.emitMessages();

    // Broadcast reaction packet
    this.network.broadcast<ChatReactionPayload>('chat:reaction', {
      messageId,
      emoji,
      remove: alreadyReacted,
    });
  }

  /**
   * Vote on a poll
   */
  public votePoll(messageId: string, pollId: string, optionId: string, fromIdentity: PeerIdentity, isMultiChoice = false) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg || !msg.poll) return;

    msg.poll.options.forEach((opt) => {
      if (opt.id === optionId) {
        if (!opt.votes.includes(fromIdentity.peerId)) {
          opt.votes.push(fromIdentity.peerId);
        } else {
          opt.votes = opt.votes.filter((p) => p !== fromIdentity.peerId);
        }
      } else if (!isMultiChoice) {
        opt.votes = opt.votes.filter((p) => p !== fromIdentity.peerId);
      }
    });

    this.saveMessagesDebounced();
    this.emitMessages();

    this.network.broadcast<ChatPollVotePayload>('chat:poll:vote', {
      messageId,
      pollId,
      optionId,
      isMultiChoice,
    });
  }

  /**
   * Answer a quiz
   */
  public answerQuiz(messageId: string, quizId: string, selectedOptionIndex: number, fromIdentity: PeerIdentity) {
    const msg = this.messages.find((m) => m.id === messageId);
    if (!msg || !msg.quiz) return;

    if (!msg.quiz.answers) msg.quiz.answers = {};
    msg.quiz.answers[fromIdentity.peerId] = selectedOptionIndex;

    this.saveMessagesDebounced();
    this.emitMessages();

    this.network.broadcast<ChatQuizAnswerPayload>('chat:quiz:answer', {
      messageId,
      quizId,
      selectedOptionIndex,
    });
  }

  /**
   * Delete a message locally from the room history
   */
  public deleteMessage(messageId: string) {
    this.messages = this.messages.filter((m) => m.id !== messageId);
    this.removeUnacked(messageId);
    this.emitMessages();
    this.saveMessagesDebounced();
  }

  /**
   * Exponential backoff retry queue with congestion protection
   */
  private queueUnacked(msg: ChatMessageItem, payload: ChatMessagePayload) {
    const entry = {
      message: msg,
      payload,
      attempts: 0,
      timer: null as any,
    };

    const retry = () => {
      if (entry.attempts >= 5) {
        this.removeUnacked(msg.id);
        return;
      }
      entry.attempts++;
      // Backoff intervals: 500ms, 1200ms, 2500ms, 5000ms, 10000ms
      const delays = [500, 1200, 2500, 5000, 10000];
      const delay = delays[entry.attempts - 1] || 10000;

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

  public markAsRead(messageId?: string) {
    if (messageId) {
      const msg = this.messages.find((m) => m.id === messageId);
      if (msg && !msg.isSelf) {
        msg.status = 'read';
        this.network.send(msg.from.peerId, 'chat:read', { messageId });
        this.saveMessagesDebounced();
      }
    } else {
      // Mark all unread incoming messages as read
      let updated = false;
      this.messages
        .filter((m) => !m.isSelf && m.status !== 'read')
        .forEach((m) => {
          m.status = 'read';
          this.network.send(m.from.peerId, 'chat:read', { messageId: m.id });
          updated = true;
        });
      if (updated) {
        this.saveMessagesDebounced();
      }
      this.unreadCount = 0;
      this.emitUnread();
    }
  }

  public getMessages(): ChatMessageItem[] {
    return [...this.messages];
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  public onMessages(callback: (messages: ChatMessageItem[]) => void): () => void {
    this.listeners.add(callback);
    callback(this.getMessages());
    return () => this.listeners.delete(callback);
  }

  public onUnread(callback: (count: number) => void): () => void {
    this.unreadListeners.add(callback);
    callback(this.unreadCount);
    return () => this.unreadListeners.delete(callback);
  }

  public onUnreadChange(callback: (count: number) => void): () => void {
    return this.onUnread(callback);
  }

  public onNotificationToast(callback: (notif: ChatNotificationData) => void): () => void {
    this.toastListeners.add(callback);
    return () => this.toastListeners.delete(callback);
  }

  private emitToast(notif: ChatNotificationData) {
    this.toastListeners.forEach((cb) => {
      try {
        cb(notif);
      } catch (err) {
        console.error('[ChatService] Error in toast listener:', err);
      }
    });
  }

  private emitMessages() {
    const msgs = this.getMessages();
    this.listeners.forEach((cb) => {
      try {
        cb(msgs);
      } catch (err) {
        console.error('[ChatService] Error in listener callback:', err);
      }
    });
  }

  private emitUnread() {
    this.unreadListeners.forEach((cb) => cb(this.unreadCount));
  }

  private requestHistorySync() {
    this.network.broadcast<ChatHistoryPayload>('chat:history:request', {
      sinceTimestamp: this.messages.length > 0 ? this.messages[this.messages.length - 1].timestamp : 0,
    });
  }

  private async loadCachedMessages() {
    if (!this.currentRoomId) return;

    try {
      const key = `${STORAGE_PREFIX}${this.currentRoomId}`;
      const legacyKey = `nerd_buddy_chat_${this.currentRoomId}`;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get([key, legacyKey]);
        const stored: StoredChatMessage[] = res[key] || res[legacyKey] || [];
        if (stored.length > 0 && this.messages.length === 0) {
          this.messages = stored.map((s) => {
            const isSelf = s.from.peerId === this.myPeerId;
            // Preserves accurate delivery status: if a self message was never delivered, it remains 'sent' or 'pending'
            let status: MessageAckStatus = s.status || (isSelf ? 'sent' : 'delivered');
            if (isSelf && status !== 'delivered' && status !== 'read') {
              status = 'sent';
            }
            return {
              ...s,
              status,
              isSelf,
            };
          });
          orderMessages(this.messages);
          this.emitMessages();
        }
      }
    } catch (err) {
      console.warn('[ChatService] Failed to load cached messages:', err);
    }
  }

  private saveMessagesDebounced = debounce(() => {
    this.saveMessages();
  }, 1000);

  private async saveMessages() {
    if (!this.currentRoomId || this.messages.length === 0) return;

    try {
      const key = `${STORAGE_PREFIX}${this.currentRoomId}`;
      const toSave: StoredChatMessage[] = this.messages.slice(-MAX_STORED_MESSAGES).map((m) => ({
        id: m.id,
        from: m.from,
        text: m.text,
        timestamp: m.timestamp,
        messageType: m.messageType,
        replyTo: m.replyTo,
        replyPreview: m.replyPreview,
        imageUrl: m.imageUrl,
        imageCaption: m.imageCaption,
        codeSnippet: m.codeSnippet,
        poll: m.poll,
        quiz: m.quiz,
        fileAttachment: m.fileAttachment,
        mentions: m.mentions,
        reactions: m.reactions,
        status: m.status,
        seq: m.seq,
        lamportTime: m.lamportTime,
        hlc: m.hlc,
      }));

      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [key]: toSave });
      }
    } catch (err) {
      console.warn('[ChatService] Failed to save messages:', err);
    }
  }
}
