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

export interface RoomContext {
  roomId: string;
  platform: string;
  slug: string;
  title: string;
  canonicalUrl: string;
  isGroup?: boolean;
  groupDetails?: GroupDetails;
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
