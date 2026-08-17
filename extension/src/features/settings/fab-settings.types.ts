// ─── Floating Action Button, In-Page Widget, Whiteboard Preferences & Settings Types ───

import { WhiteboardBackgroundType, WhiteboardPrivacyMode } from '../whiteboard/whiteboard.types';

export type FabDisplayMode = 'coding_sites' | 'all_sites' | 'custom_sites' | 'disabled';
export type FabClickAction = 'open_popup' | 'open_extension';
export type FabPositionMode = 'permanent' | 'temporary';
export type PopupContentMode = 'all' | 'both' | 'chat_only' | 'whiteboard_only' | 'timer_only' | 'none';

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
  defaultPrivacyMode: 'personal',
  defaultBackgroundType: 'grid',
  defaultBgColor: '#090d16',
  defaultPenColor: '#6366f1',
  defaultPenWidth: 4,
  disappearingInkDurationSec: 3,
  autoSavePersonalNotebook: true,
};

export interface FabSettings {
  mode: FabDisplayMode;
  showMainFab?: boolean; // Independent toggle: Show/Hide Main Synqto FAB (default: true)
  showTimerFab?: boolean; // Independent toggle: Show/Hide Standalone Timer FAB (default: true)
  showCodeTogetherDock?: boolean; // Independent toggle: Show/Hide Code Together Dock (default: false)
  clickAction: FabClickAction;
  customDomains: string[];
  enableWhiteboard: boolean;
  enableTimer?: boolean;
  popupContentMode: PopupContentMode; // 'all' | 'both' | 'chat_only' | 'whiteboard_only' | 'timer_only' | 'none'
  positionMode: FabPositionMode; // 'permanent' (saves dragged spot across all tabs) | 'temporary' (resets on page reload)
  savedPosition?: FabPosition; // Legacy fallback
  savedMainPosition?: FabPosition; // Independent coordinates for Main FAB
  savedTimerPosition?: FabPosition; // Independent coordinates for Timer FAB
  savedCodeTogetherPosition?: { top: number; right: number }; // Draggable coordinates for CodeTogether Dock
  whiteboardPrefs?: WhiteboardPreferences;
}

export const DEFAULT_FAB_SETTINGS: FabSettings = {
  mode: 'all_sites',
  showMainFab: true,
  showTimerFab: true,
  showCodeTogetherDock: false,
  clickAction: 'open_popup',
  customDomains: ['leetcode.com', 'neetcode.io', 'codeforces.com', 'hackerrank.com', 'geeksforgeeks.org', 'codechef.com', 'atcoder.jp', 'localhost', '127.0.0.1'],
  enableWhiteboard: true,
  enableTimer: true,
  popupContentMode: 'both',
  positionMode: 'permanent',
  savedPosition: { right: 24, bottom: 24 },
  savedMainPosition: { right: 24, bottom: 24 },
  savedTimerPosition: { right: 140, bottom: 24 },
  savedCodeTogetherPosition: { top: 16, right: 90 },
  whiteboardPrefs: DEFAULT_WHITEBOARD_PREFERENCES,
};

export const FAB_STORAGE_KEY = 'nerd_buddy_fab_settings';
export const SYNQTO_FAB_STORAGE_KEY = 'synqto_fab_settings';
