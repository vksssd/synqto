// ─── Shared notification service ───
//
// One place that decides how a failure reaches the user.
//
// WHY THIS EXISTS. Failures were reported to console.warn / console.error and nowhere else.
// The mic-permission case is the clearest example: joinVoice() catches the browser's
// NotAllowedError, logs it, sets a flag, and returns false — so the user clicks "join voice",
// nothing happens, and the only explanation is in a devtools console they will never open.
// The information needed to fix it (Chrome blocked the request; grant permission) exists at
// the moment of failure and is thrown away.
//
// A console message is a note to the developer. A toast is a message to the user. Most of the
// catch blocks in this codebase were writing the first when they owed the second.
//
// Two design rules:
//
//   1. The service is TRANSPORT-AGNOSTIC. It holds a queue and notifies subscribers; it does
//      not render. The side panel renders React toasts, the content widget renders into its
//      shadow DOM, and a future surface can render however it likes — but the decision about
//      what is worth telling the user, and in what words, is made once, here.
//
//   2. Messages name the REMEDY, not the exception. "NotAllowedError" tells the user nothing
//      they can act on. "Microphone blocked — click the camera icon in Chrome's address bar
//      to allow it" tells them exactly what to do. describeError() below is where raw browser
//      error names are translated into that.

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface SynqtoNotification {
  id: string;
  level: NotificationLevel;
  /** Short, action-oriented. Shown in bold. */
  title: string;
  /** Optional detail. Should say what to DO, not what went wrong internally. */
  detail?: string;
  /** How long to show it. Errors default to sticky so they cannot be missed. */
  durationMs: number;
  createdAt: number;
}

type Listener = (list: SynqtoNotification[]) => void;

/**
 * Default lifetimes.
 *
 * Errors persist until dismissed: a message the user did not happen to be looking at is the
 * same as no message, and an error usually requires them to DO something. Success is brief —
 * it confirms something they just did and already expect.
 */
const DEFAULT_DURATION: Record<NotificationLevel, number> = {
  success: 2600,
  info: 3600,
  warning: 6000,
  error: 0, // sticky
};

export class NotificationService {
  private static instance: NotificationService | null = null;
  private items: SynqtoNotification[] = [];
  private listeners: Set<Listener> = new Set();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Bounded so a failing loop cannot paper the screen. When a subsystem fails repeatedly,
   * the user needs to know it is failing — not to receive one toast per attempt.
   */
  private static readonly MAX_VISIBLE = 4;

  /**
   * Suppression window for identical messages.
   *
   * A retrying subsystem produces the same failure many times a second. Showing each one is
   * both useless and actively harmful: the stack of duplicates hides everything else. The
   * first occurrence is shown and the rest are collapsed into it.
   */
  private static readonly DEDUPE_MS = 8000;
  private static readonly MAX_DEDUPE_KEYS = 100;
  private lastShown: Map<string, number> = new Map();

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.items);
    return () => {
      this.listeners.delete(fn);
    };
  }

  public notify(
    level: NotificationLevel,
    title: string,
    detail?: string,
    durationMs?: number
  ): string | null {
    const key = `${level}:${title}:${detail ?? ''}`;
    const now = Date.now();
    for (const [seenKey, seenAt] of this.lastShown) {
      if (now - seenAt >= NotificationService.DEDUPE_MS) this.lastShown.delete(seenKey);
    }
    const last = this.lastShown.get(key);
    if (last !== undefined && now - last < NotificationService.DEDUPE_MS) {
      return null; // collapsed into the one already on screen
    }
    this.lastShown.delete(key);
    this.lastShown.set(key, now);
    while (this.lastShown.size > NotificationService.MAX_DEDUPE_KEYS) {
      const oldest = this.lastShown.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.lastShown.delete(oldest);
    }

    const item: SynqtoNotification = {
      id: `n-${now}-${Math.random().toString(36).slice(2, 8)}`,
      level,
      title,
      detail,
      durationMs: durationMs ?? DEFAULT_DURATION[level],
      createdAt: now,
    };

    const previousIds = new Set(this.items.map((existing) => existing.id));
    this.items = [...this.items, item].slice(-NotificationService.MAX_VISIBLE);
    const retainedIds = new Set(this.items.map((existing) => existing.id));
    previousIds.forEach((id) => {
      if (!retainedIds.has(id)) this.clearTimer(id);
    });
    this.emit();

    if (item.durationMs > 0) {
      this.timers.set(
        item.id,
        setTimeout(() => this.dismiss(item.id), item.durationMs)
      );
    }
    return item.id;
  }

  public info(title: string, detail?: string) { return this.notify('info', title, detail); }
  public success(title: string, detail?: string) { return this.notify('success', title, detail); }
  public warn(title: string, detail?: string) { return this.notify('warning', title, detail); }
  public error(title: string, detail?: string) { return this.notify('error', title, detail); }

  public dismiss(id: string) {
    this.clearTimer(id);
    const next = this.items.filter((i) => i.id !== id);
    if (next.length !== this.items.length) {
      this.items = next;
      this.emit();
    }
  }

  public clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.items = [];
    this.lastShown.clear();
    this.emit();
  }

  public getAll(): SynqtoNotification[] {
    return this.items;
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  public destroy(): void {
    this.clear();
    this.listeners.clear();
    if (NotificationService.instance === this) NotificationService.instance = null;
  }

  private emit() {
    this.listeners.forEach((fn) => {
      try {
        fn(this.items);
      } catch (err) {
        // A throwing renderer must not stop the others from being told.
        console.error('[NotificationService] listener error:', err);
      }
    });
  }
}

/**
 * Translates a browser media error into something the user can act on.
 *
 * getUserMedia rejects with a small set of DOMException names that are precise and completely
 * opaque to a non-developer. Each maps to a genuinely different situation with a genuinely
 * different remedy, so collapsing them into "could not access microphone" would throw away
 * the most useful thing the browser told us.
 */
export function describeMediaError(err: any, device: 'microphone' | 'camera'): {
  title: string;
  detail: string;
} {
  const name = String(err?.name || err?.message || err || '');
  const Device = device === 'microphone' ? 'Microphone' : 'Camera';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        title: `${Device} blocked`,
        // Names the exact control to click. In an extension side panel the permission prompt
        // does not appear over the panel, which is why users report "nothing happened" —
        // the request was made and silently refused by a previous decision.
        detail: `Chrome is blocking ${device} access. Click the camera icon in the address bar, allow ${device}, then try again.`,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        title: `No ${device} found`,
        detail: `No ${device} is connected. Plug one in and try again.`,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        title: `${Device} is in use`,
        detail: `Another app is using your ${device}. Close it and try again.`,
      };
    case 'OverconstrainedError':
      return {
        title: `${Device} not compatible`,
        detail: `Your ${device} does not support the requested settings.`,
      };
    case 'AbortError':
      return {
        title: `${Device} interrupted`,
        detail: 'The request was interrupted. Try again.',
      };
    case 'SecurityError':
      return {
        title: `${Device} not permitted here`,
        detail: `This page's security settings block ${device} access.`,
      };
    default:
      return {
        title: `Could not start ${device}`,
        // The raw name is included as a last resort — it is useless to most users but it is
        // the only thing that makes an unrecognised failure reportable.
        detail: name ? `Unexpected error: ${name}` : 'An unexpected error occurred.',
      };
  }
}
