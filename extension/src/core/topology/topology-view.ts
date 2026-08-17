// ─── Formal TopologyView & Monotonic Conflict Ordering ───

import { PeerId, RoomId, TopologyEpoch } from '../types/identifiers';
import { TopologyTier } from './topology.types';

export interface TopologyView {
  roomId: RoomId;
  tier: TopologyTier;
  epoch: TopologyEpoch;
  generation: number;
  membershipVersion: number;
  transitionId?: string;
  leaders: PeerId[];
  primaryLeader?: PeerId;
  secondaryLeader?: PeerId;
  relayAvailable: boolean;
  timestamp: number;
}

export type ViewComparison = 'NEWER' | 'OLDER' | 'EQUAL' | 'CONFLICT';

export class TopologyViewEngine {
  /**
   * Compares two topology views using monotonic ordering:
   * 1. Major Topology Epoch (higher is newer)
   * 2. Leader Incarnation Generation (higher is newer)
   * 3. Membership Roster Version (higher is newer)
   * 4. Tie-breaking hash
   */
  public static compare(local: TopologyView, incoming: TopologyView): ViewComparison {
    if (incoming.epoch > local.epoch) return 'NEWER';
    if (incoming.epoch < local.epoch) return 'OLDER';

    if (incoming.generation > local.generation) return 'NEWER';
    if (incoming.generation < local.generation) return 'OLDER';

    if (incoming.membershipVersion > local.membershipVersion) return 'NEWER';
    if (incoming.membershipVersion < local.membershipVersion) return 'OLDER';

    // Same epoch, generation, and membershipVersion
    if (local.tier === incoming.tier && local.leaders.join(',') === incoming.leaders.join(',')) {
      return 'EQUAL';
    }

    return 'CONFLICT';
  }

  /**
   * Creates an initial default view for a room
   */
  public static createDefault(roomId: RoomId, initialPeer: PeerId): TopologyView {
    return {
      roomId,
      tier: 'TIER1_FULL_MESH',
      epoch: 1,
      generation: 1,
      membershipVersion: 1,
      leaders: [],
      relayAvailable: false,
      timestamp: Date.now(),
    };
  }
}
