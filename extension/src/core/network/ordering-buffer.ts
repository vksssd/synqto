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
  gapTimer: ReturnType<typeof setTimeout> | null;
  gapDetectedAt: number;
  lastDeliveredAt: number;
}

export class OrderingBuffer {
  private streams: Map<string, StreamState> = new Map();
  private readonly GAP_TIMEOUT_MS = 30000;
  private readonly GAP_SKIP_TIMEOUT_MS = 45000;
  private readonly MAX_GAP_REQUEST = 64;

  /**
   * Per-(stream, peer) cap on out-of-order packets held awaiting repair.
   *
   * Set to the repair window because that is the largest gap a single NACK can ask to be
   * filled: holding more than MAX_GAP_REQUEST packets means waiting for a repair that this
   * buffer never requested and will never receive.
   */
  private readonly MAX_HOLDING_QUEUE = 64;

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
      if (state.gapTimer !== null) {
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
    //
    // The holding queue is bounded. It previously was not, and both the gap and the flood
    // that fills it are chosen by the remote peer: send seq=1, withhold seq=2, then transmit
    // seq=3..N with large payloads, and the receiver buffers every one of them for up to the
    // 45s skip window. MAX_GAP_REQUEST bounded the repair REQUEST, not the memory.
    //
    // The cap is the repair window itself, because beyond it the stream is already
    // unrecoverable in one round trip: a gap wider than MAX_GAP_REQUEST cannot be repaired by
    // the NACK this buffer emits, so continuing to accumulate is holding memory for a repair
    // that cannot arrive. When it overflows, collapse to the earliest queued packet
    // immediately rather than waiting out the timer — the outcome is identical and the wait
    // buys nothing but a larger footprint.
    if (state.holdingQueue.size >= this.MAX_HOLDING_QUEUE) {
      this.collapseGap(state, onDeliver);
      // Re-evaluate: after collapsing, this packet may now be exactly what is expected.
      if (packet.seq === state.expectedSeq) {
        onDeliver(packet);
        state.expectedSeq++;
        while (state.holdingQueue.has(state.expectedSeq)) {
          const nextPkt = state.holdingQueue.get(state.expectedSeq)!;
          state.holdingQueue.delete(state.expectedSeq);
          onDeliver(nextPkt);
          state.expectedSeq++;
        }
        return;
      }
      if (packet.seq < state.expectedSeq) return; // superseded by the collapse
    }

    state.holdingQueue.set(packet.seq, packet);

    if (state.gapTimer === null) {
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
        // Gap recovery expired: give up on the missing range rather than stall forever.
        this.collapseGap(state, onDeliver);
      }, this.GAP_TIMEOUT_MS);
    }
  }

  /**
   * Abandons an unrepairable gap: jumps expectedSeq forward to the earliest packet actually
   * held, then drains everything contiguous from there.
   *
   * Shared by the gap timer and the overflow guard so the two cannot diverge. It was
   * previously inline in the timer only, which is why the overflow case had no way to
   * release memory except by waiting for that timer.
   *
   * This deliberately DELIVERS the buffered packets rather than discarding them. The
   * alternative — dropping everything past the gap — would turn one lost packet into an
   * arbitrarily long silence on that stream. Skipping forward means the application sees a
   * hole, which the replication layer's causal buffering is built to detect and repair, and
   * which is strictly more recoverable than data that was never handed up at all.
   */
  private collapseGap(state: StreamState, onDeliver: (packet: NetworkPacket) => void): void {
    if (state.holdingQueue.size === 0) return;

    let lowest = Infinity;
    for (const seq of state.holdingQueue.keys()) {
      if (seq < lowest) lowest = seq;
    }
    if (!Number.isFinite(lowest)) return;

    state.expectedSeq = lowest;
    while (state.holdingQueue.has(state.expectedSeq)) {
      const nextPkt = state.holdingQueue.get(state.expectedSeq)!;
      state.holdingQueue.delete(state.expectedSeq);
      onDeliver(nextPkt);
      state.expectedSeq++;
    }
  }

  /**
   * Advances simulated time to drain expired gap timeouts in simulation harnesses.
   */
  public step(simulatedNow: number, onDeliver: (packet: NetworkPacket) => void): void {
    this.streams.forEach((state) => {
      if (state.holdingQueue.size > 0 && state.gapDetectedAt > 0) {
        if (simulatedNow - state.gapDetectedAt >= this.GAP_TIMEOUT_MS) {
          if (state.gapTimer !== null) {
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
      if (state.gapTimer !== null) clearTimeout(state.gapTimer);
    });
    this.streams.clear();
  }
}
