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

export class IdentityService {
  private static instance: IdentityService | null = null;
  private currentIdentity: PeerIdentity | null = null;
  private listeners: Set<(identity: PeerIdentity) => void> = new Set();

  private constructor() {
    this.getOrCreateIdentity().catch(() => {});
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
    if (this.currentIdentity) {
      return this.currentIdentity;
    }

    // Try loading from storage (support both modern synqto_ and legacy nerd_buddy_ keys)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const result = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
        const identity = result[STORAGE_KEY] || result[LEGACY_STORAGE_KEY];
        if (identity) {
          this.currentIdentity = identity;
          return this.currentIdentity!;
        }
      } catch (e) {
        console.warn('[IdentityService] Failed to load from chrome.storage.local');
      }
    } else if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) {
        try {
          this.currentIdentity = JSON.parse(stored);
          return this.currentIdentity!;
        } catch (e) {}
      }
    }

    // Generate new random identity
    const newIdentity = this.generateIdentity();
    await this.saveIdentity(newIdentity);
    return newIdentity;
  }

  public async regenerateIdentity(): Promise<PeerIdentity> {
    const newIdentity = this.generateIdentity();
    await this.saveIdentity(newIdentity);
    return newIdentity;
  }

  public async updateNickname(nickname: string): Promise<PeerIdentity> {
    const current = await this.getOrCreateIdentity();
    const updated: PeerIdentity = {
      ...current,
      nickname: nickname.trim() || current.nickname,
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

  private async saveIdentity(identity: PeerIdentity) {
    this.currentIdentity = identity;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: identity,
        [LEGACY_STORAGE_KEY]: identity,
      });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(identity));
    }

    this.listeners.forEach((fn) => fn(identity));
  }

  public onChange(listener: (identity: PeerIdentity) => void): () => void {
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
}
