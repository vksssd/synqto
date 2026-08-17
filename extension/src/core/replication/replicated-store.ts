// ─── Generic Replicated Store Container ───
// Universal distributed state container unifying OperationJournal, CausalSyncEngine,
// BoundedMemoryManager, and SnapshotTransferManager with the PacketPipeline and StorageAdapter.

import { OperationId, PeerId } from '../types/identifiers';
import {
  createPacket,
  NetworkPacket,
  PeerIdentity,
  StateOpPayload,
  StateSyncRequestPayload,
  StateSyncResponsePayload,
  StateSnapshotRequestPayload,
  StateSnapshotPayload,
} from '../network/packet';
import { PacketPipeline } from '../network/packet-pipeline';
import { OperationJournal, ReplicatedEvent, ReplicatedSnapshot } from './operation-journal';
import { CausalSyncEngine } from './causal-sync-engine';
import { BoundedMemoryConfig, BoundedMemoryManager } from './bounded-memory';
import { SnapshotTransferManager } from './snapshot-transfer';
import { VectorClock, dominates } from './vector-clock';
import { IStorageAdapter, InMemoryStorageAdapter } from './storage-adapter';
import { DeliveryContext, ReplicationValidator } from './validation';

export type StateReducer<TState, TOp> = (
  state: TState,
  op: TOp,
  event: ReplicatedEvent<TOp>
) => TState;

export class ReplicatedStore<TState = unknown, TOp = unknown> {
  private readonly journal: OperationJournal<TState, TOp>;
  private readonly syncEngine: CausalSyncEngine<TState, TOp>;
  private readonly memoryManager: BoundedMemoryManager<TState, TOp>;
  private readonly snapshotTransfer: SnapshotTransferManager<TState, TOp>;
  private readonly storage: IStorageAdapter<TState, TOp>;

  private currentState: TState;
  private listeners: Set<(state: TState, event?: ReplicatedEvent<TOp>) => void> = new Set();
  private activeParticipants: Set<PeerId> = new Set();
  /** FIFO serialization queue for storage-side compaction transactions (see enqueueCompactionTransaction). */
  private compactionQueue: Promise<void> = Promise.resolve();

  constructor(
    public readonly storeId: string,
    public readonly localIdentity: PeerIdentity,
    public readonly roomId: string,
    private readonly reducer: StateReducer<TState, TOp>,
    private readonly initialState: TState,
    private readonly pipeline: PacketPipeline,
    config: BoundedMemoryConfig = {},
    storageAdapter?: IStorageAdapter<TState, TOp>
  ) {
    this.storage = storageAdapter ?? new InMemoryStorageAdapter<TState, TOp>(storeId);
    this.journal = new OperationJournal<TState, TOp>(storeId, localIdentity.peerId);
    this.memoryManager = new BoundedMemoryManager<TState, TOp>(storeId, this.journal, config);

    this.syncEngine = new CausalSyncEngine<TState, TOp>(
      storeId,
      localIdentity.peerId,
      this.journal,
      {
        onEmitSyncRequest: (req, target) => this.sendSyncRequest(req, target),
        onRequireSnapshot: (sId, target) => this.requestSnapshot(target),
        onOperationApplied: (evt: ReplicatedEvent<TOp>) => {
          this.currentState = this.journal.reduceState(this.reducer, this.initialState);
          this.notifyListeners(evt);
          this.storage.appendJournalEvent(evt).catch(() => {});
          this.memoryManager.recordOperation();
          this.checkCompaction();
        },
      }
    );

    this.snapshotTransfer = new SnapshotTransferManager<TState, TOp>(
      storeId,
      localIdentity.peerId,
      roomId,
      this.journal,
      this.memoryManager,
      this.pipeline,
      {
        onSnapshotInstalled: (snap, matState) => {
          this.currentState = matState;
          this.notifyListeners();
          this.storage.saveSnapshot(snap).then(() => {
            return this.storage.commitSnapshot(snap.snapshotVersion);
          }).catch(() => {});
        },
      }
    );

    this.currentState = initialState;
  }

  /**
   * Generates and commits a local mutation synchronously, persisting asynchronously to storage.
   */
  public mutate(
    type: string,
    op: TOp,
    explicitDependencies?: OperationId[],
    topologyEpoch?: number
  ): ReplicatedEvent<TOp> {
    // 1. Gather causal dependencies
    const deps: OperationId[] = explicitDependencies || [];

    // 2. Append to local journal
    const event = this.journal.appendLocal(type, op, deps, topologyEpoch);
    this.memoryManager.recordOperation();

    // 3. Persist to storage
    this.storage.appendJournalEvent(event).catch(() => {});

    // 4. Materialize updated state
    this.currentState = this.journal.reduceState(this.reducer, this.initialState);
    this.notifyListeners(event);

    // 5. Broadcast state:op packet to cluster
    const payload: StateOpPayload<TOp> = {
      storeId: this.storeId,
      opId: event.opId,
      author: event.author,
      seq: event.seq,
      lamport: event.lamport,
      dependencies: event.dependencies,
      type: event.type,
      op: event.op,
      timestamp: event.timestamp,
      topologyEpoch: event.topologyEpoch,
      // Piggyback our contiguous frontier so peers can compute a real stable cut
      // without waiting for an explicit anti-entropy round.
      senderVector: this.journal.getContiguousVectorClock(),
    };

    const packet = createPacket(
      'state:op',
      this.localIdentity,
      this.roomId,
      payload,
      undefined,
      { priority: 'SYNC', topologyEpoch }
    );

    this.pipeline.sendPacket(packet, undefined, { isReliable: true }).catch((err) => {
      console.error(`[ReplicatedStore:${this.storeId}] Broadcast failed for op ${event.opId}`, err);
    });

    this.checkCompaction();
    return event;
  }

  /**
   * Transactional asynchronous mutation enforcing strict storage persistence BEFORE network broadcast.
   */
  public async mutateAsync(
    type: string,
    op: TOp,
    explicitDependencies?: OperationId[],
    topologyEpoch?: number
  ): Promise<ReplicatedEvent<TOp>> {
    const deps: OperationId[] = explicitDependencies || [];

    // 1. Append to local in-memory journal
    const event = this.journal.appendLocal(type, op, deps, topologyEpoch);
    this.memoryManager.recordOperation();

    // 2. Persist to storage BEFORE network transmission (Durability Invariant)
    await this.storage.appendJournalEvent(event);

    // 3. Materialize updated state
    this.currentState = this.journal.reduceState(this.reducer, this.initialState);
    this.notifyListeners(event);

    // 4. Broadcast state:op packet to cluster
    const payload: StateOpPayload<TOp> = {
      storeId: this.storeId,
      opId: event.opId,
      author: event.author,
      seq: event.seq,
      lamport: event.lamport,
      dependencies: event.dependencies,
      type: event.type,
      op: event.op,
      timestamp: event.timestamp,
      topologyEpoch: event.topologyEpoch,
      // Piggyback our contiguous frontier so peers can compute a real stable cut
      // without waiting for an explicit anti-entropy round.
      senderVector: this.journal.getContiguousVectorClock(),
    };

    const packet = createPacket(
      'state:op',
      this.localIdentity,
      this.roomId,
      payload,
      undefined,
      { priority: 'SYNC', topologyEpoch }
    );

    await this.pipeline.sendPacket(packet, undefined, { isReliable: true });
    await this.compactAsync(false);
    return event;
  }

  /**
   * Handles incoming network packets dispatched from PacketPipeline.
   */
  public handleIncomingPacket(packet: NetworkPacket): boolean {
    if (!packet.type.startsWith('state:')) return false;

    switch (packet.type) {
      case 'state:op': {
        const payload = packet.payload as StateOpPayload<TOp>;
        if (payload.storeId !== this.storeId) return false;

        this.activeParticipants.add(packet.from.peerId);
        // Learn the broadcaster's frontier from ordinary traffic. This is what makes
        // the stable-cut consensus in BoundedMemoryManager actually reachable during
        // normal operation rather than only after an explicit sync exchange.
        if (payload.senderVector) {
          this.syncEngine.recordPeerVector(packet.from.peerId, payload.senderVector);
        }
        const event: ReplicatedEvent<TOp> = {
          storeId: payload.storeId,
          opId: payload.opId,
          author: payload.author,
          seq: payload.seq,
          lamport: payload.lamport,
          dependencies: payload.dependencies || [],
          type: payload.type,
          op: payload.op,
          timestamp: payload.timestamp,
          topologyEpoch: payload.topologyEpoch,
        };

        const deliveryContext: DeliveryContext = (packet as any).forwardedBy
          ? { kind: 'forwarded', senderPeerId: packet.from.peerId, authenticatedOrigin: payload.author }
          : { kind: 'direct-origin', senderPeerId: packet.from.peerId };

        const applied = this.syncEngine.ingestOperation(event, deliveryContext);
        if (applied) {
          this.storage.appendJournalEvent(event).catch(() => {});
        }
        return applied;
      }

      case 'state:sync_request': {
        const payload = packet.payload as StateSyncRequestPayload;
        if (payload.storeId !== this.storeId) return false;

        this.activeParticipants.add(packet.from.peerId);
        const isBehindCut = (remoteVec: VectorClock) =>
          this.memoryManager.isBehindStableCut(remoteVec);
        const response = this.syncEngine.handleSyncRequest(payload, isBehindCut);

        if (response.requiresSnapshot) {
          const snapshot = this.getOrComputeTransferSnapshot();
          if (snapshot) {
            this.snapshotTransfer.sendSnapshot(packet.from.peerId, snapshot, this.localIdentity);
          }
        } else {
          this.sendSyncResponse(response, packet.from.peerId);
        }
        return true;
      }

      case 'state:sync_response': {
        const payload = packet.payload as StateSyncResponsePayload<TOp>;
        if (payload.storeId !== this.storeId) return false;

        this.activeParticipants.add(packet.from.peerId);
        if (payload.vectorClock) {
          this.syncEngine.recordPeerVector(packet.from.peerId, payload.vectorClock);
        }
        if (payload.requiresSnapshot) {
          // NOTE: must compare using the CONTIGUOUS vector clock, not the raw merged one.
          // The raw vector clock advances to the max seq seen per author on ANY accepted
          // op (including causally-independent, out-of-order arrivals), so it cannot detect
          // a causal gap (e.g. seq 3 missing while seq 5 already arrived). Using it here would
          // let a peer with such a gap wrongly conclude it "dominates" the responder's vector
          // and skip requesting the snapshot needed to fill the gap, causing permanent
          // non-convergence for the missing operation.
          if (!dominates(this.journal.getContiguousVectorClock(), payload.vectorClock)) {
            this.requestSnapshot(packet.from.peerId);
          }
          return true;
        }

        const appliedEvents = this.syncEngine.handleSyncResponse(payload);
        if (appliedEvents.length > 0) {
          this.currentState = this.journal.reduceState(this.reducer, this.initialState);
          this.notifyListeners();
          this.storage.appendJournalEvents(appliedEvents).catch(() => {});
        }
        return true;
      }

      case 'state:snapshot_request': {
        const payload = packet.payload as StateSnapshotRequestPayload;
        if (payload.storeId !== this.storeId) return false;

        const snapshot = this.getOrComputeTransferSnapshot();
        if (snapshot) {
          this.snapshotTransfer.sendSnapshot(packet.from.peerId, snapshot, this.localIdentity);
        }
        return true;
      }

      case 'state:snapshot_response': {
        const payload = packet.payload as StateSnapshotPayload<TState>;
        if (payload.storeId !== this.storeId) return false;

        return this.snapshotTransfer.installSnapshot(payload, this.reducer, this.initialState);
      }

      default:
        return false;
    }
  }

  /**
   * Triggers anti-entropy sync with a specific peer or broadcasts to active participants.
   */
  public syncWith(targetPeerId?: PeerId): void {
    const syncReq = this.syncEngine.createSyncRequest();
    this.sendSyncRequest(syncReq, targetPeerId);
  }

  private sendSyncRequest(req: StateSyncRequestPayload, targetPeerId?: PeerId): void {
    const packet = createPacket(
      'state:sync_request',
      this.localIdentity,
      this.roomId,
      req,
      targetPeerId,
      { priority: 'SYNC', channelPriority: 'control' }
    );
    this.pipeline.sendPacket(packet, targetPeerId, { isReliable: true }).catch(() => {});
  }

  private sendSyncResponse(resp: StateSyncResponsePayload<TOp>, targetPeerId: PeerId): void {
    const packet = createPacket(
      'state:sync_response',
      this.localIdentity,
      this.roomId,
      resp,
      targetPeerId,
      { priority: 'SYNC', channelPriority: 'bulk' }
    );
    this.pipeline.sendPacket(packet, targetPeerId, { isReliable: true }).catch(() => {});
  }

  private requestSnapshot(targetPeerId: PeerId): void {
    this.snapshotTransfer.requestSnapshot(targetPeerId, this.localIdentity).catch(() => {});
  }

  /**
   * Returns a snapshot suitable for serving to a peer that requested one, forcing a fresh
   * compaction if there is new journal data to fold in, or falling back to the existing
   * baseline snapshot when there is nothing new to compact.
   *
   * BUG THIS FIXES: `compact(true)` (force=true) still returns null whenever the live journal
   * has shrunk to <= minRetentionEvents (the common steady state right after any compaction) —
   * there is simply nothing NEW to fold in. Callers that did `if (snapshot) sendSnapshot(...)`
   * on the RAW compact() result would silently send NOTHING back to a peer that explicitly
   * asked for a snapshot because it detected it was behind the stable cut. With no retry
   * mechanism on the requesting side beyond further anti-entropy rounds (which just repeat the
   * same silently-dropped request), that peer's gap could never be filled — a permanent
   * convergence failure. Falling back to the already-computed `getLatestSnapshot()` fixes this:
   * the previous snapshot is still valid and sufficient to answer the request.
   */
  private getOrComputeTransferSnapshot(): ReplicatedSnapshot<TState> | null {
    return this.compact(true) ?? this.journal.getLatestSnapshot();
  }

  /**
   * Evaluates compaction and checkpoints synchronously if bounds exceeded.
   */
  public compact(force = false): ReplicatedSnapshot<TState> | null {
    const peerVectors = Array.from(this.syncEngine.getPeerVectors().values());
    const activePeers = Array.from(this.activeParticipants);

    const snapshot = this.memoryManager.maybeCompact(
      this.reducer,
      this.initialState,
      peerVectors,
      activePeers,
      force
    );

    if (snapshot) {
      this.enqueueCompactionTransaction(snapshot).catch((err) => {
        console.error(`[ReplicatedStore:${this.storeId}] Compaction transaction failed`, err);
      });
    }

    return snapshot;
  }

  /**
   * Evaluates and executes 5-step transactional compaction asynchronously.
   */
  public async compactAsync(force = false): Promise<ReplicatedSnapshot<TState> | null> {
    const peerVectors = Array.from(this.syncEngine.getPeerVectors().values());
    const activePeers = Array.from(this.activeParticipants);

    const snapshot = this.memoryManager.maybeCompact(
      this.reducer,
      this.initialState,
      peerVectors,
      activePeers,
      force
    );

    if (snapshot) {
      await this.enqueueCompactionTransaction(snapshot);
    }

    return snapshot;
  }

  /**
   * Serializes all storage-side compaction transactions for this store onto a single FIFO
   * queue. Multiple mutate()/mutateAsync() calls in flight can each independently trigger
   * maybeCompact() and produce a NEW snapshot version before the PREVIOUS snapshot's storage
   * transaction has finished; without serialization, an in-flight transaction's step 5
   * (pruneSnapshotsExcept) can race ahead and delete a newer, not-yet-committed snapshot's
   * storage record out from under it, causing step 2 (verify) to spuriously fail. The
   * in-memory journal/materialized state is unaffected either way (maybeCompact() already
   * applied the snapshot synchronously) — this queue protects only the durability path.
   */
  private enqueueCompactionTransaction(snapshot: ReplicatedSnapshot<TState>): Promise<void> {
    const task = this.compactionQueue.then(() => this.commitCompactionTransaction(snapshot));
    // Keep the chain alive even if this transaction fails, so subsequent compactions still run.
    this.compactionQueue = task.catch(() => {});
    return task;
  }

  /**
   * 5-step transactional compaction commit protocol:
   *   1. Persist snapshot V (uncommitted)
   *   2. Verify persistence (readback + integrity check)
   *   3. Write commit marker V (only after verification succeeds)
   *   4. Truncate journal before snapshot.vector
   *   5. Prune all prior snapshot versions from storage
   *
   * If verification fails, the commit marker is NEVER written, so a crash or corruption
   * during persist leaves the previously committed snapshot + journal as the recovery
   * authority (hydrate() ignores any snapshot whose version != committedVersion).
   */
  private async commitCompactionTransaction(snapshot: ReplicatedSnapshot<TState>): Promise<void> {
    // Step 1: Write new snapshot V (uncommitted)
    await this.storage.saveSnapshot(snapshot);

    // Step 2: Verify persistence before committing
    const verified = await this.storage.verifySnapshotIntegrity(snapshot.snapshotVersion);
    if (!verified) {
      console.error(
        `[ReplicatedStore:${this.storeId}] Snapshot v${snapshot.snapshotVersion} failed persistence verification — commit aborted, previous committed baseline remains authoritative`
      );
      return;
    }

    // Step 3: Write commit marker V (this becomes the sole recovery authority)
    await this.storage.commitSnapshot(snapshot.snapshotVersion);

    // Step 4: Truncate journal strictly before snapshot.vector
    await this.storage.truncateJournalBefore(snapshot.vector);

    // Step 5: Prune all prior snapshot versions now that V is committed and journal is truncated
    await this.storage.pruneSnapshotsExcept(snapshot.snapshotVersion);
  }

  /**
   * Hydrates state from persistent storage upon startup or process recovery.
   */
  public async hydrate(): Promise<{ recoveredVersion: number; eventCount: number }> {
    // 1. Load committed snapshot
    const { snapshot, committedVersion } = await this.storage.loadSnapshot();
    if (snapshot && snapshot.snapshotVersion === committedVersion) {
      this.journal.setSnapshot(snapshot);
      this.memoryManager.setStableCutVector(snapshot.vector);
    }

    // 2. Load stored journal events
    const storedEvents = await this.storage.loadJournalEvents();
    const baselineVector = snapshot ? snapshot.vector : {};

    for (const evt of storedEvents) {
      const cutSeq = baselineVector[evt.author] || 0;
      if (evt.seq > cutSeq && !this.journal.hasOp(evt.opId)) {
        this.journal.applyRemote(evt);
      }
    }

    // 3. Materialize updated state
    this.currentState = this.journal.reduceState(this.reducer, this.initialState);
    this.notifyListeners();

    return {
      recoveredVersion: committedVersion,
      eventCount: this.journal.getEventCount(),
    };
  }

  private checkCompaction(): void {
    this.compact(false);
  }

  public getState(): TState {
    return this.currentState;
  }

  public getVectorClock(): VectorClock {
    return this.journal.getVectorClock();
  }

  public getPendingCount(): number {
    return this.syncEngine.getPendingCount();
  }

  public subscribe(listener: (state: TState, event?: ReplicatedEvent<TOp>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(event?: ReplicatedEvent<TOp>): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState, event);
      } catch (err) {
        console.error(`[ReplicatedStore:${this.storeId}] Subscriber error:`, err);
      }
    });
  }

  public getJournal(): OperationJournal<TState, TOp> {
    return this.journal;
  }

  public getSyncEngine(): CausalSyncEngine<TState, TOp> {
    return this.syncEngine;
  }

  public getMemoryManager(): BoundedMemoryManager<TState, TOp> {
    return this.memoryManager;
  }

  public getSnapshotTransfer(): SnapshotTransferManager<TState, TOp> {
    return this.snapshotTransfer;
  }

  public getStorage(): IStorageAdapter<TState, TOp> {
    return this.storage;
  }

  public clear(): void {
    this.journal.clear();
    this.syncEngine.clear();
    this.memoryManager.clear();
    this.listeners.clear();
    this.activeParticipants.clear();
    this.currentState = this.initialState;
  }
}
