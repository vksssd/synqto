// ─── Stream-Scoped Ordering Buffer & Gap Recovery Engine ───
// Guarantees monotonic sequence ordering per (streamId, senderPeerId) with gap repair.

import { PeerId } from '../types/identifiers';
import { NetworkPacket, GapRepairPayload } from './packet';

export interface StreamKey {
  streamId: string;
  senderPeerId: PeerId;
}

export function toStreamKey(streamId: string, senderPeerId: PeerId): string {
  return `${streamId}:${senderPeerId}`;
}

interface StreamState {
  expectedSeq: number;
  holdingQueue: Map<number, NetworkPacket>;
  gapTimer: any;
  gapDetectedAt: number;
  lastDeliveredAt: number;
}

export class OrderingBuffer {
  private streams: Map<string, StreamState> = new Map();
  private readonly GAP_TIMEOUT_MS = 30000;
  private readonly GAP_SKIP_TIMEOUT_MS = 45000;
  private readonly MAX_GAP_REQUEST = 64;

  /**
   * Ingests packet into ordering buffer.
   * If packet matches expected sequence, delivers immediately and drains consecutive queue.
   * If packet is out of order (packet.seq > expectedSeq), buffers and triggers gap repair.
   * If packet has no streamId/seq, bypasses buffer and delivers immediately.
   */
  public inflow(
    packet: NetworkPacket,
    onDeliver: (packet: NetworkPacket) => void,
    onGapDetected?: (repair: GapRepairPayload) => void
  ): void {
    if (!packet.streamId || typeof packet.seq !== 'number') {
      // Unordered or ephemeral packet -> deliver immediately
      onDeliver(packet);
      return;
    }

    const key = toStreamKey(packet.streamId, packet.from.peerId);
    let state = this.streams.get(key);

    if (!state) {
      // First packet seen for this stream - streams start with expectedSeq = 1
      state = {
        expectedSeq: 1,
        holdingQueue: new Map(),
        gapTimer: null,
        gapDetectedAt: 0,
        lastDeliveredAt: Date.now(),
      };
      this.streams.set(key, state);
    }

    // 1. In-order packet arrival
    if (packet.seq === state.expectedSeq) {
      if (state.gapTimer) {
        clearTimeout(state.gapTimer);
        state.gapTimer = null;
      }
      state.gapDetectedAt = 0;

      onDeliver(packet);
      state.expectedSeq++;
      state.lastDeliveredAt = Date.now();

      // Drain all consecutive queued packets
      while (state.holdingQueue.has(state.expectedSeq)) {
        const nextPkt = state.holdingQueue.get(state.expectedSeq)!;
        state.holdingQueue.delete(state.expectedSeq);
        onDeliver(nextPkt);
        state.expectedSeq++;
      }
      return;
    }

    // 2. Duplicate / stale sequence arrival (seq < expectedSeq)
    if (packet.seq < state.expectedSeq) {
      // Drop duplicate without redelivery
      return;
    }

    // 3. Out-of-order packet arrival (seq > expectedSeq)
    state.holdingQueue.set(packet.seq, packet);

    if (!state.gapTimer) {
      state.gapDetectedAt = typeof packet.timestamp === 'number' ? packet.timestamp : Date.now();
      const missingStart = state.expectedSeq;
      const missingEnd = Math.min(packet.seq - 1, state.expectedSeq + this.MAX_GAP_REQUEST);

      // Emit immediate selective gap repair NACK
      if (onGapDetected) {
        onGapDetected({
          streamId: packet.streamId,
          fromPeerId: packet.from.peerId,
          missingRangeStart: missingStart,
          missingRangeEnd: missingEnd,
        });
      }

      state.gapTimer = setTimeout(() => {
        if (!state) return;
        state.gapTimer = null;

        // Gap recovery expired: advance expectedSeq to lowest queued packet to avoid permanent stall
        const queuedSeqs = Array.from(state.holdingQueue.keys()).sort((a, b) => a - b);
        if (queuedSeqs.length > 0) {
          const nextAvailable = queuedSeqs[0];
          state.expectedSeq = nextAvailable;

          while (state.holdingQueue.has(state.expectedSeq)) {
            const nextPkt = state.holdingQueue.get(state.expectedSeq)!;
            state.holdingQueue.delete(state.expectedSeq);
            onDeliver(nextPkt);
            state.expectedSeq++;
          }
        }
      }, this.GAP_TIMEOUT_MS);
    }
  }

  /**
   * Advances simulated time to drain expired gap timeouts in simulation harnesses.
   */
  public step(simulatedNow: number, onDeliver: (packet: NetworkPacket) => void): void {
    this.streams.forEach((state) => {
      if (state.holdingQueue.size > 0 && state.gapDetectedAt > 0) {
        if (simulatedNow - state.gapDetectedAt >= this.GAP_TIMEOUT_MS) {
          if (state.gapTimer) {
            clearTimeout(state.gapTimer);
            state.gapTimer = null;
          }
          state.gapDetectedAt = 0;

          const queuedSeqs = Array.from(state.holdingQueue.keys()).sort((a, b) => a - b);
          if (queuedSeqs.length > 0) {
            const nextAvailable = queuedSeqs[0];
            state.expectedSeq = nextAvailable;

            while (state.holdingQueue.has(state.expectedSeq)) {
              const nextPkt = state.holdingQueue.get(state.expectedSeq)!;
              state.holdingQueue.delete(state.expectedSeq);
              onDeliver(nextPkt);
              state.expectedSeq++;
            }
          }
        }
      }
    });
  }

  public getExpectedSeq(streamId: string, senderPeerId: PeerId): number | undefined {
    const key = toStreamKey(streamId, senderPeerId);
    return this.streams.get(key)?.expectedSeq;
  }

  public hasPending(): boolean {
    for (const state of this.streams.values()) {
      if (state.holdingQueue.size > 0) return true;
    }
    return false;
  }

  public clear(): void {
    this.streams.forEach((state) => {
      if (state.gapTimer) clearTimeout(state.gapTimer);
    });
    this.streams.clear();
  }
}
