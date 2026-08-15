// ─── Group & Community Service (Serverless Zero-Knowledge P2P) ───

import { StudyGroup, CreateGroupParams, GroupInvitePayload, GroupSchedule } from './group.types';
import { RoomService } from '@/features/room/room.service';
import { IdentityService } from '@/features/identity/identity.service';
import { fnv1aHash, sha256Hex, uuid } from '@/shared/utils';

const STORAGE_KEY = 'nerd_buddy_saved_groups';

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
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        if (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY])) {
          this.groups = res[STORAGE_KEY];
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
      chrome.storage.local.set({ [STORAGE_KEY]: this.groups });
    }
  }

  private getDefaultGroups(): StudyGroup[] {
    return [
      {
        id: 'default-leetcode-150',
        name: 'LeetCode Top 150',
        slug: 'leetcode-top-150',
        description: 'Daily interview prep and algorithmic problem solving',
        goals: 'Complete all 150 LeetCode problems together. Help each other with approaches and optimizations.',
        rules: '1. Be respectful\n2. No direct copy-paste solutions\n3. Explain your approach first\n4. Use spoiler tags for solutions',
        schedule: { openTime: '19:00', closeTime: '21:00', timezone: 'IST', days: ['Mon', 'Wed', 'Fri'] },
        tags: ['#general', '#doubts', '#solutions', '#resources'],
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
        goals: 'Master system design interviews. Weekly mock design sessions.',
        rules: '1. Share diagrams when possible\n2. Discuss trade-offs\n3. No gatekeeping',
        schedule: { openTime: '20:00', closeTime: '22:00', timezone: 'IST', days: ['Tue', 'Thu', 'Sat'] },
        tags: ['#general', '#mock-interviews', '#resources'],
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
   * Returns a specific group by ID or roomId.
   */
  public getGroupById(groupId: string): StudyGroup | undefined {
    return this.groups.find((g) => g.id === groupId || g.roomId === groupId);
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
      passwordHash = await sha256Hex(params.password);
      // Zero-knowledge secret room ID: only peers with exact password compute same roomId
      const secretSeed = `${cleanSlug}:${params.password}`;
      const secretHash = await sha256Hex(secretSeed);
      roomId = `group:${cleanSlug || 'squad'}-sec-${secretHash.slice(0, 16)}`;
    } else {
      roomId = `group:${cleanSlug || 'squad'}-pub-${fnv1aHash(cleanSlug + ':public')}`;
    }

    const identity = await this.identityService.getOrCreateIdentity();

    // Ensure tags always include #general
    const tags = params.tags && params.tags.length > 0
      ? params.tags
      : ['#general'];
    if (!tags.includes('#general')) tags.unshift('#general');

    const newGroup: StudyGroup = {
      id: uuid(),
      name: params.name.trim(),
      slug: cleanSlug || 'squad',
      description: params.description?.trim() || undefined,
      goals: params.goals?.trim() || undefined,
      rules: params.rules?.trim() || undefined,
      schedule: params.schedule,
      avatar: params.avatar || '🚀',
      isPrivate: params.isPrivate,
      passwordHash,
      topicTag: params.topicTag || 'General',
      tags,
      roomId,
      createdAt: Date.now(),
      creatorPeerId: identity.peerId,
      adminPeerIds: [identity.peerId],
      isCreator: true,
      isMember: true,
      joinedAt: Date.now(),
      welcomeMessageRead: true, // creator doesn't need to read welcome
    };

    // Prepend to list
    this.groups = [newGroup, ...this.groups.filter((g) => g.roomId !== newGroup.roomId)];
    this.saveToStorage();
    this.emitChange();

    // Automatically enter the newly created group room
    await this.enterGroupRoom(newGroup);

    return newGroup;
  }

  /**
   * Joins a group as a persistent member WITHOUT switching signaling rooms.
   * User stays connected to their current rooms (multi-room support).
   * Use `enterGroupRoom()` to actually connect to the signaling room.
   */
  public async joinGroup(
    group: StudyGroup,
    password?: string
  ): Promise<{ success: boolean; error?: string }> {
    let targetRoomId = group.roomId;

    if (group.isPrivate) {
      if (!password && !group.passwordHash) {
        return { success: false, error: 'Password required to enter this private group' };
      }

      if (password) {
        // Compute zero-knowledge room ID with the entered password
        const secretSeed = `${group.slug}:${password}`;
        const secretHash = await sha256Hex(secretSeed);
        targetRoomId = `group:${group.slug}-sec-${secretHash.slice(0, 16)}`;

        // If we have stored passwordHash, verify local match
        if (group.passwordHash) {
          const inputHash = await sha256Hex(password);
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
      welcomeMessageRead: false, // new member needs to read welcome
    };

    // Save group to list and mark as persistent joined member
    const existingIdx = this.groups.findIndex((g) => g.id === group.id || g.roomId === group.roomId);
    if (existingIdx >= 0) {
      updatedGroup.welcomeMessageRead = this.groups[existingIdx].welcomeMessageRead;
      this.groups[existingIdx] = updatedGroup;
    } else {
      this.groups = [updatedGroup, ...this.groups];
    }
    this.saveToStorage();
    this.emitChange();

    return { success: true };
  }

  /**
   * Actually enters a group's signaling room (connects to peers).
   * This is separate from joinGroup() to support multi-room connections.
   */
  public async enterGroupRoom(group: StudyGroup): Promise<void> {
    await this.roomService.joinGroupRoom({
      roomId: group.roomId,
      name: group.name,
      slug: group.slug,
      avatar: group.avatar,
      isPrivate: group.isPrivate,
      description: group.description,
      topicTag: group.topicTag,
    });
  }

  /**
   * Synq action: joins as member (if not already) AND enters the room.
   * This is the primary user action from the GroupCard.
   */
  public async synqToGroup(
    group: StudyGroup,
    password?: string
  ): Promise<{ success: boolean; error?: string; needsWelcome?: boolean }> {
    // If not yet a member, join first
    if (!group.isMember && !group.isCreator) {
      const joinResult = await this.joinGroup(group, password);
      if (!joinResult.success) return joinResult;

      // Check if needs welcome gate
      const updatedGroup = this.getGroupById(group.id);
      const hasWelcomeContent = Boolean(
        updatedGroup?.goals || updatedGroup?.rules || updatedGroup?.schedule
      );
      if (hasWelcomeContent && !updatedGroup?.welcomeMessageRead) {
        return { success: true, needsWelcome: true };
      }
    }

    // Enter the signaling room
    await this.enterGroupRoom(group);
    return { success: true };
  }

  /**
   * Leaves a permanent study group membership.
   * User is removed from persistent membership but group stays in discover list.
   */
  public async leaveGroup(groupId: string): Promise<void> {
    const target = this.groups.find((g) => g.id === groupId || g.roomId === groupId);
    if (!target) return;

    // If currently active in this group room, leave it
    const currentRoom = this.roomService.getCurrentRoom();
    if (currentRoom && currentRoom.roomId === target.roomId) {
      await this.roomService.leaveCurrentRoom();
    }

    // Mark as not a member but keep in list for discovery
    target.isMember = false;
    target.isCreator = false;
    target.welcomeMessageRead = false;
    target.joinedAt = undefined;
    this.saveToStorage();
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
   * Checks if user is admin/creator (can edit group info).
   */
  public async isAdmin(groupId: string): Promise<boolean> {
    const g = this.groups.find((grp) => grp.id === groupId || grp.roomId === groupId);
    if (!g) return false;
    if (g.isCreator) return true;
    const identity = await this.identityService.getOrCreateIdentity();
    return Boolean(g.adminPeerIds?.includes(identity.peerId));
  }

  /**
   * Updates group info (description, goals, rules, schedule, tags).
   * Only admin/creator can call this.
   */
  public async updateGroupInfo(
    groupId: string,
    updates: {
      description?: string;
      goals?: string;
      rules?: string;
      schedule?: GroupSchedule;
      tags?: string[];
      name?: string;
      avatar?: string;
    }
  ): Promise<boolean> {
    const idx = this.groups.findIndex((g) => g.id === groupId || g.roomId === groupId);
    if (idx < 0) return false;

    const group = this.groups[idx];
    if (updates.description !== undefined) group.description = updates.description;
    if (updates.goals !== undefined) group.goals = updates.goals;
    if (updates.rules !== undefined) group.rules = updates.rules;
    if (updates.schedule !== undefined) group.schedule = updates.schedule;
    if (updates.tags !== undefined) {
      group.tags = updates.tags;
      if (!group.tags.includes('#general')) group.tags.unshift('#general');
    }
    if (updates.name !== undefined) group.name = updates.name;
    if (updates.avatar !== undefined) group.avatar = updates.avatar;

    this.saveToStorage();
    this.emitChange();
    return true;
  }

  /**
   * Marks the welcome message as read for this group.
   */
  public markWelcomeRead(groupId: string): void {
    const g = this.groups.find((grp) => grp.id === groupId || grp.roomId === groupId);
    if (g) {
      g.welcomeMessageRead = true;
      this.saveToStorage();
      this.emitChange();
    }
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
   * Deletes / removes a group from saved study squads entirely.
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
    group: StudyGroup,
    includePassword = false,
    password = ''
  ): string {
    const payload: GroupInvitePayload = {
      version: 1,
      name: group.name,
      slug: group.slug,
      avatar: group.avatar,
      isPrivate: group.isPrivate,
      topicTag: group.topicTag,
      description: group.description,
      pwd: includePassword && password ? password : undefined,
    };

    const jsonStr = JSON.stringify(payload);
    try {
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
      return `NBGRP:${b64}`;
    } catch {
      return `NBGRP:${btoa(jsonStr)}`;
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
      const jsonStr = decodeURIComponent(escape(atob(b64)));
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
