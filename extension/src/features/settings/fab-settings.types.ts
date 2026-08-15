// ─── Floating Action Button, In-Page Widget & Whiteboard Settings Types ───

export type FabDisplayMode = 'coding_sites' | 'all_sites' | 'custom_sites' | 'disabled';
export type FabClickAction = 'open_popup' | 'open_extension';

export interface FabSettings {
  mode: FabDisplayMode;
  clickAction: FabClickAction;
  customDomains: string[];
  enableWhiteboard: boolean; // Not on by default, toggleable in Settings
}

export const DEFAULT_FAB_SETTINGS: FabSettings = {
  mode: 'coding_sites',
  clickAction: 'open_popup',
  customDomains: ['leetcode.com', 'neetcode.io', 'codeforces.com', 'hackerrank.com', 'geeksforgeeks.org'],
  enableWhiteboard: false,
};

export const FAB_STORAGE_KEY = 'nerd_buddy_fab_settings';
export const SYNQTO_FAB_STORAGE_KEY = 'synqto_fab_settings';
