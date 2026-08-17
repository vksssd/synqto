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
    };

    const packet = createPacket(
      'state:op',
      this.localIdentity,
      this.roomId,
      payload,
      undefined,
      { priority: 'DATA', topologyEpoch }
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
    };

    const packet = createPacket(
      'state:op',
      this.localIdentity,
      this.roomId,
      payload,
      undefined,
      { priority: 'DATA', topologyEpoch }
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
          const snapshot = this.compact(true);
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
        if (payload.requiresSnapshot) {
          if (!dominates(this.journal.getVectorClock(), payload.vectorClock)) {
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

        const snapshot = this.compact(true);
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
      this.storage.saveSnapshot(snapshot).then(() => {
        return this.storage.commitSnapshot(snapshot.snapshotVersion);
      }).then(() => {
        return this.storage.truncateJournalBefore(snapshot.vector);
      }).catch(() => {});
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
      // Step 1: Write uncommitted snapshot V
      await this.storage.saveSnapshot(snapshot);
      // Step 2: Write commit marker V
      await this.storage.commitSnapshot(snapshot.snapshotVersion);
      // Step 3: Truncate storage journal before snapshot.vector
      await this.storage.truncateJournalBefore(snapshot.vector);
    }

    return snapshot;
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
