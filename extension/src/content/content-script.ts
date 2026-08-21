// ─── Synqto Content Script Entry Point ───

import { PageObserver } from './page-observer';
import { DetectedResource } from './resource-detector';
import { CursorOverlay } from './cursor-overlay';
import { FloatingWidget } from './floating-widget';
import { InPageEditorSync } from './in-page-editor-sync';

console.log('[Synqto] Content script initialized on:', window.location.href);

let cursorOverlay: CursorOverlay | null = null;
let floatingWidget: FloatingWidget | null = null;
let editorSync: InPageEditorSync | null = null;

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
}, () => {
  // PageObserver is the low-cost liveness sentinel. When Chrome invalidates this isolated
  // world, tear down every other long-lived owner too; otherwise their global listeners and
  // recurring timers survive on the host page until it is manually reloaded.
  cursorOverlay?.destroy();
  editorSync?.destroy();
  floatingWidget?.handleContextInvalidated();
});

// 2. Initialize live laser pointer and cursor overlay
cursorOverlay = new CursorOverlay();

// 3. Initialize in-browser floating button and quick chat widget
floatingWidget = new FloatingWidget();

// 4. Initialize in-situ LeetCode problem editor synchronization engine
editorSync = new InPageEditorSync();
