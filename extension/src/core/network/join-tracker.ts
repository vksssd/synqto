// ─── Join Admission Tracker ───
//
// Makes "has this peer actually joined?" a question with an answer.
//
// Today a peer looks joined as soon as the server registers it. Registration means a
// WebSocket was accepted and a roster entry exists — it says nothing about whether the peer
// can exchange a single packet with anyone. Every stage after that (roster delivery, topology
// convergence, neighbour selection, signalling, DataChannel open) can fail independently and
// silently, and the peer still presents as "in the room".
//
// That gap is why a failing join is so hard to diagnose: the symptom is "the third person is
// there but nothing works", and there is no state anywhere that distinguishes "we never got
// the roster" from "we got it but never dialled" from "we dialled but ICE never completed".
//
// OBSERVATION BEFORE ENFORCEMENT. This tracker records the ladder; it does not gate on it.
// The reason is deliberate: a hub-level bug was recently found where a reconnecting peer was
// evicted from its own room by its predecessor's teardown, which produces exactly the
// "registered but not joined" symptom this ladder is meant to explain. Enforcing a state
// machine on top of an unobserved cause would risk encoding the workaround rather than the
// fix. Record first, decide where to gate once the traces say where joins actually stall.

import { PeerId, RoomId } from '../types/identifiers';

/**
 * Admission stages, in order. A join advances monotonically; it never moves backwards, so a
 * peer that reaches LINKS_CONNECTED and then loses a link is a repair case, not a re-join.
 */
export const JOIN_STAGES = [
  'CONNECTING',
  'REGISTERING',
  'REGISTERED',
  'ROSTER_SYNCED',
  'TOPOLOGY_SYNCED',
  'NEIGHBORS_SELECTED',
  'SIGNALING_ESTABLISHED',
  'LINKS_CONNECTED',
  'TOPOLOGY_CONFIRMED',
  'ACTIVE',
] as const;

export type JoinStage = (typeof JOIN_STAGES)[number];

const STAGE_INDEX: Record<JoinStage, number> = JOIN_STAGES.reduce(
  (acc, stage, i) => ({ ...acc, [stage]: i }),
  {} as Record<JoinStage, number>
);

export interface JoinEvent {
  stage: JoinStage;
  at: number;
  /** Milliseconds since the join began — the number that matters when diagnosing a stall. */
  elapsedMs: number;
  detail?: Record<string, unknown>;
}

export interface JoinSnapshot {
  roomId: RoomId;
  peerId: PeerId;
  stage: JoinStage;
  startedAt: number;
  elapsedMs: number;
  events: JoinEvent[];
  /** Links the tier requires versus links actually open. */
  requiredLinks: number;
  connectedLinks: number;
  stalled: boolean;
  failureHint?: string;
}

/**
 * How long a join may sit in one stage before it is called stalled.
 *
 * Not a timeout — nothing is aborted. It is the threshold at which the tracker starts saying
 * "this is where it stopped", which is the entire diagnostic value.
 */
export const STAGE_STALL_MS = 8000;

/** Plain-language explanation per stage, surfaced when a join stalls there. */
const STALL_HINTS: Partial<Record<JoinStage, string>> = {
  CONNECTING: 'WebSocket never opened — server unreachable, blocked, or wrong URL',
  REGISTERING: 'room:join sent but never acknowledged — check the handshake close reason',
  REGISTERED: 'registered on the server but no roster arrived — roster delivery or listener registration',
  ROSTER_SYNCED: 'roster arrived but topology never resolved a tier',
  TOPOLOGY_SYNCED: 'tier known but no neighbours selected — mesh plan produced an empty set',
  NEIGHBORS_SELECTED: 'neighbours chosen but no offer/answer completed — signalling path',
  SIGNALING_ESTABLISHED: 'SDP exchanged but no DataChannel opened — ICE or NAT traversal',
  LINKS_CONNECTED: 'links open but topology never confirmed the peer',
};

export class JoinTracker {
  private roomId: RoomId = '';
  private peerId: PeerId = '';
  private stage: JoinStage = 'CONNECTING';
  private startedAt = 0;
  private lastAdvanceAt = 0;
  /**
   * Whether begin() has been called.
   *
   * A separate flag rather than testing `startedAt === 0`, because zero is a legitimate
   * timestamp. Using it as a sentinel silently disables stall detection for any clock whose
   * origin is zero — which is every injected test clock, and therefore exactly the case where
   * the detection would be verified. Same falsy-zero trap as `lamportTime || timestamp`.
   */
  private started = false;
  private events: JoinEvent[] = [];
  private requiredLinks = 0;
  private connectedLinks = 0;

  /** Bounded: a long session with repeated repairs must not grow this without limit. */
  private static readonly MAX_EVENTS = 64;

  private listeners: Set<(snap: JoinSnapshot) => void> = new Set();
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  public begin(roomId: RoomId, peerId: PeerId): void {
    this.roomId = roomId;
    this.peerId = peerId;
    this.stage = 'CONNECTING';
    this.startedAt = this.now();
    this.lastAdvanceAt = this.startedAt;
    this.started = true;
    this.events = [];
    this.requiredLinks = 0;
    this.connectedLinks = 0;
    this.record('CONNECTING');
  }

  /**
   * Advances to a stage, ignoring anything at or below the current one.
   *
   * Monotonic because the stages describe progress through admission, not the peer's health
   * afterwards. A link lost after ACTIVE is a repair, and letting it drag the join state
   * backwards would make "did this peer ever join?" unanswerable — which is the question the
   * tracker exists to answer.
   */
  public advance(stage: JoinStage, detail?: Record<string, unknown>): void {
    if (STAGE_INDEX[stage] <= STAGE_INDEX[this.stage]) return;
    this.stage = stage;
    this.lastAdvanceAt = this.now();
    this.record(stage, detail);
    this.emit();
  }

  /** Records link progress. Advancing to LINKS_CONNECTED is the caller's decision. */
  public setLinkProgress(connected: number, required: number): void {
    this.connectedLinks = connected;
    this.requiredLinks = required;
  }

  private record(stage: JoinStage, detail?: Record<string, unknown>): void {
    const at = this.now();
    this.events.push({ stage, at, elapsedMs: at - this.startedAt, detail });
    if (this.events.length > JoinTracker.MAX_EVENTS) this.events.shift();
  }

  /**
   * Whether the join has sat in its current stage past the stall threshold.
   *
   * ACTIVE is never stalled — a completed join that stays completed is the desired state, not
   * a peer stuck at the end of the ladder.
   */
  public isStalled(): boolean {
    if (!this.started) return false;
    if (this.stage === 'ACTIVE') return false;
    return this.now() - this.lastAdvanceAt > STAGE_STALL_MS;
  }

  public getSnapshot(): JoinSnapshot {
    const stalled = this.isStalled();
    return {
      roomId: this.roomId,
      peerId: this.peerId,
      stage: this.stage,
      startedAt: this.startedAt,
      elapsedMs: this.started ? this.now() - this.startedAt : 0,
      events: [...this.events],
      requiredLinks: this.requiredLinks,
      connectedLinks: this.connectedLinks,
      stalled,
      failureHint: stalled ? STALL_HINTS[this.stage] : undefined,
    };
  }

  /** One-line trace for logs and bug reports. */
  public format(): string {
    const snap = this.getSnapshot();
    const trail = snap.events.map((e) => `${e.stage}@${e.elapsedMs}ms`).join(' → ');
    const links = `${snap.connectedLinks}/${snap.requiredLinks} links`;
    const status = snap.stalled ? ` STALLED: ${snap.failureHint ?? 'unknown'}` : '';
    return `[join ${snap.peerId} in ${snap.roomId}] ${trail} (${links})${status}`;
  }

  public onChange(fn: (snap: JoinSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // A diagnostic must never break the thing it is diagnosing.
      }
    });
  }

  public reset(): void {
    this.stage = 'CONNECTING';
    this.startedAt = 0;
    this.lastAdvanceAt = 0;
    this.started = false;
    this.events = [];
    this.requiredLinks = 0;
    this.connectedLinks = 0;
  }
}
