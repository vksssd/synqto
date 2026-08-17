// ─── Reliable Transport Primitive with ACK/NACK & Exponential Retry ───

import { MessageId, PeerId } from '../types/identifiers';
import { NetworkEnvelope } from './envelope';

export interface DeliveryReceipt {
  messageId: MessageId;
  status: 'delivered' | 'timeout' | 'rejected';
  attempts: number;
  rttMs?: number;
  error?: string;
}

export interface TransportAckPayload {
  messageId: MessageId;
  status: 'ack' | 'nack';
  reason?: string;
}

interface PendingMessage {
  envelope: NetworkEnvelope;
  attempts: number;
  maxAttempts: number;
  initialSentAt: number;
  lastSentAt: number;
  timer: any;
  resolve: (receipt: DeliveryReceipt) => void;
  reject: (err: Error) => void;
}

export class ReliableTransport {
  private static instance: ReliableTransport | null = null;
  private pending: Map<MessageId, PendingMessage> = new Map();
  private receivedMessageIds: Set<MessageId> = new Set();
  private messageHistoryOrder: MessageId[] = [];
  private readonly MAX_HISTORY = 1000;

  private sendRawFn: ((envelope: NetworkEnvelope) => void) | null = null;

  public static getInstance(): ReliableTransport {
    if (!ReliableTransport.instance) {
      ReliableTransport.instance = new ReliableTransport();
    }
    return ReliableTransport.instance;
  }

  public bindSender(sender: (envelope: NetworkEnvelope) => void): void {
    this.sendRawFn = sender;
  }

  /**
   * Sends an envelope with reliability guarantees (ACK tracking + retry)
   */
  public async sendReliable(
    envelope: NetworkEnvelope,
    maxAttempts = 4
  ): Promise<DeliveryReceipt> {
    if (!this.sendRawFn) {
      throw new Error('[ReliableTransport] No sender bound to ReliableTransport');
    }

    // Ephemeral & bestEffort bypass ACK tracking
    if (envelope.delivery === 'ephemeral' || envelope.delivery === 'bestEffort') {
      this.sendRawFn(envelope);
      return {
        messageId: envelope.messageId,
        status: 'delivered',
        attempts: 1,
        rttMs: 0,
      };
    }

    return new Promise<DeliveryReceipt>((resolve, reject) => {
      const pendingItem: PendingMessage = {
        envelope,
        attempts: 1,
        maxAttempts,
        initialSentAt: Date.now(),
        lastSentAt: Date.now(),
        timer: null,
        resolve,
        reject,
      };

      this.pending.set(envelope.messageId, pendingItem);
      this.sendRawFn!(envelope);
      this.scheduleRetry(pendingItem);
    });
  }

  private scheduleRetry(item: PendingMessage): void {
    if (item.timer) clearTimeout(item.timer);

    // Exponential backoff with jitter: 400ms * (1.8 ^ attempts) + jitter
    const delay = Math.floor(
      Math.min(5000, 400 * Math.pow(1.8, item.attempts - 1)) + Math.random() * 200
    );

    item.timer = setTimeout(() => {
      if (!this.pending.has(item.envelope.messageId)) return;

      if (item.attempts >= item.maxAttempts) {
        this.pending.delete(item.envelope.messageId);
        item.resolve({
          messageId: item.envelope.messageId,
          status: 'timeout',
          attempts: item.attempts,
          error: `Delivery timed out after ${item.attempts} attempts`,
        });
        return;
      }

      item.attempts += 1;
      item.lastSentAt = Date.now();
      if (this.sendRawFn) {
        this.sendRawFn(item.envelope);
      }
      this.scheduleRetry(item);
    }, delay);
  }

  /**
   * Processes incoming ACK from target peer
   */
  public handleAck(ack: TransportAckPayload, fromPeerId: PeerId): void {
    const item = this.pending.get(ack.messageId);
    if (!item) return;

    if (item.timer) clearTimeout(item.timer);
    this.pending.delete(ack.messageId);

    const rtt = Date.now() - item.initialSentAt;
    item.resolve({
      messageId: ack.messageId,
      status: ack.status === 'ack' ? 'delivered' : 'rejected',
      attempts: item.attempts,
      rttMs: rtt,
      error: ack.reason,
    });
  }

  /**
   * Checks if envelope is duplicate. If not, records it in LRU filter.
   * Returns true if packet is NEW, false if duplicate.
   */
  public filterDuplicate(messageId: MessageId): boolean {
    if (this.receivedMessageIds.has(messageId)) {
      return false; // Duplicate
    }

    this.receivedMessageIds.add(messageId);
    this.messageHistoryOrder.push(messageId);

    if (this.messageHistoryOrder.length > this.MAX_HISTORY) {
      const oldest = this.messageHistoryOrder.shift();
      if (oldest) this.receivedMessageIds.delete(oldest);
    }

    return true; // Fresh message
  }

  public clear(): void {
    this.pending.forEach((item) => {
      if (item.timer) clearTimeout(item.timer);
    });
    this.pending.clear();
    this.receivedMessageIds.clear();
    this.messageHistoryOrder = [];
  }
}
