// ─── Background Service Worker (Manifest V3 Coordinator) ───

import { ContextRegistry } from '@/core/runtime/context-registry';
import { detectRoutedResource, RoutedResource } from '@/core/runtime/tab-room-context';
import { Capability } from '@/core/types/identifiers';
import {
  PopupRect,
  PopupDisplay,
  PopupWindowPreset,
  computePopupBounds,
  isWhiteboardPopupWindow,
  selectPopupDisplay,
} from '@/core/runtime/popup-window';

const ALARM_KEEPALIVE = 'nerd_buddy_keepalive';
const CONTEXT_REGISTRY_STORAGE_KEY = 'synqto_context_registry';
let creatingOffscreen: Promise<void> | null = null;
const WHITEBOARD_POPUP_SESSION_KEY = 'synqto_whiteboard_popup_window_id';
let whiteboardPopupWindowId: number | null = null;
let whiteboardPopupOperation: Promise<{ success: boolean; windowId?: number; reused?: boolean; error?: string }> | null = null;

async function getSourceWindowBounds(windowId?: number): Promise<PopupRect | null> {
  try {
    // Content-script senders carry tab.windowId. Extension pages such as the side panel do
    // not, so fall back to the last-focused browser window to preserve monitor affinity.
    const win = windowId === undefined
      ? await chrome.windows.getLastFocused()
      : await chrome.windows.get(windowId);
    if (
      typeof win.left !== 'number' || typeof win.top !== 'number' ||
      typeof win.width !== 'number' || typeof win.height !== 'number'
    ) return null;
    return { left: win.left, top: win.top, width: win.width, height: win.height };
  } catch {
    return null;
  }
}

async function getPopupWorkArea(sourceWindowId?: number): Promise<PopupRect> {
  const sourceBounds = await getSourceWindowBounds(sourceWindowId);
  try {
    const displays = await new Promise<PopupDisplay[]>((resolve) => {
      chrome.system.display.getInfo((items) => resolve(items));
    });
    const selected = selectPopupDisplay(displays, sourceBounds);
    if (selected) return selected.workArea;
  } catch {
    // Older Chromium builds may not expose system.display despite the optional runtime API.
  }
  return sourceBounds ?? { left: 0, top: 0, width: 1280, height: 800 };
}

async function rememberWhiteboardPopup(windowId: number | null): Promise<void> {
  whiteboardPopupWindowId = windowId;
  if (!chrome.storage.session) return;
  if (windowId === null) await chrome.storage.session.remove(WHITEBOARD_POPUP_SESSION_KEY);
  else await chrome.storage.session.set({ [WHITEBOARD_POPUP_SESSION_KEY]: windowId });
}

async function forgetWhiteboardPopupIfOwned(windowId: number): Promise<void> {
  if (whiteboardPopupWindowId === windowId) whiteboardPopupWindowId = null;
  if (!chrome.storage.session) return;
  const stored = await chrome.storage.session.get([WHITEBOARD_POPUP_SESSION_KEY]);
  // A delayed removal event for an older window must never erase a replacement popup.
  if (stored[WHITEBOARD_POPUP_SESSION_KEY] === windowId) {
    await chrome.storage.session.remove(WHITEBOARD_POPUP_SESSION_KEY);
  }
}

async function findExistingWhiteboardPopup(canonicalUrl: string): Promise<chrome.windows.Window | null> {
  if (whiteboardPopupWindowId === null && chrome.storage.session) {
    const stored = await chrome.storage.session.get([WHITEBOARD_POPUP_SESSION_KEY]);
    const storedId = stored[WHITEBOARD_POPUP_SESSION_KEY];
    if (typeof storedId === 'number') whiteboardPopupWindowId = storedId;
  }

  if (whiteboardPopupWindowId !== null) {
    try {
      const cached = await chrome.windows.get(whiteboardPopupWindowId, { populate: true });
      if (isWhiteboardPopupWindow(cached, canonicalUrl)) return cached;
    } catch {
      // Stale IDs are expected after manual close or a service-worker/browser restart.
    }
    await rememberWhiteboardPopup(null);
  }

  // Session restore can recreate the popup while storage.session starts empty. Discover the
  // canonical URL before creating so browser restart cannot produce a duplicate document.
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  const discovered = windows.find((win) => isWhiteboardPopupWindow(win, canonicalUrl)) ?? null;
  if (discovered?.id !== undefined) await rememberWhiteboardPopup(discovered.id);
  return discovered;
}

function openOrFocusWhiteboardPopup(
  preset: PopupWindowPreset,
  sourceWindowId?: number
): Promise<{ success: boolean; windowId?: number; reused?: boolean; error?: string }> {
  if (whiteboardPopupOperation) return whiteboardPopupOperation;

  whiteboardPopupOperation = (async () => {
    const canonicalUrl = chrome.runtime.getURL('sidepanel.html?view=whiteboard');
    const workArea = await getPopupWorkArea(sourceWindowId);
    const bounds = computePopupBounds(workArea, preset);
    const existing = await findExistingWhiteboardPopup(canonicalUrl);

    if (existing?.id !== undefined) {
      try {
        const focused = await chrome.windows.update(existing.id, { ...bounds, focused: true });
        await rememberWhiteboardPopup(focused.id ?? existing.id);
        return { success: true, windowId: focused.id ?? existing.id, reused: true };
      } catch {
        // The user can close the popup between discovery and focus. Recover within this
        // request instead of making them click a second time.
        await forgetWhiteboardPopupIfOwned(existing.id);
      }
    }

    const created = await chrome.windows.create({
      url: canonicalUrl,
      type: 'popup',
      focused: true,
      ...bounds,
    });
    if (created.id === undefined) throw new Error('Chrome did not return a popup window ID');
    await rememberWhiteboardPopup(created.id);
    return { success: true, windowId: created.id, reused: false };
  })()
    .catch((err) => ({ success: false, error: String(err?.message || err) }))
    .finally(() => {
      whiteboardPopupOperation = null;
    });

  return whiteboardPopupOperation;
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === whiteboardPopupWindowId) {
    void forgetWhiteboardPopupIfOwned(windowId);
    return;
  }
  // A restarted worker may not have hydrated the cached ID yet.
  if (chrome.storage.session) {
    void chrome.storage.session.get([WHITEBOARD_POPUP_SESSION_KEY]).then((stored) => {
      if (stored[WHITEBOARD_POPUP_SESSION_KEY] === windowId) {
        return forgetWhiteboardPopupIfOwned(windowId);
      }
    });
  }
});

// 1. Setup keepalive alarm
chrome.alarms.create(ALARM_KEEPALIVE, { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_KEEPALIVE) {
    // Keepalive ping
    ensureOffscreenDocument();
  }
});

// 2. Open side panel when toolbar action icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// 2.1 First run.
//
// There was previously no onInstalled handler at all: a fresh install did nothing observable,
// so a new user was left with an unexplained toolbar icon and a FAB that appears on pages with
// no indication of what either does. Two cheap, non-intrusive signals fix that — a badge on the
// toolbar icon drawing the eye to the entry point, and a stored install timestamp so the panel
// can tell a first-time user from a returning one.
//
// Deliberately does NOT force-open a tab or the side panel: hijacking the browser on install is
// hostile, and sidePanel.open() requires a user gesture it would not have here anyway.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      synqto_installed_at: Date.now(),
      synqto_first_run_pending: true,
    });

    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    chrome.action.setTitle({ title: 'Synqto — click to get started' });
  }
});

// Clear the new-install badge the first time the panel is actually opened, so it marks
// "not yet opened" rather than becoming permanent decoration.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.synqto_sidepanel_open?.newValue === true) {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.set({ synqto_first_run_pending: false });
  }
});

const registry = ContextRegistry.getInstance();
const removedDuringHydration = new Set<number>();

const registryReady = (async () => {
  try {
    if (!chrome.storage.session) return;
    const [stored, tabs] = await Promise.all([
      chrome.storage.session.get([CONTEXT_REGISTRY_STORAGE_KEY]),
      chrome.tabs.query({}),
    ]);
    const liveTabIds = new Set(
      tabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => tabId !== undefined && !removedDuringHydration.has(tabId))
    );
    registry.hydrate(stored[CONTEXT_REGISTRY_STORAGE_KEY], liveTabIds);
    registry.pruneStale();
    await chrome.storage.session.set({
      [CONTEXT_REGISTRY_STORAGE_KEY]: registry.snapshot(),
    });
  } catch (err) {
    console.debug('[ServiceWorker] Context registry hydration bypassed:', err);
  }
})();

function persistContextRegistry() {
  void registryReady.then(async () => {
    try {
      if (chrome.storage.session) {
        await chrome.storage.session.set({
          [CONTEXT_REGISTRY_STORAGE_KEY]: registry.snapshot(),
        });
      }
    } catch (err) {
      console.debug('[ServiceWorker] Context registry persistence bypassed:', err);
    }
  });
}

function detectTabResource(tab: chrome.tabs.Tab): RoutedResource | null {
  return detectRoutedResource(tab.url, tab.title);
}

function updateTabContext(tab: chrome.tabs.Tab): RoutedResource | null {
  if (tab.id === undefined) return null;
  const resource = detectTabResource(tab);
  if (!resource) {
    registry.unregister(tab.id);
    persistContextRegistry();
    return null;
  }
  registry.register({
    tabId: tab.id,
    url: resource.url,
    roomId: resource.roomId,
    isProblemTab: true,
  });
  persistContextRegistry();
  return resource;
}

function publishActiveTabContext(tab: chrome.tabs.Tab) {
  const resource = updateTabContext(tab);
  if (resource) {
    chrome.storage.local.set({
      synqto_active_problem: resource,
      synqto_active_url: resource.url,
      nerd_buddy_active_problem: resource,
      nerd_buddy_active_url: resource.url,
    });
  } else {
    chrome.storage.local.remove([
      'synqto_active_problem',
      'nerd_buddy_active_problem',
      'synqto_active_url',
      'nerd_buddy_active_url',
    ]);
  }
}

// Clean up tab tracking when closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removedDuringHydration.add(tabId);
  registry.unregister(tabId);
  persistContextRegistry();
});

// 3. Listen for tab switches to keep active problem context updated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      publishActiveTabContext(tab);
    }
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const updatedTab = { ...tab, id: tabId, url: changeInfo.url };
    if (tab.active) publishActiveTabContext(updatedTab);
    else updateTabContext(updatedTab);
  }
});

function getRequiredCapability(messageType: string): Capability | undefined {
  if (messageType.startsWith('CODE_')) return 'code';
  if (messageType.startsWith('WHITEBOARD_')) return 'whiteboard';
  if (messageType.startsWith('LOCAL_CURSOR_') || messageType.startsWith('LOCAL_CLICK_')) return 'cursor';
  if (messageType === 'TIMER_STATE_SYNC') return 'timer';
  return undefined;
}

// 4. Listen for messages from content scripts and floating widgets
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROBLEM_DETECTED') {
    const resource = detectRoutedResource(
      sender.tab?.url || message.payload?.url,
      message.payload?.title || sender.tab?.title
    );
    if (sender.tab?.id) {
      if (resource) {
        registry.register({
          tabId: sender.tab.id,
          url: resource.url || sender.tab.url,
          roomId: resource.roomId,
          isProblemTab: true,
        });
        persistContextRegistry();
      }
    }
    // Only accept from active foreground tab
    if (sender.tab?.active && resource) {
      chrome.storage.local.set({
        synqto_active_problem: resource,
        synqto_active_url: resource.url,
        nerd_buddy_active_problem: resource,
        nerd_buddy_active_url: resource.url,
      });
    }
  } else if (message.type === 'SET_TAB_ROOM_CONTEXT') {
    const targetTabId = message.tabId || sender.tab?.id;
    if (targetTabId && message.roomId) {
      registry.updateRoom(targetTabId, message.roomId);
      persistContextRegistry();
    }
  } else if (
    message.type === 'LOCAL_CURSOR_MOVE' ||
    message.type === 'LOCAL_CLICK_PULSE' ||
    message.type === 'WHITEBOARD_STROKE_LOCAL' ||
    message.type === 'WHITEBOARD_STROKES_LOCAL' ||
    message.type === 'WHITEBOARD_UPDATE_STROKES_LOCAL' ||
    message.type === 'WHITEBOARD_CLEAR_LOCAL' ||
    message.type === 'WHITEBOARD_UNDO_LOCAL' ||
    message.type === 'WHITEBOARD_BG_LOCAL' ||
    message.type === 'WHITEBOARD_PAGE_SYNC_LOCAL' ||
    message.type === 'WHITEBOARD_PRIVACY_LOCAL' ||
    message.type === 'TIMER_STATE_SYNC' ||
    message.type === 'CODE_DELTA_LOCAL' ||
    message.type === 'CODE_CURSOR_LOCAL' ||
    message.type === 'CODE_SYNC_LOCAL' ||
    message.type === 'CODE_DELTA_REMOTE' ||
    message.type === 'CODE_CURSOR_REMOTE' ||
    message.type === 'CODE_SYNC_REMOTE'
  ) {
    // Route only to relevant tabs matching this room/session and capability. The original
    // runtime.sendMessage from the content script already reaches extension pages; sending it
    // again here delivered every local mutation twice.
    const explicitRoomId = message.roomId || message.payload?.roomId;

    void registryReady.then(() => {
      const targetRoomId =
        explicitRoomId ||
        (sender.tab?.id ? registry.getContext(sender.tab.id)?.roomId : undefined);
      const routedMessage = targetRoomId ? { ...message, roomId: targetRoomId } : message;
      const capability = getRequiredCapability(message.type);
      const targetTabs = targetRoomId
        ? registry.getTabsForRoom(targetRoomId, capability)
        : registry.getAllProblemTabs();

      targetTabs.forEach((tabId) => {
        if (tabId !== sender.tab?.id) {
          chrome.tabs.sendMessage(tabId, routedMessage).catch(() => {});
        }
      });
    });
  } else if (message.type === 'OPEN_SIDEPANEL') {
    // chrome.sidePanel.open() must be invoked synchronously inside this handler to stay
    // within the caller's user-gesture window, and it can still legitimately fail (no
    // gesture, panel disabled for the tab, older Chrome). Previously every failure was
    // swallowed by .catch(() => {}) AND sendResponse({success:true}) was sent regardless,
    // so a FAB click that did nothing still reported success and the user got no feedback
    // and no fallback instruction. Report the real outcome instead.
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    const sidePanel = (chrome.sidePanel as any);

    if (!sidePanel?.open) {
      sendResponse({ success: false, reason: 'unsupported' });
      return true;
    }

    const markOpen = () => {
      chrome.storage.local.set({
        synqto_sidepanel_open: true,
        nerd_buddy_sidepanel_open: true,
        // Only set when the caller asked for CoFocus (the FAB's 🎯 button), so an ordinary
        // panel open never pops the launcher unexpectedly. The panel clears this as soon as
        // it consumes it, making it a one-shot request rather than sticky state that would
        // re-open the launcher on every subsequent panel open.
        ...(message.openCoFocus ? { synqto_open_cofocus: Date.now() } : {}),
      });
    };

    // Guarantee the panel is ENABLED for this tab before opening it.
    //
    // sidePanel.open() rejects if the panel is disabled for the target tab, and a tab can end
    // up disabled without anyone asking for it — setOptions({enabled:false}) elsewhere, or a
    // tab restored from a session where it was. The manifest's default_path only establishes
    // a global default; it does not re-enable a tab that was explicitly turned off.
    //
    // setOptions is fire-and-forget on purpose: awaiting it would move open() out of the
    // synchronous window that Chrome requires for a user-gesture-initiated call, which is the
    // one thing that must not happen here.
    try {
      sidePanel.setOptions?.({ tabId, path: 'sidepanel.html', enabled: true });
    } catch {
      /* older Chrome without setOptions — open() below is still worth attempting */
    }

    const attempt = tabId ? sidePanel.open({ tabId }) : (windowId ? sidePanel.open({ windowId }) : Promise.reject(new Error('no target')));

    Promise.resolve(attempt)
      .then(() => {
        markOpen();
        sendResponse({ success: true });
      })
      .catch((err: any) => {
        // Retry at window scope before giving up — tab-scoped open fails on some pages.
        if (windowId && tabId) {
          Promise.resolve(sidePanel.open({ windowId }))
            .then(() => {
              markOpen();
              sendResponse({ success: true });
            })
            .catch((err2: any) => {
              console.warn('[ServiceWorker] sidePanel.open failed', err2);
              sendResponse({ success: false, reason: 'gesture', message: String(err2?.message || err2) });
            });
        } else {
          console.warn('[ServiceWorker] sidePanel.open failed', err);
          sendResponse({ success: false, reason: 'gesture', message: String(err?.message || err) });
        }
      });

    return true; // async sendResponse
  } else if (message.type === 'OPEN_WHITEBOARD_POPUP') {
    const preset: PopupWindowPreset =
      message.preset === 'small' || message.preset === 'medium' ||
      message.preset === 'large' || message.preset === 'near-maximized'
        ? message.preset
        : 'large';
    void openOrFocusWhiteboardPopup(preset, sender.tab?.windowId).then(sendResponse);
    return true;
  } else if (message.type === 'SEND_PAGE_CHAT_MESSAGE') {
    // Forward to sidepanel for P2P mesh distribution
    chrome.runtime.sendMessage(message).catch(() => {});
  } else if (message.type === 'CAPTURE_ACTIVE_TAB') {
    chrome.windows.getLastFocused({ populate: false }, (win) => {
      const windowId = win?.id;
      const executeCapture = (targetWinId?: number) => {
        const handleResult = (dataUrl: string | undefined) => {
          if (chrome.runtime.lastError || !dataUrl) {
            console.warn('[ServiceWorker] captureVisibleTab failed:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Capture failed' });
          } else {
            sendResponse({ success: true, dataUrl });
          }
        };

        if (targetWinId !== undefined) {
          chrome.tabs.captureVisibleTab(targetWinId, { format: 'png' }, handleResult);
        } else {
          chrome.tabs.captureVisibleTab({ format: 'png' }, handleResult);
        }
      };

      executeCapture(windowId);
    });
    return true; // asynchronous sendResponse
  }

  // Return FALSE (implicitly, by not returning true) for every branch that does not call
  // sendResponse asynchronously.
  //
  // This previously returned `true` unconditionally, which tells Chrome "a response is
  // coming later" and holds the message channel open until it times out. Almost no branch
  // above ever responds, so every message leaked a port — and the hot paths here are
  // LOCAL_CURSOR_MOVE and CODE_DELTA_LOCAL, which fire continuously while a user moves the
  // mouse or types. That produced a steady stream of leaked channels and the familiar
  // "message port closed before a response was received" console spam.
  return false;
});

// 5. Broadcast settings changes immediately to all active tabs
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.synqto_fab_settings || changes.nerd_buddy_fab_settings) {
      const newSettings = (changes.synqto_fab_settings || changes.nerd_buddy_fab_settings)?.newValue;
      if (newSettings) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((t) => {
            if (t.id) {
              chrome.tabs.sendMessage(t.id, {
                type: 'FAB_SETTINGS_UPDATED',
                payload: newSettings,
              }).catch(() => {});
            }
          });
        });
      }
    }
  }
});

// 5. Ensure offscreen document is alive for background WebRTC
async function ensureOffscreenDocument() {
  const offscreenUrl = 'offscreen.html';
  try {
    if (typeof (chrome.runtime as any)?.getContexts === 'function') {
      const existingContexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(offscreenUrl)],
      });

      if (existingContexts.length > 0) {
        return;
      }
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    if (typeof chrome.offscreen !== 'undefined') {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['WEB_RTC' as any],
        justification: 'Maintain P2P presence and notifications when sidepanel is closed',
      });

      await creatingOffscreen;
      creatingOffscreen = null;
    }
  } catch (err) {
    console.debug('[ServiceWorker] Offscreen doc initialization bypassed:', err);
    creatingOffscreen = null;
  }
}

ensureOffscreenDocument();
