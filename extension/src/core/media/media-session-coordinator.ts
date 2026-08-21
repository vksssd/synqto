export type MicrophoneSessionOwner = 'voice' | 'live';

/**
 * WebRTCService has one outbound audio sender per peer connection. Voice chat and live-stage
 * audio therefore cannot both own it without silently replacing one another's track. This
 * realm-local coordinator makes that exclusivity explicit and tells the previous owner to
 * complete its own lifecycle before the new track is attached.
 */
export class MediaSessionCoordinator {
  private static instance: MediaSessionCoordinator | null = null;
  private owner: MicrophoneSessionOwner | null = null;
  private releaseHandlers = new Map<MicrophoneSessionOwner, () => void>();

  public static getInstance(): MediaSessionCoordinator {
    if (!MediaSessionCoordinator.instance) {
      MediaSessionCoordinator.instance = new MediaSessionCoordinator();
    }
    return MediaSessionCoordinator.instance;
  }

  public register(owner: MicrophoneSessionOwner, onReplaced: () => void): () => void {
    this.releaseHandlers.set(owner, onReplaced);
    return () => {
      if (this.releaseHandlers.get(owner) === onReplaced) this.releaseHandlers.delete(owner);
    };
  }

  public claim(owner: MicrophoneSessionOwner): MicrophoneSessionOwner | null {
    const previous = this.owner;
    if (previous === owner) return null;

    // Publish the new owner before invoking the old one. Its release() must not erase the
    // ownership that just replaced it.
    this.owner = owner;
    if (previous) this.releaseHandlers.get(previous)?.();
    return previous;
  }

  public release(owner: MicrophoneSessionOwner): void {
    if (this.owner === owner) this.owner = null;
  }

  public getOwner(): MicrophoneSessionOwner | null {
    return this.owner;
  }
}
