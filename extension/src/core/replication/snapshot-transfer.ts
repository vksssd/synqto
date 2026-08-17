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
        if (this.hooks.onSnapshotRejected) {
          this.hooks.onSnapshotRejected('STALE_SNAPSHOT', payload);
        }
        return false;
      }
      const currentContiguous = this.journal.getContiguousVectorClock();
      if (Object.keys(currentContiguous).length > 0 && dominates(currentContiguous, payload.vectorClock)) {
        if (this.hooks.onSnapshotRejected) {
          this.hooks.onSnapshotRejected('STALE_SNAPSHOT', payload);
        }
        return false;
      }

      // 3. CAUSAL SAFETY GATE — refuse to install a snapshot that is CONCURRENT with our own.
      //
      // A snapshot is a fully materialized state up to payload.vectorClock. Adopting it is only
      // lossless when it causally covers everything our own baseline already folded in. If our
      // local snapshot contains compacted history the incoming snapshot does NOT (i.e. the two
      // vectors are concurrent), there is no way to combine them at this layer: the operations
      // behind our baseline have already been truncated out of the journal, so they cannot be
      // replayed on top of the incoming state.
      //
      // The previous implementation tried to paper over this by "merging" the two states with a
      // shape-guessing heuristic — a special case for `{ keys: {...} }` and an untyped shallow
      // spread for everything else. For any other shape (e.g. `{ items: [...] }`) the spread let
      // the incoming field wholly REPLACE the local one, silently discarding local history. It
      // then recorded `mergedVector = merge(local, payload)`, asserting the state covered BOTH
      // histories when it actually only reflected `payload`. That inflated vector is what made
      // the loss permanent and undetectable: every later anti-entropy round read the vector,
      // concluded "I already have everything up to V", and never re-requested the dropped ops.
      //
      // Deciding how to reconcile two genuinely divergent application states is application-level
      // conflict-resolution (CRDT) semantics — a P4 concern. The P3 substrate must not invent it.
      // Rejecting here is lossless and honest: local state is left fully intact and the peers
      // reconcile through ordinary delta-based anti-entropy instead.
      if (localSnapshot && !dominates(payload.vectorClock, localSnapshot.vector)) {
        if (this.hooks.onSnapshotRejected) {
          this.hooks.onSnapshotRejected('CONCURRENT_SNAPSHOT', payload);
        }
        return false;
      }

      // 4. Extract local operations strictly newer than the incoming snapshot; these are still
      // live in the journal and will be replayed on top of the adopted baseline.
      const localEvents = this.journal.getEvents();
      const concurrentUncommitted: ReplicatedEvent<TOp>[] = [];

      for (const evt of localEvents) {
        const snapshotSeq = payload.vectorClock[evt.author] || 0;
        if (evt.seq > snapshotSeq) {
          concurrentUncommitted.push(evt);
        }
      }

      // 5. Adopt the incoming snapshot verbatim as the new baseline. Its vector describes exactly
      // what its state contains — no synthetic union, so the vector never over-claims coverage.
      const snapshot: ReplicatedSnapshot<TState> = {
        storeId: this.storeId,
        snapshotVersion: Math.max(localSnapshot?.snapshotVersion || 0, payload.snapshotVersion) + 1,
        vector: { ...payload.vectorClock },
        state: payload.state,
        checksum: payload.checksum,
        byteLength: payload.byteLength,
        timestamp: payload.timestamp,
      };

      // 6. Atomically install baseline snapshot and reset cut vector
      this.journal.setSnapshot(snapshot);
      this.memoryManager.setStableCutVector(snapshot.vector);

      // 7. Re-apply local operations that postdate the snapshot on top of the new baseline
      this.journal.truncateBefore(snapshot.vector);
      for (const evt of concurrentUncommitted) {
        this.journal.applyRemote(evt);
      }

      // 8. Materialize new state
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
