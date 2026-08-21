# Synqto comprehensive repair status — 2026-08-20

This document separates verified local evidence from deployed or physical-device evidence.
Passing source assertions is not treated as proof of a deployed end-to-end connection.

## Current version boundary

| Component | Version | Protocol | Evidence |
|---|---:|---:|---|
| Extension worktree | 0.14.0 | 2 | version check and production build |
| Server worktree | 0.6.3 | 2 | `main.go`, `go test ./...`, `go vet ./...`, `go build ./...` |
| Production Render server | 0.6.0 | 1 | `GET https://synqto-server.onrender.com/health` on 2026-08-21 |

The production server must be upgraded before authoritative live-stream admission can pass.
The protocol-2 client deliberately rejects Go Live when connected to a protocol-1 server rather
than silently falling back to client-only admission.

## Acceptance evidence

| Requirement | Current result | Evidence / remaining proof |
|---|---|---|
| Deterministic signaling ownership | Locally verified | ownership handoff and signaling lifecycle regressions |
| Stale unregister cannot remove a replacement | Locally verified | connection-specific server ownership tests |
| Duplicate connects and reconnect storms are bounded | Locally verified | signaling lifecycle regressions |
| Room/tab/problem are separate by default | Locally verified | room-selection and tab-churn regressions |
| Stale cross-room events are fenced | Locally verified | room-scoped runtime and service-worker regressions |
| Shared transport handoff is exact-room | Locally verified | `PacketPipeline` rejects wrong-room and post-leave ingress before ACK/reassembly/ordering; `TransportRouter` cancels timer ID `0` and drops deferred old-room packets on leave or direct re-init |
| Signaling reconnect ownership is exact-room/exact-peer | Locally verified | inbound envelopes require the active room and target; a different-room/peer reconnect drops the old signaling queue; explicit disconnect generation-invalidates already-queued socket callbacks |
| Core networking timers have complete teardown | Locally verified | signaling heartbeat/reconnect, topology reconciliation/snapshot/router/grace timers, link monitoring, leader health, tier transitions, ordering gaps, reliable retries, and panel handoff all release timer ID `0` |
| Topology and WebRTC bootstrap/teardown are generation-safe | Locally verified | leave blanks topology identity/room, fences A→B→A snapshot hydration and per-peer relay-hint awaits, clears pre-offer ICE and per-room WebRTC diagnostics, and direct network re-init first retires the previous owner |
| Presence roster is room-scoped immediately | Locally verified | room transitions synchronously clear the prior roster and re-announce only in the new room; same-room notifications are idempotent |
| Voice and live participation are explicit | Locally verified | media state-machine regressions; Voice is bound on every room transition and teardown releases two network handlers, two WebRTC handlers, the media owner, analyser ID `0`, AudioContext, local/remote audio, and gesture retries |
| Blocked remote-audio autoplay listeners are bounded | Locally verified | one owned gesture-listener group per peer; peer removal, room teardown, replacement, and late promise rejection all release or suppress retries |
| SPA page observer releases owned resources | Locally verified | teardown cancels pending debounce/polling, disconnects the mutation observer, removes navigation listeners, and restores only History methods it still owns |
| Invalidated content scripts release all long-lived owners | Locally verified | the observer liveness sentinel coordinates cursor, editor-sync, and widget teardown; recurring timers, Chrome/window listeners, drag handlers, observers, animation frames, and canvas caches are released while an inert reload notice remains |
| Remote cursor churn is bounded | Locally verified | inactive cursor DOM, timeout ownership, and peer map entries are removed after the fade window; click-ripple timers are released on teardown |
| CoFocus cancellation and replacement are ownership-safe | Locally verified | identity loads, room joins, partner-arrival timers, countdowns, topology callbacks, and lobby socket events are generation/room fenced; explicit partner exit leaves only the captured room |
| CoFocus teardown releases owned resources | Locally verified | lobby/room/network/topology subscriptions, timer ID `0`, queue connection, and completion-audio contexts are released idempotently |
| CoFocus lobby input fails closed | Locally verified | only server envelopes for the lobby are accepted; match room, partner, mode, duration, waiting metadata, and error payloads are bounded and validated before a match transition |
| Chat history never hydrates or retries across rooms | Locally verified | cache reads, history retries, delivery retries, and debounced persistence handoff are bound to the exact room generation; teardown releases all 11 room handlers and every owned timer |
| Whiteboard hydration and local IPC are room/private scoped | Locally verified | concurrent room loads cannot overwrite the current board or persist an unhydrated placeholder; cross-window messages require explicit personal/collaborative scope and exact room for collaborative data; teardown releases the BroadcastChannel, runtime/storage listeners, and all 11 network handlers |
| Personal whiteboard hydration preserves early work | Locally verified | drawings and privacy changes made while storage loads replay onto the stored personal notebook without an intermediate blank write |
| Tutor/live lifecycle releases every owner | Locally verified | eight exact-room network handlers, two WebRTC handlers, two signaling handlers, the media coordinator, admission listeners/timeouts including ID `0`, mixed media, and UI subscribers are released idempotently |
| Identity hydration and replacement are generation-safe | Locally verified | a newer valid cross-realm storage write cannot be overwritten by an older pending read; the stable storage listener is removed and retired callbacks are inert |
| Gamification begins from truthful hydrated state | Locally verified | empty state has no fabricated active date or counters; first activity creates day one and updates the longest streak; actions arriving during storage hydration replay onto loaded totals; teardown releases heartbeat ID `0` and queued work |
| Group hydration preserves early mutations | Locally verified | initialization is a real shared promise and early problem-group registration replays onto stored squads instead of being overwritten by the late storage callback |
| Timer, theme, and diary hydration preserve early actions | Locally verified | timer/config actions replay onto loaded state; early theme patches merge with saved customization; diary edits/deletes replay without erasing untouched stored entries; timer teardown releases storage, interval ID `0`, and completion-audio contexts |
| React UI delayed work has explicit lifetime ownership | Locally verified | one timeout owner handles ID `0`, replacement, unmount cancellation, and already-queued stale callbacks; diary drafts flush on teardown; chat file readers abort; clipboard, whiteboard, settings, modal, code, microphone, and delete-confirm callbacks are fenced after unmount or close; settings retries own one generation-correlated subscription and deadline |
| Notification timers and dedupe history are bounded | Locally verified | timer ID `0` is released, eviction immediately clears the evicted timer, and dedupe history is time-pruned and capped at 100 keys |
| Code execution is room- and run-correlated | Locally verified | room switches fence late execution completions, newer local runs supersede slower predecessors, and remote results must match the latest run ID from that peer; teardown releases six network handlers, the runtime relay, and cursor timer ID `0` |
| Live admission is authoritative | Implemented locally; not deployed | protocol-2 server tests pass; production still protocol 1 |
| Timer values are editable and timestamp-derived | Locally verified | logic regressions plus live UI invalid/valid/running edit smoke test |
| Whiteboard surfaces use canonical notebooks | Locally verified | storage-key/document tests and live side-panel board smoke test |
| Whiteboard popup has one restart-safe lifecycle owner | Locally verified | both surfaces delegate to the service worker; simultaneous requests serialize, the canonical window is reused/focused, stale IDs recover, restored popups are rediscovered, and all presets clamp to the source monitor's actual work area |
| System objects label immediately and support Skip | Locally verified | regression tests plus live placement → Skip flow |
| Skipped objects remain editable later | Locally verified | rendered-bounds regression plus live select → Label flow |
| Settings affect behavior and persist | Locally verified | source/runtime regressions plus toggle → reload → restore smoke test |
| Accessible icon controls and settings disclosures | Locally verified | 42 icon/accessibility regressions and live accessible-tree audit |
| Narrow side-panel layout | Locally verified | 350 px runtime check: no horizontal overflow; labels collapse while tab names remain |
| Malformed/hostile input is rejected | Locally verified | security, transport, routing, and server protocol tests |
| Full post-registration connection trace | Locally verified | one correlated WebSocket attempt plus per-peer PC generation now records offer/answer creation and application, candidate gather/send/receive/apply, ICE, DTLS, SCTP, DataChannel creation/open, application hello/ready, and first application delivery |
| Diagnostic trace is bounded and privacy-safe | Locally verified | candidate-heavy milestones deduplicate by generation/category; server accepts only allowlisted kinds/states/reasons/transports/categories and never receives SDP, candidate addresses, ports, or content in trace payloads |
| Two independently identified browser clients connect bidirectionally | Locally verified | separate `127.0.0.1` and `localhost` origins joined one local protocol-2 Go server room; both control/bulk DataChannels opened and each client received the other's chat message |
| Production extension build | Verified | Vite production build passes |
| Extension release packaging | Verified in isolation | 0.14.0 ZIP created, expanded, and checked for root manifest and required entry points |
| Server build/test/vet | Verified | all three commands pass |
| Two physical devices connect bidirectionally | **Not verified** | requires deployed protocol-2 server and two separate devices/networks |
| Physical disconnect/reconnect and server restart recovery | **Not verified** | run after deployment with correlated attempt traces |
| Clean-checkout build | **Not verified** | current nested repositories contain pre-existing user changes and were preserved |
| Cross-browser/device matrix | **Not verified** | requires supported browser/device environments |

## Local UI smoke matrix

| Surface / flow | Result |
|---|---|
| Side panel loads without console warnings/errors | Pass |
| Room and chat visible controls have accessible names | Pass |
| All expanded Settings controls have accessible names | Pass |
| Settings disclosures toggle from Enter | Pass |
| Main FAB setting persists across reload | Pass |
| Timer rejects `0:99` with an inline alert | Pass |
| Timer accepts `00:05`, starts, completes, and returns to the next configured phase | Pass |
| Architecture object placement opens inline label editor | Pass |
| Skip closes the editor without removing the object | Pass |
| Click-placed object is selectable over its rendered footprint | Pass |
| Selected unlabeled object reopens label editing | Pass |
| 350 px layout has no document-level horizontal overflow | Pass |
| Two isolated local browser identities discover each other and reach `2 Studying` | Pass |
| Local protocol-2 chat delivers A → B and B → A over the peer mesh | Pass |
| Clean two-peer trace reaches ICE connected → DTLS connected → SCTP connected → both DataChannels open | Pass |
| Both peers send/receive the explicit application hello and report application `ready` | Pass |
| Trickle ICE emits one diagnostic milestone per candidate category and PC generation | Pass |
| Connected-server status reports the configured localhost endpoint, not a hard-coded production URL | Pass |

## Automated verification

The current extension suite has 391 passing scenarios:

- topology and resilience: 78
- signaling lifecycle: 51
- security: 16
- application logic: 45
- icon/accessibility/version/package invariants: 42
- content, presence, media, session, hydration, room, and UI callback ownership lifecycle: 53
- transport: 14
- mesh stress: 30
- routing stress: 62

The server worktree passes `go test ./...`, `go vet ./...`, and `go build ./...`.

## Deployment and two-device gate

After explicit deployment authorization:

1. Deploy the server worktree and verify `/health` reports server `0.6.3` and protocol `2`.
2. Package/load extension `0.14.0` on two physical systems with distinct device identities.
3. Join the exact same explicit room without tab-follow enabled.
4. Capture one correlated connection attempt on both clients and the server.
5. Verify discovery, registration, offer, answer, ICE exchange, ICE connected, DTLS,
   DataChannel open, application handshake, and bidirectional application messages.
6. Verify chat, collaborative whiteboard, voice, live admission, camera/screen controls, and
   popup/Picture-in-Picture behavior.
7. Drop and restore the network, then restart the server; verify serialized reconnect and
   state resynchronization without duplicate peer ownership.
8. Repeat on different networks. Record the first failed stage rather than classifying every
   failure as WebRTC.
