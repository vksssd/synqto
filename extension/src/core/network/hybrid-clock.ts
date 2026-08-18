// ─── Hybrid Logical Clock (Kulkarni et al., 2014) ───
//
// Every packet carries a timestamp so receivers can list events in a stable, sorted order.
// The obvious implementation — stamp Date.now() and sort by it — does not work across peers,
// and it is worth being precise about why, because the failure is silent and looks like a
// UI bug rather than a clock bug.
//
// Browser wall clocks disagree. Skew of a few seconds is routine on consumer machines, and
// minutes is not unusual (a laptop resuming from sleep, a phone that has not re-synced NTP,
// a VM whose clock drifted). Sorting purely by sender wall time therefore produces orderings
// that are not just imprecise but causally wrong: B's reply can sort *before* A's message it
// replies to, because B's clock is 4 seconds behind A's. No amount of care at the receiver
// fixes this, because the information needed to correct it is not in the packet.
//
// The opposite extreme — a pure Lamport counter — is causally correct but is a small integer
// with no relation to real time, so it cannot be displayed, cannot be compared against
// locally-stored history, and cannot answer "when did this happen".
//
// A Hybrid Logical Clock gives both. Its timestamp is a pair (wall, counter) where `wall`
// tracks physical time to within the room's actual message latency, and `counter`
// disambiguates events that land in the same millisecond or arrive from a peer whose clock
// is ahead. The resulting value is:
//
//   - sortable as a single total order (compareHLC below)
//   - causally consistent: if A happened-before B then hlc(A) < hlc(B), always
//   - monotonic per peer: it never goes backwards, even if the local clock does
//   - human-meaningful: `wall` is a real epoch-ms timestamp, safe to display
//
// This is the same construction CockroachDB and other distributed stores use for exactly
// this problem.

/** A hybrid logical timestamp. Wire-compact: `w` = wall ms, `c` = logical counter. */
export interface HLC {
  /** Physical component — epoch milliseconds. Safe to render as a real time. */
  w: number;
  /** Logical component — disambiguates events within the same millisecond. */
  c: number;
}

/**
 * How far ahead of our own physical clock a remote HLC may drag us.
 *
 * Without this bound, a single peer whose system clock is set to next year would, on its
 * first packet, pull every other peer's HLC forward to that value — and because an HLC is
 * monotonic it can never come back down. The whole room's timestamps would be poisoned for
 * the lifetime of the session, and every subsequent message would sort against a wall value
 * a year in the future.
 *
 * Peers are untrusted here (anyone can run a modified client), so this is a correctness
 * boundary, not just a guard against accidental misconfiguration. Beyond this bound we keep
 * the causal guarantee — the remote event still sorts after everything it depends on, via
 * the counter — but refuse to import its wall time.
 */
export const MAX_CLOCK_DRIFT_MS = 120_000;

/** Counter ceiling. Reaching this means ~65k events in one millisecond, which is not real. */
const MAX_COUNTER = 0xffff;

export class HybridClock {
  private wall = 0;
  private counter = 0;
  private driftRejections = 0;

  /** Injectable for tests; defaults to the real clock. */
  constructor(private now: () => number = () => Date.now()) {}

  /**
   * Stamps a locally-originated event.
   *
   * Two calls in the same millisecond return the same `w` with an incremented `c`, so local
   * send order is always preserved even for a burst of messages inside one tick.
   */
  public tick(): HLC {
    const physical = this.now();

    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else {
      // Local clock stalled or went backwards (NTP correction, sleep/resume). Hold the
      // logical wall value and advance the counter — never emit a decreasing timestamp.
      this.counter = Math.min(MAX_COUNTER, this.counter + 1);
    }

    return { w: this.wall, c: this.counter };
  }

  /**
   * Merges a received timestamp, then returns the receive event's own stamp.
   *
   * This is the step that makes ordering work: by absorbing the sender's clock we guarantee
   * that anything we send afterwards sorts strictly after what we just received, so a reply
   * can never sort before the message it replies to.
   */
  public update(remote: HLC | undefined): HLC {
    const physical = this.now();

    if (!remote || typeof remote.w !== 'number' || typeof remote.c !== 'number') {
      return this.tick();
    }

    // Refuse to import wall time from a clock implausibly far ahead of ours.
    let remoteWall = remote.w;
    if (remoteWall > physical + MAX_CLOCK_DRIFT_MS) {
      this.driftRejections++;
      remoteWall = 0; // fall back to local physical time; causality still holds below
    }

    const maxWall = Math.max(this.wall, remoteWall, physical);

    if (maxWall === this.wall && maxWall === remoteWall) {
      this.counter = Math.min(MAX_COUNTER, Math.max(this.counter, remote.c) + 1);
    } else if (maxWall === this.wall) {
      this.counter = Math.min(MAX_COUNTER, this.counter + 1);
    } else if (maxWall === remoteWall) {
      this.counter = Math.min(MAX_COUNTER, remote.c + 1);
    } else {
      // Physical time moved past both — safe to reset the counter.
      this.counter = 0;
    }

    this.wall = maxWall;
    return { w: this.wall, c: this.counter };
  }

  /** Current value without advancing. */
  public peek(): HLC {
    return { w: this.wall, c: this.counter };
  }

  public getDriftRejections(): number {
    return this.driftRejections;
  }

  public reset(): void {
    this.wall = 0;
    this.counter = 0;
    this.driftRejections = 0;
  }
}

/**
 * Total order over hybrid timestamps.
 *
 * The peerId tiebreak is not cosmetic. Two peers can legitimately produce byte-identical
 * (w, c) pairs for concurrent events, and without a deterministic final tiebreak each
 * replica would order that pair however its local sort happened to land — so two people
 * looking at the same room would see the same two messages in different orders. Comparing
 * peerId makes every replica converge on one order.
 */
export function compareHLC(
  a: { hlc?: HLC; timestamp?: number; peerId?: string },
  b: { hlc?: HLC; timestamp?: number; peerId?: string }
): number {
  const aw = a.hlc?.w ?? a.timestamp ?? 0;
  const bw = b.hlc?.w ?? b.timestamp ?? 0;
  if (aw !== bw) return aw - bw;

  const ac = a.hlc?.c ?? 0;
  const bc = b.hlc?.c ?? 0;
  if (ac !== bc) return ac - bc;

  const ap = a.peerId ?? '';
  const bp = b.peerId ?? '';
  return ap < bp ? -1 : ap > bp ? 1 : 0;
}

/** Renders an HLC as epoch ms, for display or for storage alongside legacy timestamps. */
export function hlcToMillis(h: HLC | undefined): number {
  return h?.w ?? 0;
}

/** Compact string form, useful for logs and dedupe keys: `1787065298332.0003`. */
export function formatHLC(h: HLC | undefined): string {
  if (!h) return '-';
  return `${h.w}.${String(h.c).padStart(4, '0')}`;
}

/** Process-wide clock. Packet stamping and inbound merging must share one instance. */
export const globalClock = new HybridClock();
