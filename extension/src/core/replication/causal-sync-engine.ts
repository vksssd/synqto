import { OperationId, PeerId } from '../types/identifiers';
import {
  VectorClock,
  createVectorClock,
  compareVectorClocks,
  dominates,
} from './vector-clock';
import { OperationJournal, ReplicatedEvent } from './operation-journal';
import {
  StateOpPayload,
  StateSyncRequestPayload,
  StateSyncResponsePayload,
} from '../network/packet';
import { ReplicationValidator, DeliveryContext } from './validation';

export interface CausalSyncHooks<TOp = unknown> {
  onEmitSyncRequest?: (request: StateSyncRequestPayload, targetPeerId?: PeerId) => void;
  onEmitSyncResponse?: (response: StateSyncResponsePayload<TOp>, targetPeerId: PeerId) => void;
  onRequireSnapshot?: (storeId: string, targetPeerId: PeerId) => void;
  onOperationApplied?: (event: ReplicatedEvent<TOp>) => void;
  onQuarantine?: (reason: string, details: any) => void;
}

export class CausalSyncEngine<TState = unknown, TOp = unknown> {
  private readonly MAX_PENDING_CAUSAL = 128;
  private pendingCausalQueue: Map<OperationId, ReplicatedEvent<TOp>> = new Map();
  private peerVectorClocks: Map<PeerId, VectorClock> = new Map();
  private requestedMissingDeps: Set<OperationId> = new Set();
  private pendingOverflowCount = 0;
  private quarantinedCount = 0;

  constructor(
    public readonly storeId: string,
    public readonly localPeerId: PeerId,
    private readonly journal: OperationJournal<TState, TOp>,
    private readonly hooks: CausalSyncHooks<TOp> = {}
  ) {}

  /**
   * Ingests a replicated event (from broadcast or direct P2P/Relay).
   * Enforces authoritative validation policy, causal dependency validation,
   * buffers out-of-order operations in pending queue, and unblocks recursively.
   */
  public ingestOperation(
    event: ReplicatedEvent<TOp>,
    deliveryContext?: DeliveryContext
  ): boolean {
    if (this.journal.hasOp(event.opId) || this.pendingCausalQueue.has(event.opId)) {
      return false; // Duplicate
    }

    // 1. Authoritative Validation Policy Gate
    const context: DeliveryContext = deliveryContext ?? {
      kind: 'direct-origin',
      senderPeerId: event.author,
    };
    const validation = ReplicationValidator.validateOperation(
      event as any,
      context,
      this.journal
    );

    if (!validation.accepted) {
      this.quarantinedCount++;
      if (this.hooks.onQuarantine) {
        this.hooks.onQuarantine(validation.reason, event);
      }
      return false;
    }

    // 2. Check if all causal dependencies are satisfied
    if (this.journal.areDependenciesSatisfied(event.dependencies)) {
      const applied = this.journal.applyRemote(event);
      if (applied && this.hooks.onOperationApplied) {
        this.hooks.onOperationApplied(event);
      }

      // Recursively drain any pending causal operations unblocked by this event
      this.drainUnblockedPending();
      return true;
    }

    // 3. Dependencies missing -> Enforce pending queue bounds
    if (this.pendingCausalQueue.size >= this.MAX_PENDING_CAUSAL) {
      this.pendingOverflowCount++;
      this.quarantinedCount++;
      if (this.hooks.onQuarantine) {
        this.hooks.onQuarantine('PENDING_QUEUE_OVERFLOW', event);
      }
      return false;
    }

    this.pendingCausalQueue.set(event.opId, event);

    // 4. Request missing dependencies via anti-entropy
    const missingDeps = event.dependencies.filter((dep) => !this.journal.hasOp(dep));
    for (const dep of missingDeps) {
      this.requestedMissingDeps.add(dep);
    }

    if (missingDeps.length > 0 && this.hooks.onEmitSyncRequest) {
      const syncReq: StateSyncRequestPayload = {
        storeId: this.storeId,
        requestingPeerId: this.localPeerId,
        vectorClock: this.journal.getVectorClock(),
      };
      this.hooks.onEmitSyncRequest(syncReq, event.author);
    }

    return false;
  }

  /**
   * Scans and drains all pending operations whose causal prerequisites are now met.
   */
  private drainUnblockedPending(): void {
    let unblockedAny = true;
    while (unblockedAny) {
      unblockedAny = false;
      for (const [opId, pendingEvent] of Array.from(this.pendingCausalQueue.entries())) {
        if (this.journal.areDependenciesSatisfied(pendingEvent.dependencies)) {
          this.pendingCausalQueue.delete(opId);
          const applied = this.journal.applyRemote(pendingEvent);
          if (applied && this.hooks.onOperationApplied) {
            this.hooks.onOperationApplied(pendingEvent);
          }
          unblockedAny = true;
          break; // Restart loop to maintain topological evaluation
        }
      }
    }
  }

  /**
   * Generates a sync request containing local vector clock digest for anti-entropy reconciliation.
   */
  public createSyncRequest(): StateSyncRequestPayload {
    const snapshot = this.journal.getLatestSnapshot();
    return {
      storeId: this.storeId,
      requestingPeerId: this.localPeerId,
      vectorClock: this.journal.getContiguousVectorClock(),
      lastKnownSnapshotVersion: snapshot?.snapshotVersion,
    };
  }

  /**
   * Handles an incoming sync request from a remote peer.
   * Compares vector clocks and determines whether to respond with delta operations or require a full snapshot.
   */
  public handleSyncRequest(
    request: StateSyncRequestPayload,
    isBehindStableCut: (remoteVector: VectorClock) => boolean
  ): StateSyncResponsePayload<TOp> {
    this.peerVectorClocks.set(request.requestingPeerId, request.vectorClock);

    // Check if remote peer is behind the stable cut (needs full snapshot)
    const requiresSnapshot = isBehindStableCut(request.vectorClock);
    const snapshot = this.journal.getLatestSnapshot();

    if (requiresSnapshot) {
      return {
        storeId: this.storeId,
        targetPeerId: request.requestingPeerId,
        missingEvents: [],
        requiresSnapshot: true,
        snapshotVersion: snapshot?.snapshotVersion,
        vectorClock: this.journal.getVectorClock(),
      };
    }

    // Remote peer is within live journal window -> Extract missing deltas
    const missingEvents = this.journal.getDeltasSince(request.vectorClock);
    return {
      storeId: this.storeId,
      targetPeerId: request.requestingPeerId,
      missingEvents: missingEvents as StateOpPayload<TOp>[],
      requiresSnapshot: false,
      snapshotVersion: snapshot?.snapshotVersion,
      vectorClock: this.journal.getVectorClock(),
    };
  }

  /**
   * Ingests an anti-entropy sync response, applying all missing operations.
   */
  public handleSyncResponse(response: StateSyncResponsePayload<TOp>): ReplicatedEvent<TOp>[] {
    const applied: ReplicatedEvent<TOp>[] = [];

    if (response.requiresSnapshot) {
      if (this.hooks.onRequireSnapshot) {
        this.hooks.onRequireSnapshot(this.storeId, response.targetPeerId);
      }
      return applied;
    }

    // Apply delta operations in order
    for (const evt of response.missingEvents) {
      const event: ReplicatedEvent<TOp> = {
        storeId: evt.storeId,
        opId: evt.opId,
        author: evt.author,
        seq: evt.seq,
        lamport: evt.lamport,
        dependencies: evt.dependencies || [],
        type: evt.type,
        op: evt.op,
        timestamp: evt.timestamp,
        topologyEpoch: evt.topologyEpoch,
      };

      if (this.ingestOperation(event)) {
        applied.push(event);
      }
    }

    return applied;
  }

  public recordPeerVector(peerId: PeerId, vector: VectorClock): void {
    this.peerVectorClocks.set(peerId, { ...vector });
  }

  public getPeerVectors(): Map<PeerId, VectorClock> {
    return new Map(this.peerVectorClocks);
  }

  public getPendingCount(): number {
    return this.pendingCausalQueue.size;
  }

  public getPendingOverflowCount(): number {
    return this.pendingOverflowCount;
  }

  public getQuarantinedCount(): number {
    return this.quarantinedCount;
  }

  public clear(): void {
    this.pendingCausalQueue.clear();
    this.peerVectorClocks.clear();
    this.requestedMissingDeps.clear();
  }
}
