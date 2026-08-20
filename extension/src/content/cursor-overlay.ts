// ─── Live Synchronized Laser Pointer & Click Ripple Overlay (Synqme Stage) ───

import { safeCssColor } from '@/core/security/sanitize';

/** Fallbacks used whenever a peer's colour fails validation. Match the app's palette. */
const DEFAULT_CURSOR_COLOR = '#6366f1';
const TUTOR_CURSOR_COLOR = '#8b5cf6';

interface RemoteCursorData {
  peerId: string;
  nickname: string;
  avatar: string;
  color: string;
  xPct: number;
  yPct: number;
  isTutor: boolean;
  timestamp: number;
}

interface ClickPulseData {
  peerId: string;
  nickname: string;
  xPct: number;
  yPct: number;
  color: string;
  isTutor?: boolean;
  timestamp: number;
}

function isExtensionValid(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

export class CursorOverlay {
  private container: HTMLDivElement | null = null;
  private cursorElements: Map<string, HTMLDivElement> = new Map();
  private cursorTimeouts: Map<string, number> = new Map();
  private myIdentity: any = null;
  private liveStage: any = null;

  constructor() {
    this.createContainer();
    this.loadState();
    this.listenToStorage();
    this.listenForMessages();
    this.setupLocalTrackers();
  }

  private async loadState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const res = await chrome.storage.local.get([
          'nerd_buddy_identity',
          'synqme_identity',
          'nerd_buddy_live_stage',
          'synqme_live_stage'
        ]);
        this.myIdentity = res.synqme_identity || res.nerd_buddy_identity || null;
        this.liveStage = res.synqme_live_stage || res.nerd_buddy_live_stage || null;
        if (!this.liveStage || !this.liveStage.isActive) {
          this.clearAllCursors();
        }
      } catch {}
    }
  }

  private listenToStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.synqme_identity || changes.nerd_buddy_identity) {
            this.myIdentity = (changes.synqme_identity || changes.nerd_buddy_identity).newValue;
          }
          if (changes.synqme_live_stage || changes.nerd_buddy_live_stage) {
            this.liveStage = (changes.synqme_live_stage || changes.nerd_buddy_live_stage).newValue;
            if (!this.liveStage || !this.liveStage.isActive) {
              this.clearAllCursors();
            }
          }
        }
      });
    }
  }

  public clearAllCursors(): void {
    this.cursorTimeouts.forEach((t) => clearTimeout(t));
    this.cursorTimeouts.clear();

    this.cursorElements.forEach((el) => {
      el.remove();
    });
    this.cursorElements.clear();

    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  private isLocalUserOnStage(): boolean {
    if (!this.liveStage || !this.liveStage.isActive) return false;
    const myPeerId = this.myIdentity?.peerId;
    if (!myPeerId) return false;

    // Check if Tutor
    if (this.liveStage.tutorIdentity?.peerId === myPeerId || this.liveStage.tutorPeerId === myPeerId || this.liveStage.myRole === 'tutor') {
      return true;
    }

    // Check if approved Speaker on stage
    if (Array.isArray(this.liveStage.guestSpeakers) && this.liveStage.guestSpeakers.some((g: any) => g.peerId === myPeerId)) {
      return true;
    }

    return false;
  }

  private createContainer(): void {
    if (document.getElementById('nerd-buddy-cursor-overlay')) return;

    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.createContainer(), { once: true });
      } else {
        window.addEventListener('load', () => this.createContainer(), { once: true });
      }
      return;
    }

    const div = document.createElement('div');
    div.id = 'nerd-buddy-cursor-overlay';
    div.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 2147483645 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    `;
    document.body.appendChild(div);
    this.container = div;

    // Inject CSS keyframes for click ripple
    if (!document.getElementById('nerd-buddy-cursor-styles')) {
      const style = document.createElement('style');
      style.id = 'nerd-buddy-cursor-styles';
      style.textContent = `
        @keyframes nb-click-ripple {
          0% { transform: scale(0.15); opacity: 1; }
          40% { opacity: 0.9; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `;
      (document.head || document.documentElement || document.body)?.appendChild(style);
    }
  }

  private listenForMessages(): void {
    if (!isExtensionValid() || !chrome.runtime?.onMessage) return;

    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!isExtensionValid()) return;

        if (msg.type === 'NERD_BUDDY_STAGE_ENDED' || msg.type === 'NERD_BUDDY_STAGE_INACTIVE') {
          this.clearAllCursors();
          return;
        }

        if (msg.type === 'NERD_BUDDY_CURSOR_UPDATE' && msg.cursor) {
          const cursor = msg.cursor as RemoteCursorData;
          if (this.mayBroadcast(cursor.peerId)) {
            this.renderCursor(cursor);
          }
        } else if (msg.type === 'NERD_BUDDY_CLICK_PULSE' && msg.click) {
          const click = msg.click as ClickPulseData;
          if (this.mayBroadcast(click.peerId)) {
            this.renderClickPulse(click);
          }
        }
      });
    } catch {}
  }

  /**
   * Decides whether a peer is allowed to draw on this viewport.
   *
   * THE BUG THIS CLOSES. The previous check was, in both branches:
   *
   *     const isBroadcaster = cursor.isTutor || (this.liveStage && <roster lookup>);
   *
   * `cursor.isTutor` is a field on the inbound packet — a claim made by the sender about
   * itself. Leading the disjunction with it meant the roster lookup never ran for anyone who
   * simply set the flag, so during a live stage (where cursors are supposed to be restricted
   * to the tutor and invited guest speakers) any participant could paint a laser pointer and
   * click ripples across every other participant's screen by asserting `isTutor: true`. The
   * click branch made it doubly explicit by re-checking `|| click.isTutor` after already
   * folding it into isBroadcaster.
   *
   * Authorisation must come from the stage roster, which is distributed by the stage owner,
   * and never from the packet being authorised. The sender's own claim is now ignored
   * entirely rather than merely deprioritised — an `||` with an attacker-controlled operand
   * is not a check.
   */
  private mayBroadcast(peerId: string): boolean {
    // No live stage means no restriction to enforce: ordinary rooms show everyone's cursor.
    if (!this.liveStage) return true;
    if (!peerId) return false;

    const stage = this.liveStage;
    if (stage.tutorIdentity?.peerId === peerId) return true;
    if (stage.tutorPeerId === peerId) return true;
    return Boolean(stage.guestSpeakers?.some((g: any) => g?.peerId === peerId));
  }

  private renderCursor(cursor: RemoteCursorData): void {
    if (!this.container) this.createContainer();
    if (!this.container) return;

    let el = this.cursorElements.get(cursor.peerId);
    if (!el) {
      el = document.createElement('div');
      el.style.cssText = `
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        pointer-events: none !important;
        transform: translate3d(0px, 0px, 0) !important;
        will-change: transform !important;
        transition: transform 0.05s linear, opacity 0.3s ease !important;
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
        opacity: 1 !important;
        z-index: 2147483646 !important;
      `;

      const avatarDiv = document.createElement('div');
      const labelDiv = document.createElement('div');
      el.appendChild(avatarDiv);
      el.appendChild(labelDiv);

      this.container.appendChild(el);
      this.cursorElements.set(cursor.peerId, el);
    }

    const x = Math.max(0, Math.min(window.innerWidth - 30, (cursor.xPct / 100) * window.innerWidth));
    const y = Math.max(0, Math.min(window.innerHeight - 30, (cursor.yPct / 100) * window.innerHeight));

    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.style.opacity = '1';

    // The peer's colour lands inside a cssText declaration list below, so it is narrowed to
    // a colour literal first. Unvalidated, `red !important; width:100vw !important;
    // height:100vh` would append declarations that override the width/height set earlier in
    // the same string — letting any peer in the room paint over the victim's whole viewport —
    // and `background:url(https://attacker/)` would turn the overlay into a tracking beacon.
    const glowColor = cursor.isTutor
      ? TUTOR_CURSOR_COLOR
      : safeCssColor(cursor.color, DEFAULT_CURSOR_COLOR);
    const avatarEl = el.firstElementChild as HTMLElement;
    const labelEl = el.lastElementChild as HTMLElement;

    if (avatarEl && (el as any)._lastColor !== glowColor) {
      (el as any)._lastColor = glowColor;
      avatarEl.style.cssText = `
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: ${glowColor};
        box-shadow: 0 0 16px ${glowColor}, 0 0 6px #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        color: #fff;
        border: 2px solid #ffffff;
      `;
      labelEl.style.cssText = `
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid ${glowColor};
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.6);
        white-space: nowrap;
      `;
    }

    if (avatarEl) avatarEl.textContent = cursor.avatar || '👑';
    if (labelEl) labelEl.textContent = `${cursor.nickname} ${cursor.isTutor ? '🎓 (Tutor)' : '🎤 (Speaker)'}`;

    // Clear previous timeout and fade out cursor after 4s
    const oldTimeout = this.cursorTimeouts.get(cursor.peerId);
    if (oldTimeout) clearTimeout(oldTimeout);

    const newTimeout = window.setTimeout(() => {
      if (el) el.style.opacity = '0';
    }, 4000);

    this.cursorTimeouts.set(cursor.peerId, newTimeout);
  }

  private renderClickPulse(click: ClickPulseData): void {
    if (!this.container) this.createContainer();
    if (!this.container) return;

    const x = (click.xPct / 100) * window.innerWidth;
    const y = (click.yPct / 100) * window.innerHeight;

    const ripple = document.createElement('div');
    // Same cssText injection sink as renderCursor — see the note there.
    const color = safeCssColor(
      click.color,
      click.isTutor ? TUTOR_CURSOR_COLOR : DEFAULT_CURSOR_COLOR
    );

    ripple.style.cssText = `
      position: fixed !important;
      left: ${x - 22}px !important;
      top: ${y - 22}px !important;
      width: 44px !important;
      height: 44px !important;
      border-radius: 50% !important;
      border: 3px solid ${color} !important;
      box-shadow: 0 0 16px ${color}, inset 0 0 8px ${color} !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      box-sizing: border-box !important;
      animation: nb-click-ripple 0.85s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important;
    `;

    this.container.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, 900);
  }

  private setupLocalTrackers(): void {
    let lastMoveSent = 0;

    // 1. Mouse move tracker (Broadcasted ONLY if tutor or speaker on stage)
    window.addEventListener('mousemove', (e) => {
      if (!isExtensionValid()) return;
      if (!this.isLocalUserOnStage()) return;

      const now = Date.now();
      if (now - lastMoveSent < 40) return;
      lastMoveSent = now;

      const xPct = (e.clientX / window.innerWidth) * 100;
      const yPct = (e.clientY / window.innerHeight) * 100;

      try {
        chrome.runtime.sendMessage({
          type: 'LOCAL_CURSOR_MOVE',
          xPct,
          yPct,
        }).catch(() => {});
      } catch (err) {}
    });

    // 2. Click pulse tracker (Broadcasted + rendered locally on click)
    window.addEventListener('click', (e) => {
      if (!isExtensionValid()) return;
      if (!this.isLocalUserOnStage()) return;

      const xPct = (e.clientX / window.innerWidth) * 100;
      const yPct = (e.clientY / window.innerHeight) * 100;

      // Render local ripple immediately for tutor's own visual feedback
      this.renderClickPulse({
        peerId: this.myIdentity?.peerId || 'local',
        nickname: this.myIdentity?.nickname || 'You',
        xPct,
        yPct,
        color: this.myIdentity?.color || '#8b5cf6',
        isTutor: true,
        timestamp: Date.now(),
      });

      try {
        chrome.runtime.sendMessage({
          type: 'LOCAL_CLICK_PULSE',
          xPct,
          yPct,
        }).catch(() => {});
      } catch (err) {}
    });
  }
}
