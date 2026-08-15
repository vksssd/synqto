// ─── Shared utilities ───

/** Generate a UUID v4. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * FNV-1a 64-bit hash (JavaScript-safe 53-bit version).
 * Returns an 8-character hex string.
 */
export function fnv1aHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ (c & 0xff), 0x01000193);
    h2 = Math.imul(h2 ^ (c >> 8), 0x01000193);
  }
  const combined = ((h1 >>> 0) ^ (h2 >>> 0)) >>> 0;
  return combined.toString(16).padStart(8, '0');
}

/** Compute SHA-256 hex string (using Web Crypto API with synchronous fallback). */
export async function sha256Hex(message: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Synchronous fallback
  return fnv1aHash(message) + fnv1aHash(message + '_nb_sec');
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Debounce a function. */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/** Merge class names (simple version without tailwind-merge). */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Format elapsed time as "Xm" or "Xh Xm". */
export function formatElapsed(startTimestamp: number): string {
  const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}

/** Pick a random item from an array. */
export function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Sleep for a given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter. */
export function backoffDelay(
  attempt: number,
  baseMs = 1000,
  maxMs = 16000,
  jitterMs = 500
): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return delay + Math.random() * jitterMs;
}
