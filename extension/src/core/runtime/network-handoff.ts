// Coordinates ownership of the one signaling/WebRTC session shared by extension pages.
//
// A JavaScript singleton is only a singleton inside one execution context. The side panel and
// offscreen document have separate heaps, so both can otherwise create a SignalingService for
// the same peer ID. A storage-backed request/acknowledgement gives the offscreen owner a chance
// to release its socket before the panel starts a replacement.

export const NETWORK_HANDOFF_REQUEST_KEY = 'synqto_network_handoff_request';
export const NETWORK_HANDOFF_ACK_KEY = 'synqto_network_handoff_ack';

const PANEL_OPEN_KEY = 'synqto_sidepanel_open';
const LEGACY_PANEL_OPEN_KEY = 'nerd_buddy_sidepanel_open';
const DEFAULT_HANDOFF_TIMEOUT_MS = 600;
let latestLocalClaimToken: string | null = null;

export interface NetworkOwnershipClaim {
  token: string | null;
  ready: Promise<void>;
}

function createHandoffToken(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `panel-${Date.now()}-${randomPart}`;
}

/**
 * Marks the side panel as the desired owner and waits until the offscreen context has stopped
 * its network session. A timeout is intentional: the offscreen document may not exist yet, in
 * which case there is no competing owner to acknowledge the request.
 */
export function claimSidePanelNetworkOwnership(
  timeoutMs = DEFAULT_HANDOFF_TIMEOUT_MS
): NetworkOwnershipClaim {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { token: null, ready: Promise.resolve() };
  }

  const token = createHandoffToken();
  latestLocalClaimToken = token;

  const ready = new Promise<void>((resolve) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      chrome.storage.onChanged.removeListener(onStorageChange);
      // Do not remove the token here. A newer panel claim may already have replaced it, and
      // an older claim's completion must never erase the newer ownership request. The token
      // also lets an offscreen document created slightly later observe that the panel owns
      // networking and yield before it starts. releaseSidePanelNetworkOwnership clears it.
      resolve();
    };

    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[NETWORK_HANDOFF_ACK_KEY]?.newValue === token) finish();
    };

    chrome.storage.onChanged.addListener(onStorageChange);
    timeoutHandle = setTimeout(finish, Math.max(0, timeoutMs));

    chrome.storage.local.set(
      {
        [PANEL_OPEN_KEY]: true,
        [LEGACY_PANEL_OPEN_KEY]: true,
        [NETWORK_HANDOFF_REQUEST_KEY]: token,
      },
      () => {
        // A storage failure means no offscreen context can observe this request. Continue as
        // the only viable owner and let the normal signaling failure path report any problem.
        if (chrome.runtime.lastError) finish();
      }
    );
  });

  return { token, ready };
}

/** Marks the panel closed after its local network session has already been stopped. */
export function releaseSidePanelNetworkOwnership(token: string | null): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  // React development remounts and rapid close/reopen sequences can leave an older effect's
  // cleanup running after a newer claim. That stale cleanup does not own the new claim.
  if (!token || latestLocalClaimToken !== token) return;

  chrome.storage.local.set(
    {
      [PANEL_OPEN_KEY]: false,
      [LEGACY_PANEL_OPEN_KEY]: false,
    },
    () => {
      // A newer claim in this realm wins even if it started while the storage write was
      // pending. Across realms, only clear correlation keys when storage still contains the
      // token being released.
      if (latestLocalClaimToken !== token) return;
      chrome.storage.local.get([NETWORK_HANDOFF_REQUEST_KEY], (res) => {
        if (latestLocalClaimToken !== token) return;
        if (res[NETWORK_HANDOFF_REQUEST_KEY] === token) {
          chrome.storage.local.remove([NETWORK_HANDOFF_REQUEST_KEY, NETWORK_HANDOFF_ACK_KEY]);
        }
        latestLocalClaimToken = null;
      });
    }
  );
}
