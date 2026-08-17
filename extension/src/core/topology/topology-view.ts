export type TopologyPhase =
  | 'STABLE'
  | 'PREPARING'
  | 'CONNECTING'
  | 'SYNCING'
  | 'COMMITTING'
  | 'DRAINING'
  | 'ROLLING_BACK';

export interface TopologyView {
  roomId: RoomId;
  tier: TopologyTier;
  phase?: TopologyPhase;
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

export interface TopologyProposal {
  proposalId: string;
  roomId: RoomId;
  previousEpoch: TopologyEpoch;
  proposedEpoch: TopologyEpoch;
  currentTier: TopologyTier;
  proposedTier: TopologyTier;
  leaders: PeerId[];
  proposer: PeerId;
  votes: string[]; // List of voting peer IDs
  createdAt: number;
}

export type ViewComparison = 'NEWER' | 'OLDER' | 'EQUAL' | 'CONFLICT';

export class TopologyProposalEngine {
  /**
   * Creates a formal proposal for advancing the topology epoch/tier
   */
  public static createProposal(
    currentView: TopologyView,
    proposedTier: TopologyTier,
    proposedLeaders: PeerId[],
    proposer: PeerId
  ): TopologyProposal {
    return {
      proposalId: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      roomId: currentView.roomId,
      previousEpoch: currentView.epoch,
      proposedEpoch: (currentView.epoch + 1) as TopologyEpoch,
      currentTier: currentView.tier,
      proposedTier,
      leaders: proposedLeaders,
      proposer,
      votes: [proposer],
      createdAt: Date.now(),
    };
  }

  /**
   * Validates a proposal against current topology epoch and quorum threshold
   */
  public static validateProposal(
    currentView: TopologyView,
    proposal: TopologyProposal,
    requiredQuorum: number
  ): boolean {
    if (proposal.roomId !== currentView.roomId) return false;
    if (proposal.previousEpoch !== currentView.epoch) return false;
    if (proposal.proposedEpoch !== currentView.epoch + 1) return false;
    return proposal.votes.length >= requiredQuorum;
  }

  /**
   * Commits an approved proposal into an updated TopologyView
   */
  public static commitProposal(proposal: TopologyProposal): TopologyView {
    return {
      roomId: proposal.roomId,
      tier: proposal.proposedTier,
      phase: 'STABLE',
      epoch: proposal.proposedEpoch,
      generation: 1,
      membershipVersion: 1,
      leaders: proposal.leaders,
      relayAvailable: proposal.proposedTier === 'TIER3_SERVER_RELAY',
      timestamp: Date.now(),
    };
  }
}

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
      phase: 'STABLE',
      epoch: 1,
      generation: 1,
      membershipVersion: 1,
      leaders: [],
      relayAvailable: false,
      timestamp: Date.now(),
    };
  }
}
