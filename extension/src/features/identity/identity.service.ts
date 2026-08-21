// ─── Identity Service (Profile & Nickname Generator) ───

import { PeerIdentity } from '@/core/network/packet';
import { uuid, randomPick } from '@/shared/utils';

const ADJECTIVES = [
  'Swift', 'Brave', 'Async', 'Binary', 'Quantum', 'Cyber', 'Neural', 'Pixel',
  'Cosmic', 'Turbo', 'Dynamic', 'Algorithmic', 'Static', 'Hyper', 'Stealth',
  'Recursive', 'Atomic', 'Polymorphic', 'Parallel', 'Vector', 'Matrix', 'Zero'
] as const;

const NOUNS = [
  'Fox', 'Owl', 'Cheetah', 'Otter', 'Falcon', 'Wolf', 'Panda', 'Lynx',
  'Raven', 'Badger', 'Hawk', 'Dolphin', 'Tiger', 'Beaver', 'Penguin',
  'Viper', 'Dragon', 'Eagle', 'Koala', 'Cobra', 'Gecko', 'Bison'
] as const;

const EMOJIS = [
  '🦊', '🦉', '🐆', '🦦', '🦅', '🐺', '🐼', '🐱', '🐦', '🦡',
  '🐬', '🐯', '🦫', '🐧', '🐍', '🐲', '🐨', '🦎', '🦬', '🐙',
  '🤖', '👾', '🚀', '💡', '⚡', '💻', '🔮', '🧩', '🎯', '🔥'
] as const;

const HUES = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#f97316', // Orange
  '#eab308', // Yellow
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
] as const;

const STORAGE_KEY = 'synqto_identity';
const LEGACY_STORAGE_KEY = 'nerd_buddy_identity';
const MAX_PEER_ID_LENGTH = 64;
const MAX_NICKNAME_LENGTH = 48;

function isValidPeerId(peerId: unknown): peerId is string {
  return (
    typeof peerId === 'string' &&
    peerId.length > 0 &&
    peerId.length <= MAX_PEER_ID_LENGTH &&
    /^[A-Za-z0-9_:-]+$/.test(peerId)
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Rejects corrupted or attacker-written storage records before they become routing keys. */
export function isValidStoredIdentity(value: unknown): value is PeerIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<PeerIdentity>;
  return (
    isValidPeerId(identity.peerId) &&
    typeof identity.nickname === 'string' &&
    identity.nickname.length > 0 &&
    utf8Length(identity.nickname) <= MAX_NICKNAME_LENGTH &&
    typeof identity.avatar === 'string' &&
    identity.avatar.length <= 32 &&
    typeof identity.color === 'string' &&
    identity.color.length <= 32
  );
}

function sanitizeNickname(nickname: string): string {
  const cleaned = nickname
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  let result = '';
  let bytes = 0;
  for (const char of cleaned) {
    const nextBytes = utf8Length(char);
    if (bytes + nextBytes > MAX_NICKNAME_LENGTH) break;
    result += char;
    bytes += nextBytes;
  }
  return result;
}

export class IdentityService {
  private static instance: IdentityService | null = null;
  private currentIdentity: PeerIdentity | null = null;
  /** Stable fallback for synchronous callers while persistent storage is still loading. */
  private provisionalIdentity: PeerIdentity | null = null;
  private initPromise: Promise<PeerIdentity> | null = null;
  private listeners: Set<(identity: PeerIdentity) => void> = new Set();
  private storageChangeListener: ((changes: any, area: string) => void) | null = null;
  private operationGeneration = 0;
  private identityRevision = 0;
  private destroyed = false;

  private constructor() {
    this.setupStorageListener();
    this.getOrCreateIdentity().catch(() => {});
  }

  private setupStorageListener(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      this.storageChangeListener = (changes, area) => {
        if (this.destroyed || area !== 'local') return;
        const candidate = changes[STORAGE_KEY]?.newValue ?? changes[LEGACY_STORAGE_KEY]?.newValue;
        if (!isValidStoredIdentity(candidate)) return;
        if (
          this.currentIdentity?.peerId === candidate.peerId &&
          this.currentIdentity?.nickname === candidate.nickname &&
          this.currentIdentity?.avatar === candidate.avatar &&
          this.currentIdentity?.color === candidate.color
        ) {
          return;
        }

        // chrome.storage.local is shared across the side panel, offscreen document and
        // service worker. Adopting the latest valid write makes simultaneous first-run
        // identity creation converge instead of leaving each realm with a different peer ID.
        this.currentIdentity = candidate;
        this.provisionalIdentity = candidate;
        this.identityRevision++;
        this.listeners.forEach((fn) => fn(candidate));
      };
      chrome.storage.onChanged.addListener(this.storageChangeListener);
    }
  }

  public static getInstance(): IdentityService {
    if (!IdentityService.instance) {
      IdentityService.instance = new IdentityService();
    }
    return IdentityService.instance;
  }

  public getCachedIdentity(): PeerIdentity | null {
    return this.currentIdentity;
  }

  public async getOrCreateIdentity(): Promise<PeerIdentity> {
    if (this.destroyed) {
      if (!this.provisionalIdentity) this.provisionalIdentity = this.generateIdentity();
      return this.currentIdentity || this.provisionalIdentity;
    }
    if (this.currentIdentity) {
      return this.currentIdentity;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    const generation = this.operationGeneration;
    const revision = this.identityRevision;
    this.initPromise = (async () => {
      try {
        // Try loading from storage (support both modern synqto_ and legacy nerd_buddy_ keys)
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          try {
            const result = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
            const identity = result[STORAGE_KEY] || result[LEGACY_STORAGE_KEY];
            if (isValidStoredIdentity(identity)) {
              if (!this.isCurrentOperation(generation)) return identity;
              if (this.identityRevision !== revision && this.currentIdentity) {
                return this.currentIdentity;
              }
              this.currentIdentity = identity;
              this.provisionalIdentity = identity;
              this.identityRevision++;
              return this.currentIdentity!;
            }
          } catch (e) {
            console.warn('[IdentityService] Failed to load from chrome.storage.local', e);
          }
        } else if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (isValidStoredIdentity(parsed)) {
                if (!this.isCurrentOperation(generation)) return parsed;
                if (this.identityRevision !== revision && this.currentIdentity) {
                  return this.currentIdentity;
                }
                this.currentIdentity = parsed;
                this.provisionalIdentity = parsed;
                this.identityRevision++;
                return this.currentIdentity;
              }
            } catch (e) {
              console.warn('[IdentityService] Failed to parse identity from localStorage', e);
            }
          }
        }

        // Generate new random identity if none exists in storage
        if (!this.isCurrentOperation(generation)) {
          return this.currentIdentity || this.provisionalIdentity || this.generateIdentity();
        }
        if (this.identityRevision !== revision && this.currentIdentity) {
          return this.currentIdentity;
        }
        const newIdentity = this.generateIdentity();
        await this.saveIdentity(newIdentity, generation);
        return newIdentity;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public async regenerateIdentity(): Promise<PeerIdentity> {
    if (this.destroyed) {
      if (!this.provisionalIdentity) this.provisionalIdentity = this.generateIdentity();
      return this.currentIdentity || this.provisionalIdentity;
    }
    const newIdentity = this.generateIdentity();
    await this.saveIdentity(newIdentity);
    return newIdentity;
  }

  public async updateNickname(nickname: string): Promise<PeerIdentity> {
    const current = await this.getOrCreateIdentity();
    const cleanNickname = sanitizeNickname(nickname);
    const updated: PeerIdentity = {
      ...current,
      nickname: cleanNickname || current.nickname,
    };
    await this.saveIdentity(updated);
    return updated;
  }

  private generateIdentity(): PeerIdentity {
    const adjective = randomPick(ADJECTIVES);
    const noun = randomPick(NOUNS);
    const nickname = `${adjective}${noun}`;
    const avatar = randomPick(EMOJIS);
    const color = randomPick(HUES);
    const peerId = `nb-${uuid().slice(0, 8)}`;

    return {
      peerId,
      nickname,
      avatar,
      color,
    };
  }

  private async saveIdentity(identity: PeerIdentity, generation = this.operationGeneration) {
    if (!this.isCurrentOperation(generation)) return;
    this.currentIdentity = identity;
    this.provisionalIdentity = identity;
    this.identityRevision++;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: identity,
        [LEGACY_STORAGE_KEY]: identity,
      });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(identity));
    }

    if (!this.isCurrentOperation(generation)) return;
    this.listeners.forEach((fn) => fn(identity));
  }

  public onChange(listener: (identity: PeerIdentity) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    if (this.currentIdentity) {
      listener(this.currentIdentity);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getIdentitySync(): PeerIdentity | null {
    return this.currentIdentity;
  }

  public getMyIdentity(): PeerIdentity {
    if (this.currentIdentity) {
      return this.currentIdentity;
    }

    // If async initialization is currently in flight, do not overwrite storage with a new fallback identity
    if (this.initPromise) {
      if (!this.provisionalIdentity) {
        this.provisionalIdentity = this.generateIdentity();
      }
      return this.provisionalIdentity;
    }

    const fallback = this.generateIdentity();
    if (!this.destroyed) void this.saveIdentity(fallback);
    return fallback;
  }

  private isCurrentOperation(generation: number): boolean {
    return !this.destroyed && generation === this.operationGeneration;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operationGeneration++;
    if (this.storageChangeListener && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageChangeListener);
    }
    this.storageChangeListener = null;
    this.listeners.clear();
    this.initPromise = null;
    if (IdentityService.instance === this) IdentityService.instance = null;
  }
}
