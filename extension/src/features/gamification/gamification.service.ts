// ─── Gamification & Streak Service (Serverless Zero-Knowledge) ───

import { DailyActivity, StreakStats, Badge, BadgeId } from './gamification.types';

const STORAGE_KEY_STATS = 'synqto_streak_stats';
const LEGACY_STORAGE_KEY_STATS = 'nerd_buddy_streak_stats';
const STORAGE_KEY_BADGES = 'synqto_unlocked_badges';
const LEGACY_STORAGE_KEY_BADGES = 'nerd_buddy_unlocked_badges';

export class GamificationService {
  private static instance: GamificationService | null = null;

  private stats: StreakStats = {
    currentStreak: 1,
    longestStreak: 1,
    totalDaysActive: 1,
    totalProblemsSolved: 1,
    totalFocusMinutes: 15,
    lastActiveDate: this.getTodayDateString(),
    activityMap: {},
  };

  private badges: Record<BadgeId, Badge> = this.getDefaultBadges();
  private listeners: Set<(stats: StreakStats, badges: Badge[]) => void> = new Set();
  private initialized = false;
  /** Handle for the focus heartbeat, so it can be stopped and cannot be started twice. */
  private focusHeartbeat: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.loadFromStorage();
    this.startFocusHeartbeat();
  }

  public static getInstance(): GamificationService {
    if (!GamificationService.instance) {
      GamificationService.instance = new GamificationService();
    }
    return GamificationService.instance;
  }

  private getTodayDateString(d = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getYesterdayDateString(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this.getTodayDateString(d);
  }

  private getDefaultBadges(): Record<BadgeId, Badge> {
    return {
      streak_3: {
        id: 'streak_3',
        title: '3-Day Spark',
        description: 'Code collaboratively 3 days in a row',
        icon: '🔥',
        category: 'streak',
        unlockedAt: null,
        progress: { current: 1, max: 3 },
      },
      streak_7: {
        id: 'streak_7',
        title: '7-Day Fire',
        description: 'Maintain a 1-week continuous study streak',
        icon: '⚡',
        category: 'streak',
        unlockedAt: null,
        progress: { current: 1, max: 7 },
      },
      streak_30: {
        id: 'streak_30',
        title: 'Monthly Legend',
        description: 'Unstoppable 30-day coding consistency',
        icon: '🏆',
        category: 'streak',
        unlockedAt: null,
        progress: { current: 1, max: 30 },
      },
      problems_5: {
        id: 'problems_5',
        title: 'Problem Explorer',
        description: 'Solve / explore 5 unique coding problems',
        icon: '🚀',
        category: 'problem',
        unlockedAt: null,
        progress: { current: 1, max: 5 },
      },
      problems_25: {
        id: 'problems_25',
        title: 'Algorithm Crusher',
        description: 'Work through 25 algorithmic problems',
        icon: '🧠',
        category: 'problem',
        unlockedAt: null,
        progress: { current: 1, max: 25 },
      },
      problems_100: {
        id: 'problems_100',
        title: 'Centurion Master',
        description: 'Study 100 coding problems with buddies',
        icon: '💎',
        category: 'problem',
        unlockedAt: null,
        progress: { current: 1, max: 100 },
      },
      focus_1h: {
        id: 'focus_1h',
        title: 'Deep Focus',
        description: 'Spend 60 minutes in active peer study',
        icon: '⏱️',
        category: 'focus',
        unlockedAt: null,
        progress: { current: 15, max: 60 },
      },
      focus_10h: {
        id: 'focus_10h',
        title: 'Marathon Scholar',
        description: 'Accumulate 10 hours of collaborative learning',
        icon: '📚',
        category: 'focus',
        unlockedAt: null,
        progress: { current: 15, max: 600 },
      },
      mesh_leader: {
        id: 'mesh_leader',
        title: 'Backbone Anchor',
        description: 'Serve as cluster leader in 3+ rooms',
        icon: '👑',
        category: 'social',
        unlockedAt: null,
        progress: { current: 1, max: 3 },
      },
      live_tutor: {
        id: 'live_tutor',
        title: 'Master Tutor',
        description: 'Broadcast a live teaching session on stage',
        icon: '🎓',
        category: 'social',
        unlockedAt: null,
        progress: { current: 0, max: 1 },
      },
      private_squad: {
        id: 'private_squad',
        title: 'Cipher Master',
        description: 'Create or join a password-encrypted squad',
        icon: '🔒',
        category: 'social',
        unlockedAt: null,
        progress: { current: 0, max: 1 },
      },
    };
  }

  private async loadFromStorage(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(
        [STORAGE_KEY_STATS, LEGACY_STORAGE_KEY_STATS, STORAGE_KEY_BADGES, LEGACY_STORAGE_KEY_BADGES],
        (res) => {
          const stats = res[STORAGE_KEY_STATS] || res[LEGACY_STORAGE_KEY_STATS];
          if (stats) {
            this.stats = { ...this.stats, ...stats };
            this.reconcileStreakOnLoad();
          } else {
            // Initialize mock past 30 days data so user has visual squares on day 1
            this.initEmptyStats();
          }

          const badges = res[STORAGE_KEY_BADGES] || res[LEGACY_STORAGE_KEY_BADGES];
          if (badges) {
            const loadedBadges = badges as Record<BadgeId, Badge>;
            this.badges = { ...this.getDefaultBadges(), ...loadedBadges };
          }

          // NOTE: touchStreak() is deliberately NOT called here. It used to run on every
          // load, so merely opening the side panel counted as a day of activity and
          // extended the streak. That made the streak a measure of "days the panel was
          // opened" rather than days studied. It now advances only from real signals:
          // recordProblemVisit, recordMessage and focus time.
          this.evaluateBadges();
          this.initialized = true;
          this.emitChange();
        }
      );
    } else {
      this.initEmptyStats();
      this.evaluateBadges();
      this.initialized = true;
      this.emitChange();
    }
  }

  /**
   * Starts a new user from a genuinely empty record.
   *
   * This previously fabricated ~15 days of randomised heatmap activity and seeded
   * currentStreak = 3, longestStreak = 5, totalProblemsSolved = 8 and 180 focus minutes,
   * "for visual satisfaction". That is not placeholder chrome — it is presented as the
   * user's own study history, it persists to storage on the next save, and it immediately
   * unlocks the streak_3 badge for doing nothing. A streak that can be obtained by
   * installing the extension does not mean anything, which defeats the point of tracking
   * it. New users now start at zero and earn the first square by actually studying.
   */
  private initEmptyStats(): void {
    this.stats.activityMap = {};
    this.stats.currentStreak = 0;
    this.stats.longestStreak = 0;
    this.stats.totalProblemsSolved = 0;
    this.stats.totalFocusMinutes = 0;
    this.stats.totalDaysActive = 0;
  }

  private saveToStorage(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [STORAGE_KEY_STATS]: this.stats,
        [LEGACY_STORAGE_KEY_STATS]: this.stats,
        [STORAGE_KEY_BADGES]: this.badges,
        [LEGACY_STORAGE_KEY_BADGES]: this.badges,
      });
    }
  }

  /**
   * Expires a lapsed streak at load time.
   *
   * currentStreak was only ever recalculated inside touchStreak(), which runs on activity.
   * So a user who kept a 7-day streak and then didn't study for a week would open the panel
   * and still be told "7 day streak" — the number stayed frozen at its last value and only
   * collapsed to 1 once they next visited a problem. The displayed streak was therefore
   * wrong precisely when it mattered most, and it silently rewarded a streak that had
   * already been broken.
   *
   * A streak survives only if the last active day was today or yesterday.
   */
  private reconcileStreakOnLoad(): void {
    const last = this.stats.lastActiveDate;
    if (!last) return;

    const today = this.getTodayDateString();
    const yesterday = this.getYesterdayDateString();

    if (last === today || last === yesterday) return; // still alive

    if (this.stats.currentStreak !== 0) {
      this.stats.currentStreak = 0;
      // longestStreak is a historical high-water mark and is deliberately preserved.
      this.saveToStorage();
      this.emitChange();
    }
  }

  /**
   * Returns today's activity entry, creating it at zero if absent.
   *
   * Replaces a `if (this.stats.activityMap[today]) { ...increment... }` pattern that appeared
   * at every write site. That is a guard where an ensure was needed: when the entry did not
   * exist the increment was silently skipped rather than the day being started. The focus
   * heartbeat was the case that actually bit — it never calls touchStreak(), so on any day the
   * user neither opened a problem nor sent a message, `minutesSpent` was dropped while
   * `totalFocusMinutes` still incremented, leaving the daily map and the lifetime totals
   * permanently disagreeing with no way to tell which was right.
   */
  private ensureToday(): { date: string; count: number; problemsVisited: number; minutesSpent: number; messagesSent: number } {
    const today = this.getTodayDateString();
    let entry = this.stats.activityMap[today];
    if (!entry) {
      entry = { date: today, count: 0, problemsVisited: 0, minutesSpent: 0, messagesSent: 0 };
      this.stats.activityMap[today] = entry;
    }
    return entry;
  }

  /**
   * Evaluates streak continuation for today.
   */
  public touchStreak(): void {
    const today = this.getTodayDateString();
    const yesterday = this.getYesterdayDateString();

    // Creation used to seed `count: 1, problemsVisited: 1, minutesSpent: 1` — non-zero
    // counters for events that had not happened yet. Because recordProblemVisit() calls
    // touchStreak() and THEN does `problemsVisited += 1`, the first problem of every day was
    // counted twice, and `minutesSpent` started at 1 for zero elapsed time. Both inflated
    // numbers feed evaluateBadges(), so badges unlocked early too.
    //
    // ensureToday() creates the entry at zero and returns it; the caller does its own
    // increment. Exactly one increment per event, from one place.
    this.ensureToday().count += 1;

    if (this.stats.lastActiveDate === today) {
      // Already active today — nothing to recalculate
    } else if (this.stats.lastActiveDate === yesterday) {
      // Continued streak from yesterday!
      this.stats.currentStreak += 1;
      this.stats.longestStreak = Math.max(this.stats.longestStreak, this.stats.currentStreak);
      this.stats.totalDaysActive += 1;
    } else {
      // Either a gap of 2+ days, or the streak was already expired to 0 at load.
      // Today becomes day one of a fresh streak.
      this.stats.currentStreak = 1;
      this.stats.totalDaysActive += 1;
    }

    this.stats.lastActiveDate = today;
    this.evaluateBadges();
    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Records solving / visiting a problem.
   */
  public recordProblemVisit(problemSlug: string): void {
    this.touchStreak();

    const entry = this.ensureToday();
    entry.problemsVisited += 1;
    entry.count += 2;

    this.stats.totalProblemsSolved += 1;
    this.evaluateBadges();
    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Records sending a collaborative chat message.
   */
  public recordMessageSent(): void {
    this.touchStreak();
    this.ensureToday().messagesSent += 1;
    this.saveToStorage();
  }

  /**
   * Unlocks milestone badges based on statistics.
   */
  public unlockCustomBadge(badgeId: BadgeId): void {
    if (this.badges[badgeId] && !this.badges[badgeId].unlockedAt) {
      this.badges[badgeId].unlockedAt = Date.now();
      this.badges[badgeId].progress.current = this.badges[badgeId].progress.max;
      this.saveToStorage();
      this.emitChange();
    }
  }

  private evaluateBadges(): void {
    // 1. Streak badges
    this.updateBadgeProgress('streak_3', this.stats.currentStreak);
    this.updateBadgeProgress('streak_7', this.stats.currentStreak);
    this.updateBadgeProgress('streak_30', this.stats.currentStreak);

    // 2. Problem count badges
    this.updateBadgeProgress('problems_5', this.stats.totalProblemsSolved);
    this.updateBadgeProgress('problems_25', this.stats.totalProblemsSolved);
    this.updateBadgeProgress('problems_100', this.stats.totalProblemsSolved);

    // 3. Focus minutes badges
    this.updateBadgeProgress('focus_1h', this.stats.totalFocusMinutes);
    this.updateBadgeProgress('focus_10h', this.stats.totalFocusMinutes);
  }

  private updateBadgeProgress(badgeId: BadgeId, currentVal: number): void {
    const b = this.badges[badgeId];
    if (!b) return;

    b.progress.current = Math.min(currentVal, b.progress.max);
    if (b.progress.current >= b.progress.max && !b.unlockedAt) {
      b.unlockedAt = Date.now();
    }
  }

  /**
   * Background interval tracking 1 minute of active study focus.
   */
  private startFocusHeartbeat(): void {
    // Guarded against double-start. The handle was previously discarded, so there was no way
    // to stop the timer and no way to notice a second one running: two heartbeats would have
    // counted every minute twice, forever, with no symptom other than implausible stats.
    if (this.focusHeartbeat !== null) return;

    this.focusHeartbeat = setInterval(() => {
      // Only credit a minute the user could plausibly have spent studying.
      //
      // This used to increment unconditionally, which meant "focus minutes" measured how long
      // the extension had been loaded, not how long anyone was working: leave a tab open
      // overnight and wake up to 480 minutes of focus and every time-based badge unlocked. A
      // statistic the user cannot influence by working harder is not a statistic, and streak
      // badges built on it are unearned.
      //
      // document.hidden is a deliberately weak proxy — it cannot detect someone staring out
      // of a window — but it is honest about the one thing it does know: a backgrounded tab
      // is definitely not being read. Chrome also throttles timers in hidden tabs, so the
      // unguarded version was additionally miscounting elapsed time in exactly that state.
      if (typeof document !== 'undefined' && document.hidden) return;

      this.ensureToday().minutesSpent += 1;
      this.stats.totalFocusMinutes += 1;
      this.evaluateBadges();
      this.saveToStorage();
      this.emitChange();
    }, 60000);
  }

  /** Stops the focus heartbeat. Exists so the timer is releasable rather than immortal. */
  public stopFocusHeartbeat(): void {
    if (this.focusHeartbeat !== null) {
      clearInterval(this.focusHeartbeat);
      this.focusHeartbeat = null;
    }
  }

  public getStats(): StreakStats {
    return this.stats;
  }

  public getBadges(): Badge[] {
    return Object.values(this.badges);
  }

  public onChange(listener: (stats: StreakStats, badges: Badge[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.stats, this.getBadges());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    const badgeList = this.getBadges();
    this.listeners.forEach((fn) => fn(this.stats, badgeList));
  }
}
