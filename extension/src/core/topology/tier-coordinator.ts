// ─── Adaptive Topology Tier Coordinator with Time-Based Hysteresis ───

import {
  TopologyTier,
  TopologyLifecycleState,
  TopologyPolicy,
  ADAPTIVE_POLICY,
  TOPOLOGY_THRESHOLDS,
  TOPOLOGY_TIMERS,
} from './topology.types';

export type MigrationPhase =
  | 'EVALUATING'
  | 'PREPARING'
  | 'CONNECTING'
  | 'VERIFYING'
  | 'COMMITTING'
  | 'DRAINING'
  | 'STABLE'
  | 'ABORTED'
  | 'ROLLBACK';

export interface MigrationTransaction {
  transitionId: string;
  fromTier: TopologyTier;
  toTier: TopologyTier;
  phase: MigrationPhase;
  startedAt: number;
  timeoutMs: number;
}

export class TierCoordinator {
  private currentTier: TopologyTier = 'TIER1_FULL_MESH';
  private lifecycleState: TopologyLifecycleState = 'STABLE_TIER1';
  private activeTransaction: MigrationTransaction | null = null;
  private peerCount = 1;

  private transitionTimer: any = null;
  private onTierChangedFn: ((newTier: TopologyTier, oldTier: TopologyTier) => void) | null = null;
  private onStateChangedFn: ((newState: TopologyLifecycleState) => void) | null = null;

  /**
   * @param policy Which tiers this room may occupy. Defaults to ADAPTIVE_POLICY so every
   * pre-existing call site keeps its current behaviour untouched. CoFocus sessions pass
   * DIRECT_ONLY_POLICY, which makes promotion structurally unreachable rather than merely
   * unlikely — see TopologyPolicy's docblock.
   */
  constructor(private readonly policy: TopologyPolicy = ADAPTIVE_POLICY) {}

  /** Returns the policy governing this coordinator (diagnostics & assertions). */
  public getPolicy(): TopologyPolicy {
    return this.policy;
  }

  /** True if the policy permits occupying the given tier. */
  private isTierAllowed(tier: TopologyTier): boolean {
    return this.policy.allowedTiers.includes(tier);
  }

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

  public getActiveTransaction(): MigrationTransaction | null {
    return this.activeTransaction;
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
        // POLICY GATE: under DIRECT_ONLY the room may never leave full mesh, so promotion is
        // not merely rejected later — it is never evaluated, and no threshold change can
        // reach past this. Deliberately checked BEFORE the peer-count comparison so the
        // guarantee does not depend on the value of TIER1_PROMOTE_AT.
        if (!this.isTierAllowed('TIER2_MULTI_LEADER')) {
          this.cancelScheduledTransition('STABLE_TIER1');
          break;
        }
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
        } else if (
          // POLICY GATE: same reasoning as the TIER1 branch — a policy that disallows relay
          // never evaluates the TIER2 -> TIER3 promotion at all.
          this.isTierAllowed('TIER3_SERVER_RELAY') &&
          this.policy.allowRelay &&
          this.peerCount >= TOPOLOGY_THRESHOLDS.TIER2_PROMOTE_AT
        ) {
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

    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.activeTransaction = {
      transitionId: txId,
      fromTier: this.currentTier,
      toTier: targetTier,
      phase: 'EVALUATING',
      startedAt: Date.now(),
      timeoutMs: delayMs,
    };

    this.setLifecycleState(evaluatingState);
    if (this.transitionTimer) clearTimeout(this.transitionTimer);

    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (conditionCheck()) {
        const oldTier = this.currentTier;
        this.currentTier = targetTier;
        if (this.activeTransaction) {
          this.activeTransaction.phase = 'STABLE';
        }

        this.setLifecycleState(
          targetTier === 'TIER1_FULL_MESH'
            ? 'STABLE_TIER1'
            : targetTier === 'TIER2_MULTI_LEADER'
            ? 'STABLE_TIER2'
            : 'STABLE_TIER3'
        );

        console.info(`[TierCoordinator] Committed topology migration (${txId}): ${oldTier} -> ${targetTier}`);
        if (this.onTierChangedFn) {
          this.onTierChangedFn(targetTier, oldTier);
        }
      } else {
        this.rollbackMigration(txId, 'Condition not sustained');
      }
    }, delayMs);
  }

  public rollbackMigration(transitionId: string, reason: string): void {
    if (this.activeTransaction && this.activeTransaction.transitionId === transitionId) {
      this.activeTransaction.phase = 'ROLLBACK';
      console.warn(`[TierCoordinator] Rolled back migration (${transitionId}): ${reason}`);
    }

    this.cancelScheduledTransition(
      this.currentTier === 'TIER1_FULL_MESH'
        ? 'STABLE_TIER1'
        : this.currentTier === 'TIER2_MULTI_LEADER'
        ? 'STABLE_TIER2'
        : 'STABLE_TIER3'
    );
  }

  public commitMigration(transitionId: string): boolean {
    if (this.activeTransaction && this.activeTransaction.transitionId === transitionId) {
      this.activeTransaction.phase = 'COMMITTING';
      return true;
    }
    return false;
  }

  private cancelScheduledTransition(stableState: TopologyLifecycleState): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.activeTransaction && this.activeTransaction.phase !== 'STABLE') {
      this.activeTransaction.phase = 'ABORTED';
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
    this.activeTransaction = null;
    this.currentTier = 'TIER1_FULL_MESH';
    this.lifecycleState = 'STABLE_TIER1';
    this.peerCount = 1;
  }
}
