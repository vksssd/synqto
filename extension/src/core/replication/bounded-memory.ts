// ─── Bounded Memory & Log Compaction Engine ───
// Manages memory safety, stable cut vector computation, checkpointing,
// and log truncation for distributed replicated state.

import { PeerId } from '../types/identifiers';
import {
  VectorClock,
  createVectorClock,
  minVectorClocks,
  dominates,
} from './vector-clock';
import { OperationJournal, ReplicatedSnapshot } from './operation-journal';
import { PayloadChunker } from '../network/chunker';

export interface BoundedMemoryConfig {
  maxJournalEvents?: number;
  checkpointIntervalOps?: number;
  maxSnapshotBytes?: number;
  minRetentionEvents?: number;
}

export class BoundedMemoryManager<TState = unknown, TOp = unknown> {
  public readonly maxJournalEvents: number;
  public readonly checkpointIntervalOps: number;
  public readonly maxSnapshotBytes: number;
  public readonly minRetentionEvents: number;

  private stableCutVector: VectorClock = createVectorClock();
  private snapshotVersion = 0;
  private opsSinceLastCheckpoint = 0;

  constructor(
    public readonly storeId: string,
    private readonly journal: OperationJournal<TState, TOp>,
    config: BoundedMemoryConfig = {}
  ) {
    this.maxJournalEvents = config.maxJournalEvents ?? 500;
    this.checkpointIntervalOps = config.checkpointIntervalOps ?? 250;
    this.maxSnapshotBytes = config.maxSnapshotBytes ?? 4 * 1024 * 1024; // 4 MB
    this.minRetentionEvents = config.minRetentionEvents ?? 50;
  }

  /**
   * Tracks newly appended/applied operation count and evaluates whether compaction should trigger.
   */
  public recordOperation(): void {
    this.opsSinceLastCheckpoint++;
  }

  /**
   * Evaluates and executes log compaction:
   * 1. Check if journal exceeds capacity threshold or checkpoint interval.
   * 2. Compute stableCutVector across active replication participants.
   * 3. Materialize and CRC32-checksum state snapshot.
   * 4. Truncate stable prefix from the live journal, retaining bounded active tail.
   */
  public maybeCompact(
    reducer: (state: TState, op: TOp, event: any) => TState,
    initialState: TState,
    peerVectors: VectorClock[] = [],
    activePeers?: PeerId[],
    force = false
  ): ReplicatedSnapshot<TState> | null {
    const eventCount = this.journal.getEventCount();
    const shouldCompact =
      force ||
      eventCount >= this.maxJournalEvents ||
      this.opsSinceLastCheckpoint >= this.checkpointIntervalOps;

    if (!shouldCompact || eventCount <= this.minRetentionEvents) {
      return null;
    }

    // 1. Calculate stableCutVector
    let cutVector: VectorClock;
    if (eventCount >= this.maxJournalEvents) {
      // Hard memory bound exceeded -> Force tail cut to strictly bound memory
      cutVector = this.computeTailCut();
    } else if (activePeers && activePeers.length > 0 && peerVectors.length >= activePeers.length) {
      // Stability frontier: minimum vector clock across all active replication peers
      const minFrontier = minVectorClocks(peerVectors, activePeers);
      cutVector = Object.keys(minFrontier).length > 0 ? minFrontier : this.computeTailCut();
    } else {
      cutVector = this.computeTailCut();
    }

    if (Object.keys(cutVector).length === 0) {
      return null;
    }

    // 2. Materialize state strictly up to contiguous vector clock
    const contiguousVector = this.journal.getContiguousVectorClock();
    const currentState = this.journal.reduceState(reducer, initialState, contiguousVector);
    const serializedState = JSON.stringify(currentState);
    const byteLength = new TextEncoder().encode(serializedState).length;

    if (byteLength > this.maxSnapshotBytes) {
      console.warn(
        `[BoundedMemoryManager] Snapshot size (${byteLength} B) exceeds ceiling (${this.maxSnapshotBytes} B) for store ${this.storeId}`
      );
    }

    const checksum = PayloadChunker.calculateCRC32(serializedState);
    this.snapshotVersion++;

    // 3. Construct snapshot containing state strictly up to contiguous journal vector clock
    const snapshot: ReplicatedSnapshot<TState> = {
      storeId: this.storeId,
      snapshotVersion: this.snapshotVersion,
      vector: contiguousVector,
      state: JSON.parse(serializedState),
      checksum,
      byteLength,
      timestamp: Date.now(),
    };

    // 4. Update snapshot and truncate live journal strictly up to cutVector (preserving live tail)
    this.journal.setSnapshot(snapshot);
    this.stableCutVector = { ...cutVector };
    const pruned = this.journal.truncateBefore(this.stableCutVector);

    this.opsSinceLastCheckpoint = 0;
    return snapshot;
  }

  /**
   * Computes a tail cut vector that retains minRetentionEvents in the active journal tail.
   */
  private computeTailCut(): VectorClock {
    const events = this.journal.getEvents();
    const cutIdx = events.length - this.minRetentionEvents - 1;
    if (cutIdx < 0) return createVectorClock();

    const cutVector = createVectorClock();
    for (let i = 0; i <= cutIdx; i++) {
      const evt = events[i];
      cutVector[evt.author] = Math.max(cutVector[evt.author] || 0, evt.seq);
    }
    return cutVector;
  }

  /**
   * Evaluates if a remote peer's version vector is behind the stable cut.
   * If true, the remote peer cannot be caught up via incremental deltas and requires a full snapshot.
   */
  public isBehindStableCut(remoteVector: VectorClock): boolean {
    if (Object.keys(this.stableCutVector).length === 0) {
      return false; // No compaction has occurred yet
    }
    return !dominates(remoteVector, this.stableCutVector);
  }

  public getStableCutVector(): VectorClock {
    return { ...this.stableCutVector };
  }

  public setStableCutVector(vector: VectorClock): void {
    this.stableCutVector = { ...vector };
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion;
  }

  public clear(): void {
    this.stableCutVector = createVectorClock();
    this.snapshotVersion = 0;
    this.opsSinceLastCheckpoint = 0;
  }
}
