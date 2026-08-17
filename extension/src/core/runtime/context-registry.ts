// ─── Extension Context Registry & Capability Router ───

import { TabId, RoomId, PeerId, SessionId, Capability, ExtensionContextType } from '../types/identifiers';

export interface TabContextInfo {
  tabId: TabId;
  url?: string;
  roomId?: RoomId;
  peerId?: PeerId;
  sessionId?: SessionId;
  contextType: ExtensionContextType;
  capabilities: Set<Capability>;
  isProblemTab: boolean;
  registeredAt: number;
  lastActiveAt: number;
}

export class ContextRegistry {
  private static instance: ContextRegistry | null = null;
  private contexts: Map<TabId, TabContextInfo> = new Map();

  public static getInstance(): ContextRegistry {
    if (!ContextRegistry.instance) {
      ContextRegistry.instance = new ContextRegistry();
    }
    return ContextRegistry.instance;
  }

  public register(info: {
    tabId: TabId;
    url?: string;
    roomId?: RoomId;
    peerId?: PeerId;
    sessionId?: SessionId;
    contextType?: ExtensionContextType;
    capabilities?: Capability[];
    isProblemTab?: boolean;
  }): TabContextInfo {
    const existing = this.contexts.get(info.tabId);
    const updated: TabContextInfo = {
      tabId: info.tabId,
      url: info.url ?? existing?.url,
      roomId: info.roomId ?? existing?.roomId,
      peerId: info.peerId ?? existing?.peerId,
      sessionId: info.sessionId ?? existing?.sessionId,
      contextType: info.contextType ?? existing?.contextType ?? 'CONTENT_SCRIPT',
      capabilities: new Set([
        ...(existing?.capabilities ? Array.from(existing.capabilities) : []),
        ...(info.capabilities ?? ['cursor', 'code', 'whiteboard', 'chat']),
      ]),
      isProblemTab: info.isProblemTab ?? existing?.isProblemTab ?? false,
      registeredAt: existing?.registeredAt ?? Date.now(),
      lastActiveAt: Date.now(),
    };

    this.contexts.set(info.tabId, updated);
    return updated;
  }

  public unregister(tabId: TabId): boolean {
    return this.contexts.delete(tabId);
  }

  public getContext(tabId: TabId): TabContextInfo | undefined {
    return this.contexts.get(tabId);
  }

  public updateRoom(tabId: TabId, roomId: RoomId): void {
    const ctx = this.contexts.get(tabId);
    if (ctx) {
      ctx.roomId = roomId;
      ctx.lastActiveAt = Date.now();
    } else {
      this.register({ tabId, roomId });
    }
  }

  public updateUrl(tabId: TabId, url: string): void {
    const ctx = this.contexts.get(tabId);
    if (ctx) {
      ctx.url = url;
      ctx.lastActiveAt = Date.now();
    } else {
      this.register({ tabId, url });
    }
  }

  public getTabsForRoom(roomId?: RoomId, requiredCapability?: Capability): TabId[] {
    const matches: TabId[] = [];
    this.contexts.forEach((ctx, tabId) => {
      if (roomId && ctx.roomId !== roomId) return;
      if (requiredCapability && !ctx.capabilities.has(requiredCapability)) return;
      matches.push(tabId);
    });
    return matches;
  }

  public getAllProblemTabs(): TabId[] {
    const matches: TabId[] = [];
    this.contexts.forEach((ctx, tabId) => {
      if (ctx.isProblemTab) {
        matches.push(tabId);
      }
    });
    return matches;
  }

  public pruneStale(maxAgeMs = 1000 * 60 * 60 * 24): void {
    const now = Date.now();
    this.contexts.forEach((ctx, tabId) => {
      if (now - ctx.lastActiveAt > maxAgeMs) {
        this.contexts.delete(tabId);
      }
    });
  }
}
