import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storageState = new Map();
const storageListeners = new Set();

function emitStorageChanges(values) {
  const changes = {};
  for (const [key, newValue] of Object.entries(values)) {
    const oldValue = storageState.get(key);
    storageState.set(key, newValue);
    changes[key] = { oldValue, newValue };
  }
  for (const listener of storageListeners) listener(changes, 'local');
}

globalThis.chrome = {
  runtime: { lastError: undefined },
  storage: {
    local: {
      get(keys, callback) {
        const result = {};
        for (const key of keys) result[key] = storageState.get(key);
        callback(result);
      },
      set(values, callback) {
        emitStorageChanges(values);
        callback?.();
      },
      remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) storageState.delete(key);
      },
    },
    onChanged: {
      addListener(listener) {
        storageListeners.add(listener);
      },
      removeListener(listener) {
        storageListeners.delete(listener);
      },
    },
  },
};

globalThis.fetch = async () => ({ ok: true });

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  send(raw) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

globalThis.WebSocket = MockWebSocket;

const {
  NETWORK_HANDOFF_ACK_KEY,
  NETWORK_HANDOFF_REQUEST_KEY,
  claimSidePanelNetworkOwnership,
  releaseSidePanelNetworkOwnership,
} = await import('../src/core/runtime/network-handoff.ts');

const { SignalingService } = await import('../src/core/network/signaling.service.ts');
const { RoomService, SELECTED_ROOM_STORAGE_KEY } = await import(
  '../src/features/room/room.service.ts'
);
const { chooseResumableRoom, shouldAdoptDetectedProblem } = await import(
  '../src/features/room/room-selection.ts'
);
const { NetworkService } = await import('../src/core/network/network.service.ts');
const { TopologyService } = await import('../src/core/network/topology.service.ts');
const { WebRTCService } = await import('../src/core/network/webrtc.service.ts');
const { ContextRegistry } = await import('../src/core/runtime/context-registry.ts');
const { CodeService } = await import('../src/features/code/code.service.ts');
const { VoiceService } = await import('../src/features/voice/voice.service.ts');
const { TutorService } = await import('../src/features/tutor/tutor.service.ts');
const { NotificationService } = await import('../src/core/notify/notification.service.ts');
const { MediaSessionCoordinator } = await import(
  '../src/core/media/media-session-coordinator.ts'
);
const { detectRoutedResource, messageBelongsToRoom } = await import(
  '../src/core/runtime/tab-room-context.ts'
);
const {
  IdentityService,
  isValidStoredIdentity,
} = await import('../src/features/identity/identity.service.ts');

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

console.log('\n🧪 Running signaling lifecycle regression tests...\n');

await test('side-panel claim waits for the matching offscreen acknowledgement', async () => {
  let requestToken;
  const offscreenListener = (changes) => {
    const token = changes[NETWORK_HANDOFF_REQUEST_KEY]?.newValue;
    if (token) {
      requestToken = token;
      // Real extension contexts observe storage changes asynchronously. Mirror that boundary
      // rather than recursively emitting the acknowledgement inside the request callback.
      queueMicrotask(() => {
        chrome.storage.local.set({ [NETWORK_HANDOFF_ACK_KEY]: token });
      });
    }
  };

  chrome.storage.onChanged.addListener(offscreenListener);
  const claim = claimSidePanelNetworkOwnership(100);
  await claim.ready;
  chrome.storage.onChanged.removeListener(offscreenListener);

  assert.ok(requestToken, 'the panel did not publish a handoff token');
  assert.equal(storageState.get('synqto_sidepanel_open'), true);
  assert.equal(storageListeners.size, 0, 'claim leaked a storage listener');
});

await test('side-panel claim remains bounded when no offscreen document exists', async () => {
  const started = Date.now();
  const claim = claimSidePanelNetworkOwnership(10);
  await claim.ready;
  assert.ok(Date.now() - started < 250, 'missing acknowledgement blocked panel startup');
});

await test('acknowledged side-panel handoff releases timeout id zero', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const cleared = [];
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = (id) => cleared.push(id);

  const offscreenListener = (changes) => {
    const token = changes[NETWORK_HANDOFF_REQUEST_KEY]?.newValue;
    if (token) queueMicrotask(() => chrome.storage.local.set({ [NETWORK_HANDOFF_ACK_KEY]: token }));
  };
  chrome.storage.onChanged.addListener(offscreenListener);

  try {
    const claim = claimSidePanelNetworkOwnership(100);
    await claim.ready;
    assert.deepEqual(cleared, [0]);
    releaseSidePanelNetworkOwnership(claim.token);
  } finally {
    chrome.storage.onChanged.removeListener(offscreenListener);
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

await test('an older handoff completion cannot erase a newer ownership request', async () => {
  const observedTokens = [];
  const offscreenListener = (changes) => {
    const token = changes[NETWORK_HANDOFF_REQUEST_KEY]?.newValue;
    if (!token) return;
    observedTokens.push(token);
    queueMicrotask(() => chrome.storage.local.set({ [NETWORK_HANDOFF_ACK_KEY]: token }));
  };
  chrome.storage.onChanged.addListener(offscreenListener);

  const claims = [claimSidePanelNetworkOwnership(100), claimSidePanelNetworkOwnership(100)];
  await Promise.all(claims.map((claim) => claim.ready));
  chrome.storage.onChanged.removeListener(offscreenListener);

  assert.equal(observedTokens.length, 2);
  assert.equal(storageState.get(NETWORK_HANDOFF_REQUEST_KEY), observedTokens.at(-1));
});

await test('release publishes panel closure only after the caller has stopped networking', async () => {
  const claim = claimSidePanelNetworkOwnership(0);
  await claim.ready;
  releaseSidePanelNetworkOwnership(claim.token);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(storageState.get('synqto_sidepanel_open'), false);
  assert.equal(storageState.get('nerd_buddy_sidepanel_open'), false);
});

await test('a stale release cannot close a newer panel ownership claim', async () => {
  const oldClaim = claimSidePanelNetworkOwnership(0);
  await oldClaim.ready;
  const newClaim = claimSidePanelNetworkOwnership(0);
  releaseSidePanelNetworkOwnership(oldClaim.token);
  await newClaim.ready;

  assert.equal(storageState.get('synqto_sidepanel_open'), true);
  assert.equal(storageState.get(NETWORK_HANDOFF_REQUEST_KEY), newClaim.token);
});

await test('panel startup waits until the offscreen network owner has yielded', async () => {
  let offscreenSockets = 1;
  let panelSockets = 0;
  let maximumConcurrentSockets = 1;
  const observe = () => {
    maximumConcurrentSockets = Math.max(
      maximumConcurrentSockets,
      offscreenSockets + panelSockets
    );
  };
  const offscreenListener = (changes) => {
    const token = changes[NETWORK_HANDOFF_REQUEST_KEY]?.newValue;
    if (!token) return;
    offscreenSockets = 0;
    observe();
    queueMicrotask(() => chrome.storage.local.set({ [NETWORK_HANDOFF_ACK_KEY]: token }));
  };
  chrome.storage.onChanged.addListener(offscreenListener);

  const claim = claimSidePanelNetworkOwnership(100);
  await claim.ready;
  panelSockets = 1;
  observe();
  chrome.storage.onChanged.removeListener(offscreenListener);

  assert.equal(maximumConcurrentSockets, 1);
  panelSockets = 0;
  releaseSidePanelNetworkOwnership(claim.token);
});

await test('duplicate connect calls create one socket', () => {
  const signaling = SignalingService.getInstance();
  const before = MockWebSocket.instances.length;

  signaling.connect('room:test', 'peer:test', 'Tester');
  signaling.connect('room:test', 'peer:test', 'Tester');

  assert.equal(MockWebSocket.instances.length - before, 1);
  signaling.disconnect();
});

await test('SignalingService teardown releases timer and interval id zero', () => {
  const realClearTimeout = globalThis.clearTimeout;
  const realClearInterval = globalThis.clearInterval;
  const clearedTimeouts = [];
  const clearedIntervals = [];
  globalThis.clearTimeout = (id) => clearedTimeouts.push(id);
  globalThis.clearInterval = (id) => clearedIntervals.push(id);

  const signaling = SignalingService.getInstance();
  try {
    signaling.reconnectTimer = 0;
    signaling.pongTimeoutTimer = 0;
    signaling.pingInterval = 0;
    signaling.disconnect();
    assert.deepEqual(clearedTimeouts, [0, 0]);
    assert.deepEqual(clearedIntervals, [0]);
  } finally {
    signaling.reconnectTimer = null;
    signaling.pongTimeoutTimer = null;
    signaling.pingInterval = null;
    globalThis.clearTimeout = realClearTimeout;
    globalThis.clearInterval = realClearInterval;
  }
});

await test('an already-queued socket open cannot resurrect an explicit disconnect', () => {
  const realSetInterval = globalThis.setInterval;
  let intervalsStarted = 0;
  globalThis.setInterval = (...args) => {
    intervalsStarted++;
    return realSetInterval(...args);
  };

  const signaling = SignalingService.getInstance();
  try {
    signaling.connect('room:retired-open', 'peer:local', 'Local');
    const socket = MockWebSocket.instances.at(-1);
    const staleOpen = socket.onopen;
    signaling.disconnect();

    socket.readyState = MockWebSocket.OPEN;
    staleOpen();
    assert.equal(signaling.getIsConnected(), false);
    assert.equal(signaling.currentRoomId, '');
    assert.equal(socket.sent.length, 0, 'retired socket emitted a room join after disconnect');
    assert.equal(intervalsStarted, 0, 'retired socket restarted the heartbeat');
  } finally {
    signaling.disconnect();
    globalThis.setInterval = realSetInterval;
  }
});

await test('concurrent reconnect requests retain the first replacement attempt', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:retry', 'peer:test', 'Tester');
  MockWebSocket.instances.at(-1).readyState = MockWebSocket.OPEN;
  const before = MockWebSocket.instances.length;

  signaling.reconnect();
  const replacement = MockWebSocket.instances.at(-1);
  signaling.reconnect();

  assert.equal(MockWebSocket.instances.length - before, 1);
  assert.equal(replacement.readyState, MockWebSocket.CONNECTING);
  signaling.disconnect();
});

await test('a reconnect storm keeps one socket and one pending retry at a time', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 1;
  const timers = new Map();
  let maximumPendingTimers = 0;
  const observedDelays = [];

  globalThis.setTimeout = (fn, delay = 0) => {
    const id = nextTimerId++;
    timers.set(id, fn);
    observedDelays.push(Number(delay));
    maximumPendingTimers = Math.max(maximumPendingTimers, timers.size);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);

  const signaling = SignalingService.getInstance();
  const before = MockWebSocket.instances.length;
  try {
    signaling.connect('room:storm', 'peer:storm', 'Storm');

    for (let attempt = 0; attempt < 20; attempt++) {
      const socket = MockWebSocket.instances.at(-1);
      socket.readyState = MockWebSocket.CLOSED;
      const closeCurrentAttempt = socket.onclose;
      closeCurrentAttempt();

      assert.equal(timers.size, 1, `attempt ${attempt} scheduled concurrent retries`);
      const [timerId, retry] = timers.entries().next().value;
      timers.delete(timerId);
      retry();
      assert.equal(
        MockWebSocket.instances.length - before,
        attempt + 2,
        `attempt ${attempt} created more than one replacement socket`
      );
    }

    assert.equal(maximumPendingTimers, 1);
    assert.ok(observedDelays.every((delay) => delay >= 250 && delay <= 10_000));
  } finally {
    signaling.disconnect();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

await test('A to B to A ignores the first A socket cleanup after returning', () => {
  const signaling = SignalingService.getInstance();
  const before = MockWebSocket.instances.length;

  signaling.connect('room:A', 'peer:switch', 'Switcher');
  const firstA = MockWebSocket.instances.at(-1);
  const staleFirstAClose = firstA.onclose;
  signaling.connect('room:B', 'peer:switch', 'Switcher');
  signaling.connect('room:A', 'peer:switch', 'Switcher');
  const currentA = MockWebSocket.instances.at(-1);

  staleFirstAClose();

  assert.equal(MockWebSocket.instances.length - before, 3);
  assert.equal(signaling.ws, currentA);
  assert.equal(currentA.readyState, MockWebSocket.CONNECTING);
  assert.equal(signaling.currentRoomId, 'room:A');
  signaling.disconnect();
});

await test('reconnect to a different owner cannot flush queued frames from the old room', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:old-queue', 'peer:old', 'Old');
  signaling.sendOffer('peer:remote', { type: 'offer', sdp: 'old-room-offer' });

  signaling.reconnect('room:new-queue', 'peer:new', 'New');
  const replacement = MockWebSocket.instances.at(-1);
  replacement.readyState = MockWebSocket.OPEN;
  replacement.onopen();

  const frames = replacement.sent.map((raw) => JSON.parse(raw));
  assert.deepEqual(frames.map((frame) => frame.type), ['room:join']);
  assert.equal(frames[0].roomId, 'room:new-queue');
  assert.equal(frames[0].from, 'peer:new');
  signaling.disconnect();
});

await test('signaling rejects wrong-room and misdirected inbound frames', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:inbound-fence', 'peer:local', 'Local');
  let rosters = 0;
  let offers = 0;
  const offRoster = signaling.on('roster', () => { rosters++; });
  const offOffer = signaling.on('signal:offer', () => { offers++; });

  try {
    signaling.handleIncomingMessage({
      type: 'room:roster',
      from: 'server',
      roomId: 'room:wrong',
      payload: { peers: [], leaders: [] },
    });
    signaling.handleIncomingMessage({
      type: 'signal:offer',
      from: 'peer:remote',
      to: 'peer:someone-else',
      roomId: 'room:inbound-fence',
      payload: { sdp: { type: 'offer', sdp: 'misdirected' } },
    });
    assert.equal(rosters, 0);
    assert.equal(offers, 0);
    assert.equal(signaling.getIsRoomRegistered(), false);

    signaling.handleIncomingMessage({
      type: 'signal:offer',
      from: 'peer:remote',
      to: 'peer:local',
      roomId: 'room:inbound-fence',
      payload: { sdp: { type: 'offer', sdp: 'current' } },
    });
    assert.equal(offers, 1);
  } finally {
    offRoster();
    offOffer();
    signaling.disconnect();
  }
});

await test('join and queued signals share the active connection attempt ID', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:trace', 'peer:test', 'Tester');
  const socket = MockWebSocket.instances.at(-1);

  signaling.sendOffer('peer:remote', { type: 'offer', sdp: 'queued-before-open' });
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();

  const frames = socket.sent.map((raw) => JSON.parse(raw));
  const join = frames.find((frame) => frame.type === 'room:join');
  const offer = frames.find((frame) => frame.type === 'signal:offer');

  assert.ok(join?.connectionAttemptId, 'join frame has no correlation ID');
  assert.equal(offer?.connectionAttemptId, join.connectionAttemptId);
  signaling.disconnect();
});

await test('browser-only lifecycle traces carry the active connection attempt ID', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:diagnostics', 'peer:test', 'Tester');
  const socket = MockWebSocket.instances.at(-1);
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();

  assert.equal(
    signaling.sendConnectionTrace({
      kind: 'data-channel-state',
      remotePeerId: 'peer:remote',
      state: 'open',
      channel: 'control',
      generation: 4,
      reason: 'ICE_RESTART',
      transport: 'peer-relay',
      candidateType: 'relay',
    }),
    true
  );

  const frames = socket.sent.map((raw) => JSON.parse(raw));
  const join = frames.find((frame) => frame.type === 'room:join');
  const trace = frames.find((frame) => frame.type === 'connection:trace');
  assert.equal(trace.connectionAttemptId, join.connectionAttemptId);
  assert.equal(trace.payload.state, 'open');
  assert.equal(trace.payload.generation, 4);
  assert.equal(trace.payload.reason, 'ICE_RESTART');
  assert.equal(trace.payload.transport, 'peer-relay');
  assert.equal(trace.payload.candidateType, 'relay');
  signaling.disconnect();
});

await test('protocol-v2 room registration gates and correlates stream admission', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:admission', 'peer:test', 'Tester');
  const socket = MockWebSocket.instances.at(-1);
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'room:roster',
      from: 'server',
      roomId: 'room:admission',
      v: 2,
      payload: { peers: [], leaders: [], yourLeader: '' },
    }),
  });

  let response;
  const unsubscribe = signaling.on('stream:admission_response', (value) => {
    response = value;
  });
  assert.equal(signaling.supportsStreamAdmission(), true);
  assert.equal(signaling.requestStreamAdmission('admit-test-1'), true);
  const request = socket.sent.map((raw) => JSON.parse(raw)).at(-1);
  assert.equal(request.type, 'stream:admission_request');
  assert.equal(request.payload.requestId, 'admit-test-1');

  socket.onmessage({
    data: JSON.stringify({
      type: 'stream:admission_response',
      from: 'server',
      roomId: 'room:admission',
      payload: {
        requestId: 'admit-test-1',
        granted: true,
        activeBroadcasters: 1,
        maxBroadcasters: 2,
      },
    }),
  });
  assert.equal(response?.requestId, 'admit-test-1');
  assert.equal(response?.granted, true);
  unsubscribe();
  signaling.disconnect();
});

await test('a protocol-v1 server cannot receive unsupported stream admission frames', () => {
  const signaling = SignalingService.getInstance();
  signaling.connect('room:legacy', 'peer:test', 'Tester');
  const socket = MockWebSocket.instances.at(-1);
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();
  socket.onmessage({
    data: JSON.stringify({
      type: 'room:roster',
      from: 'server',
      roomId: 'room:legacy',
      v: 1,
      payload: { peers: [], leaders: [], yourLeader: '' },
    }),
  });
  const before = socket.sent.length;

  assert.equal(signaling.supportsStreamAdmission(), false);
  assert.equal(signaling.requestStreamAdmission('admit-legacy'), false);
  assert.equal(socket.sent.length, before);
  signaling.disconnect();
});

await test('application delivery proof ignores control traffic and emits once per peer', () => {
  const traces = [];
  const topology = Object.create(TopologyService.prototype);
  topology.currentRoomId = 'room:application-proof';
  topology.myIdentity = { peerId: 'peer:local' };
  topology.applicationTracePeers = new Set();
  topology.webrtc = {
    getConnectionGeneration() {
      return 5;
    },
  };
  topology.signaling = {
    sendConnectionTrace(trace) {
      traces.push(trace);
      return true;
    },
  };

  topology.traceApplicationDelivery('peer:remote', 'link:lsa');
  topology.traceApplicationDelivery('peer:remote', 'chat:message');
  topology.traceApplicationDelivery('peer:remote', 'whiteboard:stroke');

  assert.deepEqual(traces, [
    {
      kind: 'application-received',
      remotePeerId: 'peer:remote',
      generation: 5,
      packetType: 'chat:message',
    },
  ]);
});

await test('WebRTC milestones are generation-correlated and candidate-heavy stages are bounded', () => {
  const events = [];
  const webrtc = Object.create(WebRTCService.prototype);
  webrtc.connections = new Map([['peer:remote', { generation: 7 }]]);
  webrtc.generations = new Map([['peer:remote', 7]]);
  webrtc.diagnosticListeners = new Set([(event) => events.push(event)]);
  webrtc.emittedDiagnosticMilestones = new Set();

  const milestone = {
    kind: 'ice-candidate-stage',
    remotePeerId: 'peer:remote',
    state: 'gathered',
    candidateType: 'relay',
  };
  webrtc.emitMilestone(milestone);
  webrtc.emitMilestone(milestone);

  assert.deepEqual(events, [{ ...milestone, generation: 7 }]);
  assert.equal(
    webrtc.candidateType({ candidate: 'candidate:1 1 udp 1 203.0.113.5 3478 typ srflx' }),
    'srflx'
  );
  assert.equal(webrtc.candidateType({ candidate: 'secret malformed candidate' }), 'unknown');
});

await test('WebRTC room teardown clears pre-offer ICE and per-session diagnostics', () => {
  const webrtc = WebRTCService.getInstance();
  webrtc.closeAll();
  webrtc.pendingIceCandidates.set('peer:no-wrapper', [{ candidate: 'candidate:1' }]);
  webrtc.generations.set('peer:old', 7);
  webrtc.pcStats.set('peer:old#7', { peerId: 'peer:old', generation: 7 });
  webrtc.recentNegotiations.push({ peerId: 'peer:old', generation: 7, reason: 'INITIAL', at: 1 });
  webrtc.emittedDiagnosticMilestones.add('old-room-milestone');
  webrtc.iceDropped = 9;

  webrtc.closeAll();

  assert.equal(webrtc.pendingIceCandidates.size, 0);
  assert.equal(webrtc.generations.size, 0);
  assert.equal(webrtc.pcStats.size, 0);
  assert.equal(webrtc.recentNegotiations.length, 0);
  assert.equal(webrtc.emittedDiagnosticMilestones.size, 0);
  assert.equal(webrtc.iceDropped, 0);
});

await test('outbound trickle ICE traces one sent milestone per candidate category', () => {
  const traces = [];
  let onSignalNeeded;
  const topology = Object.create(TopologyService.prototype);
  topology.outboundSignalTraceMilestones = new Set();
  topology.webrtc = {
    onSignalNeeded(handler) {
      onSignalNeeded = handler;
    },
    onPacket() {},
    onConnectionState() {},
    getConnectionGeneration() {
      return 9;
    },
  };
  topology.peerSignaling = {
    route() {
      return { transport: 'server' };
    },
  };
  topology.signaling = {
    sendConnectionTrace(trace) {
      traces.push(trace);
      return true;
    },
  };
  topology.joinTracker = { advance() {} };
  topology.setupWebRTCListeners();

  const host = { candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host' };
  const relay = { candidate: 'candidate:2 1 udp 1 192.0.2.2 5001 typ relay' };
  onSignalNeeded('peer:remote', 'ice', host);
  onSignalNeeded('peer:remote', 'ice', host);
  onSignalNeeded('peer:remote', 'ice', relay);

  assert.deepEqual(
    traces.map((trace) => [trace.state, trace.candidateType, trace.generation]),
    [
      ['ice-sent', 'host', 9],
      ['ice-sent', 'relay', 9],
    ]
  );
});

await test('application hello proves both handshake receipt and readiness once per PC generation', () => {
  const packets = [];
  const traces = [];
  const topology = Object.create(TopologyService.prototype);
  topology.currentRoomId = 'room:application-handshake';
  topology.myIdentity = {
    peerId: 'peer:local',
    nickname: 'Local',
    avatar: '',
    color: '#000000',
  };
  topology.applicationHandshakeGenerations = new Map();
  topology.applicationReadyGenerations = new Set();
  topology.webrtc = {
    getConnectionGeneration() {
      return 3;
    },
    sendPacket(_peerId, packet) {
      packets.push(packet);
      return true;
    },
  };
  topology.signaling = {
    sendConnectionTrace(trace) {
      traces.push(trace);
      return true;
    },
  };

  topology.sendApplicationHandshake('peer:remote');
  topology.sendApplicationHandshake('peer:remote');
  topology.traceApplicationHandshake('peer:remote');
  topology.traceApplicationHandshake('peer:remote');

  assert.equal(packets.length, 1, 'duplicate channel-open events sent duplicate hellos');
  assert.equal(packets[0].type, 'application:hello');
  assert.deepEqual(
    traces.map((trace) => [trace.kind, trace.state, trace.generation]),
    [
      ['application-stage', 'handshake-sent', 3],
      ['application-stage', 'handshake-received', 3],
      ['application-stage', 'ready', 3],
    ]
  );
});

await test('a stale async room join cannot replace a newer room', async () => {
  const pendingIdentities = [];
  const networkJoins = [];
  const roomService = Object.create(RoomService.prototype);
  roomService.currentRoom = null;
  roomService.listeners = new Set();
  roomService.network = {
    init(_identity, roomId) {
      networkJoins.push(roomId);
    },
    leave() {},
  };
  roomService.identityService = {
    getOrCreateIdentity() {
      return new Promise((resolve) => pendingIdentities.push(resolve));
    },
  };

  const joinA = roomService.joinProblemRoom('LeetCode', 'a', 'A', 'https://example.test/a');
  const joinB = roomService.joinProblemRoom('LeetCode', 'b', 'B', 'https://example.test/b');

  pendingIdentities[0]({ peerId: 'peer:test', nickname: 'Tester' });
  await joinA;
  assert.deepEqual(networkJoins, [], 'stale room A reached NetworkService.init');

  pendingIdentities[1]({ peerId: 'peer:test', nickname: 'Tester' });
  const roomB = await joinB;
  assert.deepEqual(networkJoins, [roomB.roomId]);
  assert.equal(roomService.getCurrentRoom().roomId, roomB.roomId);
});

await test('leaving while identity loads cancels the pending room join', async () => {
  let resolveIdentity;
  const networkJoins = [];
  const roomService = Object.create(RoomService.prototype);
  roomService.currentRoom = null;
  roomService.listeners = new Set();
  roomService.network = {
    init(_identity, roomId) {
      networkJoins.push(roomId);
    },
    leave() {},
  };
  roomService.identityService = {
    getOrCreateIdentity() {
      return new Promise((resolve) => {
        resolveIdentity = resolve;
      });
    },
  };

  const join = roomService.joinProblemRoom('LeetCode', 'late', 'Late', 'https://example.test/late');
  roomService.leaveCurrentRoom();
  resolveIdentity({ peerId: 'peer:test', nickname: 'Tester' });
  await join;

  assert.deepEqual(networkJoins, []);
  assert.equal(roomService.getCurrentRoom(), null);
});

await test('resuming a selected room preserves its exact persisted room ID', async () => {
  storageState.delete(SELECTED_ROOM_STORAGE_KEY);
  const networkJoins = [];
  const roomService = Object.create(RoomService.prototype);
  roomService.currentRoom = null;
  roomService.listeners = new Set();
  roomService.network = {
    init(_identity, roomId) {
      networkJoins.push(roomId);
    },
    leave() {},
  };
  roomService.identityService = {
    async getOrCreateIdentity() {
      return { peerId: 'peer:test', nickname: 'Tester' };
    },
  };
  const selectedRoom = {
    roomId: 'group:stable-selection',
    platform: 'Group',
    slug: 'stable-selection',
    title: 'Stable selection',
    canonicalUrl: 'group://stable-selection',
    isGroup: true,
  };

  const resumed = await roomService.resumeRoom(selectedRoom);

  assert.equal(resumed.roomId, selectedRoom.roomId);
  assert.deepEqual(networkJoins, [selectedRoom.roomId]);
  assert.equal(storageState.get(SELECTED_ROOM_STORAGE_KEY).roomId, selectedRoom.roomId);
});

await test('suspending preserves room selection while explicit leave clears it', async () => {
  const networkLeaves = [];
  const roomService = Object.create(RoomService.prototype);
  roomService.currentRoom = null;
  roomService.listeners = new Set();
  roomService.network = {
    init() {},
    leave() {
      networkLeaves.push('leave');
    },
  };
  roomService.identityService = {
    async getOrCreateIdentity() {
      return { peerId: 'peer:test', nickname: 'Tester' };
    },
  };
  const selectedRoom = {
    roomId: 'room:persist-across-handoff',
    platform: 'Custom',
    slug: 'persist-across-handoff',
    title: 'Persist across handoff',
    canonicalUrl: 'custom://persist-across-handoff',
  };

  await roomService.resumeRoom(selectedRoom);
  roomService.suspendCurrentRoom();
  assert.equal(storageState.get(SELECTED_ROOM_STORAGE_KEY).roomId, selectedRoom.roomId);

  await roomService.resumeRoom(selectedRoom);
  roomService.leaveRoom();
  assert.equal(storageState.has(SELECTED_ROOM_STORAGE_KEY), false);
  assert.deepEqual(networkLeaves, ['leave', 'leave']);
});

await test('rapid detected-tab churn cannot evict an explicitly selected room', () => {
  const selectedRoom = {
    roomId: 'group:explicit-room',
    platform: 'Group',
    slug: 'explicit-room',
    title: 'Explicit room',
    canonicalUrl: 'group://explicit-room',
    isGroup: true,
  };
  let currentRoom = selectedRoom;

  for (let tab = 0; tab < 100; tab++) {
    const detectedProblem = {
      platform: 'LeetCode',
      slug: `problem-${tab}`,
      title: `Problem ${tab}`,
      canonicalUrl: `https://leetcode.com/problems/problem-${tab}`,
    };
    if (shouldAdoptDetectedProblem(currentRoom)) currentRoom = detectedProblem;
    assert.equal(chooseResumableRoom(selectedRoom, detectedProblem), selectedRoom);
  }

  assert.equal(currentRoom, selectedRoom);
  assert.equal(shouldAdoptDetectedProblem(null), true);
});

await test('service-worker registry survives serialization and restores routing capabilities', () => {
  const beforeRestart = Object.create(ContextRegistry.prototype);
  beforeRestart.contexts = new Map();
  beforeRestart.register({
    tabId: 41,
    url: 'https://leetcode.com/problems/two-sum',
    roomId: 'room:two-sum',
    capabilities: ['chat', 'code'],
    isProblemTab: true,
  });
  const persisted = JSON.parse(JSON.stringify(beforeRestart.snapshot()));

  const afterRestart = Object.create(ContextRegistry.prototype);
  afterRestart.contexts = new Map();
  afterRestart.hydrate(persisted, new Set([41]));

  assert.deepEqual(afterRestart.getTabsForRoom('room:two-sum', 'chat'), [41]);
  assert.deepEqual(afterRestart.getTabsForRoom('room:two-sum', 'code'), [41]);
  assert.deepEqual(afterRestart.getAllProblemTabs(), [41]);
  assert.equal(afterRestart.getContext(41).capabilities instanceof Set, true);
});

await test('registry hydration rejects dead tabs and cannot overwrite newer live state', () => {
  const registry = Object.create(ContextRegistry.prototype);
  registry.contexts = new Map();
  registry.register({ tabId: 7, roomId: 'room:new', capabilities: ['chat'] });
  const current = registry.getContext(7);
  current.lastActiveAt = 500;

  registry.hydrate(
    [
      {
        tabId: 7,
        roomId: 'room:stale',
        contextType: 'CONTENT_SCRIPT',
        capabilities: ['chat'],
        isProblemTab: true,
        registeredAt: 10,
        lastActiveAt: 100,
      },
      {
        tabId: 8,
        roomId: 'room:closed-tab',
        contextType: 'CONTENT_SCRIPT',
        capabilities: ['chat'],
        isProblemTab: true,
        registeredAt: 10,
        lastActiveAt: 100,
      },
    ],
    new Set([7])
  );

  assert.equal(registry.getContext(7).roomId, 'room:new');
  assert.equal(registry.getContext(8), undefined);
});

await test('tab detection produces a deterministic room ID and rejects browser-internal URLs', () => {
  const first = detectRoutedResource('https://leetcode.com/problems/two-sum/description/');
  const second = detectRoutedResource('https://leetcode.com/problems/two-sum/solutions/');

  assert.ok(first?.roomId);
  assert.equal(second.roomId, first.roomId);
  assert.equal(first.slug, 'two-sum');
  assert.equal(detectRoutedResource('chrome://newtab/'), null);
});

await test('cross-context collaboration messages fail closed outside their exact room', () => {
  assert.equal(messageBelongsToRoom('room:A', 'room:A'), true);
  assert.equal(messageBelongsToRoom('room:A', 'room:B'), false);
  assert.equal(messageBelongsToRoom(undefined, 'room:A'), false);
  assert.equal(messageBelongsToRoom('room:A', ''), false);
});

await test('Code Together state is reset and re-scoped when the room changes', () => {
  const broadcasts = [];
  const codeService = Object.create(CodeService.prototype);
  codeService.currentRoomId = 'room:A';
  codeService.roomGeneration = 1;
  codeService.runGeneration = 1;
  codeService.latestRemoteRunIds = new Map([['peer:A', 'run:A']]);
  codeService.state = {
    code: 'private notes from room A',
    language: 'javascript',
    version: 99,
    lastEditedBy: 'Alice',
    lastEditedAt: 1,
    activeCursors: [{ peerId: 'peer:A' }],
    isRunning: true,
    lastResult: { output: 'secret' },
  };
  codeService.listeners = new Set();
  codeService.broadcastToContentTabs = (message) => broadcasts.push(message);

  codeService.setRoom('room:B');

  assert.equal(codeService.currentRoomId, 'room:B');
  assert.notEqual(codeService.state.code, 'private notes from room A');
  assert.equal(codeService.state.version, 1);
  assert.deepEqual(codeService.state.activeCursors, []);
  assert.equal(codeService.state.lastResult, null);
  assert.equal(broadcasts.length, 1);
});

function makeVoiceService() {
  const service = Object.create(VoiceService.prototype);
  service.localStream = null;
  service.audioContext = null;
  service.analyser = null;
  service.volumeCheckInterval = null;
  service.isInVoice = false;
  service.lifecycleState = 'NOT_JOINED';
  service.joinPromise = null;
  service.operationGeneration = 0;
  service.isMuted = false;
  service.permissionNeeded = false;
  service.speakingPeers = new Set();
  service.participants = new Map();
  service.optedInPeers = new Set();
  service.pendingRemoteStreams = new Map();
  service.remoteAudioUnlocks = null;
  service.currentRoomId = 'room:A';
  service.ownedUnsubscribers = [];
  service.destroyed = false;
  service.listeners = new Set();
  service.speakingListeners = new Set();
  service.webrtc = { setLocalAudioTrack() {} };
  service.network = { broadcast() {}, send() {} };
  service.mediaCoordinator = {
    claim() {
      return null;
    },
    release() {},
  };
  service.startAudioAnalyser = async () => {};
  service.stopAudioAnalyser = () => {};
  return service;
}

function makeAudioStream() {
  const track = {
    enabled: true,
    readyState: 'live',
    onended: null,
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = 'ended';
    },
  };
  const stream = {
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
    getTracks: () => [track],
  };
  return { stream, track };
}

async function withMockMediaDevices(getUserMedia, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
  try {
    return await fn();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
}

await test('concurrent voice joins share one microphone acquisition', async () => {
  const voice = makeVoiceService();
  const { stream } = makeAudioStream();
  let resolveMedia;
  let acquisitions = 0;
  const media = new Promise((resolve) => {
    resolveMedia = resolve;
  });

  await withMockMediaDevices(
    () => {
      acquisitions++;
      return media;
    },
    async () => {
      const first = voice.joinVoice();
      const second = voice.joinVoice();
      assert.equal(first, second);
      assert.equal(voice.getLifecycleState(), 'JOINING');
      assert.equal(acquisitions, 1);
      resolveMedia(stream);
      assert.equal(await first, true);
      assert.equal(await second, true);
      assert.equal(voice.getLifecycleState(), 'JOINED');
    }
  );
});

await test('leaving while microphone permission is pending fences the late stream', async () => {
  const voice = makeVoiceService();
  const { stream, track } = makeAudioStream();
  let resolveMedia;
  const media = new Promise((resolve) => {
    resolveMedia = resolve;
  });

  await withMockMediaDevices(
    () => media,
    async () => {
      const joining = voice.joinVoice();
      voice.leaveVoice();
      resolveMedia(stream);
      assert.equal(await joining, false);
      assert.equal(track.stopped, true);
      assert.equal(voice.localStream, null);
      assert.equal(voice.getLifecycleState(), 'NOT_JOINED');
    }
  );
});

await test('an externally ended microphone track leaves voice and notifies the user', async () => {
  const voice = makeVoiceService();
  const { stream, track } = makeAudioStream();
  let warnings = 0;
  const originalGetInstance = NotificationService.getInstance;
  NotificationService.getInstance = () => ({
    warn() {
      warnings++;
    },
  });

  try {
    await withMockMediaDevices(() => Promise.resolve(stream), async () => {
      assert.equal(await voice.joinVoice(), true);
      track.onended();
      assert.equal(voice.getLifecycleState(), 'NOT_JOINED');
      assert.equal(voice.getIsInVoice(), false);
      assert.equal(warnings, 1);
    });
  } finally {
    NotificationService.getInstance = originalGetInstance;
  }
});

await test('remote voice is attached only after both peers explicitly opt in', () => {
  const voice = makeVoiceService();
  let remoteStreamHandler;
  voice.webrtc = {
    onRemoteStream(fn) {
      remoteStreamHandler = fn;
    },
    onRemoteStreamRemoved() {},
  };
  const attachments = [];
  voice.attachRemoteAudio = (peerId) => attachments.push(peerId);
  voice.setupWebRTCListeners();
  const { stream } = makeAudioStream();

  remoteStreamHandler('peer:remote', stream);
  assert.deepEqual(attachments, []);
  voice.isInVoice = true;
  remoteStreamHandler('peer:remote', stream);
  assert.deepEqual(attachments, []);
  voice.optedInPeers.add('peer:remote');
  remoteStreamHandler('peer:remote', stream);
  assert.deepEqual(attachments, ['peer:remote']);
});

await test('adding an audio track renegotiates recv-only peer connections', async () => {
  const webrtc = Object.create(WebRTCService.prototype);
  const replacementTrack = { readyState: 'live' };
  const transceiver = {
    receiver: { track: { kind: 'audio' } },
    sender: {
      track: null,
      async replaceTrack(track) {
        this.track = track;
      },
    },
    direction: 'recvonly',
  };
  webrtc.localAudioTrack = replacementTrack;
  webrtc.localVideoTrack = null;
  webrtc.connections = new Map([
    ['peer:remote', { peerId: 'peer:remote', pc: { connectionState: 'connected', getTransceivers: () => [transceiver] } }],
  ]);
  const renegotiations = [];
  webrtc.renegotiate = async (peerId, reason) => renegotiations.push([peerId, reason]);

  await webrtc.syncTracksToAllPeers('audio');

  assert.equal(transceiver.sender.track, replacementTrack);
  assert.equal(transceiver.direction, 'sendrecv');
  assert.deepEqual(renegotiations, [['peer:remote', 'TRACK_CHANGE']]);
});

await test('voice and live media ownership cannot silently replace each other', () => {
  const coordinator = Object.create(MediaSessionCoordinator.prototype);
  coordinator.owner = null;
  coordinator.releaseHandlers = new Map();
  const releases = [];
  coordinator.register('voice', () => {
    releases.push('voice');
    coordinator.release('voice');
  });
  coordinator.register('live', () => {
    releases.push('live');
    coordinator.release('live');
  });

  assert.equal(coordinator.claim('voice'), null);
  assert.equal(coordinator.claim('live'), 'voice');
  assert.equal(coordinator.getOwner(), 'live');
  assert.deepEqual(releases, ['voice']);
  assert.equal(coordinator.claim('voice'), 'live');
  assert.equal(coordinator.getOwner(), 'voice');
  assert.deepEqual(releases, ['voice', 'live']);
});

function makeTutorService() {
  const service = Object.create(TutorService.prototype);
  service.state = {
    viewerState: 'NOT_WATCHING',
    broadcasterState: 'IDLE',
    isActive: false,
    tutorPeerId: null,
    tutorIdentity: null,
    guestSpeakers: [],
    handRaises: [],
    isMyHandRaised: false,
    myRole: 'audience',
    isAudioLive: false,
    isVideoLive: false,
    broadcastType: 'audio',
    activeStreams: [],
  };
  service.remoteCursors = new Map();
  service.cursorListeners = new Set();
  service.stateListeners = new Set();
  service.remoteStreamListeners = new Set();
  service.localStream = null;
  service.localSourceStreams = [];
  service.mixAudioContext = null;
  service.remoteStreams = new Map();
  service.selectedStreamPeerId = null;
  service.currentRoomId = 'room:A';
  service.startPromise = null;
  service.speakerMediaPromise = null;
  service.operationGeneration = 0;
  service.admissionHeld = false;
  service.admissionRequestPromise = null;
  service.ownedUnsubscribers = [];
  service.admissionTimeouts = new Set();
  service.admissionCancellers = new Set();
  service.destroyed = false;
  service.identityService = {
    async getOrCreateIdentity() {
      return { peerId: 'peer:self', nickname: 'Self', avatar: '🦊', color: '#6366f1' };
    },
    getCachedIdentity() {
      return { peerId: 'peer:self', nickname: 'Self', avatar: '🦊', color: '#6366f1' };
    },
  };
  service.webrtc = {
    setLocalMediaStream() {},
    setLocalAudioTrack() {},
    setLocalVideoTrack() {},
    initiateConnection() {},
    isConnected() {
      return false;
    },
  };
  service.network = {
    broadcast() {},
    getTopologyState() {
      return { allPeers: new Set() };
    },
  };
  service.gamificationService = { unlockCustomBadge() {} };
  service.mediaCoordinator = {
    claim() {
      return null;
    },
    release() {},
  };
  service.signaling = {
    releaseStreamAdmission() {},
  };
  service.requestBroadcastAdmission = async () => ({ granted: true });
  return service;
}

function makeLiveStream() {
  const makeTrack = (kind) => ({
    kind,
    enabled: true,
    onended: null,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  });
  const audioTrack = makeTrack('audio');
  const videoTrack = makeTrack('video');
  const tracks = [audioTrack, videoTrack];
  const stream = {
    getTracks: () => tracks,
    getAudioTracks: () => [audioTrack],
    getVideoTracks: () => [videoTrack],
    addTrack(track) {
      if (!tracks.includes(track)) tracks.push(track);
    },
    removeTrack(track) {
      const index = tracks.indexOf(track);
      if (index >= 0) tracks.splice(index, 1);
    },
  };
  return { stream, audioTrack, videoTrack };
}

await test('live viewer media remains disabled until explicit Join Stream', () => {
  const tutor = makeTutorService();
  tutor.state.activeStreams = [
    {
      streamId: 'stream:remote',
      broadcasterPeerId: 'peer:broadcaster',
      broadcasterIdentity: { peerId: 'peer:broadcaster', nickname: 'Remote' },
      title: 'Remote stream',
      broadcastType: 'camera',
      startedAt: 1,
    },
  ];
  let remoteHandler;
  tutor.webrtc = {
    ...tutor.webrtc,
    onRemoteStream(fn) {
      remoteHandler = fn;
    },
    onRemoteStreamRemoved() {},
  };
  tutor.setupWebRTCListeners();
  const { stream, audioTrack, videoTrack } = makeLiveStream();

  remoteHandler('peer:broadcaster', stream);
  assert.equal(audioTrack.enabled, false);
  assert.equal(videoTrack.enabled, false);
  assert.equal(tutor.getActiveRemoteStream(), null);

  assert.equal(tutor.joinStream('peer:broadcaster'), true);
  assert.equal(tutor.getState().viewerState, 'WATCHING');
  assert.equal(audioTrack.enabled, true);
  assert.equal(tutor.getActiveRemoteStream(), stream);

  tutor.leaveStream();
  assert.equal(tutor.getState().viewerState, 'NOT_WATCHING');
  assert.equal(videoTrack.enabled, false);
  assert.equal(tutor.getActiveRemoteStream(), null);
});

await test('live viewer gating never disables an unannounced voice-only stream', () => {
  const tutor = makeTutorService();
  let remoteHandler;
  tutor.webrtc = {
    ...tutor.webrtc,
    onRemoteStream(fn) {
      remoteHandler = fn;
    },
    onRemoteStreamRemoved() {},
  };
  tutor.setupWebRTCListeners();
  const { stream, track: audioTrack } = makeAudioStream();

  remoteHandler('peer:voice-only', stream);

  assert.equal(audioTrack.enabled, true);
  assert.equal(tutor.selectedStreamPeerId, null);
  assert.equal(tutor.getActiveRemoteStream(), null);
});

await test('concurrent Go Live calls share one media acquisition', async () => {
  const tutor = makeTutorService();
  const { stream } = makeLiveStream();
  let acquisitions = 0;

  await withMockMediaDevices(
    () => {
      acquisitions++;
      return Promise.resolve(stream);
    },
    async () => {
      const first = tutor.startTutorStage('camera', 'room:A');
      const second = tutor.startTutorStage('camera', 'room:A');
      assert.equal(first, second);
      assert.equal(await first, true);
      assert.equal(acquisitions, 1);
      assert.equal(tutor.getState().broadcasterState, 'LIVE');
    }
  );
});

await test('live service waits for a correlated authoritative admission response', async () => {
  const tutor = makeTutorService();
  delete tutor.requestBroadcastAdmission;
  const listeners = new Map();
  const requested = [];
  tutor.signaling = {
    getIsRoomRegistered: () => true,
    supportsStreamAdmission: () => true,
    on(type, handler) {
      listeners.set(type, handler);
      return () => listeners.delete(type);
    },
    requestStreamAdmission(requestId) {
      requested.push(requestId);
      queueMicrotask(() => {
        listeners.get('stream:admission_response')?.({
          requestId,
          granted: true,
          activeBroadcasters: 1,
          maxBroadcasters: 2,
        });
      });
      return true;
    },
    releaseStreamAdmission() {},
  };

  const result = await tutor.requestBroadcastAdmission(tutor.operationGeneration);

  assert.equal(result.granted, true);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /^admit-/);
});

await test('room switch fences and stops a late live-media acquisition', async () => {
  const tutor = makeTutorService();
  const { stream, audioTrack, videoTrack } = makeLiveStream();
  let resolveMedia;
  const media = new Promise((resolve) => {
    resolveMedia = resolve;
  });

  await withMockMediaDevices(
    () => media,
    async () => {
      const starting = tutor.startTutorStage('camera', 'room:A');
      await Promise.resolve();
      tutor.setRoom('room:B');
      resolveMedia(stream);
      assert.equal(await starting, false);
      assert.equal(audioTrack.stopped, true);
      assert.equal(videoTrack.stopped, true);
      assert.equal(tutor.getState().broadcasterState, 'IDLE');
      assert.equal(tutor.currentRoomId, 'room:B');
    }
  );
});

await test('stopping live media clears both WebRTC audio and video senders', () => {
  const tutor = makeTutorService();
  const { stream, audioTrack, videoTrack } = makeLiveStream();
  const mediaAssignments = [];
  tutor.webrtc.setLocalMediaStream = (value) => mediaAssignments.push(value);
  tutor.localStream = stream;
  tutor.localSourceStreams = [stream];
  tutor.state.broadcasterState = 'LIVE';
  tutor.state.myRole = 'tutor';
  tutor.state.activeStreams = [
    {
      streamId: 'stream:self',
      broadcasterPeerId: 'peer:self',
      broadcasterIdentity: tutor.identityService.getCachedIdentity(),
      title: 'Test',
      broadcastType: 'camera',
      startedAt: 1,
    },
  ];

  tutor.stopTutorStage('room:A');

  assert.equal(audioTrack.stopped, true);
  assert.equal(videoTrack.stopped, true);
  assert.deepEqual(mediaAssignments, [null]);
  assert.equal(tutor.getState().broadcasterState, 'IDLE');
  assert.equal(tutor.getState().isAudioLive, false);
  assert.equal(tutor.getState().isVideoLive, false);
});

await test('live popout reuses Picture-in-Picture instead of creating a second app realm', () => {
  const source = readFileSync(new URL('../src/features/tutor/TutorStage.tsx', import.meta.url), 'utf8');
  assert.match(source, /requestPictureInPicture\(\)/);
  assert.doesNotMatch(source, /sidepanel\.html\?popout=stream/);
  assert.doesNotMatch(source, /chrome\.windows\.create\s*\(/);
});

await test('live control payloads are bound to the packet sender, not spoofable IDs', () => {
  const tutor = makeTutorService();
  const handlers = new Map();
  tutor.network = {
    ...tutor.network,
    on(type, handler) {
      handlers.set(type, handler);
      return () => {};
    },
  };
  tutor.setupNetworkListeners();
  const sender = {
    peerId: 'peer:actual',
    nickname: 'Actual',
    avatar: '🐙',
    color: '#10b981',
  };
  const packet = { roomId: 'room:A', from: sender };

  handlers.get('stream:announce')(
    {
      streamId: 'stream:forged',
      broadcasterPeerId: 'peer:victim',
      broadcasterIdentity: { peerId: 'peer:victim', nickname: 'Victim' },
      title: 'x'.repeat(500),
      broadcastType: 'camera',
      startedAt: 1,
    },
    packet
  );

  const announced = tutor.getState().activeStreams[0];
  assert.equal(announced.broadcasterPeerId, sender.peerId);
  assert.equal(announced.broadcasterIdentity.nickname, sender.nickname);
  assert.equal(announced.title.length, 160);

  handlers.get('stream:stopped')({ broadcasterPeerId: 'peer:victim' }, packet);
  assert.deepEqual(tutor.getState().activeStreams, []);
});

await test('synchronous identity reads use one stable provisional peer ID', () => {
  const identityService = Object.create(IdentityService.prototype);
  identityService.currentIdentity = null;
  identityService.provisionalIdentity = null;
  identityService.initPromise = new Promise(() => {});

  const first = identityService.getMyIdentity();
  const second = identityService.getMyIdentity();

  assert.equal(second.peerId, first.peerId);
  assert.equal(second, first);
});

await test('corrupted stored identities cannot become routing identities', () => {
  assert.equal(isValidStoredIdentity(null), false);
  assert.equal(
    isValidStoredIdentity({ peerId: '>', nickname: 'Mallory', avatar: 'x', color: '#000' }),
    false
  );
  assert.equal(
    isValidStoredIdentity({
      peerId: 'nb-valid_123',
      nickname: 'Alice',
      avatar: '🦊',
      color: '#6366f1',
    }),
    true
  );
  assert.equal(
    isValidStoredIdentity({
      peerId: 'nb-valid_123',
      nickname: '🦊'.repeat(20),
      avatar: '🦊',
      color: '#6366f1',
    }),
    false,
    'nickname limit must match the server UTF-8 byte limit'
  );
});

await test('a changed peer ID rebuilds every network subsystem in the same room', () => {
  const calls = [];
  const networkService = Object.create(NetworkService.prototype);
  networkService.myIdentity = { peerId: 'nb-old', nickname: 'Old', avatar: '', color: '#000' };
  networkService.currentRoomId = 'room:identity';
  networkService.topology = {
    getPolicy() {
      return { name: 'test-policy' };
    },
  };
  networkService.leave = () => calls.push(['leave']);
  networkService.init = (identity, roomId, policy) =>
    calls.push(['init', identity.peerId, roomId, policy.name]);

  networkService.updateIdentity({
    peerId: 'nb-new',
    nickname: 'New',
    avatar: '',
    color: '#000',
  });

  assert.deepEqual(calls, [
    ['leave'],
    ['init', 'nb-new', 'room:identity', 'test-policy'],
  ]);
});

console.log(`\n🏁 Signaling lifecycle: ${passed}/${total} tests passed\n`);
if (passed !== total) process.exit(1);
