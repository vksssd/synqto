package election

import (
	"math"
	"time"
)

const (
	// DefaultScoreMargin is the hysteresis margin a candidate must exceed
	// an incumbent leader's score by to trigger a leadership switch (15% margin).
	DefaultScoreMargin = 0.15

	// Scoring weights
	UptimeWeight    = 0.6
	StabilityWeight = 0.4
	MaxUptimeSecs   = 3600.0 // 1 hour cap for uptime normalization
)

// CandidateInfo holds the data needed to score a peer for leader election.
type CandidateInfo struct {
	JoinedAt       time.Time
	ReconnectCount int
	PromotedAt     time.Time
}

// Score computes a leader election score for a peer in [0.0, 1.0].
// Higher score = better leader candidate.
//
// score = UptimeWeight * normalizedUptime + StabilityWeight * stability
//
// - uptime: seconds since peer joined the room (normalized to 1 hour max)
// - stability: 1 / (reconnectCount + 1) — fewer reconnects = higher stability
func Score(joinedAt time.Time, reconnectCount int) float64 {
	uptimeSecs := time.Since(joinedAt).Seconds()
	normalizedUptime := math.Min(uptimeSecs, MaxUptimeSecs) / MaxUptimeSecs

	stability := 1.0 / (float64(reconnectCount) + 1.0)

	return UptimeWeight*normalizedUptime + StabilityWeight*stability
}

// SelectBestCandidate picks the peer with the highest election score.
func SelectBestCandidate(candidates map[string]CandidateInfo) string {
	bestID := ""
	bestScore := -1.0

	for id, info := range candidates {
		s := Score(info.JoinedAt, info.ReconnectCount)
		if s > bestScore {
			bestScore = s
			bestID = id
		}
	}

	return bestID
}

// SelectBestCandidateWithMargin selects a replacement candidate only if their
// score beats the incumbent leader's score by at least scoreMargin.
// This prevents flapping on minor score differences.
func SelectBestCandidateWithMargin(candidates map[string]CandidateInfo, incumbentScore float64, scoreMargin float64) (string, bool) {
	bestID := ""
	bestScore := -1.0

	for id, info := range candidates {
		s := Score(info.JoinedAt, info.ReconnectCount)
		if s > bestScore {
			bestScore = s
			bestID = id
		}
	}

	if bestID != "" && bestScore >= (incumbentScore+scoreMargin) {
		return bestID, true
	}

	return "", false
}
