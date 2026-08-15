// ─── Live Synchronized Laser Pointer & Click Ripple Overlay (Synqme Stage) ───

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
          // Render if sender is a tutor or marked as broadcaster
          const isBroadcaster = cursor.isTutor ||
            (this.liveStage && (this.liveStage.tutorIdentity?.peerId === cursor.peerId || this.liveStage.tutorPeerId === cursor.peerId || this.liveStage.guestSpeakers?.some((g: any) => g.peerId === cursor.peerId)));

          if (isBroadcaster || !this.liveStage) {
            this.renderCursor(cursor);
          }
        } else if (msg.type === 'NERD_BUDDY_CLICK_PULSE' && msg.click) {
          const click = msg.click as ClickPulseData;
          // Render click ripple immediately if sender is tutor or broadcaster
          const isBroadcaster = click.isTutor ||
            (this.liveStage && (this.liveStage.tutorIdentity?.peerId === click.peerId || this.liveStage.tutorPeerId === click.peerId || this.liveStage.guestSpeakers?.some((g: any) => g.peerId === click.peerId)));

          if (isBroadcaster || click.isTutor || !this.liveStage) {
            this.renderClickPulse(click);
          }
        }
      });
    } catch {}
  }

  private renderCursor(cursor: RemoteCursorData): void {
    if (!this.container) this.createContainer();
    if (!this.container) return;

    let el = this.cursorElements.get(cursor.peerId);
    if (!el) {
      el = document.createElement('div');
      el.style.cssText = `
        position: fixed !important;
        pointer-events: none !important;
        transition: left 0.05s linear, top 0.05s linear, opacity 0.3s ease !important;
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
        opacity: 1 !important;
        z-index: 2147483646 !important;
      `;
      this.container.appendChild(el);
      this.cursorElements.set(cursor.peerId, el);
    }

    const x = Math.max(0, Math.min(window.innerWidth - 30, (cursor.xPct / 100) * window.innerWidth));
    const y = Math.max(0, Math.min(window.innerHeight - 30, (cursor.yPct / 100) * window.innerHeight));

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.opacity = '1';

    const glowColor = cursor.isTutor ? '#8b5cf6' : cursor.color || '#6366f1';

    el.innerHTML = `
      <div style="
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
      ">
        ${cursor.avatar || '👑'}
      </div>
      <div style="
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
      ">
        ${cursor.nickname} ${cursor.isTutor ? '🎓 (Tutor)' : '🎤 (Speaker)'}
      </div>
    `;

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
    const color = click.color || (click.isTutor ? '#8b5cf6' : '#6366f1');

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
