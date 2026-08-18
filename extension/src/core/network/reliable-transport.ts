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

  // ─── Congestion control ───
  //
  // A BUFFER_OVERFLOW NACK is the receiver saying "I am full". The old behaviour was to
  // immediately reschedule at the *same* backoff level, which is exactly backwards: under
  // sustained pressure every sender kept retransmitting at a fixed rate into a buffer that
  // was already overflowing, and because the NACK path never incremented `attempts` those
  // retries neither escalated nor ever terminated. That is the chat "buffer full" drop loop.
  //
  // Response is now TCP-shaped: multiplicative decrease on congestion signal, decayed back
  // toward normal as ACKs start flowing again.
  private congestionFactor: number = 1;
  private readonly MAX_CONGESTION_FACTOR = 8;
  private readonly CONGESTION_DECAY = 0.85;

  // In-flight cap. `pending` was unbounded, so a peer that went away left every queued chat
  // message retrying independently — N messages x maxAttempts fan-out, all aimed at a
  // buffer already known to be full. Past this many, new sends fail fast so the UI can say
  // so instead of silently amplifying.
  private readonly MAX_PENDING = 100;
  private rejectedForBackpressure: number = 0;

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

    if (this.pending.size >= this.MAX_PENDING) {
      this.rejectedForBackpressure++;
      return {
        messageId: packet.id,
        status: 'rejected',
        attempts: 0,
        error: `BACKPRESSURE: ${this.pending.size} messages already awaiting ACK`,
      };
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

    // Exponential backoff: RTO * (1.8 ^ (attempts - 1)) * congestion + jitter.
    //
    // Jitter is proportional rather than a flat 0-150ms: when many peers are backed off
    // against the same congested receiver, a fixed jitter window does nothing to spread out
    // retries that are seconds apart, and they re-synchronise into the same bursts.
    const backoffMultiplier = Math.pow(1.8, Math.max(0, item.attempts - 1));
    const base = this.rto * backoffMultiplier * this.congestionFactor;
    const delay = Math.min(
      this.MAX_RTO * this.congestionFactor,
      Math.round(base + Math.random() * base * 0.25)
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

    // Successful delivery means the receiver has drained. Decay the congestion widening
    // back toward 1 so a single transient burst does not slow the session permanently.
    if (this.congestionFactor > 1) {
      this.congestionFactor = Math.max(1, this.congestionFactor * this.CONGESTION_DECAY);
    }

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

    if (nack.reason === 'BUFFER_OVERFLOW') {
      // Congestion signal. Multiplicative decrease first, so the reschedule below is
      // computed against the widened backoff and not the pre-congestion one.
      this.congestionFactor = Math.min(this.MAX_CONGESTION_FACTOR, this.congestionFactor * 1.5);

      // Count it as an attempt. Previously this path left `attempts` untouched, so a peer
      // emitting a steady stream of BUFFER_OVERFLOW kept resetting the retry timer at a
      // fixed backoff and the message could retry indefinitely — never escalating, never
      // giving up, and never surfacing a failure to the caller.
      item.attempts += 1;

      if (item.attempts >= item.maxAttempts) {
        if (item.timer) clearTimeout(item.timer);
        this.pending.delete(nack.nackFor);
        item.resolve({
          messageId: nack.nackFor,
          status: 'rejected',
          attempts: item.attempts,
          error: 'NACK: BUFFER_OVERFLOW (receiver stayed congested)',
        });
        return;
      }

      item.lastSentAt = Date.now();
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
      // Mirrors scheduleRetry's formula minus jitter, so simulation harnesses observe the
      // same backoff (including congestion widening) as the real timer path.
      const backoffMultiplier = Math.pow(1.8, Math.max(0, item.attempts - 1));
      const delay = Math.min(
        this.MAX_RTO * this.congestionFactor,
        Math.round(this.rto * backoffMultiplier * this.congestionFactor)
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

  /** Congestion + backpressure counters, for diagnostics. */
  public getCongestionStats(): {
    congestionFactor: number;
    pending: number;
    rejectedForBackpressure: number;
  } {
    return {
      congestionFactor: Math.round(this.congestionFactor * 100) / 100,
      pending: this.pending.size,
      rejectedForBackpressure: this.rejectedForBackpressure,
    };
  }

  public clear(): void {
    this.pending.forEach((item) => {
      if (item.timer) clearTimeout(item.timer);
    });
    this.pending.clear();
    this.receivedMessageIds.clear();
    this.messageHistoryOrder = [];
    this.congestionFactor = 1;
    this.rejectedForBackpressure = 0;
  }
}
