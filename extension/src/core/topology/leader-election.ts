// ─── Deterministic Leader Scoring & Quorum Election Engine ───

import { PeerId } from '../types/identifiers';
import { LeaderScoreMetrics, TOPOLOGY_THRESHOLDS } from './topology.types';

export interface ScoredPeer {
  peerId: PeerId;
  score: number;
  metrics: LeaderScoreMetrics;
}

export class LeaderElectionEngine {
  /**
   * Computes a deterministic 0–100 capability score for a candidate peer node
   */
  public static computeScore(metrics: LeaderScoreMetrics, peerId: PeerId): number {
    // 1. Uptime Score (0 - 25 pts): reward nodes that have been stable for >1 min
    const uptimeMinutes = metrics.uptimeMs / (1000 * 60);
    const uptimeScore = Math.min(25, uptimeMinutes * 2.5);

    // 2. Latency / RTT Score (0 - 25 pts): reward sub-100ms round trips
    const rttScore = Math.max(0, 25 - (metrics.rttMs / 12));

    // 3. Packet Loss Reliability (0 - 25 pts): 0% loss = 25 pts
    const lossRate = Math.min(1, Math.max(0, metrics.packetLossRate));
    const reliabilityScore = 25 * (1 - lossRate);

    // 4. Power & Battery Status (0 - 15 pts)
    let powerScore = 10;
    if (metrics.isPluggedIn) {
      powerScore = 15;
    } else if (metrics.batteryLevel !== undefined) {
      powerScore = Math.floor(metrics.batteryLevel * 15);
    }

    // 5. Deterministic Hash Tie-Breaker (0 - 10 pts)
    let hashVal = 0;
    for (let i = 0; i < peerId.length; i++) {
      hashVal = (hashVal << 5) - hashVal + peerId.charCodeAt(i);
      hashVal |= 0;
    }
    const tieBreakerScore = Math.abs(hashVal % 100) / 10;

    const rawTotal = uptimeScore + rttScore + reliabilityScore + powerScore + tieBreakerScore;
    return Math.round(Math.min(100, Math.max(0, rawTotal)) * 10) / 10;
  }

  /**
   * Evaluates and selects the target set of active leaders for Tier 2
   * Applies hysteresis margin to prevent leadership flapping among close scores
   */
  public static selectLeaders(
    currentLeaders: PeerId[],
    allCandidates: ScoredPeer[],
    targetCount: number = TOPOLOGY_THRESHOLDS.MIN_LEADERS
  ): PeerId[] {
    if (allCandidates.length <= targetCount) {
      return allCandidates.map((c) => c.peerId);
    }

    const currentLeaderSet = new Set(currentLeaders);
    const currentLeaderScores = new Map<PeerId, number>();
    allCandidates.forEach((c) => {
      if (currentLeaderSet.has(c.peerId)) {
        currentLeaderScores.set(c.peerId, c.score);
      }
    });

    // Sort candidates descending by score
    const sorted = [...allCandidates].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.peerId.localeCompare(b.peerId);
    });

    const chosen: PeerId[] = [];

    // First retain incumbent leaders unless a candidate beats them by PROMOTION_SCORE_MARGIN
    for (const incumbent of currentLeaders) {
      const incScore = currentLeaderScores.get(incumbent);
      if (incScore !== undefined && chosen.length < targetCount) {
        // Check if there is a superior challenger that beats incumbent by margin
        const betterChallenger = sorted.find(
          (c) =>
            !currentLeaderSet.has(c.peerId) &&
            !chosen.includes(c.peerId) &&
            c.score >= incScore + TOPOLOGY_THRESHOLDS.PROMOTION_SCORE_MARGIN
        );

        if (!betterChallenger) {
          chosen.push(incumbent);
        }
      }
    }

    // Fill remaining leadership slots with top candidates
    for (const candidate of sorted) {
      if (chosen.length >= targetCount) break;
      if (!chosen.includes(candidate.peerId)) {
        chosen.push(candidate.peerId);
      }
    }

    return chosen;
  }

  /**
   * Elects a replacement candidate when a single leader has failed
   */
  public static electReplacement(
    activeRemainingLeaders: PeerId[],
    availablePeers: ScoredPeer[]
  ): PeerId | null {
    const leaderSet = new Set(activeRemainingLeaders);
    const eligible = availablePeers
      .filter((p) => !leaderSet.has(p.peerId))
      .sort((a, b) => b.score - a.score);

    return eligible[0]?.peerId ?? null;
  }
}
