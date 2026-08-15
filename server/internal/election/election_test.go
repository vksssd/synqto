package election

import (
	"testing"
	"time"
)

func TestScoreCalculation(t *testing.T) {
	now := time.Now()
	joinedLongAgo := now.Add(-30 * time.Minute)
	joinedJustNow := now.Add(-10 * time.Second)

	scoreHigh := Score(joinedLongAgo, 0)
	scoreLow := Score(joinedJustNow, 3)

	if scoreHigh <= scoreLow {
		t.Errorf("expected high uptime / low reconnect score (%f) to exceed low uptime score (%f)", scoreHigh, scoreLow)
	}
}

func TestSelectBestCandidate(t *testing.T) {
	now := time.Now()
	candidates := map[string]CandidateInfo{
		"peer-stable": {
			JoinedAt:       now.Add(-20 * time.Minute),
			ReconnectCount: 0,
		},
		"peer-flaky": {
			JoinedAt:       now.Add(-25 * time.Minute),
			ReconnectCount: 5,
		},
		"peer-new": {
			JoinedAt:       now.Add(-1 * time.Minute),
			ReconnectCount: 0,
		},
	}

	best := SelectBestCandidate(candidates)
	if best != "peer-stable" {
		t.Errorf("expected 'peer-stable' to win election, got '%s'", best)
	}
}

func TestSelectBestCandidateWithMargin(t *testing.T) {
	now := time.Now()
	incumbentScore := Score(now.Add(-30*time.Minute), 0)

	candidates := map[string]CandidateInfo{
		"challenger-slight": {
			JoinedAt:       now.Add(-31 * time.Minute),
			ReconnectCount: 0,
		},
	}

	// Challenger is only slightly older, within 15% hysteresis margin, so should NOT trigger replacement
	bestID, shouldReplace := SelectBestCandidateWithMargin(candidates, incumbentScore, DefaultScoreMargin)
	if shouldReplace {
		t.Errorf("expected shouldReplace=false due to score margin hysteresis, got true for '%s'", bestID)
	}

	// Challenger with massive score advantage should trigger replacement
	candidatesAdv := map[string]CandidateInfo{
		"challenger-veteran": {
			JoinedAt:       now.Add(-60 * time.Minute),
			ReconnectCount: 0,
		},
	}
	incumbentLowScore := Score(now.Add(-2*time.Minute), 2)
	bestIDAdv, shouldReplaceAdv := SelectBestCandidateWithMargin(candidatesAdv, incumbentLowScore, DefaultScoreMargin)
	if !shouldReplaceAdv || bestIDAdv != "challenger-veteran" {
		t.Errorf("expected 'challenger-veteran' with shouldReplace=true, got id='%s', shouldReplace=%v", bestIDAdv, shouldReplaceAdv)
	}
}
