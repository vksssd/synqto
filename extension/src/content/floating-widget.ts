// ─── In-Browser Floating Action Button & Pixel-Perfect Problem Chat Popup ───

import { FabSettings, DEFAULT_FAB_SETTINGS, FAB_STORAGE_KEY } from '@/features/settings/fab-settings.types';
import { detectResource } from './resource-detector';
import { getPlatformBadgeColor, computeRoomId } from '@/features/room/room-utils';

interface ChatMessageData {
  id: string;
  from: {
    nickname: string;
    avatar: string;
    color: string;
    peerId: string;
  };
  text: string;
  timestamp: number;
  replyTo?: string;
  replyPreview?: string;
  status?: 'pending' | 'sent' | 'delivered' | 'read';
  isSelf?: boolean;
}

export class FloatingWidget {
  private hostElement: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private isOpen = false;
  private settings: FabSettings = DEFAULT_FAB_SETTINGS;
  private currentProblem: { platform: string; slug: string; title: string; canonicalUrl: string; roomId: string } | null = null;
  private messages: ChatMessageData[] = [];
  private unreadCount = 0;
  private currentRoomStorageKey = '';
  private myIdentity: { nickname: string; avatar: string; color: string; peerId: string } | null = null;
  private liveStage: any = null;
  private peerCount = 1;
  private replyingTo: ChatMessageData | null = null;
  private revealedSpoilers: Record<string, boolean> = {};

  constructor() {
    this.init();
  }

  private async init() {
    await this.loadIdentity();
    await this.loadSettings();
    this.detectCurrentPageProblem();
    this.checkVisibilityAndRender();
    this.listenToStorageChanges();
  }

  private async loadIdentity() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(['nerd_buddy_identity']);
      if (res.nerd_buddy_identity) {
        this.myIdentity = res.nerd_buddy_identity;
      }
    }

    if (!this.myIdentity) {
      this.myIdentity = {
        peerId: 'peer-' + Math.random().toString(36).slice(2, 10),
        nickname: 'Coder' + Math.floor(Math.random() * 900 + 100),
        avatar: '⚡',
        color: '#6366f1',
      };
    }
  }

  private async loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        FAB_STORAGE_KEY,
        'nerd_buddy_active_problem',
        'nerd_buddy_live_stage',
        'nerd_buddy_sidepanel_open',
        'nerd_buddy_peer_count',
      ]);

      if (res[FAB_STORAGE_KEY]) {
        this.settings = res[FAB_STORAGE_KEY];
      }
      if (res.nerd_buddy_active_problem) {
        this.currentProblem = res.nerd_buddy_active_problem;
        this.currentRoomStorageKey = `nerd_buddy_chat_${this.currentProblem?.roomId || ''}`;
        await this.loadMessages();
      }
      if (res.nerd_buddy_live_stage) {
        this.liveStage = res.nerd_buddy_live_stage;
      }
      if (typeof res.nerd_buddy_peer_count === 'number') {
        this.peerCount = Math.max(1, res.nerd_buddy_peer_count);
      }
    }
  }

  private detectCurrentPageProblem() {
    const detected = detectResource(window.location.href, document.title);
    if (detected) {
      const roomId = computeRoomId(detected.slug, detected.canonicalUrl);
      this.currentProblem = {
        platform: detected.platform,
        slug: detected.slug,
        title: detected.title,
        canonicalUrl: detected.canonicalUrl,
        roomId,
      };
      this.currentRoomStorageKey = `nerd_buddy_chat_${roomId}`;
      this.loadMessages();
    }
  }

  private shouldShow(): boolean {
    if (this.settings.mode === 'disabled') return false;
    if (this.settings.mode === 'all_sites') return true;

    const hostname = window.location.hostname.toLowerCase();

    if (this.settings.mode === 'custom_sites') {
      return this.settings.customDomains.some((d) => hostname.includes(d.toLowerCase()));
    }

    // Default 'coding_sites' mode
    const codingDomains = [
      'leetcode.com',
      'neetcode.io',
      'codeforces.com',
      'hackerrank.com',
      'geeksforgeeks.org',
      'codechef.com',
      'atcoder.jp',
      'github.com',
      'youtube.com',
      'arxiv.org',
    ];

    const isCodingDomain = codingDomains.some((d) => hostname.includes(d));
    const isDetected = Boolean(this.currentProblem || detectResource(window.location.href));
    return isCodingDomain || isDetected;
  }

  private checkVisibilityAndRender() {
    const shouldDisplay = this.shouldShow();

    if (shouldDisplay && !this.hostElement) {
      this.createWidgetDOM();
    } else if (!shouldDisplay && this.hostElement) {
      this.hostElement.remove();
      this.hostElement = null;
      this.shadow = null;
    }
  }

  private createWidgetDOM() {
    if (document.getElementById('nerd-buddy-floating-root')) return;

    this.hostElement = document.createElement('div');
    this.hostElement.id = 'nerd-buddy-floating-root';
    this.hostElement.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483645;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    `;

    document.body.appendChild(this.hostElement);
    this.shadow = this.hostElement.attachShadow({ mode: 'open' });
    this.render();
  }

  private render() {
    if (!this.shadow) return;

    const problemTitle = this.currentProblem ? this.currentProblem.title : 'Study Circle';
    const problemPlatform = this.currentProblem ? this.currentProblem.platform : 'General';
    const platformColor = getPlatformBadgeColor(problemPlatform);
    const isLive = Boolean(this.liveStage && this.liveStage.isActive);
    const tutorName = isLive ? this.liveStage.tutorIdentity?.nickname || 'Tutor' : '';
    const broadcastType = isLive ? (this.liveStage.broadcastType || 'Audio').toUpperCase() : '';

    this.shadow.innerHTML = `
      <style>
        :host {
          --bg-app: #030712;
          --bg-surface: rgba(15, 23, 42, 0.85);
          --bg-surface-elevated: rgba(30, 41, 59, 0.92);
          --bg-glass-input: rgba(3, 7, 18, 0.7);
          --border-subtle: rgba(255, 255, 255, 0.08);
          --border-medium: rgba(255, 255, 255, 0.14);
          --border-focus: rgba(99, 102, 241, 0.5);
          --primary: #6366f1;
          --primary-glow: rgba(99, 102, 241, 0.35);
          --accent-purple: #8b5cf6;
          --accent-emerald: #10b981;
          --accent-rose: #f43f5e;
          --accent-cyan: #06b6d4;
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --text-dim: #475569;
          --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }

        /* Floating Action Button */
        .fab-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 9999px;
          background: ${isLive ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #4f46e5, #7c3aed)'};
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.25);
          box-shadow: ${isLive ? '0 0 24px rgba(239, 68, 68, 0.65)' : '0 10px 25px -5px rgba(79, 70, 229, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)'};
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          user-select: none;
          backdrop-filter: blur(12px);
        }

        .fab-button:hover {
          transform: translateY(-2px) scale(1.03);
          box-shadow: ${isLive ? '0 0 32px rgba(239, 68, 68, 0.85)' : '0 14px 28px -5px rgba(79, 70, 229, 0.65)'};
        }

        .live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 0 8px #ffffff;
          animation: pulse 1.2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }

        .fab-badge {
          background: #f59e0b;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 9999px;
        }

        /* In-Page Popup Card (Identical to Sidepanel Chat View) */
        .popup-card {
          display: ${this.isOpen ? 'flex' : 'none'};
          flex-direction: column;
          position: absolute;
          bottom: 56px;
          right: 0;
          width: 380px;
          height: 520px;
          max-height: 82vh;
          background: rgba(15, 23, 42, 0.96);
          border: 1px solid ${isLive ? 'rgba(239, 68, 68, 0.45)' : 'rgba(99, 102, 241, 0.35)'};
          border-radius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85), 0 0 24px ${isLive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(99, 102, 241, 0.2)'};
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          overflow: hidden;
          animation: slideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          color: var(--text-primary);
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Room Header (Matches RoomCard) */
        .room-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95));
          border-bottom: 1px solid var(--border-subtle);
        }

        .room-info {
          display: flex;
          align-items: center;
          gap: 10px;
          overflow: hidden;
        }

        .platform-icon-box {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }

        .problem-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 170px;
        }

        .badges-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .platform-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: ${platformColor}20;
          border: 1px solid ${platformColor}50;
          color: ${platformColor};
          text-transform: uppercase;
        }

        .peer-count-pill {
          font-size: 10px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .icon-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 5px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }

        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        /* Live Broadcast Alert Bar */
        .live-stage-banner {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(139, 92, 246, 0.2));
          border-bottom: 1px solid rgba(239, 68, 68, 0.35);
          padding: 6px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          color: #fca5a5;
        }

        /* Messages List (Matches ChatCard.tsx exactly) */
        .message-list {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .chat-bubble {
          display: flex;
          flex-direction: column;
          max-width: 86%;
          padding: 8px 12px;
          border-radius: 14px;
          font-size: 12px;
          position: relative;
          word-break: break-word;
          line-height: 1.45;
        }

        .chat-bubble.self {
          align-self: flex-end;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.28), rgba(139, 92, 246, 0.22));
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-bottom-right-radius: 4px;
          color: #ffffff;
        }

        .chat-bubble.other {
          align-self: flex-start;
          background: var(--bg-surface-elevated);
          border: 1px solid var(--border-subtle);
          border-bottom-left-radius: 4px;
          color: #f1f5f9;
        }

        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
          font-size: 11px;
        }

        .chat-author {
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .chat-timestamp {
          color: var(--text-dim);
          font-size: 10px;
        }

        .reply-quote-preview {
          border-left: 2px solid var(--primary);
          padding-left: 6px;
          margin-bottom: 4px;
          font-size: 10px;
          color: var(--text-muted);
          font-style: italic;
        }

        .chat-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          margin-top: 4px;
          font-size: 10px;
          color: var(--text-dim);
        }

        .ack-read {
          color: var(--accent-cyan);
          font-weight: bold;
        }

        /* Reply Banner */
        .replying-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          color: var(--text-secondary);
          margin: 0 10px;
        }

        /* Quick Strategy Prompt Pills (Matches ChatInput.tsx) */
        .prompt-pills-row {
          display: flex;
          gap: 5px;
          padding: 6px 10px;
          overflow-x: auto;
          background: rgba(15, 23, 42, 0.4);
          border-top: 1px solid var(--border-subtle);
        }

        .prompt-pill {
          white-space: nowrap;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-subtle);
          border-radius: 9999px;
          padding: 3px 8px;
          font-size: 10px;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .prompt-pill:hover {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.4);
          color: #ffffff;
        }

        /* Composer Toolbar (Matches ChatInput.tsx) */
        .composer-box {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: rgba(30, 41, 59, 0.92);
          border-top: 1px solid var(--border-subtle);
        }

        .input-glass {
          flex: 1;
          background: var(--bg-glass-input);
          border: 1px solid var(--border-medium);
          border-radius: 8px;
          color: #ffffff;
          font-size: 12px;
          padding: 7px 10px;
          outline: none;
          font-family: inherit;
        }

        .input-glass:focus {
          border-color: var(--border-focus);
          box-shadow: 0 0 10px var(--primary-glow);
        }

        .btn-send {
          background: linear-gradient(135deg, var(--primary), var(--accent-purple));
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #ffffff;
          padding: 7px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .btn-send:hover {
          filter: brightness(1.1);
        }
      </style>

      <!-- In-Page Chat Popup -->
      <div class="popup-card" id="nb-popup">
        <!-- Room Header -->
        <div class="room-header">
          <div class="room-info">
            <div class="platform-icon-box">⚡</div>
            <div>
              <div class="problem-title">${problemTitle}</div>
              <div class="badges-row">
                <span class="platform-pill">${problemPlatform}</span>
                <span class="peer-count-pill">
                  <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
                  <span>${this.peerCount} Online</span>
                </span>
              </div>
            </div>
          </div>

          <div class="header-actions">
            <button class="icon-btn" id="nb-open-sidepanel" title="Open complete extension in side panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              </svg>
            </button>
            <button class="icon-btn" id="nb-close-popup" title="Minimize">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Live Broadcaster Banner if Active -->
        ${isLive ? `
          <div class="live-stage-banner">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="live-dot"></span>
              <span><strong>${tutorName}</strong> is broadcasting ${broadcastType}</span>
            </div>
            <button id="nb-live-tunein" style="background:#ef4444;color:#fff;border:none;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer;">
              Watch Stream 📺
            </button>
          </div>
        ` : ''}

        <!-- Message List -->
        <div class="message-list" id="nb-messages">
          ${this.messages.length === 0 ? `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);gap:8px;padding:30px 10px;text-align:center;">
              <div style="font-size:28px;">💬</div>
              <div style="font-size:13px;font-weight:600;color:var(--text-secondary);">No messages yet</div>
              <div style="font-size:11px;max-width:220px;">Say hello or ask for a hint! Messages are synchronized P2P across all peers.</div>
            </div>
          ` : this.messages.map((m, idx) => `
            <div class="chat-bubble ${m.isSelf ? 'self' : 'other'}">
              ${m.replyPreview ? `<div class="reply-quote-preview">${this.escapeHtml(m.replyPreview)}</div>` : ''}
              
              <div class="chat-header">
                <div class="chat-author">
                  <span>${m.from?.avatar || '👤'}</span>
                  <span style="color:${m.isSelf ? '#ffffff' : m.from?.color || '#a5b4fc'}">
                    ${m.isSelf ? 'You' : m.from?.nickname || 'Buddy'}
                  </span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                  <span class="chat-timestamp">${this.formatTimestamp(m.timestamp)}</span>
                  <button class="icon-btn nb-reply-trigger" data-id="${m.id}" data-text="${this.escapeHtml(m.text.slice(0, 35))}" data-nick="${this.escapeHtml(m.from?.nickname || 'Buddy')}" style="padding:0;width:18px;height:18px;" title="Reply">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M9 14L4 9l5-5"/>
                      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v5.5"/>
                    </svg>
                  </button>
                </div>
              </div>

              <div class="chat-body">${this.renderFormattedText(m.text, idx)}</div>

              ${m.isSelf ? `
                <div class="chat-footer">
                  ${m.status === 'pending' ? '<span>⏳</span>' : ''}
                  ${m.status === 'sent' ? '<span style="color:var(--text-dim);">✓</span>' : ''}
                  ${m.status === 'delivered' ? '<span style="color:var(--text-secondary);">✓✓</span>' : ''}
                  ${m.status === 'read' ? '<span class="ack-read">✓✓</span>' : ''}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>

        <!-- Replying Banner -->
        ${this.replyingTo ? `
          <div class="replying-banner">
            <span>Replying to <strong>${this.replyingTo.from.nickname}</strong>: ${this.escapeHtml(this.replyingTo.text.slice(0, 30))}...</span>
            <button class="icon-btn" id="nb-cancel-reply" style="padding:0;width:18px;height:18px;">✕</button>
          </div>
        ` : ''}

        <!-- Quick Strategy Prompt Pills -->
        <div class="prompt-pills-row">
          <button class="prompt-pill" data-text="⚡ O(N) Time">⚡ O(N) Time</button>
          <button class="prompt-pill" data-text="💾 O(1) Space">💾 O(1) Space</button>
          <button class="prompt-pill" data-text="👉 Two Pointers">👉 Two Pointers</button>
          <button class="prompt-pill" data-text="🔍 Binary Search">🔍 Binary Search</button>
          <button class="prompt-pill" data-text="🧠 DP / Memo">🧠 DP / Memo</button>
          <button class="prompt-pill" data-text="💡 Sliding Window">💡 Sliding Window</button>
          <button class="prompt-pill" data-text="⏳ Anyone stuck?">⏳ Anyone stuck?</button>
        </div>

        <!-- Input Box & Composer -->
        <form class="composer-box" id="nb-composer">
          <button type="button" class="icon-btn" id="nb-spoiler-insert" title="Insert Spoiler Blur ||text||" style="width:28px;height:28px;flex-shrink:0;">
            👁️‍🗨️
          </button>
          <input type="text" class="input-glass" id="nb-input" placeholder="Type a hint, code snippet, or ||spoiler||..." />
          <button type="submit" class="btn-send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>

      <!-- Floating Action Button (FAB) -->
      <button class="fab-button" id="nb-fab-trigger">
        ${isLive ? `<span class="live-dot"></span>` : `<span>⚡</span>`}
        <span>${isLive ? `LIVE (${tutorName})` : 'Nerd Buddy'}</span>
        ${this.unreadCount > 0 ? `<span class="fab-badge">${this.unreadCount}</span>` : ''}
      </button>
    `;

    this.attachEventListeners();
  }

  private attachEventListeners() {
    if (!this.shadow) return;

    // Toggle FAB Click
    const fabBtn = this.shadow.getElementById('nb-fab-trigger');
    fabBtn?.addEventListener('click', () => {
      if (this.settings.clickAction === 'open_extension') {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
        }
        return;
      }

      this.isOpen = !this.isOpen;
      this.unreadCount = 0;
      this.render();
      if (this.isOpen) {
        this.scrollToBottom();
      }
    });

    // Close Popup Button
    const closeBtn = this.shadow.getElementById('nb-close-popup');
    closeBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
    });

    // Open Full Side Panel Button (Automatically minimizes popup)
    const openPanelBtn = this.shadow.getElementById('nb-open-sidepanel');
    openPanelBtn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
      }
    });

    // Live Tune In Button
    const liveTuneIn = this.shadow.getElementById('nb-live-tunein');
    liveTuneIn?.addEventListener('click', () => {
      this.isOpen = false;
      this.render();
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' }).catch(() => {});
      }
    });

    // Cancel Reply Button
    const cancelReplyBtn = this.shadow.getElementById('nb-cancel-reply');
    cancelReplyBtn?.addEventListener('click', () => {
      this.replyingTo = null;
      this.render();
    });

    // Reply Triggers
    const replyBtns = this.shadow.querySelectorAll('.nb-reply-trigger');
    replyBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = (e.currentTarget as HTMLElement);
        const id = target.getAttribute('data-id') || '';
        const text = target.getAttribute('data-text') || '';
        const nick = target.getAttribute('data-nick') || '';
        this.replyingTo = {
          id,
          text,
          from: { nickname: nick, avatar: '👤', color: '#a5b4fc', peerId: '' },
          timestamp: Date.now(),
        };
        this.render();
        const input = this.shadow?.getElementById('nb-input') as HTMLInputElement;
        input?.focus();
      });
    });

    // Quick Strategy Pills
    const pills = this.shadow.querySelectorAll('.prompt-pill');
    pills.forEach((p) => {
      p.addEventListener('click', (e) => {
        const text = (e.target as HTMLElement).getAttribute('data-text');
        if (text) {
          this.sendMessage(text);
        }
      });
    });

    // Insert Spoiler Shortcut
    const spoilerBtn = this.shadow.getElementById('nb-spoiler-insert');
    const input = this.shadow.getElementById('nb-input') as HTMLInputElement;
    spoilerBtn?.addEventListener('click', () => {
      if (input) {
        input.value = `${input.value}||hint solution||`;
        input.focus();
      }
    });

    // Spoiler Click-to-Reveal
    const spoilerSpans = this.shadow.querySelectorAll('.nb-spoiler-tag');
    spoilerSpans.forEach((span) => {
      span.addEventListener('click', (e) => {
        const sKey = (e.currentTarget as HTMLElement).getAttribute('data-skey') || '';
        this.revealedSpoilers[sKey] = !this.revealedSpoilers[sKey];
        this.render();
      });
    });

    // Code Copy Buttons
    const copyBtns = this.shadow.querySelectorAll('.nb-copy-code');
    copyBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const code = (e.currentTarget as HTMLElement).getAttribute('data-code') || '';
        if (code) {
          navigator.clipboard.writeText(code);
          (e.currentTarget as HTMLElement).innerText = '✓ Copied';
          setTimeout(() => {
            (e.currentTarget as HTMLElement).innerText = '📋 Copy';
          }, 1500);
        }
      });
    });

    // Composer Form Submit
    const composer = this.shadow.getElementById('nb-composer') as HTMLFormElement;
    composer?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input?.value.trim();
      if (val) {
        this.sendMessage(val, this.replyingTo ? { id: this.replyingTo.id, preview: `${this.replyingTo.from.nickname}: ${this.replyingTo.text.slice(0, 30)}` } : undefined);
        if (input) input.value = '';
        this.replyingTo = null;
      }
    });
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private renderFormattedText(text: string, msgIdx: number): string {
    const lines = text.split('\n');

    return lines.map((line, lIdx) => {
      // Code block detection
      if (line.startsWith('```') && line.endsWith('```') && line.length > 6) {
        const codeText = line.slice(3, -3);
        return `
          <div style="background:rgba(0,0,0,0.45);padding:6px 8px;border-radius:6px;margin:4px 0;font-family:var(--font-mono);font-size:11px;position:relative;">
            <pre style="margin:0;white-space:pre-wrap;word-break:break-all;">${this.escapeHtml(codeText)}</pre>
            <button class="nb-copy-code" data-code="${this.escapeHtml(codeText)}" style="position:absolute;top:4px;right:4px;background:rgba(255,255,255,0.1);border:none;color:#fff;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">
              📋 Copy
            </button>
          </div>
        `;
      }

      // Check for inline spoilers ||spoiler text||
      if (line.includes('||')) {
        const parts = line.split(/(\|\|.*?\|\|)/g);
        const renderedParts = parts.map((part, pIdx) => {
          if (part.startsWith('||') && part.endsWith('||') && part.length > 4) {
            const spoilerContent = part.slice(2, -2);
            const sKey = `${msgIdx}-${lIdx}-${pIdx}`;
            const isRevealed = Boolean(this.revealedSpoilers[sKey]);

            return `
              <span class="nb-spoiler-tag" data-skey="${sKey}" style="display:inline-block;padding:1px 6px;border-radius:4px;background:${isRevealed ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.15)'};border:1px solid rgba(255, 255, 255, 0.1);filter:${isRevealed ? 'none' : 'blur(4px)'};cursor:pointer;user-select:${isRevealed ? 'text' : 'none'};color:${isRevealed ? 'var(--text-primary)' : 'transparent'};">
                ${this.escapeHtml(spoilerContent)}
              </span>
            `;
          }
          return this.escapeHtml(part);
        }).join('');

        return `<p style="margin:2px 0;">${renderedParts}</p>`;
      }

      return `<p style="margin:2px 0;">${this.escapeHtml(line)}</p>`;
    }).join('');
  }

  private deduplicateMessages(raw: any[]): ChatMessageData[] {
    const seen = new Set<string>();
    const unique: ChatMessageData[] = [];

    for (const m of raw) {
      if (!m || !m.id) continue;
      if (!seen.has(m.id)) {
        seen.add(m.id);
        unique.push({
          ...m,
          isSelf: m.from?.peerId === this.myIdentity?.peerId || m.isSelf,
        });
      }
    }
    return unique;
  }

  private async sendMessage(text: string, replyTo?: { id: string; preview: string }) {
    if (!text.trim()) return;

    if (!this.currentRoomStorageKey && this.currentProblem?.roomId) {
      this.currentRoomStorageKey = `nerd_buddy_chat_${this.currentProblem.roomId}`;
    }

    const trimmed = text.trim();
    const messageId = 'msg-' + Math.random().toString(36).slice(2, 10) + Date.now();
    const myMsg: ChatMessageData = {
      id: messageId,
      from: this.myIdentity || { nickname: 'You', avatar: '⚡', color: '#6366f1', peerId: 'self' },
      text: trimmed,
      timestamp: Date.now(),
      replyTo: replyTo?.id,
      replyPreview: replyTo?.preview,
      status: 'sent',
      isSelf: true,
    };

    // 1. Immediate optimistic UI render
    this.messages.push(myMsg);
    this.messages = this.deduplicateMessages(this.messages);
    this.render();
    this.scrollToBottom();

    // 2. Persist to storage
    if (this.currentRoomStorageKey && typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([this.currentRoomStorageKey]);
        const existing = (res[this.currentRoomStorageKey] && Array.isArray(res[this.currentRoomStorageKey]))
          ? res[this.currentRoomStorageKey]
          : [];
        const updated = this.deduplicateMessages([...existing, myMsg]).slice(-150);
        await chrome.storage.local.set({ [this.currentRoomStorageKey]: updated });
      } catch (e) {}
    }

    // 3. Broadcast across P2P network via service worker
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SEND_PAGE_CHAT_MESSAGE',
        messageId,
        text: myMsg.text,
        replyTo: myMsg.replyTo,
        replyPreview: myMsg.replyPreview,
        roomId: this.currentProblem?.roomId,
      }).catch(() => {});
    }
  }

  private async loadMessages() {
    if (!this.currentRoomStorageKey) return;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([this.currentRoomStorageKey]);
      if (res[this.currentRoomStorageKey] && Array.isArray(res[this.currentRoomStorageKey])) {
        this.messages = this.deduplicateMessages(res[this.currentRoomStorageKey]);
        if (this.isOpen) {
          this.render();
          this.scrollToBottom();
        }
      }
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const list = this.shadow?.getElementById('nb-messages');
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    }, 40);
  }

  private listenToStorageChanges() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          // 1. Auto-minimize popup when sidepanel is opened
          if (changes.nerd_buddy_sidepanel_open) {
            if (changes.nerd_buddy_sidepanel_open.newValue === true && this.isOpen) {
              this.isOpen = false;
              this.render();
            }
          }

          // 2. Live stage awareness
          if (changes.nerd_buddy_live_stage) {
            this.liveStage = changes.nerd_buddy_live_stage.newValue;
            this.render();
          }

          // 3. User identity sync
          if (changes.nerd_buddy_identity) {
            this.myIdentity = changes.nerd_buddy_identity.newValue;
          }

          // 4. Widget settings change
          if (changes[FAB_STORAGE_KEY]) {
            this.settings = changes[FAB_STORAGE_KEY].newValue;
            this.checkVisibilityAndRender();
          }

          // 5. Active problem change
          if (changes.nerd_buddy_active_problem) {
            this.currentProblem = changes.nerd_buddy_active_problem.newValue;
            this.currentRoomStorageKey = `nerd_buddy_chat_${this.currentProblem?.roomId || ''}`;
            this.loadMessages();
            this.checkVisibilityAndRender();
          }

          // 6. Online peer count sync
          if (changes.nerd_buddy_peer_count) {
            this.peerCount = Math.max(1, changes.nerd_buddy_peer_count.newValue || 1);
            this.render();
          }

          // 7. Real-time chat sync across sidepanel and in-page popup
          if (this.currentRoomStorageKey && changes[this.currentRoomStorageKey]) {
            const raw = changes[this.currentRoomStorageKey].newValue || [];
            this.messages = this.deduplicateMessages(raw);

            if (!this.isOpen && changes[this.currentRoomStorageKey].newValue?.length > (changes[this.currentRoomStorageKey].oldValue?.length || 0)) {
              this.unreadCount++;
            }
            this.render();
            if (this.isOpen) {
              this.scrollToBottom();
            }
          }
        }
      });
    }
  }
}
