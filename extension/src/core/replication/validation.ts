import { PeerId } from '../types/identifiers';
import { StateOpPayload, StateSnapshotPayload } from '../network/packet';
import { PayloadChunker } from '../network/chunker';
import { OperationJournal } from './operation-journal';

export type RejectReason =
  | 'MALFORMED_ENVELOPE'
  | 'AUTHOR_SPOOFING'
  | 'INVALID_SEQUENCE'
  | 'INVALID_LAMPORT'
  | 'SELF_DEPENDENCY'
  | 'CYCLIC_DEPENDENCY'
  | 'OVERSIZED_SNAPSHOT'
  | 'CRC32_CHECKSUM_MISMATCH'
  | 'PENDING_QUEUE_OVERFLOW'
  | 'STALE_SNAPSHOT';

export type ValidationResult =
  | { accepted: true; isPending?: boolean }
  | { accepted: false; reason: RejectReason; quarantine: boolean };

export type DeliveryContext =
  | {
      kind: 'direct-origin';
      senderPeerId: PeerId;
    }
  | {
      kind: 'forwarded';
      senderPeerId: PeerId;
      authenticatedOrigin?: PeerId;
    };

export class ReplicationValidator {
  private static readonly MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024; // 4 MB
  private static readonly MAX_CYCLE_SEARCH_DEPTH = 32;

  /**
   * Authoritative validation gate for incoming replicated state operations.
   */
  public static validateOperation<TState, TOp>(
    payload: StateOpPayload<TOp>,
    deliveryContext: DeliveryContext,
    journal: OperationJournal<TState, TOp>
  ): ValidationResult {
    // 1. Envelope structural validation
    if (!payload || !payload.storeId || !payload.opId || typeof payload.opId !== 'string') {
      return { accepted: false, reason: 'MALFORMED_ENVELOPE', quarantine: true };
    }

    if (!payload.author || typeof payload.author !== 'string') {
      return { accepted: false, reason: 'MALFORMED_ENVELOPE', quarantine: true };
    }

    // 2. Identity / Authorship validation with DeliveryContext
    if (deliveryContext.kind === 'direct-origin') {
      if (payload.author !== deliveryContext.senderPeerId) {
        return { accepted: false, reason: 'AUTHOR_SPOOFING', quarantine: true };
      }
    } else if (deliveryContext.kind === 'forwarded') {
      if (deliveryContext.authenticatedOrigin && payload.author !== deliveryContext.authenticatedOrigin) {
        return { accepted: false, reason: 'AUTHOR_SPOOFING', quarantine: true };
      }
    }

    // 3. Monotonic sequence and Lamport integer validation
    if (!Number.isInteger(payload.seq) || payload.seq <= 0) {
      return { accepted: false, reason: 'INVALID_SEQUENCE', quarantine: true };
    }

    if (!Number.isInteger(payload.lamport) || payload.lamport < 0) {
      return { accepted: false, reason: 'INVALID_LAMPORT', quarantine: true };
    }

    // 4. Self-dependency guard
    if (payload.dependencies && payload.dependencies.includes(payload.opId)) {
      return { accepted: false, reason: 'SELF_DEPENDENCY', quarantine: true };
    }

    // 5. Known cyclic dependency detection (bounded DFS over known local journal graph)
    if (payload.dependencies && payload.dependencies.length > 0) {
      if (this.detectKnownCycle(payload.opId, payload.dependencies, journal)) {
        return { accepted: false, reason: 'CYCLIC_DEPENDENCY', quarantine: true };
      }
    }

    return { accepted: true };
  }

  /**
   * Bounded DFS to detect if any of the op's dependencies lead back to opId in the known local journal graph.
   * Unknown remote dependencies are ignored here and handled as PENDING.
   */
  private static detectKnownCycle<TState, TOp>(
    targetOpId: string,
    dependencies: string[],
    journal: OperationJournal<TState, TOp>
  ): boolean {
    const visited = new Set<string>();
    const stack: { opId: string; depth: number }[] = dependencies.map((dep) => ({
      opId: dep,
      depth: 1,
    }));

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.opId === targetOpId) {
        return true; // Cycle established
      }

      if (current.depth >= this.MAX_CYCLE_SEARCH_DEPTH) {
        continue; // Bound search depth
      }

      if (!visited.has(current.opId)) {
        visited.add(current.opId);
        const knownEvent = journal.getOp(current.opId);
        if (knownEvent && knownEvent.dependencies) {
          for (const nextDep of knownEvent.dependencies) {
            stack.push({ opId: nextDep, depth: current.depth + 1 });
          }
        }
      }
    }

    return false;
  }

  /**
   * Authoritative validation gate for incoming snapshot transfer payloads.
   */
  public static validateSnapshot<TState>(
    payload: StateSnapshotPayload<TState>,
    maxSnapshotBytes = ReplicationValidator.MAX_SNAPSHOT_BYTES
  ): ValidationResult {
    // 1. Envelope structural sanity
    if (!payload || !payload.storeId || payload.state === undefined || !payload.vectorClock) {
      return { accepted: false, reason: 'MALFORMED_ENVELOPE', quarantine: true };
    }

    // 2. Size hard ceiling
    if (payload.byteLength > maxSnapshotBytes) {
      return { accepted: false, reason: 'OVERSIZED_SNAPSHOT', quarantine: true };
    }

    // 3. CRC32 Integrity checksum verification
    const serializedState = JSON.stringify(payload.state);
    const computedCRC = PayloadChunker.calculateCRC32(serializedState);
    if (computedCRC !== payload.checksum) {
      return { accepted: false, reason: 'CRC32_CHECKSUM_MISMATCH', quarantine: true };
    }

    return { accepted: true };
  }
}
