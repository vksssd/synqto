// ─── Background Offscreen WebRTC Runner & Notifications ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService, SELECTED_ROOM_STORAGE_KEY } from '@/features/room/room.service';
import { chooseResumableRoom, shouldAdoptDetectedProblem } from '@/features/room/room-selection';
import { ChatService } from '@/features/chat/chat.service';
import {
  NETWORK_HANDOFF_ACK_KEY,
  NETWORK_HANDOFF_REQUEST_KEY,
} from '@/core/runtime/network-handoff';

console.log('[Synqto] Background offscreen runner initialized');

let isSidepanelOpen = false;
/**
 * Mirrors room.service.ts's synqto_cofocus_active storage flag. RoomService is a singleton
 * per execution context (see its setCoFocusActiveFlag comment) — this offscreen page has its
 * own instance, entirely blind to a CoFocus room the side panel joined. The storage flag is
 * the only channel that crosses that boundary.
 */
let cofocusActiveElsewhere = false;
let backgroundResumeTimer: ReturnType<typeof setTimeout> | null = null;
let resumeGeneration = 0;
const network = NetworkService.getInstance();
const identityService = IdentityService.getInstance();
const roomService = RoomService.getInstance();
const chatService = ChatService.getInstance();

// Identity storage is shared across extension contexts. If another surface regenerates the
// peer ID, this offscreen realm must rebuild its active network session too; otherwise it
// keeps signaling under the old ID while storage and the side panel have already converged.
identityService.onChange((identity) => network.updateIdentity(identity));

// Listen to sidepanel open/closed state in chrome.storage.local
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local.get(
    [
      'synqto_sidepanel_open',
      'nerd_buddy_sidepanel_open',
      'synqto_active_problem',
      'nerd_buddy_active_problem',
      SELECTED_ROOM_STORAGE_KEY,
      'synqto_cofocus_active',
      NETWORK_HANDOFF_REQUEST_KEY,
    ],
    (res) => {
      isSidepanelOpen = Boolean(
        res[NETWORK_HANDOFF_REQUEST_KEY] ||
          (res.synqto_sidepanel_open ?? res.nerd_buddy_sidepanel_open)
      );
      cofocusActiveElsewhere = Boolean(res.synqto_cofocus_active);
      const selectedRoom = res[SELECTED_ROOM_STORAGE_KEY];
      const activeProb = chooseResumableRoom(
        selectedRoom,
        res.synqto_active_problem || res.nerd_buddy_active_problem
      );
      if (isSidepanelOpen) {
        suspendBackgroundMesh();
        acknowledgePanelHandoff(res[NETWORK_HANDOFF_REQUEST_KEY]);
      } else if (activeProb) {
        scheduleBackgroundResume(activeProb);
      }
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if ('synqto_cofocus_active' in changes) {
        cofocusActiveElsewhere = Boolean(changes.synqto_cofocus_active.newValue);
        if (cofocusActiveElsewhere) cancelBackgroundResume();
      }

      const panelChange = changes.synqto_sidepanel_open || changes.nerd_buddy_sidepanel_open;
      if (panelChange) {
        isSidepanelOpen = Boolean(panelChange.newValue);
        if (isSidepanelOpen) {
          // Sidepanel opened -> yield WebRTC slots so UI owns the direct connection.
          //
          // Safe to call unconditionally even during a CoFocus session: this offscreen page's
          // own RoomService never joins a CoFocus room (resumeBackgroundMesh refuses to while
          // cofocusActiveElsewhere is set — see below), so there is nothing CoFocus-related
          // here to yield. The side panel reopening is what a CoFocus session is waiting for.
          suspendBackgroundMesh();
        } else {
          // Sidepanel closed -> resume background WebRTC mesh
          chrome.storage.local.get(
            [
              NETWORK_HANDOFF_REQUEST_KEY,
              SELECTED_ROOM_STORAGE_KEY,
              'synqto_active_problem',
              'nerd_buddy_active_problem',
            ],
            (res) => {
              // A claim token is authoritative. This guards an old panel realm publishing
              // its delayed close after a replacement panel has already claimed ownership.
              if (res[NETWORK_HANDOFF_REQUEST_KEY]) {
                isSidepanelOpen = true;
                suspendBackgroundMesh();
                acknowledgePanelHandoff(res[NETWORK_HANDOFF_REQUEST_KEY]);
                return;
              }
              const selectedRoom = res[SELECTED_ROOM_STORAGE_KEY];
              const prob = chooseResumableRoom(
                selectedRoom,
                res.synqto_active_problem || res.nerd_buddy_active_problem
              );
              if (prob) {
                scheduleBackgroundResume(prob);
              }
            }
          );
        }
      }

      const handoffRequest = changes[NETWORK_HANDOFF_REQUEST_KEY]?.newValue;
      if (handoffRequest) {
        // The request and panel-open flag are written atomically, but handle this key as the
        // authoritative ownership signal so listener ordering cannot start a second socket.
        isSidepanelOpen = true;
        suspendBackgroundMesh();
        acknowledgePanelHandoff(handoffRequest);
      }

      const problemChange = changes.synqto_active_problem || changes.nerd_buddy_active_problem;
      if (
        problemChange &&
        !isSidepanelOpen &&
        shouldAdoptDetectedProblem(roomService.getCurrentRoom()) &&
        problemChange.newValue
      ) {
        scheduleBackgroundResume(problemChange.newValue);
      }
    }
  });
}

// Listen for in-page chat messages forwarded from floating widget when sidepanel is closed
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === 'SEND_PAGE_CHAT_MESSAGE' && msg.text && !isSidepanelOpen) {
      const identity = await identityService.getOrCreateIdentity();
      chatService.sendMessage(
        msg.text,
        identity,
        msg.replyTo ? { id: msg.replyTo, preview: msg.replyPreview } : undefined,
        msg.messageId
      );
    }
  });
}

async function resumeBackgroundMesh(problem: any) {
  if (!problem || isSidepanelOpen) return;

  const generation = ++resumeGeneration;

  // Never let stale problem-page detection evict an active CoFocus session.
  //
  // App.tsx's own copy of this same "resume from stored active problem" listener carries this
  // exact guard (see its comment: closing a session's room by surprise "camera and partner
  // gone, no prompt, no explanation" was a real, observed bug). This offscreen listener exists
  // to do the identical job — rejoin whatever room the last detected page implies — for the
  // case where the side panel is closed, which is precisely when a CoFocus Watcher session is
  // running: Watcher takes over the whole side panel surface, so a user checking another tab
  // mid-session closes the panel routinely. That is exactly the moment this function used to
  // fire unconditionally, tearing the CoFocus room down via joinProblemRoom()'s leaveCurrentRoom()
  // and replacing it with an unrelated, non-DIRECT_ONLY_POLICY room — breaking the "CoFocus is
  // always exactly two peers, always direct P2P" invariant with no user action and no signal to
  // the partner beyond whatever the room-reconciliation watcher manages to salvage after the fact.
  //
  // Checked against cofocusActiveElsewhere (the cross-context storage flag), NOT
  // roomService.getCurrentRoom() — this offscreen page's own RoomService never joins a CoFocus
  // room itself, so its local state can never reflect a session the side panel is running. See
  // room.service.ts's setCoFocusActiveFlag for the write side.
  if (cofocusActiveElsewhere) return;

  const room = problem.roomId
    ? await roomService.resumeRoom(problem)
    : await roomService.joinProblemRoom(
        problem.platform,
        problem.slug,
        problem.title,
        problem.canonicalUrl
      );

  // The identity lookup in joinProblemRoom is asynchronous. A panel claim or a newer tab
  // transition may have won while it was pending; never initialize chat for that stale room.
  if (
    generation !== resumeGeneration ||
    isSidepanelOpen ||
    cofocusActiveElsewhere ||
    roomService.getCurrentRoom()?.roomId !== room.roomId
  ) {
    return;
  }

  const identity = await identityService.getOrCreateIdentity();
  if (generation !== resumeGeneration || isSidepanelOpen || cofocusActiveElsewhere) return;
  chatService.init(room.roomId, identity.peerId);
}

function cancelBackgroundResume() {
  resumeGeneration++;
  if (backgroundResumeTimer) {
    clearTimeout(backgroundResumeTimer);
    backgroundResumeTimer = null;
  }
}

function suspendBackgroundMesh() {
  cancelBackgroundResume();
  roomService.suspendCurrentRoom();
}

function scheduleBackgroundResume(problem: any) {
  cancelBackgroundResume();
  if (!problem || isSidepanelOpen || cofocusActiveElsewhere) return;

  // Allow the panel's close frame and room:leave to reach the server before registering the
  // same peer from this context. The debounce also collapses rapid tab/problem churn.
  backgroundResumeTimer = setTimeout(() => {
    backgroundResumeTimer = null;
    if (!isSidepanelOpen && !cofocusActiveElsewhere) void resumeBackgroundMesh(problem);
  }, 350);
}

function acknowledgePanelHandoff(requestToken: unknown) {
  if (!requestToken || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  chrome.storage.local.set({ [NETWORK_HANDOFF_ACK_KEY]: requestToken });
}

// Listen for background desktop notifications
network.on<{ text: string }>('chat:message', (payload, packet) => {
  if (isSidepanelOpen) return;

  if (typeof chrome !== 'undefined' && chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `${packet.from.nickname} (${packet.from.avatar})`,
      message: payload.text || 'Sent a message in Synqto',
      priority: 1,
    });
  }
});

network.on<{ text: string }>('community:wave', (payload, packet) => {
  if (isSidepanelOpen) return;

  if (typeof chrome !== 'undefined' && chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '👋 Synqto Wave',
      message: `${packet.from.nickname} waved at you!`,
      priority: 1,
    });
  }
});
