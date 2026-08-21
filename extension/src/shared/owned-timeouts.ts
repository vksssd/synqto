/**
 * Owns delayed callbacks for a component or service lifetime.
 *
 * Removing a handle from the registry is also a generation fence: even if the
 * browser has already queued the callback, a cancelled callback remains inert.
 */
export class OwnedTimeouts {
  private readonly handles = new Set<ReturnType<typeof setTimeout>>();

  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    let handle: ReturnType<typeof setTimeout>;
    handle = setTimeout(() => {
      if (!this.handles.delete(handle)) return;
      callback();
    }, delayMs);
    this.handles.add(handle);
    return handle;
  }

  cancel(handle: ReturnType<typeof setTimeout> | null | undefined): void {
    if (handle === null || handle === undefined) return;
    this.handles.delete(handle);
    clearTimeout(handle);
  }

  replace(
    current: ReturnType<typeof setTimeout> | null | undefined,
    callback: () => void,
    delayMs: number
  ): ReturnType<typeof setTimeout> {
    this.cancel(current);
    return this.schedule(callback, delayMs);
  }

  clearAll(): void {
    for (const handle of this.handles) clearTimeout(handle);
    this.handles.clear();
  }
}
