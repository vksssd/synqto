// ─── Synqto Content Script Entry Point ───

import { PageObserver } from './page-observer';
import { DetectedResource } from './resource-detector';
import { CursorOverlay } from './cursor-overlay';
import { FloatingWidget } from './floating-widget';
import { InPageEditorSync } from './in-page-editor-sync';

console.log('[Synqto] Content script initialized on:', window.location.href);

// 1. Initialize live problem observer
new PageObserver((resource: DetectedResource) => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'PROBLEM_DETECTED',
        payload: resource,
      });
    }
  } catch (err) {
    // Extension context invalidated on update
  }
});

// 2. Initialize live laser pointer and cursor overlay
new CursorOverlay();

// 3. Initialize in-browser floating button and quick chat widget
new FloatingWidget();

// 4. Initialize in-situ LeetCode problem editor synchronization engine
new InPageEditorSync();
