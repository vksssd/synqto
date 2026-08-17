// ─── Vector Clock Primitives for Distributed State Replication ───

import { PeerId, OperationId } from '../types/identifiers';

export type VectorClock = Record<PeerId, number>;

export type VectorComparison = 'EQUAL' | 'ANCESTOR' | 'DESCENDANT' | 'CONCURRENT';

/**
 * Creates a fresh VectorClock instance
 */
export function createVectorClock(initial?: Record<PeerId, number>): VectorClock {
  return { ...(initial || {}) };
}

/**
 * Returns a new VectorClock with the given peer's logical clock incremented by 1
 */
export function incrementVectorClock(clock: VectorClock, peerId: PeerId): VectorClock {
  const current = clock[peerId] || 0;
  return {
    ...clock,
    [peerId]: current + 1,
  };
}

/**
 * Merges two vector clocks component-wise (taking max clock for each peer)
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };
  for (const [peerId, counter] of Object.entries(b)) {
    merged[peerId] = Math.max(merged[peerId] || 0, counter);
  }
  return merged;
}

/**
 * Compares two vector clocks:
 * - 'EQUAL': Identical states
 * - 'ANCESTOR': clock A strictly happened before clock B (A is an ancestor of B)
 * - 'DESCENDANT': clock B strictly happened before clock A (A is a descendant of B)
 * - 'CONCURRENT': Concurrent operations with causal ambiguity (requires deterministic tie-breaking)
 */
export function compareVectorClocks(a: VectorClock, b: VectorClock): VectorComparison {
  const allPeers = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aHasGreater = false;
  let bHasGreater = false;

  for (const peerId of allPeers) {
    const valA = a[peerId] || 0;
    const valB = b[peerId] || 0;

    if (valA > valB) aHasGreater = true;
    if (valB > valA) bHasGreater = true;
  }

  if (!aHasGreater && !bHasGreater) return 'EQUAL';
  if (aHasGreater && !bHasGreater) return 'DESCENDANT';
  if (!aHasGreater && bHasGreater) return 'ANCESTOR';
  return 'CONCURRENT';
}

/**
 * Generates a deterministic, universally unique OperationId
 */
export function generateOperationId(author: PeerId, seq: number, lamport: number): OperationId {
  return `${author}:${seq}:${lamport}`;
}

/**
 * Parses an OperationId back into its components
 */
export function parseOperationId(opId: OperationId): { author: PeerId; seq: number; lamport: number } | null {
  const parts = opId.split(':');
  if (parts.length < 3) return null;
  return {
    author: parts[0],
    seq: parseInt(parts[1], 10) || 0,
    lamport: parseInt(parts[2], 10) || 0,
  };
}
