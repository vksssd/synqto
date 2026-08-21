// ─── Room Service (Room State & Lifecycle Coordinator) ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomContext, computeRoomId } from './room-utils';
import { DIRECT_ONLY_POLICY } from '@/core/topology/topology.types';

export const SELECTED_ROOM_STORAGE_KEY = 'synqto_selected_room';

export class RoomService {
  private static instance: RoomService | null = null;
  private network: NetworkService;
  private identityService: IdentityService;

  private currentRoom: RoomContext | null = null;
  private listeners: Set<(room: RoomContext | null) => void> = new Set();

  private constructor() {
    this.network = NetworkService.getInstance();
    this.identityService = IdentityService.getInstance();
  }

  public static getInstance(): RoomService {
    if (!RoomService.instance) {
      RoomService.instance = new RoomService();
    }
    return RoomService.instance;
  }

  public async joinProblemRoom(
    platform: string,
    slug: string,
    title: string,
    canonicalUrl: string
  ): Promise<RoomContext> {
    const roomId = computeRoomId(slug, canonicalUrl);

    if (this.currentRoom?.roomId === roomId) {
      return this.currentRoom;
    }

    // Keep the old selection until the replacement has completed identity/network setup.
    this.leaveCurrentRoom(true);

    const roomContext: RoomContext = {
      roomId,
      platform,
      slug,
      title,
      canonicalUrl,
    };

    this.currentRoom = roomContext;

    // Get current identity and join network
    const identity = await this.identityService.getOrCreateIdentity();
    if (this.currentRoom !== roomContext) {
      return this.currentRoom ?? roomContext;
    }
    this.network.init(identity, roomId);

    this.persistSelectedRoom(roomContext);
    this.emitChange();
    return roomContext;
  }

  public async joinCustomRoom(roomName: string): Promise<RoomContext> {
    const cleanSlug = roomName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 32);
    const roomId = `room:${cleanSlug || 'lounge'}-general`;

    if (this.currentRoom?.roomId === roomId) {
      return this.currentRoom;
    }

    // Keep the previous persisted selection until this asynchronous replacement succeeds.
    this.leaveCurrentRoom(true);

    const roomContext: RoomContext = {
      roomId,
      platform: 'Custom',
      slug: cleanSlug,
      title: roomName,
      canonicalUrl: `custom://${cleanSlug}`,
    };

    this.currentRoom = roomContext;
    const identity = await this.identityService.getOrCreateIdentity();
    if (this.currentRoom !== roomContext) {
      return this.currentRoom ?? roomContext;
    }
    this.network.init(identity, roomId);

    this.persistSelectedRoom(roomContext);
    this.emitChange();
    return roomContext;
  }

  public async joinGroupRoom(context: {
    roomId: string;
    name: string;
    slug: string;
    avatar: string;
    isPrivate: boolean;
    description?: string;
    topicTag?: string;
  }): Promise<RoomContext> {
    if (this.currentRoom?.roomId === context.roomId) {
      return this.currentRoom;
    }

    this.leaveCurrentRoom(true);

    const roomContext: RoomContext = {
      roomId: context.roomId,
      platform: 'Group',
      slug: context.slug,
      title: context.name,
      canonicalUrl: `group://${context.slug}`,
      isGroup: true,
      groupDetails: {
        name: context.name,
        avatar: context.avatar,
        isPrivate: context.isPrivate,
        description: context.description,
        topicTag: context.topicTag,
      },
    };

    this.currentRoom = roomContext;
    const identity = await this.identityService.getOrCreateIdentity();
    if (this.currentRoom !== roomContext) {
      return this.currentRoom ?? roomContext;
    }
    this.network.init(identity, context.roomId);

    this.persistSelectedRoom(roomContext);
    this.emitChange();
    return roomContext;
  }

  /**
   * Joins a CoFocus session room (Watcher or Together).
   *
   * The room ID comes from the matchmaking lobby (or a shared invite code) rather than being
   * derived from page content, so there is no computeRoomId call here — both peers were handed
   * the same ID by the server.
   *
   * THE IMPORTANT LINE is the DIRECT_ONLY_POLICY passed to network.init(). It is what makes
   * "CoFocus sessions are always two-peer direct P2P" a structural guarantee rather than a
   * consequence of peer count sitting below TIER1_PROMOTE_AT: under this policy the tier
   * coordinator never evaluates promotion, no leader mesh is constructed, and the transport
   * router refuses to fall back to the server relay. This is the only call site that passes a
   * non-default policy.
   */
  public async joinCoFocusRoom(
    roomId: string,
    opts: {
      mode: 'WATCHER' | 'TOGETHER';
      sessionLengthSec?: number;
      subjectTag?: string;
      partnerPeerId?: string;
    }
  ): Promise<RoomContext> {
    if (this.currentRoom?.roomId === roomId) {
      return this.currentRoom;
    }

    this.leaveCurrentRoom(true);

    const isWatcher = opts.mode === 'WATCHER';
    const roomContext: RoomContext = {
      roomId,
      platform: 'CoFocus',
      slug: isWatcher ? 'watcher' : 'together',
      title: isWatcher
        ? 'Focus Session'
        : opts.subjectTag
        ? `Study Together · ${opts.subjectTag}`
        : 'Study Together',
      canonicalUrl: `cofocus://${roomId}`,
      cofocusMode: opts.mode,
      cofocusDetails: {
        sessionLengthSec: opts.sessionLengthSec,
        subjectTag: opts.subjectTag,
        partnerPeerId: opts.partnerPeerId,
      },
    };

    this.currentRoom = roomContext;

    const identity = await this.identityService.getOrCreateIdentity();
    if (this.currentRoom !== roomContext) {
      return this.currentRoom ?? roomContext;
    }
    this.network.init(identity, roomId, DIRECT_ONLY_POLICY);

    // Cross-context signal that a CoFocus session is live, independent of chrome.storage's
    // synqto_active_problem (which this session does not use at all, and which the offscreen
    // document's background-mesh listener otherwise has no way to distinguish from an
    // ordinary problem room).
    //
    // RoomService is a singleton PER EXECUTION CONTEXT, not a shared instance: the side panel
    // and the offscreen document are separate pages with separate JS heaps, so
    // this.currentRoom here is invisible to offscreen.ts's own RoomService instance. Without
    // this flag, offscreen.ts's resumeBackgroundMesh() — which fires the instant the side
    // panel closes, precisely when a Watcher session (which occupies the whole panel) is most
    // likely to be running — had no way to know a CoFocus room was active anywhere and would
    // silently replace it via joinProblemRoom()'s leaveCurrentRoom(). See offscreen.ts for the
    // read side.
    this.setCoFocusActiveFlag(roomId, opts.mode);

    this.persistSelectedRoom(roomContext);
    this.emitChange();
    return roomContext;
  }

  /**
   * Rejoins the exact room selected by another extension context or a previous browser UI.
   * It deliberately trusts the stored roomId instead of deriving one from the active tab:
   * selected room and detected browser problem are separate state.
   */
  public async resumeRoom(context: RoomContext): Promise<RoomContext> {
    if (!context?.roomId || !context.slug || !context.canonicalUrl) {
      throw new Error('[RoomService] Cannot resume an invalid room context');
    }
    if (this.currentRoom?.roomId === context.roomId) return this.currentRoom;

    this.leaveCurrentRoom(true);
    const roomContext: RoomContext = {
      ...context,
      groupDetails: context.groupDetails ? { ...context.groupDetails } : undefined,
      cofocusDetails: context.cofocusDetails ? { ...context.cofocusDetails } : undefined,
    };
    this.currentRoom = roomContext;

    const identity = await this.identityService.getOrCreateIdentity();
    if (this.currentRoom !== roomContext) {
      return this.currentRoom ?? roomContext;
    }
    this.network.init(
      identity,
      roomContext.roomId,
      roomContext.cofocusMode ? DIRECT_ONLY_POLICY : undefined
    );
    if (roomContext.cofocusMode) {
      this.setCoFocusActiveFlag(roomContext.roomId, roomContext.cofocusMode);
    }
    this.persistSelectedRoom(roomContext);
    this.emitChange();
    return roomContext;
  }

  private setCoFocusActiveFlag(roomId: string, mode: 'WATCHER' | 'TOGETHER') {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ synqto_cofocus_active: { roomId, mode } });
    }
  }

  private clearCoFocusActiveFlag() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove('synqto_cofocus_active');
    }
  }

  public leaveCurrentRoom(preserveSelection = false) {
    if (!this.currentRoom) {
      if (!preserveSelection) this.clearSelectedRoom();
      return;
    }

    if (this.currentRoom.cofocusMode) {
      this.clearCoFocusActiveFlag();
    }

    this.network.leave();
    this.currentRoom = null;
    if (!preserveSelection) this.clearSelectedRoom();
    this.emitChange();
  }

  /** Releases this JavaScript context's socket while keeping the user's selected room. */
  public suspendCurrentRoom() {
    this.leaveCurrentRoom(true);
  }

  public leaveRoom() {
    this.leaveCurrentRoom();
  }

  public getCurrentRoom(): RoomContext | null {
    return this.currentRoom;
  }

  public onChange(listener: (room: RoomContext | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentRoom);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange() {
    this.listeners.forEach((fn) => fn(this.currentRoom));
  }

  private persistSelectedRoom(room: RoomContext) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ [SELECTED_ROOM_STORAGE_KEY]: room });
    }
  }

  private clearSelectedRoom() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.remove(SELECTED_ROOM_STORAGE_KEY);
    }
  }
}
