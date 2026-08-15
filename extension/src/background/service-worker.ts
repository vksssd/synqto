// ─── Background Service Worker (Manifest V3 Coordinator) ───

const ALARM_KEEPALIVE = 'nerd_buddy_keepalive';
let creatingOffscreen: Promise<void> | null = null;

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

// 3. Listen for tab switches to keep active problem context updated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      chrome.storage.local.set({
        synqto_active_url: tab.url,
        nerd_buddy_active_url: tab.url,
      });
    }
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    chrome.storage.local.set({
      synqto_active_url: changeInfo.url,
      nerd_buddy_active_url: changeInfo.url,
    });
  }
});

// 4. Listen for messages from content scripts and floating widgets
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PROBLEM_DETECTED') {
    // Only accept from active foreground tab
    if (sender.tab?.active) {
      chrome.storage.local.set({
        synqto_active_problem: message.payload,
        synqto_active_url: message.payload.url,
        nerd_buddy_active_problem: message.payload,
        nerd_buddy_active_url: message.payload.url,
      });
    }
  } else if (
    message.type === 'LOCAL_CURSOR_MOVE' ||
    message.type === 'LOCAL_CLICK_PULSE' ||
    message.type === 'WHITEBOARD_STROKE_LOCAL' ||
    message.type === 'WHITEBOARD_CLEAR_LOCAL' ||
    message.type === 'WHITEBOARD_UNDO_LOCAL'
  ) {
    // Forward to sidepanel / offscreen for DataChannel broadcast
    chrome.runtime.sendMessage(message).catch(() => {});
  } else if (message.type === 'OPEN_SIDEPANEL') {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (tabId && (chrome.sidePanel as any)?.open) {
      (chrome.sidePanel as any).open({ tabId }).catch(() => {
        if (windowId) {
          (chrome.sidePanel as any).open({ windowId }).catch(() => {});
        }
      });
    } else if (windowId && (chrome.sidePanel as any)?.open) {
      (chrome.sidePanel as any).open({ windowId }).catch(() => {});
    }
    chrome.storage.local.set({
      synqto_sidepanel_open: true,
      nerd_buddy_sidepanel_open: true,
    });
    sendResponse({ success: true });
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
  return true;
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
