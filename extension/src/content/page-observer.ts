// ─── Single Page Application (SPA) & DOM Title Observer ───

import { debounce } from '@/shared/utils';
import { detectResource, DetectedResource } from './resource-detector';

function isExtensionValid(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

export class PageObserver {
  private lastUrl = '';
  private lastTitle = '';
  private callback: (resource: DetectedResource) => void;
  private mutationObserver: MutationObserver | null = null;
  private pollTimer: any = null;

  constructor(callback: (resource: DetectedResource) => void) {
    this.callback = callback;
    this.init();
  }

  private init() {
    this.checkCurrentPage();

    // 1. Intercept History API (pushState & replaceState) for Next.js / React Router SPAs
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.debouncedCheck();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.debouncedCheck();
    };

    // 2. Navigation events
    window.addEventListener('popstate', () => this.debouncedCheck());
    window.addEventListener('hashchange', () => this.debouncedCheck());
    window.addEventListener('yt-navigate-finish', () => this.debouncedCheck());

    // 3. MutationObserver on document.title & problem headings
    this.mutationObserver = new MutationObserver(() => {
      if (document.title !== this.lastTitle) {
        this.debouncedCheck();
      }
    });

    const titleEl = document.querySelector('title');
    if (titleEl) {
      this.mutationObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
    }

    // 4. Polling fallback (350ms interval) to catch quiet SPA transitions
    this.pollTimer = setInterval(() => {
      if (!isExtensionValid()) {
        this.destroy();
        return;
      }
      if (window.location.href !== this.lastUrl) {
        this.checkCurrentPage();
      }
    }, 350);
  }

  private debouncedCheck = debounce(() => {
    if (!isExtensionValid()) {
      this.destroy();
      return;
    }
    this.checkCurrentPage();
  }, 250);

  private checkCurrentPage() {
    const currentUrl = window.location.href;
    const currentTitle = document.title;

    if (currentUrl === this.lastUrl && currentTitle === this.lastTitle) {
      return;
    }

    this.lastUrl = currentUrl;
    this.lastTitle = currentTitle;

    const resource = detectResource(currentUrl, currentTitle);
    if (resource) {
      this.callback(resource);
    }
  }

  public destroy() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
