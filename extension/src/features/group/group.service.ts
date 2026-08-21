// ─── Group & Community Service (Serverless Zero-Knowledge P2P) ───

import { StudyGroup, CreateGroupParams, GroupInvitePayload } from './group.types';
import { RoomService } from '@/features/room/room.service';
import { IdentityService } from '@/features/identity/identity.service';
import { fnv1aHash, sha256Hex, uuid } from '@/shared/utils';

const STORAGE_KEY = 'synqto_saved_groups';
const LEGACY_STORAGE_KEY = 'nerd_buddy_saved_groups';

export class GroupService {
  private static instance: GroupService | null = null;
  private roomService: RoomService;
  private identityService: IdentityService;

  private groups: StudyGroup[] = [];
  private listeners: Set<(groups: StudyGroup[]) => void> = new Set();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationResolver: (() => void) | null = null;
  private pendingMutations: Array<() => void> = [];
  private destroyed = false;

  private constructor() {
    this.roomService = RoomService.getInstance();
    this.identityService = IdentityService.getInstance();
    void this.loadFromStorage();
  }

  public static getInstance(): GroupService {
    if (!GroupService.instance) {
      GroupService.instance = new GroupService();
    }
    return GroupService.instance;
  }

  private loadFromStorage(): Promise<void> {
    if (this.destroyed || this.initialized) return Promise.resolve();
    if (this.initializationPromise) return this.initializationPromise;

    const finish = (saved: StudyGroup[] | null): void => {
      if (this.destroyed || this.initialized) return;
      const usedDefaults = !saved;
      this.groups = saved || this.getDefaultGroups();
      this.initialized = true;
      const pending = this.pendingMutations.splice(0);
      pending.forEach((mutation) => {
        try {
          mutation();
        } catch (err) {
          console.error('[GroupService] deferred mutation failed:', err);
        }
      });
      if (usedDefaults) this.saveToStorage();
      this.emitChange();
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const attempt = new Promise<void>((resolve) => {
        this.initializationResolver = resolve;
        chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (res) => {
          const saved = res[STORAGE_KEY] || res[LEGACY_STORAGE_KEY];
          finish(Array.isArray(saved) ? saved : null);
          if (this.initializationResolver === resolve) this.initializationResolver = null;
          resolve();
        });
      });
      this.initializationPromise = attempt;
      void attempt.finally(() => {
        if (this.initializationPromise === attempt) this.initializationPromise = null;
      });
      return attempt;
    } else {
      finish(null);
      return Promise.resolve();
    }
  }

  private saveToStorage(): void {
    if (this.destroyed || !this.initialized) return;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({
        [STORAGE_KEY]: this.groups,
        [LEGACY_STORAGE_KEY]: this.groups,
      });
    }
  }

  private getDefaultGroups(): StudyGroup[] {
    return [
      {
        id: 'default-leetcode-150',
        name: 'LeetCode Top 150',
        slug: 'leetcode-top-150',
        description: 'Daily interview prep and algorithmic problem solving',
        avatar: '🚀',
        isPrivate: false,
        topicTag: 'LeetCode',
        roomId: `group:leetcode-top-150-pub-${fnv1aHash('leetcode-top-150:public')}`,
        createdAt: Date.now() - 86400000 * 3,
        isCreator: false,
      },
      {
        id: 'default-sys-design',
        name: 'System Design Lounge',
        slug: 'system-design-lounge',
        description: 'Distributed systems, scaling patterns, and architecture discussions',
        avatar: '🧠',
        isPrivate: false,
        topicTag: 'System Design',
        roomId: `group:system-design-lounge-pub-${fnv1aHash('system-design-lounge:public')}`,
        createdAt: Date.now() - 86400000 * 5,
        isCreator: false,
      },
    ];
  }

  public async getGroups(): Promise<StudyGroup[]> {
    await this.loadFromStorage();
    return [...this.groups];
  }

  private deferUntilInitialized(mutation: () => void): boolean {
    if (this.destroyed) return true;
    if (this.initialized) return false;
    if (this.pendingMutations.length < 100) this.pendingMutations.push(mutation);
    return true;
  }

  /**
   * Creates a new serverless study group.
   * If password protected: uses zero-knowledge deterministic SHA-256 room derivation.
   * The signaling server never receives or knows the password.
   */
  // ─── Public handle contract ───
  //
  // A public group's roomId is derived deterministically from its name alone:
  //
  //     roomId = group:<handle>-pub-<fnv1a(handle + ":public")>
  //
  // That means the handle IS a globally resolvable address: any two peers who type the
  // same group name independently compute the same roomId and land in the same room, with
  // no directory service and no invite exchange. This is what makes groups searchable by
  // name in a fully serverless architecture.
  //
  // Because of that, normalization MUST be identical everywhere. It was previously inlined
  // in createGroup only, so any second call site that slugified even slightly differently
  // would silently resolve to a DIFFERENT room and the two users would never meet — with no
  // error surfaced. It lives here now as the single source of truth.
  //
  // Consequence worth being explicit about: handles are not owned or reserved. Two groups
  // created with the same name ARE the same public room. That is the discovery mechanism,
  // not a collision bug — but it does mean a public handle is guessable, so anything
  // requiring privacy must use the password path, which mixes the secret into the room hash.

  /** Maximum handle length; keeps derived room IDs bounded. */
  public static readonly MAX_HANDLE_LENGTH = 28;

  /**
   * Clears the creator flag on a group the user joined rather than founded.
   *
   * Accepting an invite routes through createGroup (the room ID for a private squad can
   * only be derived client-side from the password), which stamps isCreator=true on the
   * caller. Without this correction every invited member was recorded as the squad's
   * creator, which misrepresents ownership in the UI.
   */
  public markAsJoinedNotCreated(groupId: string): void {
    if (this.deferUntilInitialized(() => this.markAsJoinedNotCreated(groupId))) return;
    const g = this.groups.find((grp) => grp.id === groupId);
    if (!g || !g.isCreator) return;
    g.isCreator = false;
    g.creatorPeerId = undefined;
    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Normalizes a group name (or a typed "@handle") into its canonical handle form.
   * Idempotent: toHandle(toHandle(x)) === toHandle(x).
   */
  public static toHandle(nameOrHandle: string): string {
    const cleaned = (nameOrHandle || '')
      .trim()
      .replace(/^@+/, '') // tolerate users typing "@squad"
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .slice(0, GroupService.MAX_HANDLE_LENGTH)
      .replace(/-+$/, '')
      .replace(/^-+/, '');
    return cleaned || 'squad';
  }

  /** True if the input normalizes to something a peer could actually resolve. */
  public static isValidHandle(nameOrHandle: string): boolean {
    const h = GroupService.toHandle(nameOrHandle);
    return h.length >= 2 && h !== 'squad';
  }

  /** Computes the public room ID a handle resolves to. Mirrors createGroup exactly. */
  public static resolvePublicRoomId(nameOrHandle: string): string {
    const handle = GroupService.toHandle(nameOrHandle);
    return `group:${handle}-pub-${fnv1aHash(handle + ':public')}`;
  }

  /**
   * Searches locally known groups by name, handle, description or topic.
   * Returns matches ranked with exact-handle first so typing a full name lands on it.
   */
  public searchGroups(query: string): StudyGroup[] {
    const raw = (query || '').trim().toLowerCase();
    if (!raw) return [...this.groups];

    const handle = GroupService.toHandle(raw);
    const scored = this.groups
      .map((g) => {
        let score = -1;
        if (g.slug === handle) score = 100;
        else if (g.name.toLowerCase() === raw) score = 90;
        else if (g.slug.startsWith(handle)) score = 70;
        else if (g.name.toLowerCase().includes(raw)) score = 50;
        else if (g.description?.toLowerCase().includes(raw)) score = 20;
        else if (g.topicTag.toLowerCase().includes(raw)) score = 10;
        return { g, score };
      })
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((s) => s.g);
  }

  /**
   * Joins a PUBLIC group purely by its name/handle, with no invite token.
   *
   * If the handle matches a group already known locally, that record is reused so the
   * user keeps its avatar/description/history. Otherwise a lightweight stub is created
   * pointing at the derived room — the peers already in that room supply the real
   * identity of the group once connected.
   */
  public async joinByHandle(
    nameOrHandle: string
  ): Promise<{ success: boolean; group?: StudyGroup; error?: string }> {
    await this.loadFromStorage();
    if (this.destroyed) return { success: false, error: 'Group service is unavailable' };
    if (!GroupService.isValidHandle(nameOrHandle)) {
      return {
        success: false,
        error: 'Enter at least 2 letters or numbers (for example: leetcode-grind)',
      };
    }

    const handle = GroupService.toHandle(nameOrHandle);
    const roomId = GroupService.resolvePublicRoomId(handle);

    // Prefer an existing local record for this handle/room.
    const existing = this.groups.find((g) => g.roomId === roomId || (!g.isPrivate && g.slug === handle));
    if (existing) {
      const res = await this.joinGroup(existing);
      return res.success
        ? { success: true, group: existing }
        : { success: false, error: res.error };
    }

    const identity = await this.identityService.getOrCreateIdentity();
    if (this.destroyed) return { success: false, error: 'Group service is unavailable' };
    const stub: StudyGroup = {
      id: uuid(),
      name: nameOrHandle.trim().replace(/^@+/, '') || handle,
      slug: handle,
      avatar: '🔍',
      isPrivate: false,
      topicTag: 'General',
      roomId,
      createdAt: Date.now(),
      creatorPeerId: identity.peerId,
      isCreator: false,
      isMember: true,
      joinedAt: Date.now(),
    };

    this.groups = [stub, ...this.groups.filter((g) => g.roomId !== roomId)];
    this.saveToStorage();
    this.emitChange();

    await this.roomService.joinGroupRoom({
      roomId: stub.roomId,
      name: stub.name,
      slug: stub.slug,
      avatar: stub.avatar,
      isPrivate: false,
      description: stub.description,
      topicTag: stub.topicTag,
    });

    return { success: true, group: stub };
  }

  public async createGroup(params: CreateGroupParams): Promise<StudyGroup> {
    await this.loadFromStorage();
    if (this.destroyed) throw new Error('Group service is unavailable');
    const cleanSlug = GroupService.toHandle(params.name);

    let roomId = '';
    let passwordHash: string | undefined = undefined;

    if (params.isPrivate && params.password) {
      const cleanPassword = params.password.trim();
      passwordHash = await sha256Hex(cleanPassword);
      // Zero-knowledge secret room ID: only peers with exact password compute same roomId
      const secretSeed = `${cleanSlug}:${cleanPassword}`;
      const secretHash = await sha256Hex(secretSeed);
      roomId = `group:${cleanSlug || 'squad'}-sec-${secretHash.slice(0, 16)}`;
    } else {
      roomId = `group:${cleanSlug || 'squad'}-pub-${fnv1aHash(cleanSlug + ':public')}`;
    }

    const identity = await this.identityService.getOrCreateIdentity();
    if (this.destroyed) throw new Error('Group service is unavailable');

    const newGroup: StudyGroup = {
      id: uuid(),
      name: params.name.trim(),
      slug: cleanSlug || 'squad',
      description: params.description?.trim() || undefined,
      avatar: params.avatar || '🚀',
      isPrivate: params.isPrivate,
      passwordHash,
      topicTag: params.topicTag || 'General',
      roomId,
      createdAt: Date.now(),
      creatorPeerId: identity.peerId,
      isCreator: true,
      isMember: true,
      joinedAt: Date.now(),
    };

    // Prepend to list
    this.groups = [newGroup, ...this.groups.filter((g) => g.roomId !== newGroup.roomId)];
    this.saveToStorage();
    this.emitChange();

    // Automatically enter the newly created group
    await this.roomService.joinGroupRoom({
      roomId: newGroup.roomId,
      name: newGroup.name,
      slug: newGroup.slug,
      avatar: newGroup.avatar,
      isPrivate: newGroup.isPrivate,
      description: newGroup.description,
      topicTag: newGroup.topicTag,
    });

    return newGroup;
  }

  /**
   * Joins an existing group room and marks the user as a persistent member.
   */
  public async joinGroup(
    group: StudyGroup,
    password?: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.loadFromStorage();
    if (this.destroyed) return { success: false, error: 'Group service is unavailable' };
    let targetRoomId = group.roomId;

    if (group.isPrivate) {
      const cleanPassword = password ? password.trim() : undefined;
      if (!cleanPassword && !group.passwordHash) {
        return { success: false, error: 'Password required to enter this private group' };
      }

      if (cleanPassword) {
        // Compute zero-knowledge room ID with the entered password
        const secretSeed = `${group.slug}:${cleanPassword}`;
        const secretHash = await sha256Hex(secretSeed);
        targetRoomId = `group:${group.slug}-sec-${secretHash.slice(0, 16)}`;

        // If we have stored passwordHash, verify local match
        if (group.passwordHash) {
          const inputHash = await sha256Hex(cleanPassword);
          if (inputHash !== group.passwordHash) {
            return { success: false, error: 'Incorrect password for this group' };
          }
        }
      }
    }

    if (this.destroyed) return { success: false, error: 'Group service is unavailable' };

    const updatedGroup: StudyGroup = {
      ...group,
      roomId: targetRoomId,
      isMember: true,
      joinedAt: group.joinedAt || Date.now(),
    };

    // Save group to list and mark as persistent joined member
    const existingIdx = this.groups.findIndex((g) => g.id === group.id || g.roomId === group.roomId);
    if (existingIdx >= 0) {
      this.groups[existingIdx] = updatedGroup;
    } else {
      this.groups = [updatedGroup, ...this.groups];
    }
    this.saveToStorage();
    this.emitChange();

    await this.roomService.joinGroupRoom({
      roomId: targetRoomId,
      name: group.name,
      slug: group.slug,
      avatar: group.avatar,
      isPrivate: group.isPrivate,
      description: group.description,
      topicTag: group.topicTag,
    });

    return { success: true };
  }

  /**
   * Leaves a permanent study group.
   * User is removed from permanent membership unless they explicitly rejoin.
   */
  public async leaveGroup(groupId: string): Promise<void> {
    await this.loadFromStorage();
    if (this.destroyed) return;
    const target = this.groups.find((g) => g.id === groupId || g.roomId === groupId);
    if (!target) return;

    // If currently active in this group room, leave it
    const currentRoom = this.roomService.getCurrentRoom();
    if (currentRoom && currentRoom.roomId === target.roomId) {
      await this.roomService.leaveCurrentRoom();
      if (this.destroyed) return;
    }

    // If it's a default group or problem group, mark isMember: false; otherwise remove it
    if (target.id.startsWith('default-') || target.isProblemGroup) {
      target.isMember = false;
      this.saveToStorage();
    } else {
      this.groups = this.groups.filter((g) => g.id !== groupId && g.roomId !== groupId);
      this.saveToStorage();
    }
    this.emitChange();
  }

  /**
   * Checks if user is currently a persistent joined member.
   */
  public isMember(groupId: string): boolean {
    const g = this.groups.find((grp) => grp.id === groupId || grp.roomId === groupId);
    return Boolean(g && (g.isMember || g.isCreator));
  }

  /**
   * Automatically registers an active/detected problem room into the groups list
   * so it appears alongside all other groups in the Squads Hub.
   */
  public registerProblemGroup(problem: {
    platform: string;
    slug: string;
    title: string;
    canonicalUrl: string;
    roomId: string;
  }): void {
    if (this.deferUntilInitialized(() => this.registerProblemGroup({ ...problem }))) return;
    const existingIndex = this.groups.findIndex(
      (g) => g.roomId === problem.roomId || g.slug === problem.slug
    );

    if (existingIndex >= 0) {
      // Update existing
      this.groups[existingIndex] = {
        ...this.groups[existingIndex],
        name: problem.title,
        topicTag: problem.platform,
        canonicalUrl: problem.canonicalUrl,
        isProblemGroup: true,
      };
    } else {
      // Create new problem group entry
      const avatarMap: Record<string, string> = {
        LeetCode: '⚡',
        Codeforces: '🏆',
        NeetCode: '🧠',
        HackerRank: '💻',
        GeeksforGeeks: '📚',
        YouTube: '📹',
        GitHub: '🐙',
      };

      const newGroup: StudyGroup = {
        id: `prob-${problem.slug}-${fnv1aHash(problem.roomId)}`,
        name: problem.title,
        slug: problem.slug,
        description: `${problem.platform} Collaborative Problem Group`,
        avatar: avatarMap[problem.platform] || '💡',
        isPrivate: false,
        topicTag: problem.platform,
        roomId: problem.roomId,
        createdAt: Date.now(),
        isProblemGroup: true,
        canonicalUrl: problem.canonicalUrl,
      };

      this.groups = [newGroup, ...this.groups];
    }

    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Deletes / removes a group from saved study squads.
   */
  public async deleteGroup(groupId: string): Promise<void> {
    await this.loadFromStorage();
    if (this.destroyed) return;
    this.groups = this.groups.filter((g) => g.id !== groupId);
    this.saveToStorage();
    this.emitChange();
  }

  /**
   * Generates a portable zero-friction invite token.
   */
  public generateInviteCode(
    group: StudyGroup
  ): string {
    const payload: GroupInvitePayload = {
      version: 1,
      name: group.name,
      slug: group.slug,
      avatar: group.avatar,
      isPrivate: group.isPrivate,
      topicTag: group.topicTag,
      description: group.description,
    };

    try {
      const jsonStr = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(jsonStr);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `NBGRP:${btoa(binary)}`;
    } catch {
      return `NBGRP:${btoa(JSON.stringify(payload))}`;
    }
  }

  /**
   * Decodes an invite code string.
   */
  public parseInviteCode(code: string): GroupInvitePayload | null {
    const clean = code.trim();
    if (!clean.startsWith('NBGRP:')) {
      return null;
    }

    try {
      const b64 = clean.slice(6);
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const jsonStr = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(jsonStr) as GroupInvitePayload;
      if (!parsed.name || !parsed.slug) {
        return null;
      }
      return parsed;
    } catch (e) {
      try {
        const b64 = clean.slice(6);
        const parsed = JSON.parse(atob(b64)) as GroupInvitePayload;
        return parsed;
      } catch {
        return null;
      }
    }
  }

  public onChange(listener: (groups: StudyGroup[]) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.groups);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    if (this.destroyed) return;
    this.listeners.forEach((fn) => fn(this.groups));
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingMutations = [];
    this.listeners.clear();
    this.initializationResolver?.();
    this.initializationResolver = null;
    this.initializationPromise = null;
    if (GroupService.instance === this) GroupService.instance = null;
  }
}
