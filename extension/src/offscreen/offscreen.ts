// ─── Background Offscreen WebRTC Runner & Notifications ───

import { NetworkService } from '@/core/network/network.service';
import { IdentityService } from '@/features/identity/identity.service';
import { RoomService } from '@/features/room/room.service';
import { ChatService } from '@/features/chat/chat.service';

console.log('[Nerd Buddy] Background offscreen runner initialized');

let isSidepanelOpen = false;
const network = NetworkService.getInstance();
const identityService = IdentityService.getInstance();
const roomService = RoomService.getInstance();
const chatService = ChatService.getInstance();

// Listen to sidepanel open/closed state in chrome.storage.local
if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  chrome.storage.local.get(['nerd_buddy_sidepanel_open', 'nerd_buddy_active_problem'], (res) => {
    isSidepanelOpen = Boolean(res.nerd_buddy_sidepanel_open);
    if (!isSidepanelOpen && res.nerd_buddy_active_problem) {
      resumeBackgroundMesh(res.nerd_buddy_active_problem);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.nerd_buddy_sidepanel_open) {
        isSidepanelOpen = Boolean(changes.nerd_buddy_sidepanel_open.newValue);
        if (isSidepanelOpen) {
          // Sidepanel opened -> yield WebRTC slots so UI owns the direct connection
          roomService.leaveCurrentRoom();
        } else {
          // Sidepanel closed -> resume background WebRTC mesh
          chrome.storage.local.get(['nerd_buddy_active_problem'], (res) => {
            if (res.nerd_buddy_active_problem) {
              resumeBackgroundMesh(res.nerd_buddy_active_problem);
            }
          });
        }
      }

      if (changes.nerd_buddy_active_problem && !isSidepanelOpen) {
        resumeBackgroundMesh(changes.nerd_buddy_active_problem.newValue);
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
      message: payload.text || 'Sent a message in Nerd Buddy',
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
      title: '👋 Nerd Buddy Wave',
      message: `${packet.from.nickname} waved at you!`,
      priority: 1,
    });
  }
});
