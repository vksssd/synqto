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
  private destroyed = false;
  private originalPushState: History['pushState'] | null = null;
  private originalReplaceState: History['replaceState'] | null = null;
  private patchedPushState: History['pushState'] | null = null;
  private patchedReplaceState: History['replaceState'] | null = null;
  private invalidationNotified = false;

  constructor(
    callback: (resource: DetectedResource) => void,
    private readonly onContextInvalidated?: () => void
  ) {
    this.callback = callback;
    this.init();
  }

  private init() {
    this.checkCurrentPage();

    // 1. Intercept History API (pushState & replaceState) for Next.js / React Router SPAs
    if (typeof window !== 'undefined' && window.history) {
      const originalPushState = window.history.pushState;
      const originalReplaceState = window.history.replaceState;

      if (typeof originalPushState === 'function') {
        const observer = this;
        this.originalPushState = originalPushState;
        this.patchedPushState = function (this: History, ...args) {
          originalPushState.apply(this, args);
          if (!observer.destroyed) observer.debouncedCheck();
        };
        window.history.pushState = this.patchedPushState;
      }

      if (typeof originalReplaceState === 'function') {
        const observer = this;
        this.originalReplaceState = originalReplaceState;
        this.patchedReplaceState = function (this: History, ...args) {
          originalReplaceState.apply(this, args);
          if (!observer.destroyed) observer.debouncedCheck();
        };
        window.history.replaceState = this.patchedReplaceState;
      }
    }
    // 2. Navigation events
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.handleNavigation);
      window.addEventListener('hashchange', this.handleNavigation);
      window.addEventListener('yt-navigate-finish', this.handleNavigation);
    }

    // 3. MutationObserver on document.title & problem headings
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        if (document.title !== this.lastTitle) {
          this.debouncedCheck();
        }
      });

      const titleEl = document.querySelector('title');
      if (titleEl) {
        this.mutationObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
      }
    }

    // 4. Polling fallback (1500ms interval) to catch quiet SPA transitions without CPU overhead
    this.pollTimer = setInterval(() => {
      if (!isExtensionValid()) {
        this.notifyContextInvalidated();
        this.destroy();
        return;
      }
      if (window.location.href !== this.lastUrl) {
        this.checkCurrentPage();
      }
    }, 1500);
  }

  private debouncedCheck = debounce(() => {
    if (this.destroyed) return;
    if (!isExtensionValid()) {
      this.notifyContextInvalidated();
      this.destroy();
      return;
    }
    this.checkCurrentPage();
  }, 250);

  private handleNavigation = () => {
    if (!this.destroyed) this.debouncedCheck();
  };

  private notifyContextInvalidated(): void {
    if (this.invalidationNotified) return;
    this.invalidationNotified = true;
    try {
      this.onContextInvalidated?.();
    } catch (error) {
      console.warn('[Synqto] Content-script invalidation cleanup failed:', error);
    }
  }

  private checkCurrentPage() {
    if (this.destroyed) return;
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
    if (this.destroyed) return;
    this.destroyed = true;
    this.debouncedCheck.cancel();

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.handleNavigation);
      window.removeEventListener('hashchange', this.handleNavigation);
      window.removeEventListener('yt-navigate-finish', this.handleNavigation);

      // Do not overwrite a router/library that replaced History after us. Restoration is
      // ownership-specific in the same way stale signaling cleanup is ownership-specific.
      if (this.patchedPushState && window.history.pushState === this.patchedPushState) {
        window.history.pushState = this.originalPushState!;
      }
      if (this.patchedReplaceState && window.history.replaceState === this.patchedReplaceState) {
        window.history.replaceState = this.originalReplaceState!;
      }
    }

    this.originalPushState = null;
    this.originalReplaceState = null;
    this.patchedPushState = null;
    this.patchedReplaceState = null;
  }
}
