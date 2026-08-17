// ─── Gamification & Streak Types ───

export interface DailyActivity {
  date: string; // ISO date format "YYYY-MM-DD"
  count: number; // intensity score (problems + focus intervals)
  problemsVisited: number;
  minutesSpent: number;
  messagesSent: number;
}

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  totalDaysActive: number;
  totalProblemsSolved: number;
  totalFocusMinutes: number;
  lastActiveDate: string; // "YYYY-MM-DD"
  activityMap: Record<string, DailyActivity>; // Key: "YYYY-MM-DD"
}

export type BadgeId =
  | 'streak_3'
  | 'streak_7'
  | 'streak_30'
  | 'problems_5'
  | 'problems_25'
  | 'problems_100'
  | 'focus_1h'
  | 'focus_10h'
  | 'mesh_leader'
  | 'live_tutor'
  | 'private_squad';

export interface Badge {
  id: BadgeId;
  title: string;
  description: string;
  icon: string; // emoji icon
  category: 'streak' | 'problem' | 'focus' | 'social';
  unlockedAt: number | null; // timestamp if unlocked
  progress: {
    current: number;
    max: number;
  };
}
