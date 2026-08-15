// ─── Floating Action Button, In-Page Widget, Whiteboard Preferences & Settings Types ───

import { WhiteboardBackgroundType, WhiteboardPrivacyMode } from '../whiteboard/whiteboard.types';

export type FabDisplayMode = 'coding_sites' | 'all_sites' | 'custom_sites' | 'disabled';
export type FabClickAction = 'open_popup' | 'open_extension';
export type FabPositionMode = 'permanent' | 'temporary';

export interface FabPosition {
  right: number;
  bottom: number;
}

export interface WhiteboardPreferences {
  defaultPrivacyMode: WhiteboardPrivacyMode;
  defaultBackgroundType: WhiteboardBackgroundType;
  defaultBgColor: string;
  defaultPenColor: string;
  defaultPenWidth: number;
  disappearingInkDurationSec: number; // 2, 3, 5 seconds
  autoSavePersonalNotebook: boolean;
}

export const DEFAULT_WHITEBOARD_PREFERENCES: WhiteboardPreferences = {
  defaultPrivacyMode: 'collaborative',
  defaultBackgroundType: 'grid',
  defaultBgColor: '#090d16',
  defaultPenColor: '#6366f1',
  defaultPenWidth: 4,
  disappearingInkDurationSec: 3,
  autoSavePersonalNotebook: true,
};

export interface FabSettings {
  mode: FabDisplayMode;
  clickAction: FabClickAction;
  customDomains: string[];
  enableWhiteboard: boolean; // Not on by default, toggleable in Settings
  positionMode: FabPositionMode; // 'permanent' (saves dragged spot across all tabs) | 'temporary' (resets on page reload)
  savedPosition?: FabPosition; // Custom dragged coordinate offsets
  whiteboardPrefs?: WhiteboardPreferences;
}

export const DEFAULT_FAB_SETTINGS: FabSettings = {
  mode: 'coding_sites',
  clickAction: 'open_popup',
  customDomains: ['leetcode.com', 'neetcode.io', 'codeforces.com', 'hackerrank.com', 'geeksforgeeks.org'],
  enableWhiteboard: false,
  positionMode: 'permanent',
  savedPosition: { right: 24, bottom: 24 },
  whiteboardPrefs: DEFAULT_WHITEBOARD_PREFERENCES,
};

export const FAB_STORAGE_KEY = 'nerd_buddy_fab_settings';
export const SYNQTO_FAB_STORAGE_KEY = 'synqto_fab_settings';
