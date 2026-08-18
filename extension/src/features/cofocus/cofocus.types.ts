// ─── CoFocus (Study Partner Matchmaking) Types ───

import type { CoFocusMode } from '@/core/network/lobby.service';

export type { CoFocusMode };

/**
 * Session length presets, in minutes.
 *
 * IMPORTANT: this is a PREFERRED duration, not a matching filter. The server does not pair on
 * it — a peer asking for 25 minutes can be matched with one asking for 120. Any UI exposing
 * this must label it as a preference ("Preferred length"), never as a requirement, or users
 * will reasonably infer a guarantee that does not exist.
 */
export const SESSION_LENGTH_PRESETS = [25, 50, 120] as const;
export type SessionLengthPreset = (typeof SESSION_LENGTH_PRESETS)[number];

/**
 * Subject tags offered for Together matching.
 *
 * Kept as a short curated list rather than free text because matching is exact-on-normalized:
 * free text fragments the pool into single-occupant queues and nobody ever matches. The server
 * still normalizes (trim + lowercase + whitespace collapse) as a safety net.
 */
export const SUBJECT_TAGS = [
  'DSA & Algorithms',
  'System Design',
  'Web Development',
  'Machine Learning',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Competitive Programming',
  'Interview Prep',
  'Research & Papers',
  'Languages',
  'Other',
] as const;
export type SubjectTag = (typeof SUBJECT_TAGS)[number];

/** Lifecycle of a CoFocus session, from the launcher through to an active room. */
export type CoFocusPhase =
  | 'idle'
  /** Enqueued on the server, waiting for a partner. */
  | 'queued'
  /** Matched and joining the room; waiting for the partner to actually arrive. */
  | 'matched'
  /** Both peers present, session running. */
  | 'active'
  /** Timer reached zero (soft checkpoint — the room stays open). */
  | 'completed';

export interface CoFocusSessionState {
  phase: CoFocusPhase;
  mode: CoFocusMode | null;
  roomId?: string;
  subjectTag?: string;
  /** Preferred duration in seconds — metadata, not a matching constraint. */
  sessionLengthSec?: number;
  partnerPeerId?: string;
  partnerNickname?: string;
  /** Whether the partner has actually appeared in the room roster yet. */
  partnerPresent: boolean;
  /** Countdown remaining, seconds. Only meaningful while phase === 'active'. */
  remainingSec: number;
  /** Queue diagnostics, only while phase === 'queued'. */
  queuePosition?: number;
  queueTimeoutSec?: number;
  /** Last error surfaced by the lobby, if any. */
  error?: string;
}

export const INITIAL_COFOCUS_STATE: CoFocusSessionState = {
  phase: 'idle',
  mode: null,
  partnerPresent: false,
  remainingSec: 0,
};

/**
 * How long to wait, after being matched, for the partner to appear in the room roster before
 * concluding they vanished and re-queueing.
 *
 * The failure this covers: peers A and B are matched, A joins the room, B's browser dies before
 * it opens its room connection. Without this, A sits alone in a "matched" room indefinitely
 * with no signal that anything went wrong. 8s is comfortably above normal join latency
 * (signaling handshake + WebRTC negotiation is typically well under 2s per DISCOVERY_ANALYSIS.md)
 * while still failing fast enough that the user does not give up first.
 */
export const PARTNER_ARRIVAL_TIMEOUT_MS = 8000;
