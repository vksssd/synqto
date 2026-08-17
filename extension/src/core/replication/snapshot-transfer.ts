// ─── Snapshot Transfer & Atomic Installation Manager ───
// Bridges ReplicatedStore snapshots with P2 Chunking & ReliableTransport,
// enforcing CRC32 verification and atomic snapshot installation.

import { PeerId } from '../types/identifiers';
import { compareVectorClocks, dominates, mergeVectorClocks } from './vector-clock';
import { OperationJournal, ReplicatedEvent, ReplicatedSnapshot } from './operation-journal';
import { BoundedMemoryManager } from './bounded-memory';
import { PacketPipeline } from '../network/packet-pipeline';
import { createPacket, NetworkPacket, StateSnapshotPayload, StateSnapshotRequestPayload } from '../network/packet';
import { PayloadChunker } from '../network/chunker';
import { ReplicationValidator } from './validation';

export interface SnapshotTransferHooks<TState = unknown> {
  onSnapshotInstalled?: (snapshot: ReplicatedSnapshot<TState>, materializedState: TState) => void;
  onSnapshotRejected?: (reason: string, payload: StateSnapshotPayload<TState>) => void;
}

export class SnapshotTransferManager<TState = unknown, TOp = unknown> {
  private isInstalling = false;

  constructor(
    public readonly storeId: string,
    public readonly localPeerId: PeerId,
    public readonly roomId: string,
    private readonly journal: OperationJournal<TState, TOp>,
    private readonly memoryManager: BoundedMemoryManager<TState, TOp>,
    private readonly pipeline: PacketPipeline,
    private readonly hooks: SnapshotTransferHooks<TState> = {}
  ) {}

  /**
   * Dispatches a state snapshot to a requesting remote peer via ReliableTransport & P2 Chunker.
   */
  public async sendSnapshot(
    targetPeerId: PeerId,
    snapshot: ReplicatedSnapshot<TState>,
    myIdentity: { peerId: string; nickname: string; avatar: string; color: string }
  ): Promise<boolean> {
    const payload: StateSnapshotPayload<TState> = {
      storeId: this.storeId,
      snapshotVersion: snapshot.snapshotVersion,
      vectorClock: snapshot.vector,
      state: snapshot.state,
      checksum: snapshot.checksum,
      byteLength: snapshot.byteLength,
      timestamp: snapshot.timestamp,
    };

    const packet = createPacket(
      'state:snapshot_response',
      myIdentity,
      this.roomId,
      payload,
      targetPeerId,
      { channelPriority: 'bulk' }
    );

    const receipt = await this.pipeline.sendPacket(packet, targetPeerId, { isReliable: true });
    return receipt !== null && receipt.status === 'delivered';
  }

  /**
   * Requests a full snapshot from a remote leader or peer.
   */
  public async requestSnapshot(
    targetPeerId: PeerId,
    myIdentity: { peerId: string; nickname: string; avatar: string; color: string }
  ): Promise<void> {
    const payload: StateSnapshotRequestPayload = {
      storeId: this.storeId,
      requestingPeerId: this.localPeerId,
      currentVector: this.journal.getVectorClock(),
    };

    const packet = createPacket(
      'state:snapshot_request',
      myIdentity,
      this.roomId,
      payload,
      targetPeerId,
      { priority: 'SYNC', channelPriority: 'control' }
    );

    await this.pipeline.sendPacket(packet, targetPeerId, { isReliable: true });
  }

  /**
   * Ingests and atomically installs an incoming snapshot payload.
   * 1. Validates CRC32 checksum.
   * 2. Checks version monotonicity.
   * 3. Atomically replaces base snapshot.
   * 4. Reconciles concurrent local uncommitted operations.
   */
  public installSnapshot(
    payload: StateSnapshotPayload<TState>,
    reducer: (state: TState, op: TOp, event: ReplicatedEvent<TOp>) => TState,
    initialState: TState
  ): boolean {
    if (this.isInstalling) {
      return false; // Prevent concurrent re-entrant installations
    }
    this.isInstalling = true;

    try {
      // 1. Authoritative Snapshot Validation Gate (Envelope, Max Bytes, CRC32)
      const validation = ReplicationValidator.validateSnapshot(payload as any);
      if (!validation.accepted) {
        if (this.hooks.onSnapshotRejected) {
          this.hooks.onSnapshotRejected(validation.reason, payload);
        }
        return false;
      }

      // 2. Monotonicity: Reject if local snapshot or contiguous vector already dominates incoming snapshot
      const localSnapshot = this.journal.getLatestSnapshot();
      if (localSnapshot && dominates(localSnapshot.vector, payload.vectorClock)) {
        return false;
      }
      const currentContiguous = this.journal.getContiguousVectorClock();
      if (Object.keys(currentContiguous).length > 0 && dominates(currentContiguous, payload.vectorClock)) {
        return false;
      }

      // 3. Extract local uncommitted operations that are strictly newer than the snapshot
      const localEvents = this.journal.getEvents();
      const concurrentUncommitted: ReplicatedEvent<TOp>[] = [];

      for (const evt of localEvents) {
        const snapshotSeq = payload.vectorClock[evt.author] || 0;
        if (evt.seq > snapshotSeq) {
          concurrentUncommitted.push(evt);
        }
      }

      // 4. Construct snapshot model with state and vector union
      let mergedState = payload.state;
      if (localSnapshot && typeof localSnapshot.state === 'object' && typeof payload.state === 'object' && !Array.isArray(payload.state)) {
        if ((localSnapshot.state as any).keys && (payload.state as any).keys) {
          mergedState = {
            ...payload.state,
            keys: { ...(localSnapshot.state as any).keys, ...(payload.state as any).keys },
          };
        } else {
          mergedState = { ...localSnapshot.state, ...payload.state };
        }
      }

      const mergedVector = localSnapshot
        ? mergeVectorClocks(localSnapshot.vector, payload.vectorClock)
        : { ...payload.vectorClock };

      const snapshot: ReplicatedSnapshot<TState> = {
        storeId: this.storeId,
        snapshotVersion: Math.max(localSnapshot?.snapshotVersion || 0, payload.snapshotVersion) + 1,
        vector: mergedVector,
        state: mergedState,
        checksum: payload.checksum,
        byteLength: payload.byteLength,
        timestamp: payload.timestamp,
      };

      // 5. Atomically install baseline snapshot and reset cut vector
      this.journal.setSnapshot(snapshot);
      this.memoryManager.setStableCutVector(snapshot.vector);

      // 6. Re-apply concurrent local uncommitted operations on top of new baseline
      this.journal.truncateBefore(snapshot.vector);
      for (const evt of concurrentUncommitted) {
        this.journal.applyRemote(evt);
      }

      // 7. Materialize new state
      const materialized = this.journal.reduceState(reducer, initialState);

      if (this.hooks.onSnapshotInstalled) {
        this.hooks.onSnapshotInstalled(snapshot, materialized);
      }

      return true;
    } finally {
      this.isInstalling = false;
    }
  }

  public isInstallationInProgress(): boolean {
    return this.isInstalling;
  }
}
