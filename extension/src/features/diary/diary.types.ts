// ─── Synqto Personal Diary & Journal Notebook Types ───

export type DiaryMood = 'productive' | 'breakthrough' | 'challenging' | 'mastered' | 'review_needed';

export interface DiaryWhiteboardData {
  strokes: any[];
  bgColor?: string;
  bgPattern?: string;
}

export interface DiaryEntry {
  id: string;
  title: string;
  content: string; // Markdown notes, code snippets, checklists, lessons learned
  whiteboard?: DiaryWhiteboardData; // Dedicated whiteboard drawing / sketchpad for this entry
  problemTitle?: string;
  problemUrl?: string;
  tags: string[]; // e.g. ["#leetcode", "#dp", "#graphs", "#interview"]
  mood: DiaryMood;
  createdAt: number;
  updatedAt: number;
}

export interface DiaryBook {
  id: string;
  title: string;
  icon: string; // emoji e.g. "📓", "💡", "🧠", "🎯", "🚀", "⚡"
  color: string; // e.g. "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#38bdf8"
  description?: string;
  entries: DiaryEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface DiaryState {
  activeDiaryId: string;
  activeEntryId: string | null;
  diaries: DiaryBook[];
}

export const DEFAULT_DIARIES: DiaryBook[] = [
  {
    id: 'diary-problem-log',
    title: 'Daily Problem Log',
    icon: '📓',
    color: '#6366f1',
    description: 'Track daily problem solutions, algorithm patterns, and approaches.',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
    entries: [
      {
        id: 'entry-welcome',
        title: 'Welcome to your Synqto Coding Diary 🚀',
        content: `### 🎯 Daily Reflection & Problem Solving Notes

- **Approach**: Two Pointers / Sliding Window
- **Time Complexity**: $O(N)$
- **Space Complexity**: $O(1)$

#### Key Takeaway:
Always check edge cases when array length is 0 or 1.

\`\`\`python
def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            return [seen[diff], i]
        seen[num] = i
    return []
\`\`\`

- [x] Solved optimal solution
- [ ] Review edge cases tomorrow`,
        problemTitle: 'Two Sum',
        problemUrl: 'https://leetcode.com/problems/two-sum',
        tags: ['#leetcode', '#hashmap', '#arrays'],
        mood: 'breakthrough',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  },
  {
    id: 'diary-system-design',
    title: 'System Design Journal',
    icon: '💡',
    color: '#10b981',
    description: 'Architecture blueprints, trade-offs, and scalability notes.',
    createdAt: Date.now() - 43200000,
    updatedAt: Date.now(),
    entries: [
      {
        id: 'entry-sys-1',
        title: 'Rate Limiter Architecture & Redis Token Bucket',
        content: `### ⚖️ Rate Limiter Trade-offs

1. **Token Bucket Algorithm**:
   - High memory efficiency
   - Handles bursts gracefully
   - State stored in Redis with TTL

2. **Distributed Cache Failure Strategy**:
   - Fallback to local memory limiter or allow traffic with warning alert.`,
        tags: ['#system-design', '#redis', '#scalability'],
        mood: 'productive',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000,
      },
    ],
  },
  {
    id: 'diary-mistakes',
    title: 'Mistakes & Retrospectives',
    icon: '🧠',
    color: '#f59e0b',
    description: 'Bugs encountered, off-by-one errors, and tricky test cases to avoid.',
    createdAt: Date.now() - 21600000,
    updatedAt: Date.now(),
    entries: [],
  },
];
