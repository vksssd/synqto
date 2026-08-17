// ─── Adaptive Reliable Transport (Jacobson/Karels RTO + Karn's Algorithm + Route Independence) ───

import { MessageId, PeerId } from '../types/identifiers';
import { NetworkPacket, AckPayload, NackPayload } from './packet';

export interface DeliveryReceipt {
  messageId: MessageId;
  status: 'delivered' | 'timeout' | 'rejected';
  attempts: number;
  rttMs?: number;
  error?: string;
}

interface PendingMessage {
  packet: NetworkPacket;
  targetPeerId?: PeerId;
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
  private readonly MAX_HISTORY = 3000;

  // Jacobson/Karels RTO Estimator State
  private srtt: number = 500;       // Smoothed RTT (ms)
  private rttvar: number = 250;     // RTT Variance (ms)
  private rto: number = 1000;       // Retransmission Timeout (ms)
  private readonly MIN_RTO = 250;
  private readonly MAX_RTO = 10000;

  private sendPacketFn: ((packet: NetworkPacket, targetPeerId?: PeerId) => boolean) | null = null;

  public static getInstance(): ReliableTransport {
    if (!ReliableTransport.instance) {
      ReliableTransport.instance = new ReliableTransport();
    }
    return ReliableTransport.instance;
  }

  public bindSender(sender: (packet: NetworkPacket, targetPeerId?: PeerId) => boolean): void {
    this.sendPacketFn = sender;
  }

  /**
   * Sends a logical packet with reliability guarantees (ACK tracking + adaptive retry).
   * INVARIANT: Retransmissions preserve logical packet.id while re-evaluating physical routes dynamically.
   */
  public async sendReliable(
    packet: NetworkPacket,
    targetPeerId?: PeerId,
    maxAttempts = 6
  ): Promise<DeliveryReceipt> {
    if (!this.sendPacketFn) {
      throw new Error('[ReliableTransport] No sender bound to ReliableTransport');
    }

    return new Promise<DeliveryReceipt>((resolve, reject) => {
      const sentTime = typeof packet.timestamp === 'number' ? packet.timestamp : Date.now();
      const pendingItem: PendingMessage = {
        packet,
        targetPeerId,
        attempts: 1,
        maxAttempts,
        initialSentAt: sentTime,
        lastSentAt: sentTime,
        timer: null,
        resolve,
        reject,
      };

      this.pending.set(packet.id, pendingItem);
      this.sendPacketFn!(packet, targetPeerId);
      this.scheduleRetry(pendingItem);
    });
  }

  private scheduleRetry(item: PendingMessage): void {
    if (item.timer) clearTimeout(item.timer);

    // Exponential backoff: RTO * (1.8 ^ (attempts - 1)) + jitter
    const backoffMultiplier = Math.pow(1.8, Math.max(0, item.attempts - 1));
    const delay = Math.min(
      this.MAX_RTO,
      Math.round(this.rto * backoffMultiplier) + Math.floor(Math.random() * 150)
    );

    item.timer = setTimeout(() => {
      if (!this.pending.has(item.packet.id)) return;

      if (item.attempts >= item.maxAttempts) {
        this.pending.delete(item.packet.id);
        item.resolve({
          messageId: item.packet.id,
          status: 'timeout',
          attempts: item.attempts,
          error: `Delivery timed out after ${item.attempts} attempts (last RTO: ${delay}ms)`,
        });
        return;
      }

      item.attempts += 1;
      item.lastSentAt = Date.now();

      // Retransmit using current dynamic route resolution
      if (this.sendPacketFn) {
        this.sendPacketFn(item.packet, item.targetPeerId);
      }
      this.scheduleRetry(item);
    }, delay);
  }

  private onRetryFn: (() => void) | null = null;
  private onAckFn: (() => void) | null = null;

  public onRetry(fn: () => void): void {
    this.onRetryFn = fn;
  }

  public onAck(fn: () => void): void {
    this.onAckFn = fn;
  }

  /**
   * Processes incoming ACK from remote peer.
   * INVARIANT: Karn's algorithm — RTT samples are gathered ONLY from original transmissions (attempts === 1).
   */
  public handleAck(ack: AckPayload): void {
    const item = this.pending.get(ack.ackFor);
    if (!item) return;

    if (item.timer) clearTimeout(item.timer);
    this.pending.delete(ack.ackFor);

    const now = Date.now();
    const rtt = Math.max(1, now - item.initialSentAt);

    // Karn's Algorithm: Update RTO estimator ONLY if message was delivered on first attempt
    if (item.attempts === 1) {
      const delta = rtt - this.srtt;
      this.srtt += 0.125 * delta;
      this.rttvar += 0.25 * (Math.abs(delta) - this.rttvar);
      this.rto = Math.min(this.MAX_RTO, Math.max(this.MIN_RTO, Math.round(this.srtt + 4 * this.rttvar)));
    }

    item.resolve({
      messageId: ack.ackFor,
      status: 'delivered',
      attempts: item.attempts,
      rttMs: rtt,
    });

    if (this.onAckFn) {
      this.onAckFn();
    }
  }

  /**
   * Processes incoming NACK from remote peer.
   */
  public handleNack(nack: NackPayload): void {
    const item = this.pending.get(nack.nackFor);
    if (!item) return;

    if (nack.reason === 'BUFFER_OVERFLOW' && item.attempts < item.maxAttempts) {
      // Retryable NACK: reschedule with jittered backoff
      this.scheduleRetry(item);
      return;
    }

    // Terminal rejection
    if (item.timer) clearTimeout(item.timer);
    this.pending.delete(nack.nackFor);

    item.resolve({
      messageId: nack.nackFor,
      status: 'rejected',
      attempts: item.attempts,
      error: `NACK: ${nack.reason}`,
    });
  }

  /**
   * Checks if packet is duplicate. If not, records it in sliding-window history.
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

  /**
   * Evaluates if a packet requires an automated ACK.
   * INVARIANT: Never ACK an ACK or ephemeral control message.
   */
  public isAckable(packet: NetworkPacket): boolean {
    if (
      packet.type === 'transport:ack' ||
      packet.type === 'transport:nack' ||
      packet.type === 'transport:gap_repair' ||
      packet.type.startsWith('presence:') ||
      packet.type.startsWith('canvas:')
    ) {
      return false;
    }
    return true;
  }

  /**
   * Advances simulated time for pending message retries (for simulation harnesses).
   */
  public step(simulatedNow: number): void {
    const toRetry: PendingMessage[] = [];
    const toTimeout: PendingMessage[] = [];

    this.pending.forEach((item) => {
      const backoffMultiplier = Math.pow(1.8, Math.max(0, item.attempts - 1));
      const delay = Math.min(
        this.MAX_RTO,
        Math.round(this.rto * backoffMultiplier)
      );

      if (simulatedNow - item.lastSentAt >= delay) {
        if (item.attempts >= item.maxAttempts) {
          toTimeout.push(item);
        } else {
          toRetry.push(item);
        }
      }
    });

    toTimeout.forEach((item) => {
      this.pending.delete(item.packet.id);
      item.resolve({
        messageId: item.packet.id,
        status: 'timeout',
        attempts: item.attempts,
        error: `Delivery timed out after ${item.attempts} attempts`,
      });
    });

    toRetry.forEach((item) => {
      item.attempts += 1;
      item.lastSentAt = simulatedNow;
      if (this.onRetryFn) {
        this.onRetryFn();
      }
      if (this.sendPacketFn) {
        this.sendPacketFn(item.packet, item.targetPeerId);
      }
    });
  }

  public hasPending(): boolean {
    return this.pending.size > 0;
  }

  public getEstimator(): { srtt: number; rttvar: number; rto: number } {
    return { srtt: Math.round(this.srtt), rttvar: Math.round(this.rttvar), rto: this.rto };
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
