package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/nerdbuddy/server/internal/election"
	"github.com/nerdbuddy/server/internal/protocol"
)

const (
	// MinRedundantLeaders is the target minimum number of leaders per room
	// to avoid a single point of failure (SPOF) and provide resilient backbone mesh.
	MinRedundantLeaders = 2

	// MaxClusterHighWatermark is the upper margin of regular peers assigned to a leader
	// before splitting the cluster and promoting an additional leader.
	MaxClusterHighWatermark = 8

	// MinClusterLowWatermark is the lower margin of peers in a cluster before
	// considering consolidation/demotion of excess leaders (prevents flapping).
	MinClusterLowWatermark = 3

	// LeaderCooldownTenure is the minimum tenure a leader serves before being
	// eligible for demotion/consolidation to prevent rapid flapping.
	LeaderCooldownTenure = 20 * time.Second

	// LeaderScoreMargin is the delta margin required to replace an incumbent leader.
	LeaderScoreMargin = election.DefaultScoreMargin
)

// Room holds the state for a single collaboration room.
type Room struct {
	ID string

	mu      sync.RWMutex
	peers   map[string]*Peer // all peers (including leaders)
	leaders map[string]*Peer // subset: peers serving as leaders

	// leaderAssignments maps regular peerId → assigned leader peerId.
	leaderAssignments map[string]string
}

// NewRoom creates an empty room.
func NewRoom(id string) *Room {
	return &Room{
		ID:                id,
		peers:             make(map[string]*Peer),
		leaders:           make(map[string]*Peer),
		leaderAssignments: make(map[string]string),
	}
}

// AddPeer registers a peer into the room and assigns them a leader.
// Whenever total peer count >= 2, maintains at least 2 redundant leaders.
func (r *Room) AddPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.peers[p.ID] = p
	totalPeers := len(r.peers)

	if len(r.leaders) == 0 {
		// First peer in room → auto-promote to leader.
		r.promoteToLeaderLocked(p)
		slog.Info("auto-promoted first peer to leader", "peer", p.ID, "room", r.ID)
		return
	}

	// If room has >= 2 peers and leaders < MinRedundantLeaders (e.g. only 1 leader currently),
	// promote this 2nd peer as co-leader to eliminate single group leader bottleneck!
	if totalPeers >= MinRedundantLeaders && len(r.leaders) < MinRedundantLeaders {
		r.promoteToLeaderLocked(p)
		slog.Info("promoted peer to maintain dual-leader backbone redundancy", "peer", p.ID, "room", r.ID)
		// Balance any existing regular peers between the leaders
		r.rebalanceClustersLocked()
		return
	}

	// Otherwise, assign to least-loaded leader.
	leader := r.leastLoadedLeaderLocked()
	if leader != nil {
		r.leaderAssignments[p.ID] = leader.ID
		slog.Info("assigned peer to leader", "peer", p.ID, "leader", leader.ID, "room", r.ID)

		// Margin check: if cluster exceeds upper watermark, split cluster
		clusterSize := r.clusterSizeLocked(leader.ID)
		if clusterSize > MaxClusterHighWatermark {
			r.splitClusterLocked(leader.ID)
		}
	} else {
		// Fallback: promote if no leader found
		r.promoteToLeaderLocked(p)
	}
}

// RemovePeer unregisters a peer from the room.
// If the peer was a leader, handles reassignment and promotion with margin.
func (r *Room) RemovePeer(peerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	peer, ok := r.peers[peerID]
	if !ok {
		return
	}

	wasLeader := peer.IsLeader

	// Remove from all maps.
	delete(r.peers, peerID)
	delete(r.leaders, peerID)
	delete(r.leaderAssignments, peerID)

	if wasLeader {
		r.handleLeaderDepartureLocked(peerID)
	} else {
		// Regular peer left: check if we should consolidate underloaded leaders with margin
		r.checkLeaderConsolidationLocked()
	}
}

// IsEmpty returns true if the room has no peers.
func (r *Room) IsEmpty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.peers) == 0
}

// PeerCount returns the total number of peers in the room.
func (r *Room) PeerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.peers)
}

// GetPeer returns a peer by ID, or nil if not found.
func (r *Room) GetPeer(peerID string) *Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peers[peerID]
}

// BuildRoster creates a RosterPayload for the given peer's perspective.
func (r *Room) BuildRoster(forPeerID string) *protocol.RosterPayload {
	r.mu.RLock()
	defer r.mu.RUnlock()

	roster := &protocol.RosterPayload{
		Peers:   make([]protocol.RosterEntry, 0, len(r.peers)),
		Leaders: make([]string, 0, len(r.leaders)),
	}

	for _, p := range r.peers {
		roster.Peers = append(roster.Peers, protocol.RosterEntry{
			PeerID:   p.ID,
			Nickname: p.Nickname,
			IsLeader: p.IsLeader,
		})
	}

	for id := range r.leaders {
		roster.Leaders = append(roster.Leaders, id)
	}

	// Set the requesting peer's assigned leader.
	if assignedLeader, ok := r.leaderAssignments[forPeerID]; ok {
		roster.YourLeader = assignedLeader
	} else if _, isLeader := r.leaders[forPeerID]; isLeader {
		roster.YourLeader = forPeerID // leaders are their own leader
	}

	return roster
}

// BroadcastRoster sends an updated roster to every peer in the room.
func (r *Room) BroadcastRoster() {
	r.mu.RLock()
	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	r.mu.RUnlock()

	for _, p := range peers {
		roster := r.BuildRoster(p.ID)
		payload, _ := json.Marshal(roster)
		p.SendJSON(&protocol.Envelope{
			Type:    protocol.MsgRoomRoster,
			RoomID:  r.ID,
			Payload: payload,
		})
	}
}

// BroadcastDirect sends an envelope to every connected peer in the room.
func (r *Room) BroadcastDirect(env *protocol.Envelope) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, p := range r.peers {
		p.SendJSON(env)
	}
}

// GetLeadersExcept returns all leader IDs except the given one.
func (r *Room) GetLeadersExcept(excludeID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]string, 0, len(r.leaders))
	for id := range r.leaders {
		if id != excludeID {
			result = append(result, id)
		}
	}
	return result
}

// GetClusterPeers returns the peer IDs assigned to a specific leader.
func (r *Room) GetClusterPeers(leaderID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]string, 0)
	for peerID, assignedLeader := range r.leaderAssignments {
		if assignedLeader == leaderID {
			result = append(result, peerID)
		}
	}
	return result
}

// --- Internal helpers (must be called with r.mu held) ---

// promoteToLeaderLocked promotes a peer to leader status.
func (r *Room) promoteToLeaderLocked(p *Peer) {
	p.IsLeader = true
	p.PromotedAt = time.Now()
	r.leaders[p.ID] = p
	delete(r.leaderAssignments, p.ID) // leaders don't have an assigned leader

	// Notify the peer of their promotion.
	clusterPeers := make([]string, 0)
	for pid, lid := range r.leaderAssignments {
		if lid == p.ID {
			clusterPeers = append(clusterPeers, pid)
		}
	}
	backboneLeaders := make([]string, 0)
	for lid := range r.leaders {
		if lid != p.ID {
			backboneLeaders = append(backboneLeaders, lid)
		}
	}

	payload, _ := json.Marshal(protocol.PromotePayload{
		ClusterPeers:    clusterPeers,
		BackboneLeaders: backboneLeaders,
	})
	p.SendJSON(&protocol.Envelope{
		Type:    protocol.MsgLeaderPromote,
		RoomID:  r.ID,
		Payload: payload,
	})
}

// demoteFromLeaderLocked demotes a leader to regular peer and reassigns them.
func (r *Room) demoteFromLeaderLocked(p *Peer, newLeaderID string) {
	p.IsLeader = false
	delete(r.leaders, p.ID)
	r.leaderAssignments[p.ID] = newLeaderID

	// Reassign all peers previously assigned to p to the new leader
	for pid, lid := range r.leaderAssignments {
		if lid == p.ID {
			r.leaderAssignments[pid] = newLeaderID
		}
	}

	payload, _ := json.Marshal(protocol.DemotePayload{
		NewLeader: newLeaderID,
	})
	p.SendJSON(&protocol.Envelope{
		Type:    protocol.MsgLeaderDemote,
		RoomID:  r.ID,
		Payload: payload,
	})
}

// leastLoadedLeaderLocked finds the leader with the fewest assigned peers.
func (r *Room) leastLoadedLeaderLocked() *Peer {
	var best *Peer
	bestCount := int(^uint(0) >> 1) // max int

	for _, leader := range r.leaders {
		count := r.clusterSizeLocked(leader.ID)
		if count < bestCount {
			bestCount = count
			best = leader
		}
	}
	return best
}

// clusterSizeLocked counts the number of regular peers assigned to a leader.
func (r *Room) clusterSizeLocked(leaderID string) int {
	count := 0
	for _, lid := range r.leaderAssignments {
		if lid == leaderID {
			count++
		}
	}
	return count
}

// rebalanceClustersLocked evenly distributes assigned peers across all current leaders.
func (r *Room) rebalanceClustersLocked() {
	if len(r.leaders) == 0 {
		return
	}

	leaderList := make([]string, 0, len(r.leaders))
	for lid := range r.leaders {
		leaderList = append(leaderList, lid)
	}

	idx := 0
	for peerID := range r.leaderAssignments {
		r.leaderAssignments[peerID] = leaderList[idx%len(leaderList)]
		idx++
	}
}

// splitClusterLocked promotes the best candidate from an overloaded cluster to leader,
// then reassigns regular peers evenly across the leaders.
func (r *Room) splitClusterLocked(overloadedLeaderID string) {
	candidates := make(map[string]election.CandidateInfo)
	for peerID, lid := range r.leaderAssignments {
		if lid == overloadedLeaderID {
			if p, ok := r.peers[peerID]; ok {
				candidates[peerID] = election.CandidateInfo{
					JoinedAt:       p.JoinedAt,
					ReconnectCount: p.ReconnectCount,
					PromotedAt:     p.PromotedAt,
				}
			}
		}
	}

	bestID := election.SelectBestCandidate(candidates)
	if bestID == "" {
		return
	}

	newLeader, ok := r.peers[bestID]
	if !ok {
		return
	}

	slog.Info("splitting cluster with margin — promoting new leader",
		"newLeader", bestID,
		"fromLeader", overloadedLeaderID,
		"room", r.ID,
	)

	r.promoteToLeaderLocked(newLeader)
	r.rebalanceClustersLocked()
}

// handleLeaderDepartureLocked handles cleanup when a leader leaves the room.
// Maintains redundant leaders if total remaining peers >= 2.
func (r *Room) handleLeaderDepartureLocked(departedLeaderID string) {
	orphans := make([]string, 0)
	for peerID, lid := range r.leaderAssignments {
		if lid == departedLeaderID {
			orphans = append(orphans, peerID)
		}
	}

	totalRemainingPeers := len(r.peers)

	// If leaders < MinRedundantLeaders and we have enough peers (>= 2), promote an orphan to keep dual-leader
	if len(r.leaders) < MinRedundantLeaders && totalRemainingPeers >= MinRedundantLeaders && len(orphans) > 0 {
		candidates := make(map[string]election.CandidateInfo)
		for _, orphanID := range orphans {
			if p, ok := r.peers[orphanID]; ok {
				candidates[orphanID] = election.CandidateInfo{
					JoinedAt:       p.JoinedAt,
					ReconnectCount: p.ReconnectCount,
					PromotedAt:     p.PromotedAt,
				}
			}
		}

		bestID := election.SelectBestCandidate(candidates)
		if bestID != "" {
			if p, ok := r.peers[bestID]; ok {
				r.promoteToLeaderLocked(p)
				slog.Info("promoted orphan to maintain multi-leader redundancy after departure",
					"newLeader", bestID,
					"room", r.ID,
				)

				// Remove promoted candidate from orphans list
				newOrphans := make([]string, 0, len(orphans)-1)
				for _, oid := range orphans {
					if oid != bestID {
						newOrphans = append(newOrphans, oid)
					}
				}
				orphans = newOrphans
			}
		}
	}

	// Reassign remaining orphans to active leaders
	if len(r.leaders) > 0 {
		leaderIDs := make([]string, 0, len(r.leaders))
		for id := range r.leaders {
			leaderIDs = append(leaderIDs, id)
		}

		for i, orphanID := range orphans {
			assignTo := leaderIDs[i%len(leaderIDs)]
			r.leaderAssignments[orphanID] = assignTo
		}

		slog.Info("redistributed orphans after leader departure",
			"departedLeader", departedLeaderID,
			"orphanCount", len(orphans),
			"room", r.ID,
		)
	} else if len(orphans) > 0 {
		// All leaders departed — promote best orphan
		candidates := make(map[string]election.CandidateInfo)
		for _, orphanID := range orphans {
			if p, ok := r.peers[orphanID]; ok {
				candidates[orphanID] = election.CandidateInfo{
					JoinedAt:       p.JoinedAt,
					ReconnectCount: p.ReconnectCount,
					PromotedAt:     p.PromotedAt,
				}
			}
		}

		bestID := election.SelectBestCandidate(candidates)
		if bestID != "" {
			if p, ok := r.peers[bestID]; ok {
				r.promoteToLeaderLocked(p)
				for _, orphanID := range orphans {
					if orphanID != bestID {
						r.leaderAssignments[orphanID] = bestID
					}
				}
				slog.Info("promoted orphan to leader as sole remaining leader",
					"newLeader", bestID,
					"room", r.ID,
				)
			}
		}
	}
}

// checkLeaderConsolidationLocked evaluates whether excess underloaded leaders
// should be merged/demoted using hysteresis margins.
func (r *Room) checkLeaderConsolidationLocked() {
	// Never consolidate below MinRedundantLeaders if room has >= 2 peers
	if len(r.leaders) <= MinRedundantLeaders {
		return
	}

	// Check if any leader is underloaded (below low watermark) and past cooldown
	now := time.Now()
	for lid, leader := range r.leaders {
		if now.Sub(leader.PromotedAt) < LeaderCooldownTenure {
			continue // Protected by tenure cooldown margin
		}

		clusterSize := r.clusterSizeLocked(lid)
		if clusterSize < MinClusterLowWatermark && len(r.leaders) > MinRedundantLeaders {
			// Find target leader to merge into
			var targetLeaderID string
			for otherID := range r.leaders {
				if otherID != lid {
					targetLeaderID = otherID
					break
				}
			}

			if targetLeaderID != "" {
				slog.Info("demoting underloaded leader with hysteresis margin",
					"demotedLeader", lid,
					"mergedInto", targetLeaderID,
					"clusterSize", clusterSize,
					"room", r.ID,
				)
				r.demoteFromLeaderLocked(leader, targetLeaderID)
				r.rebalanceClustersLocked()
				break
			}
		}
	}
}
