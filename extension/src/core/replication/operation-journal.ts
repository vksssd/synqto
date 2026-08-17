// ─── Durable Append-Only Operation Journal ───
// Pure local storage and materialization engine for replicated state operations.
// Zero networking awareness: handles ordering, deduplication, replay, reduction, and delta extraction.

import { OperationId, PeerId } from '../types/identifiers';
import {
  VectorClock,
  createVectorClock,
  incrementVectorClock,
  mergeVectorClocks,
  generateOperationId,
  parseOperationId,
  dominates,
} from './vector-clock';

export interface ReplicatedEvent<TOp = unknown> {
  storeId: string;
  opId: OperationId;
  author: PeerId;
  seq: number;
  lamport: number;
  dependencies: OperationId[];
  type: string;
  op: TOp;
  timestamp: number;
  topologyEpoch?: number;
}

export interface ReplicatedSnapshot<TState = unknown> {
  storeId: string;
  snapshotVersion: number;
  vector: VectorClock;
  state: TState;
  checksum: number;
  byteLength: number;
  timestamp: number;
}

export class OperationJournal<TState = unknown, TOp = unknown> {
  private events: ReplicatedEvent<TOp>[] = [];
  private seenOpIds: Set<OperationId> = new Set();
  private opIndex: Map<OperationId, ReplicatedEvent<TOp>> = new Map();
  private vectorClock: VectorClock = createVectorClock();
  private latestSnapshot: ReplicatedSnapshot<TState> | null = null;
  private snapshotIncorporatedOpIds: Set<OperationId> = new Set();

  private localSeq = 0;
  private localLamport = 0;

  constructor(
    public readonly storeId: string,
    public readonly localAuthorId: PeerId
  ) {}

  /**
   * Appends a newly generated local operation to the journal.
   * Increments local sequence, Lamport time, and vector clock.
   */
  public appendLocal(
    type: string,
    op: TOp,
    dependencies: OperationId[] = [],
    topologyEpoch?: number
  ): ReplicatedEvent<TOp> {
    this.localSeq += 1;
    this.localLamport += 1;
    this.vectorClock = incrementVectorClock(this.vectorClock, this.localAuthorId);

    const opId = generateOperationId(this.localAuthorId, this.localSeq, this.localLamport);
    const event: ReplicatedEvent<TOp> = {
      storeId: this.storeId,
      opId,
      author: this.localAuthorId,
      seq: this.localSeq,
      lamport: this.localLamport,
      dependencies: [...dependencies],
      type,
      op,
      timestamp: Date.now(),
      topologyEpoch,
    };

    this.insertSorted(event);
    return event;
  }

  /**
   * Inserts a remote replicated event into the journal in deterministic total order.
   * Total ordering criteria: (lamport ASC, author ASC, seq ASC).
   * Returns true if event is NEW, false if DUPLICATE.
   */
  public applyRemote(event: ReplicatedEvent<TOp>): boolean {
    if (this.hasOp(event.opId)) {
      return false; // Duplicate
    }

    // Advance local Lamport clock beyond remote
    this.localLamport = Math.max(this.localLamport, event.lamport) + 1;
    this.vectorClock = mergeVectorClocks(this.vectorClock, { [event.author]: event.seq });

    this.insertSorted(event);
    return true;
  }

  /**
   * Deterministically inserts event into the sorted events list.
   */
  private insertSorted(event: ReplicatedEvent<TOp>): void {
    this.seenOpIds.add(event.opId);
    this.opIndex.set(event.opId, event);

    let idx = this.events.length;
    while (idx > 0) {
      const prev = this.events[idx - 1];
      if (
        prev.lamport < event.lamport ||
        (prev.lamport === event.lamport && prev.author < event.author) ||
        (prev.lamport === event.lamport && prev.author === event.author && prev.seq <= event.seq)
      ) {
        break;
      }
      idx--;
    }

    this.events.splice(idx, 0, event);
  }

  /**
   * Checks if an operation has been seen or incorporated into the base snapshot.
   */
  public hasOp(opId: OperationId): boolean {
    return this.seenOpIds.has(opId) || this.snapshotIncorporatedOpIds.has(opId);
  }

  /**
   * Retrieves an operation by ID if present in the active live journal.
   */
  public getOp(opId: OperationId): ReplicatedEvent<TOp> | undefined {
    return this.opIndex.get(opId);
  }

  /**
   * Verifies if all causal dependencies of an operation are satisfied.
   * A dependency is satisfied if it is in seenOpIds, snapshotIncorporatedOpIds,
   * or dominated by the latest snapshot vector clock.
   */
  public areDependenciesSatisfied(dependencies: OperationId[]): boolean {
    for (const dep of dependencies) {
      if (this.hasOp(dep)) {
        continue;
      }
      if (this.latestSnapshot) {
        const parsed = parseOperationId(dep);
        if (parsed) {
          const snapshotSeq = this.latestSnapshot.vector[parsed.author] || 0;
          if (parsed.seq <= snapshotSeq) {
            continue;
          }
        }
      }
      return false;
    }
    return true;
  }

  /**
   * Materializes application state by executing reducer over (Latest Snapshot + Remaining Events).
   * If boundaryVector is provided, limits reduction strictly up to boundaryVector.
   */
  public reduceState(
    reducer: (state: TState, op: TOp, event: ReplicatedEvent<TOp>) => TState,
    initialState: TState,
    boundaryVector?: VectorClock
  ): TState {
    let current: TState = this.latestSnapshot
      ? JSON.parse(JSON.stringify(this.latestSnapshot.state))
      : JSON.parse(JSON.stringify(initialState));

    let relevantEvents = this.latestSnapshot
      ? this.events.filter((e) => e.seq > (this.latestSnapshot!.vector[e.author] || 0))
      : this.events;

    if (boundaryVector) {
      relevantEvents = relevantEvents.filter(
        (e) => e.seq <= (boundaryVector[e.author] || 0)
      );
    }

    for (const evt of relevantEvents) {
      current = reducer(current, evt.op, evt);
    }
    return current;
  }

  /**
   * Computes the contiguous vector clock (highest sequence number for each author
   * for which ALL preceding sequence numbers are present without gaps).
   */
  public getContiguousVectorClock(): VectorClock {
    const contiguous: VectorClock = this.latestSnapshot
      ? { ...this.latestSnapshot.vector }
      : {};

    const authorSequences = new Map<PeerId, Set<number>>();
    for (const evt of this.events) {
      if (!authorSequences.has(evt.author)) {
        authorSequences.set(evt.author, new Set());
      }
      authorSequences.get(evt.author)!.add(evt.seq);
    }

    for (const [author, seqs] of authorSequences.entries()) {
      let current = contiguous[author] || 0;
      while (seqs.has(current + 1)) {
        current += 1;
      }
      contiguous[author] = current;
    }

    return contiguous;
  }

  /**
   * Extracts missing delta events that a remote peer has not yet seen based on their vector clock.
   */
  public getDeltasSince(remoteVector: VectorClock): ReplicatedEvent<TOp>[] {
    return this.events.filter((evt) => {
      const remoteSeenSeq = remoteVector[evt.author] || 0;
      return evt.seq > remoteSeenSeq;
    });
  }

  /**
   * Sets a newly received or created baseline snapshot.
   */
  public setSnapshot(snapshot: ReplicatedSnapshot<TState>): void {
    this.latestSnapshot = JSON.parse(JSON.stringify(snapshot));
    this.vectorClock = mergeVectorClocks(this.vectorClock, snapshot.vector);
    this.snapshotIncorporatedOpIds.clear();
    
    // Mark snapshot vector as incorporated
    for (const [author, seq] of Object.entries(snapshot.vector)) {
      this.localSeq = Math.max(this.localSeq, author === this.localAuthorId ? seq : 0);
    }
  }

  /**
   * Truncates events older than a stable cut vector, reclaiming memory while preserving replayability.
   * Returns the count of truncated operations.
   */
  public truncateBefore(stableCutVector: VectorClock): number {
    const retained: ReplicatedEvent<TOp>[] = [];
    let prunedCount = 0;

    for (const evt of this.events) {
      const cutSeq = stableCutVector[evt.author] || 0;
      if (evt.seq <= cutSeq) {
        prunedCount++;
        this.seenOpIds.delete(evt.opId);
        this.opIndex.delete(evt.opId);
      } else {
        retained.push(evt);
      }
    }

    this.events = retained;
    return prunedCount;
  }

  public getVectorClock(): VectorClock {
    return { ...this.vectorClock };
  }

  public getLatestSnapshot(): ReplicatedSnapshot<TState> | null {
    return this.latestSnapshot;
  }

  public getEventCount(): number {
    return this.events.length;
  }

  public getEvents(): readonly ReplicatedEvent<TOp>[] {
    return this.events;
  }

  public getLocalLamport(): number {
    return this.localLamport;
  }

  public clear(): void {
    this.events = [];
    this.seenOpIds.clear();
    this.opIndex.clear();
    this.snapshotIncorporatedOpIds.clear();
    this.vectorClock = createVectorClock();
    this.latestSnapshot = null;
    this.localSeq = 0;
    this.localLamport = 0;
  }
}
