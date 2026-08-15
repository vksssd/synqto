// ─── Floating Action Button & In-Page Widget Settings Types ───

export type FabDisplayMode = 'coding_sites' | 'all_sites' | 'custom_sites' | 'disabled';
export type FabClickAction = 'open_popup' | 'open_extension';

export interface FabSettings {
  mode: FabDisplayMode;
  clickAction: FabClickAction;
  customDomains: string[];
}

export const DEFAULT_FAB_SETTINGS: FabSettings = {
  mode: 'coding_sites',
  clickAction: 'open_popup',
  customDomains: ['leetcode.com', 'neetcode.io', 'codeforces.com', 'hackerrank.com', 'geeksforgeeks.org'],
};

export const FAB_STORAGE_KEY = 'nerd_buddy_fab_settings';
