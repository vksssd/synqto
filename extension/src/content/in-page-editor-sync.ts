// ─── In-Page LeetCode & Coding Platform Collaborative Editor Sync ───

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
  private activePeers: Map<string, RemotePeerCursor> = new Map();
  private containerEl: HTMLElement | null = null;
  private lastSentCode: string = '';
  private lastSentCursor: { line: number; ch: number } = { line: 1, ch: 1 };
  private cleanupInterval: any = null;

  constructor() {
    this.init();
  }

  private async init() {
    // 1. Load user preference
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(['synqto_code_together_enabled']);
      this.isEnabled = res.synqto_code_together_enabled !== false; // Default: enabled
    }

    // 2. Inject the main-world bridge into page DOM
    this.injectMainWorldBridge();

    // 3. Setup postMessage bridge with in-page script
    this.setupPageMessageListeners();

    // 4. Setup runtime message listeners from extension / WebRTC mesh
    this.setupRuntimeListeners();

    // 5. Render non-intrusive in-page "Code Together" dock badge
    this.renderFloatingDock();

    // 6. Start active cursor cleanup ticker
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

    chrome.runtime.onMessage.addListener((message) => {
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

  // ─── Floating "Code Together" Status Dock ───
  private renderFloatingDock() {
    if (this.containerEl) this.containerEl.remove();

    const dock = document.createElement('div');
    dock.id = 'synqto-code-together-dock';
    dock.style.cssText = `
      position: fixed !important;
      top: 16px !important;
      right: 90px !important;
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
      cursor: pointer !important;
      backdrop-filter: blur(16px) !important;
      user-select: none !important;
      transition: all 0.2s ease !important;
    `;

    document.body.appendChild(dock);
    this.containerEl = dock;

    dock.addEventListener('click', () => {
      this.toggleCodeTogether();
    });

    this.updateFloatingDock();
  }

  private updateFloatingDock() {
    if (!this.containerEl) return;

    const peerCount = this.activePeers.size;

    this.containerEl.innerHTML = `
      <span style="font-size: 13px;">${this.isEnabled ? '👥' : '🔒'}</span>
      <span style="color: ${this.isEnabled ? '#818cf8' : '#94a3b8'};">Code Together:</span>
      <span style="padding: 1px 6px; border-radius: 10px; font-size: 10px; background: ${this.isEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)'}; color: ${this.isEnabled ? '#34d399' : '#94a3b8'};">
        ${this.isEnabled ? (peerCount > 0 ? `Synced (${peerCount + 1})` : 'Active ⚡') : 'Solo'}
      </span>
      ${this.isEnabled && peerCount > 0 ? `
        <div style="display:flex;align-items:center;gap:2px;margin-left:4px;">
          ${Array.from(this.activePeers.values()).map(p => `
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${p.color || '#3b82f6'};box-shadow:0 0 6px ${p.color || '#3b82f6'};" title="${p.nickname} (line ${p.line}, col ${p.ch})"></span>
          `).join('')}
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
