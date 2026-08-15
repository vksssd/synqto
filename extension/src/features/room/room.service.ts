// ─── Room Service (Room State & Lifecycle Coordinator) ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomContext, computeRoomId } from './room-utils';

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

    // Leave existing room if any
    this.leaveCurrentRoom();

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
    this.network.init(identity, roomId);

    this.emitChange();
    return roomContext;
  }

  public async joinCustomRoom(roomName: string): Promise<RoomContext> {
    const cleanSlug = roomName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 32);
    const roomId = `room:${cleanSlug || 'lounge'}-general`;

    if (this.currentRoom?.roomId === roomId) {
      return this.currentRoom;
    }

    this.leaveCurrentRoom();

    const roomContext: RoomContext = {
      roomId,
      platform: 'Custom',
      slug: cleanSlug,
      title: roomName,
      canonicalUrl: `custom://${cleanSlug}`,
    };

    this.currentRoom = roomContext;
    const identity = await this.identityService.getOrCreateIdentity();
    this.network.init(identity, roomId);

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

    this.leaveCurrentRoom();

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
    this.network.init(identity, context.roomId);

    this.emitChange();
    return roomContext;
  }

  public leaveCurrentRoom() {
    if (!this.currentRoom) return;

    this.network.leave();
    this.currentRoom = null;
    this.emitChange();
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
}
