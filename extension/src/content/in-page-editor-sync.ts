// ─── In-Page LeetCode & Coding Platform Collaborative Editor Sync ───

import { safeCssColor, safeDisplayText, escapeHtml } from '@/core/security/sanitize';

export interface RemotePeerCursor {
  peerId: string;
  nickname: string;
  color: string;
  line: number;
  ch: number;
  lastActive: number;
}

export class InPageEditorSync {
  private isEnabled: boolean = true;
  /** Which page editor the MAIN-world bridge hooked, if any. */
  private attachedEditorKind: 'monaco' | 'codemirror' | 'textarea' | null = null;
  private showDock: boolean = false;
  private dockPosition: { top: number; right: number } = { top: 16, right: 90 };
  private isDragging: boolean = false;
  private dragMoved: boolean = false;
  private activePeers: Map<string, RemotePeerCursor> = new Map();
  private containerEl: HTMLElement | null = null;
  private lastSentCode: string = '';
  private lastSentCursor: { line: number; ch: number } = { line: 1, ch: 1 };
  private cleanupInterval: any = null;

  constructor() {
    this.init();
  }

  private async init() {
    // 1. Load user preference & FAB settings
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        'synqto_code_together_enabled',
        'synqto_code_together_dock_visible',
        'synqto_fab_settings',
        'nerd_buddy_fab_settings',
      ]);
      this.isEnabled = res.synqto_code_together_enabled !== false;
      const fabSettings = res.synqto_fab_settings || res.nerd_buddy_fab_settings;
      this.showDock = Boolean(res.synqto_code_together_dock_visible || fabSettings?.showCodeTogetherDock);
      if (fabSettings?.savedCodeTogetherPosition) {
        this.dockPosition = { ...fabSettings.savedCodeTogetherPosition };
      }
    }

    // 2. Inject the main-world bridge into page DOM
    this.injectMainWorldBridge();

    // 3. Setup postMessage bridge with in-page script
    this.setupPageMessageListeners();

    // 4. Setup runtime message listeners from extension / WebRTC mesh
    this.setupRuntimeListeners();

    // 5. Setup storage change listeners for live toggle
    this.setupStorageListeners();

    // 6. Render in-page "Code Together" dock badge (ONLY if enabled in settings)
    if (this.showDock) {
      this.renderFloatingDock();
    }

    // 7. Start active cursor cleanup ticker
    this.startCursorCleanup();

    // Request initial code state from extension if available
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CODE_GET_STATE' }, (resp) => {
        if (resp && resp.code && this.isEnabled) {
          this.applyRemoteCodeToPage(resp.code, resp.language || 'python', resp.lastEditedBy, 1, 1);
        }
      });
    }
  }

  private setupStorageListeners() {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      let changed = false;
      if (changes.synqto_code_together_enabled) {
        this.isEnabled = changes.synqto_code_together_enabled.newValue !== false;
        changed = true;
      }
      if (changes.synqto_code_together_dock_visible) {
        this.showDock = Boolean(changes.synqto_code_together_dock_visible.newValue);
        changed = true;
      }
      if (changes.synqto_fab_settings || changes.nerd_buddy_fab_settings) {
        const newSettings = changes.synqto_fab_settings?.newValue || changes.nerd_buddy_fab_settings?.newValue;
        if (newSettings) {
          if (newSettings.showCodeTogetherDock !== undefined) {
            this.showDock = Boolean(newSettings.showCodeTogetherDock);
          }
          if (newSettings.savedCodeTogetherPosition) {
            this.dockPosition = { ...newSettings.savedCodeTogetherPosition };
          }
          changed = true;
        }
      }

      if (changed) {
        if (this.showDock) {
          this.renderFloatingDock();
        } else if (this.containerEl) {
          this.containerEl.remove();
          this.containerEl = null;
        }
      }
    });
  }

  // ─── Main-World Bridge Injection (CSP Compliant) ───
  // Uses chrome.runtime.getURL to load external script without violating host page CSP
  private injectMainWorldBridge() {
    if (typeof document === 'undefined') return;

    // Check if bridge is already active via "world": "MAIN" content script
    if (document.documentElement?.getAttribute('data-synqto-bridge') === 'active') {
      return;
    }
    if (document.getElementById('synqto-inpage-editor-bridge')) return;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        const script = document.createElement('script');
        script.id = 'synqto-inpage-editor-bridge';
        script.src = chrome.runtime.getURL('content/in-page-bridge.js');
        script.async = true;
        (document.head || document.documentElement).appendChild(script);
      }
    } catch (e) {
      console.warn('[Synqto] Could not inject in-page editor bridge:', e);
    }
  }

  // ─── PostMessage Bridge Listeners ───
  private setupPageMessageListeners() {
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.source !== 'SYNQTO_EDITOR_BRIDGE') return;

      const { type, payload } = event.data;

      if (!this.isEnabled) return;

      if (type === 'EDITOR_ATTACHED') {
        this.attachedEditorKind = (event.data as any).kind ?? null;
        return;
      }

      if (type === 'LOCAL_CODE_CHANGED') {
        const { code, line, col, language } = payload;
        if (code !== this.lastSentCode) {
          this.lastSentCode = code;
          this.lastSentCursor = { line, ch: col };

          // Send to background service worker for WebRTC mesh relay
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'CODE_DELTA_LOCAL',
              payload: {
                code,
                cursorLine: line,
                cursorCol: col,
                language: language || 'python',
              },
            }).catch(() => {});
          }
        }
      } else if (type === 'LOCAL_CURSOR_MOVED') {
        const { line, ch } = payload;
        if (line !== this.lastSentCursor.line || ch !== this.lastSentCursor.ch) {
          this.lastSentCursor = { line, ch };

          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'CODE_CURSOR_LOCAL',
              payload: { line, ch },
            }).catch(() => {});
          }
        }
      }
    });
  }

  // ─── Runtime Message Listeners from Extension & Mesh ───
  private setupRuntimeListeners() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      // Answer the panel's probe even when sync is disabled, so the panel can state
      // accurately whether this tab has a real editor to collaborate in.
      if (message?.type === 'CODE_EDITOR_PROBE') {
        sendResponse({ attached: this.hasAttachedEditor(), enabled: this.isEnabled });
        return true;
      }

      if (!this.isEnabled) return;

      if (message.type === 'CODE_DELTA_REMOTE' || message.type === 'CODE_SYNC_REMOTE') {
        const { code, language, cursorLine, cursorCol, sender, lastEditedBy } = message.payload;
        this.applyRemoteCodeToPage(
          code,
          language,
          sender?.nickname || lastEditedBy || 'Peer',
          cursorLine || 1,
          cursorCol || 1
        );

        if (sender) {
          this.activePeers.set(sender.peerId, {
            peerId: sender.peerId,
            nickname: sender.nickname,
            color: sender.color || '#3b82f6',
            line: cursorLine || 1,
            ch: cursorCol || 1,
            lastActive: Date.now(),
          });
          this.updateFloatingDock();
        }
      } else if (message.type === 'CODE_CURSOR_REMOTE') {
        const { peerId, nickname, color, line, ch } = message.payload;
        this.applyRemoteCursorToPage(peerId, nickname, color, line, ch);

        this.activePeers.set(peerId, {
          peerId,
          nickname,
          color: color || '#3b82f6',
          line,
          ch,
          lastActive: Date.now(),
        });
        this.updateFloatingDock();
      }
    });
  }

  /** True when this tab has a real page editor to collaborate in. */
  private hasAttachedEditor(): boolean {
    return this.attachedEditorKind !== null;
  }

  private applyRemoteCodeToPage(code: string, language: string, senderNick: string, cursorLine: number, cursorCol: number) {
    this.lastSentCode = code;
    window.postMessage({
      source: 'SYNQTO_CONTENT_SCRIPT',
      type: 'APPLY_REMOTE_CODE',
      payload: {
        code,
        language,
        cursorLine,
        cursorCol,
        sender: senderNick,
      },
    }, '*');
  }

  private applyRemoteCursorToPage(peerId: string, nickname: string, color: string, line: number, ch: number) {
    window.postMessage({
      source: 'SYNQTO_CONTENT_SCRIPT',
      type: 'APPLY_REMOTE_CURSOR',
      payload: {
        peerId,
        nickname,
        color,
        line,
        ch,
      },
    }, '*');
  }

  // ─── Floating & Draggable "Code Together" Status Dock ───
  private renderFloatingDock() {
    if (this.containerEl) this.containerEl.remove();
    if (!this.showDock) return;

    const dock = document.createElement('div');
    dock.id = 'synqto-code-together-dock';
    const top = Number.isFinite(this.dockPosition?.top) ? this.dockPosition.top : 16;
    const right = Number.isFinite(this.dockPosition?.right) ? this.dockPosition.right : 90;

    dock.style.cssText = `
      position: fixed !important;
      top: ${top}px !important;
      right: ${right}px !important;
      z-index: 2147483640 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 5px 10px !important;
      border-radius: 9999px !important;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95)) !important;
      border: 1px solid ${this.isEnabled ? 'rgba(99, 102, 241, 0.45)' : 'rgba(255, 255, 255, 0.12)'} !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
      color: #ffffff !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      cursor: grab !important;
      backdrop-filter: blur(16px) !important;
      user-select: none !important;
      touch-action: none !important;
      transition: border-color 0.2s ease, box-shadow 0.2s ease !important;
    `;

    document.body.appendChild(dock);
    this.containerEl = dock;

    // Draggable handling
    let startX = 0;
    let startY = 0;
    let initialRight = right;
    let initialTop = top;

    const onPointerMove = (e: MouseEvent | TouchEvent) => {
      if (!this.isDragging) return;
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.hypot(dx, dy) > 4) {
        this.dragMoved = true;
        const newRight = initialRight - dx;
        const newTop = initialTop + dy;

        this.dockPosition = {
          right: Math.max(10, Math.min(window.innerWidth - 160, newRight)),
          top: Math.max(10, Math.min(window.innerHeight - 50, newTop)),
        };

        if (this.containerEl) {
          this.containerEl.style.setProperty('right', `${this.dockPosition.right}px`, 'important');
          this.containerEl.style.setProperty('top', `${this.dockPosition.top}px`, 'important');
        }
      }
    };

    const onPointerUp = () => {
      if (this.isDragging) {
        this.isDragging = false;
        if (this.containerEl) this.containerEl.style.cursor = 'grab';
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);

        if (this.dragMoved) {
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local.get(['synqto_fab_settings'], (res) => {
              const current = res.synqto_fab_settings || {};
              chrome.storage.local.set({
                synqto_fab_settings: {
                  ...current,
                  savedCodeTogetherPosition: { ...this.dockPosition },
                },
              });
            });
          }

          setTimeout(() => {
            this.dragMoved = false;
          }, 60);
        }
      }
    };

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      this.isDragging = true;
      this.dragMoved = false;
      if (this.containerEl) this.containerEl.style.cursor = 'grabbing';
      startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      initialRight = this.dockPosition.right;
      initialTop = this.dockPosition.top;

      window.addEventListener('mousemove', onPointerMove, { passive: true });
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: true });
      window.addEventListener('touchend', onPointerUp);
    };

    dock.addEventListener('mousedown', onPointerDown);
    dock.addEventListener('touchstart', onPointerDown, { passive: true });

    dock.addEventListener('click', () => {
      if (this.dragMoved) return;
      this.toggleCodeTogether();
    });

    this.updateFloatingDock();
  }

  private updateFloatingDock() {
    if (!this.containerEl) return;

    const peerCount = this.activePeers.size;

    this.containerEl.innerHTML = `
      <span style="font-size: 10px; opacity: 0.5; margin-right: -2px;">⠿</span>
      <span style="font-size: 13px;">${this.isEnabled ? '👥' : '🔒'}</span>
      <span style="color: ${this.isEnabled ? '#818cf8' : '#94a3b8'};">Code Together:</span>
      <span style="padding: 1px 6px; border-radius: 10px; font-size: 10px; background: ${this.isEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)'}; color: ${this.isEnabled ? '#34d399' : '#94a3b8'};">
        ${this.isEnabled ? (peerCount > 0 ? `Synced (${peerCount + 1})` : 'Active ⚡') : 'Solo'}
      </span>
      ${this.isEnabled && peerCount > 0 ? `
        <div style="display:flex;align-items:center;gap:2px;margin-left:4px;">
          ${Array.from(this.activePeers.values()).map(p => {
            // Every field on `p` came from a remote peer's CODE_DELTA_REMOTE /
            // CODE_CURSOR_REMOTE payload and this whole string is assigned via innerHTML.
            //
            // Unsanitised, `nickname` closed the title attribute and added an event handler
            // (script execution in the content script's world on the victim's page), and
            // `color` appended CSS declarations to a style attribute. line/ch were
            // interpolated as if numeric but arrive as arbitrary JSON values.
            const dotColor = safeCssColor(p.color, '#3b82f6');
            const name = escapeHtml(safeDisplayText(p.nickname, 32) || 'Peer');
            const line = Number.isFinite(Number(p.line)) ? Math.trunc(Number(p.line)) : 0;
            const col = Number.isFinite(Number(p.ch)) ? Math.trunc(Number(p.ch)) : 0;
            return `
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor};" title="${name} (line ${line}, col ${col})"></span>
          `;
          }).join('')}
        </div>
      ` : ''}
    `;

    this.containerEl.style.borderColor = this.isEnabled ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.12)';
  }

  private toggleCodeTogether() {
    this.isEnabled = !this.isEnabled;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ synqto_code_together_enabled: this.isEnabled });
    }
    this.updateFloatingDock();
  }

  private startCursorCleanup() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      this.activePeers.forEach((cursor, peerId) => {
        if (now - cursor.lastActive > 15000) {
          this.activePeers.delete(peerId);
          window.postMessage({
            source: 'SYNQTO_CONTENT_SCRIPT',
            type: 'REMOVE_PEER_CURSOR',
            payload: { peerId },
          }, '*');
          changed = true;
        }
      });
      if (changed) this.updateFloatingDock();
    }, 4000);
  }
}
