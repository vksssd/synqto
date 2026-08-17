// ─── Adaptive Topology Tier Coordinator with Time-Based Hysteresis ───

import {
  TopologyTier,
  TopologyLifecycleState,
  TOPOLOGY_THRESHOLDS,
  TOPOLOGY_TIMERS,
} from './topology.types';

export class TierCoordinator {
  private currentTier: TopologyTier = 'TIER1_FULL_MESH';
  private lifecycleState: TopologyLifecycleState = 'STABLE_TIER1';
  private peerCount = 1;

  private transitionTimer: any = null;
  private onTierChangedFn: ((newTier: TopologyTier, oldTier: TopologyTier) => void) | null = null;
  private onStateChangedFn: ((newState: TopologyLifecycleState) => void) | null = null;

  public onTierChanged(callback: (newTier: TopologyTier, oldTier: TopologyTier) => void): void {
    this.onTierChangedFn = callback;
  }

  public onStateChanged(callback: (state: TopologyLifecycleState) => void): void {
    this.onStateChangedFn = callback;
  }

  public getCurrentTier(): TopologyTier {
    return this.currentTier;
  }

  public getLifecycleState(): TopologyLifecycleState {
    return this.lifecycleState;
  }

  /**
   * Evaluates current peer count and drives hysteresis state machine
   */
  public updatePeerCount(count: number): void {
    this.peerCount = Math.max(1, count);
    this.evaluateTransitions();
  }

  private evaluateTransitions(): void {
    switch (this.currentTier) {
      case 'TIER1_FULL_MESH':
        if (this.peerCount >= TOPOLOGY_THRESHOLDS.TIER1_PROMOTE_AT) {
          this.scheduleTransition(
            'TIER1_EVALUATING',
            'TIER2_PREPARING',
            'TIER2_MULTI_LEADER',
            TOPOLOGY_TIMERS.PROMOTION_STABILITY_MS,
            () => this.peerCount >= TOPOLOGY_THRESHOLDS.TIER1_PROMOTE_AT
          );
        } else {
          this.cancelScheduledTransition('STABLE_TIER1');
        }
        break;

      case 'TIER2_MULTI_LEADER':
        if (this.peerCount <= TOPOLOGY_THRESHOLDS.TIER1_DEMOTE_AT) {
          // Demote to Tier 1 after 30s stability
          this.scheduleTransition(
            'TIER2_DEMOTING',
            'TIER1_FULL_MESH' as any,
            'TIER1_FULL_MESH',
            TOPOLOGY_TIMERS.DEMOTION_STABILITY_MS,
            () => this.peerCount <= TOPOLOGY_THRESHOLDS.TIER1_DEMOTE_AT
          );
        } else if (this.peerCount >= TOPOLOGY_THRESHOLDS.TIER2_PROMOTE_AT) {
          // Promote to Tier 3 (Relay) after 10s stability
          this.scheduleTransition(
            'TIER3_PREPARING',
            'STABLE_TIER3' as any,
            'TIER3_SERVER_RELAY',
            TOPOLOGY_TIMERS.PROMOTION_STABILITY_MS,
            () => this.peerCount >= TOPOLOGY_THRESHOLDS.TIER2_PROMOTE_AT
          );
        } else {
          this.cancelScheduledTransition('STABLE_TIER2');
        }
        break;

      case 'TIER3_SERVER_RELAY':
        if (this.peerCount <= TOPOLOGY_THRESHOLDS.TIER2_DEMOTE_AT) {
          // Demote to Tier 2 after 30s stability
          this.scheduleTransition(
            'TIER3_DEMOTING',
            'STABLE_TIER2' as any,
            'TIER2_MULTI_LEADER',
            TOPOLOGY_TIMERS.DEMOTION_STABILITY_MS,
            () => this.peerCount <= TOPOLOGY_THRESHOLDS.TIER2_DEMOTE_AT
          );
        } else {
          this.cancelScheduledTransition('STABLE_TIER3');
        }
        break;
    }
  }

  private scheduleTransition(
    evaluatingState: TopologyLifecycleState,
    preparingState: TopologyLifecycleState,
    targetTier: TopologyTier,
    delayMs: number,
    conditionCheck: () => boolean
  ): void {
    if (this.lifecycleState === evaluatingState) {
      return; // Already in progress
    }

    this.setLifecycleState(evaluatingState);
    if (this.transitionTimer) clearTimeout(this.transitionTimer);

    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (conditionCheck()) {
        const oldTier = this.currentTier;
        this.currentTier = targetTier;
        this.setLifecycleState(
          targetTier === 'TIER1_FULL_MESH'
            ? 'STABLE_TIER1'
            : targetTier === 'TIER2_MULTI_LEADER'
            ? 'STABLE_TIER2'
            : 'STABLE_TIER3'
        );

        console.info(`[TierCoordinator] Transitioned topology tier: ${oldTier} -> ${targetTier}`);
        if (this.onTierChangedFn) {
          this.onTierChangedFn(targetTier, oldTier);
        }
      } else {
        this.cancelScheduledTransition(
          this.currentTier === 'TIER1_FULL_MESH'
            ? 'STABLE_TIER1'
            : this.currentTier === 'TIER2_MULTI_LEADER'
            ? 'STABLE_TIER2'
            : 'STABLE_TIER3'
        );
      }
    }, delayMs);
  }

  private cancelScheduledTransition(stableState: TopologyLifecycleState): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.lifecycleState !== stableState) {
      this.setLifecycleState(stableState);
    }
  }

  private setLifecycleState(state: TopologyLifecycleState): void {
    this.lifecycleState = state;
    if (this.onStateChangedFn) {
      this.onStateChangedFn(state);
    }
  }

  public reset(): void {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
    this.currentTier = 'TIER1_FULL_MESH';
    this.lifecycleState = 'STABLE_TIER1';
    this.peerCount = 1;
  }
}
