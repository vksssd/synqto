// ─── Room Utilities (Deterministic Hashing & Canonicalization) ───

import { fnv1aHash } from '@/shared/utils';

export interface GroupDetails {
  id?: string;
  name: string;
  avatar: string;
  isPrivate: boolean;
  description?: string;
  topicTag?: string;
}

/** CoFocus session metadata attached to a matchmade or invited room. */
export interface CoFocusDetails {
  /** Preferred duration in seconds — metadata only, never a matching constraint. */
  sessionLengthSec?: number;
  subjectTag?: string;
  partnerPeerId?: string;
}

export interface RoomContext {
  roomId: string;
  platform: string;
  slug: string;
  title: string;
  canonicalUrl: string;
  isGroup?: boolean;
  groupDetails?: GroupDetails;
  /**
   * Set only for CoFocus sessions. Undefined for every pre-existing room type (problem,
   * custom, group), which therefore behave exactly as before.
   *
   * 'WATCHER'  — camera-only body doubling; the UI must not mount chat/voice/whiteboard.
   * 'TOGETHER' — full collaboration; reuses the standard room surface unchanged.
   *
   * Both run under DIRECT_ONLY_POLICY (Tier 1 direct P2P, no relay, no leader election).
   */
  cofocusMode?: 'WATCHER' | 'TOGETHER';
  cofocusDetails?: CoFocusDetails;
}

/**
 * Computes deterministic room ID for a canonical resource URL.
 * Format: `room:<cleanSlug>-<hash8>` (e.g. `room:two-sum-e7a18b2c`)
 */
export function computeRoomId(slug: string, canonicalUrl: string): string {
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .slice(0, 24)
    .replace(/-+$/, '');
  const normalizedUrl = (canonicalUrl || '').trim().toLowerCase().replace(/\/+$/, '');
  const hash = fnv1aHash(normalizedUrl || canonicalUrl || 'lobby');
  return `room:${cleanSlug || 'lobby'}-${hash}`;
}

export function getPlatformBadgeColor(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'leetcode':
      return '#FFA116';
    case 'neetcode':
      return '#8B5CF6';
    case 'codeforces':
      return '#318CE7';
    case 'hackerrank':
      return '#2EC866';
    case 'codechef':
      return '#5B4638';
    case 'geeksforgeeks':
      return '#2F8D46';
    case 'youtube':
      return '#FF0000';
    case 'arxiv':
      return '#B31B1B';
    case 'github':
      return '#24292F';
    case 'group':
      return '#8B5CF6';
    default:
      return '#6366F1';
  }
}

export const getPlatformColor = getPlatformBadgeColor;
