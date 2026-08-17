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

  private constructor() {
    this.roomService = RoomService.getInstance();
    this.identityService = IdentityService.getInstance();
    this.loadFromStorage();
  }

  public static getInstance(): GroupService {
    if (!GroupService.instance) {
      GroupService.instance = new GroupService();
    }
    return GroupService.instance;
  }

  private async loadFromStorage(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY], (res) => {
        const saved = res[STORAGE_KEY] || res[LEGACY_STORAGE_KEY];
        if (saved && Array.isArray(saved)) {
          this.groups = saved;
        } else {
          // Add default initial sample study squads
          this.groups = this.getDefaultGroups();
          this.saveToStorage();
        }
        this.initialized = true;
        this.emitChange();
      });
    } else {
      this.groups = this.getDefaultGroups();
      this.initialized = true;
      this.emitChange();
    }
  }

  private saveToStorage(): void {
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
    if (!this.initialized) {
      await this.loadFromStorage();
    }
    return this.groups;
  }

  /**
   * Creates a new serverless study group.
   * If password protected: uses zero-knowledge deterministic SHA-256 room derivation.
   * The signaling server never receives or knows the password.
   */
  public async createGroup(params: CreateGroupParams): Promise<StudyGroup> {
    const cleanSlug = params.name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .slice(0, 28)
      .replace(/-+$/, '');

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
    const target = this.groups.find((g) => g.id === groupId || g.roomId === groupId);
    if (!target) return;

    // If currently active in this group room, leave it
    const currentRoom = this.roomService.getCurrentRoom();
    if (currentRoom && currentRoom.roomId === target.roomId) {
      await this.roomService.leaveCurrentRoom();
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
    this.listeners.add(listener);
    listener(this.groups);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.listeners.forEach((fn) => fn(this.groups));
  }
}
