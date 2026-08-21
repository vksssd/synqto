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

export interface SerializedTabContextInfo extends Omit<TabContextInfo, 'capabilities'> {
  capabilities: Capability[];
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

  /** JSON-safe snapshot for chrome.storage.session across MV3 service-worker restarts. */
  public snapshot(): SerializedTabContextInfo[] {
    return Array.from(this.contexts.values()).map((ctx) => ({
      ...ctx,
      capabilities: Array.from(ctx.capabilities),
    }));
  }

  /**
   * Merges a persisted snapshot without overwriting a context reported more recently by a
   * live content script during startup hydration.
   */
  public hydrate(entries: unknown, liveTabIds?: ReadonlySet<TabId>): void {
    if (!Array.isArray(entries)) return;

    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Partial<SerializedTabContextInfo>;
      if (!Number.isInteger(entry.tabId) || (entry.tabId as number) < 0) continue;
      const tabId = entry.tabId as TabId;
      if (liveTabIds && !liveTabIds.has(tabId)) continue;
      if (!Array.isArray(entry.capabilities)) continue;

      const capabilities = entry.capabilities.filter(
        (capability): capability is Capability =>
          capability === 'cursor' ||
          capability === 'code' ||
          capability === 'whiteboard' ||
          capability === 'chat' ||
          capability === 'timer' ||
          capability === 'voice' ||
          capability === 'stage'
      );
      const restored: TabContextInfo = {
        tabId,
        url: typeof entry.url === 'string' ? entry.url : undefined,
        roomId: typeof entry.roomId === 'string' ? entry.roomId : undefined,
        peerId: typeof entry.peerId === 'string' ? entry.peerId : undefined,
        sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
        contextType: entry.contextType === 'CONTENT_SCRIPT' ? entry.contextType : 'CONTENT_SCRIPT',
        capabilities: new Set(capabilities),
        isProblemTab: entry.isProblemTab === true,
        registeredAt:
          typeof entry.registeredAt === 'number' ? entry.registeredAt : Date.now(),
        lastActiveAt: typeof entry.lastActiveAt === 'number' ? entry.lastActiveAt : Date.now(),
      };

      const existing = this.contexts.get(tabId);
      if (!existing || restored.lastActiveAt > existing.lastActiveAt) {
        this.contexts.set(tabId, restored);
      }
    }
  }
}
