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
          } else {
            // Initialize mock past 30 days data so user has visual squares on day 1
            this.initSampleHeatmap();
          }

          const badges = res[STORAGE_KEY_BADGES] || res[LEGACY_STORAGE_KEY_BADGES];
          if (badges) {
            const loadedBadges = badges as Record<BadgeId, Badge>;
            this.badges = { ...this.getDefaultBadges(), ...loadedBadges };
          }

          this.touchStreak();
          this.evaluateBadges();
          this.initialized = true;
          this.emitChange();
        }
      );
    } else {
      this.initSampleHeatmap();
      this.touchStreak();
      this.evaluateBadges();
      this.initialized = true;
      this.emitChange();
    }
  }

  private initSampleHeatmap(): void {
    const today = new Date();
    // Fill sample past 14 days with activity for visual satisfaction
    for (let i = 14; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      const dateStr = this.getTodayDateString(d);
      if (i % 2 === 0 || i < 3) {
        this.stats.activityMap[dateStr] = {
          date: dateStr,
          count: Math.floor(Math.random() * 4) + 1,
          problemsVisited: Math.floor(Math.random() * 3) + 1,
          minutesSpent: (Math.floor(Math.random() * 3) + 1) * 20,
          messagesSent: Math.floor(Math.random() * 6) + 1,
        };
      }
    }
    this.stats.currentStreak = 3;
    this.stats.longestStreak = 5;
    this.stats.totalProblemsSolved = 8;
    this.stats.totalFocusMinutes = 180;
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
   * Evaluates streak continuation for today.
   */
  public touchStreak(): void {
    const today = this.getTodayDateString();
    const yesterday = this.getYesterdayDateString();

    if (!this.stats.activityMap[today]) {
      this.stats.activityMap[today] = {
        date: today,
        count: 1,
        problemsVisited: 1,
        minutesSpent: 1,
        messagesSent: 0,
      };
    } else {
      this.stats.activityMap[today].count += 1;
    }

    if (this.stats.lastActiveDate === today) {
      // Already active today — nothing to recalculate
    } else if (this.stats.lastActiveDate === yesterday) {
      // Continued streak from yesterday!
      this.stats.currentStreak += 1;
      this.stats.longestStreak = Math.max(this.stats.longestStreak, this.stats.currentStreak);
      this.stats.totalDaysActive += 1;
    } else if (this.stats.lastActiveDate !== today) {
      // Missed a day — reset streak to 1
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
    const today = this.getTodayDateString();
    this.touchStreak();

    if (this.stats.activityMap[today]) {
      this.stats.activityMap[today].problemsVisited += 1;
      this.stats.activityMap[today].count += 2;
    }

    this.stats.totalProblemsSolved += 1;
    this.evaluateBadges();
    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Records sending a collaborative chat message.
   */
  public recordMessageSent(): void {
    const today = this.getTodayDateString();
    this.touchStreak();

    if (this.stats.activityMap[today]) {
      this.stats.activityMap[today].messagesSent += 1;
    }
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
    setInterval(() => {
      const today = this.getTodayDateString();
      if (this.stats.activityMap[today]) {
        this.stats.activityMap[today].minutesSpent += 1;
      }
      this.stats.totalFocusMinutes += 1;
      this.evaluateBadges();
      this.saveToStorage();
      this.emitChange();
    }, 60000);
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
