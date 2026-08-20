// ─── Background Offscreen WebRTC Runner & Notifications ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService } from '@/features/room/room.service';
import { ChatService } from '@/features/chat/chat.service';

console.log('[Synqto] Background offscreen runner initialized');

let isSidepanelOpen = false;
/**
 * Mirrors room.service.ts's synqto_cofocus_active storage flag. RoomService is a singleton
 * per execution context (see its setCoFocusActiveFlag comment) — this offscreen page has its
 * own instance, entirely blind to a CoFocus room the side panel joined. The storage flag is
 * the only channel that crosses that boundary.
 */
let cofocusActiveElsewhere = false;
const network = NetworkService.getInstance();
const identityService = IdentityService.getInstance();
const roomService = RoomService.getInstance();
const chatService = ChatService.getInstance();

// Listen to sidepanel open/closed state in chrome.storage.local
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local.get(
    [
      'synqto_sidepanel_open',
      'nerd_buddy_sidepanel_open',
      'synqto_active_problem',
      'nerd_buddy_active_problem',
      'synqto_cofocus_active',
    ],
    (res) => {
      isSidepanelOpen = Boolean(res.synqto_sidepanel_open ?? res.nerd_buddy_sidepanel_open);
      cofocusActiveElsewhere = Boolean(res.synqto_cofocus_active);
      const activeProb = res.synqto_active_problem || res.nerd_buddy_active_problem;
      if (!isSidepanelOpen && activeProb) {
        resumeBackgroundMesh(activeProb);
      }
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if ('synqto_cofocus_active' in changes) {
        cofocusActiveElsewhere = Boolean(changes.synqto_cofocus_active.newValue);
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
          roomService.leaveCurrentRoom();
        } else {
          // Sidepanel closed -> resume background WebRTC mesh
          chrome.storage.local.get(['synqto_active_problem', 'nerd_buddy_active_problem'], (res) => {
            const prob = res.synqto_active_problem || res.nerd_buddy_active_problem;
            if (prob) {
              resumeBackgroundMesh(prob);
            }
          });
        }
      }

      const problemChange = changes.synqto_active_problem || changes.nerd_buddy_active_problem;
      if (problemChange && !isSidepanelOpen && problemChange.newValue) {
        resumeBackgroundMesh(problemChange.newValue);
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

  const room = await roomService.joinProblemRoom(
    problem.platform,
    problem.slug,
    problem.title,
    problem.canonicalUrl
  );

  const identity = await identityService.getOrCreateIdentity();
  chatService.init(room.roomId, identity.peerId);
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
