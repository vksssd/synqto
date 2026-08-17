// ─── Replicated Append-Only Event Log & Anti-Entropy Synchronization ───

import { OperationId, PeerId, RoomId } from '../types/identifiers';
import {
  VectorClock,
  createVectorClock,
  incrementVectorClock,
  mergeVectorClocks,
  generateOperationId,
} from './vector-clock';

export interface ReplicatedEvent<TOp = unknown> {
  opId: OperationId;
  author: PeerId;
  seq: number;
  lamport: number;
  timestamp: number;
  type: string;
  op: TOp;
}

export interface ReplicatedSnapshot<TState = unknown> {
  snapshotVersion: number;
  vector: VectorClock;
  state: TState;
  timestamp: number;
}

export class ReplicatedEventLog<TState = unknown, TOp = unknown> {
  private events: ReplicatedEvent<TOp>[] = [];
  private seenOpIds: Set<OperationId> = new Set();
  private vectorClock: VectorClock = createVectorClock();
  private latestSnapshot: ReplicatedSnapshot<TState> | null = null;

  private localSeq = 0;
  private localLamport = 0;

  constructor(private readonly authorId: PeerId, private readonly roomId: RoomId) {}

  /**
   * Appends a local operation to the replicated log and stamps it with sequence & Lamport clock
   */
  public appendLocal(type: string, op: TOp): ReplicatedEvent<TOp> {
    this.localSeq += 1;
    this.localLamport += 1;
    this.vectorClock = incrementVectorClock(this.vectorClock, this.authorId);

    const opId = generateOperationId(this.authorId, this.localSeq, this.localLamport);
    const event: ReplicatedEvent<TOp> = {
      opId,
      author: this.authorId,
      seq: this.localSeq,
      lamport: this.localLamport,
      timestamp: Date.now(),
      type,
      op,
    };

    this.insertEventSorted(event);
    return event;
  }

  /**
   * Inserts a remote replicated event into the log in deterministic order
   * Returns true if event is NEW, false if DUPLICATE
   */
  public applyRemote(event: ReplicatedEvent<TOp>): boolean {
    if (this.seenOpIds.has(event.opId)) {
      return false; // Duplicate
    }

    // Advance local Lamport clock beyond remote
    this.localLamport = Math.max(this.localLamport, event.lamport) + 1;
    this.vectorClock = mergeVectorClocks(this.vectorClock, { [event.author]: event.seq });

    this.insertEventSorted(event);
    return true;
  }

  private insertEventSorted(event: ReplicatedEvent<TOp>): void {
    this.seenOpIds.add(event.opId);

    // Insert sorted by: (lamport ascending, author lexicographical, seq ascending)
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
   * Reduces the entire log from snapshot/initial state into materialized current state
   */
  public reduceState(
    reducer: (state: TState, op: TOp, event: ReplicatedEvent<TOp>) => TState,
    initialState: TState
  ): TState {
    let current = this.latestSnapshot ? this.latestSnapshot.state : initialState;
    const startIdx = this.latestSnapshot
      ? this.events.findIndex((e) => e.timestamp > this.latestSnapshot!.timestamp)
      : 0;

    const relevantEvents = startIdx >= 0 ? this.events.slice(startIdx) : this.events;
    for (const evt of relevantEvents) {
      current = reducer(current, evt.op, evt);
    }
    return current;
  }

  /**
   * Takes a compacted snapshot and truncates old history to reclaim memory
   */
  public takeSnapshot(
    reducer: (state: TState, op: TOp, event: ReplicatedEvent<TOp>) => TState,
    initialState: TState,
    maxKeepEvents = 200
  ): ReplicatedSnapshot<TState> {
    const currentState = this.reduceState(reducer, initialState);
    const snapshot: ReplicatedSnapshot<TState> = {
      snapshotVersion: (this.latestSnapshot?.snapshotVersion || 0) + 1,
      vector: { ...this.vectorClock },
      state: currentState,
      timestamp: Date.now(),
    };

    this.latestSnapshot = snapshot;

    // Prune events older than snapshot if log exceeds threshold
    if (this.events.length > maxKeepEvents) {
      const keep = this.events.slice(-maxKeepEvents);
      this.events = keep;
      this.seenOpIds = new Set(keep.map((e) => e.opId));
    }

    return snapshot;
  }

  public getDigest(): VectorClock {
    return { ...this.vectorClock };
  }

  /**
   * Computes missing delta events for a peer requesting anti-entropy reconciliation
   */
  public getMissingEvents(remoteVector: VectorClock): ReplicatedEvent<TOp>[] {
    return this.events.filter((evt) => {
      const remoteSeenSeq = remoteVector[evt.author] || 0;
      return evt.seq > remoteSeenSeq;
    });
  }

  public getEvents(): readonly ReplicatedEvent<TOp>[] {
    return this.events;
  }

  public clear(): void {
    this.events = [];
    this.seenOpIds.clear();
    this.vectorClock = createVectorClock();
    this.latestSnapshot = null;
    this.localSeq = 0;
    this.localLamport = 0;
  }
}
