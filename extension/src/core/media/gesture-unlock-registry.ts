const AUTOPLAY_UNLOCK_EVENTS = ['click', 'keydown', 'touchstart'] as const;

type GestureTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * Owns the temporary user-gesture listeners used to retry blocked media playback.
 *
 * Registering one callback on several gesture types with `{ once: true }` is not sufficient:
 * only the event that fires is removed automatically. The other listeners keep the peer and
 * service alive. This registry removes the whole group on the first gesture or when its media
 * owner disappears.
 */
export class GestureUnlockRegistry<Key> {
  private readonly pending = new Map<Key, EventListener>();

  constructor(private readonly target: GestureTarget) {}

  public arm(key: Key, action: () => void): void {
    this.cancel(key);
    const listener: EventListener = () => {
      this.cancel(key);
      action();
    };
    this.pending.set(key, listener);
    AUTOPLAY_UNLOCK_EVENTS.forEach((eventName) => {
      this.target.addEventListener(eventName, listener, { once: true });
    });
  }

  public cancel(key: Key): void {
    const listener = this.pending.get(key);
    if (!listener) return;
    AUTOPLAY_UNLOCK_EVENTS.forEach((eventName) => {
      this.target.removeEventListener(eventName, listener);
    });
    this.pending.delete(key);
  }

  public clear(): void {
    [...this.pending.keys()].forEach((key) => this.cancel(key));
  }

  public get size(): number {
    return this.pending.size;
  }
}
