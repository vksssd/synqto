import assert from 'assert';
import fs from 'fs';

const { GestureUnlockRegistry } = await import(
  '../src/core/media/gesture-unlock-registry.ts'
);
const { debounce } = await import('../src/shared/utils.ts');
const { OwnedTimeouts } = await import('../src/shared/owned-timeouts.ts');
const { PageObserver } = await import('../src/content/page-observer.ts');
const { CursorOverlay } = await import('../src/content/cursor-overlay.ts');
const { InPageEditorSync } = await import('../src/content/in-page-editor-sync.ts');
const { FloatingWidget } = await import('../src/content/floating-widget.ts');
const { DiscoveryService } = await import('../src/features/discovery/discovery.service.ts');
const { VoiceService } = await import('../src/features/voice/voice.service.ts');
const { CoFocusService } = await import('../src/features/cofocus/cofocus.service.ts');
const { INITIAL_COFOCUS_STATE } = await import('../src/features/cofocus/cofocus.types.ts');
const { LobbyService } = await import('../src/core/network/lobby.service.ts');
const { ChatService } = await import('../src/features/chat/chat.service.ts');
const { WhiteboardService } = await import('../src/features/whiteboard/whiteboard.service.ts');
const { TimerService } = await import('../src/features/timer/timer.service.ts');
const { ThemeService, DEFAULT_THEME_SETTINGS } = await import(
  '../src/features/settings/theme.service.ts'
);
const { DiaryService } = await import('../src/features/diary/diary.service.ts');
const { NotificationService } = await import('../src/core/notify/notification.service.ts');
const { CodeService } = await import('../src/features/code/code.service.ts');
const { TutorService } = await import('../src/features/tutor/tutor.service.ts');
const { IdentityService } = await import('../src/features/identity/identity.service.ts');
const { GamificationService } = await import('../src/features/gamification/gamification.service.ts');
const { GroupService } = await import('../src/features/group/group.service.ts');

let passed = 0;
let total = 0;
const failures = [];

async function scenario(name, run) {
  total++;
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ✗ ${name}`);
    console.error(`      ${error?.stack || error}`);
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    [...(this.listeners.get(type) || [])].forEach((listener) => {
      if (typeof listener === 'function') listener({ type });
      else listener.handleEvent({ type });
    });
  }

  count(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class FakeChromeEvent {
  constructor() {
    this.listeners = new Set();
  }
  addListener(listener) {
    this.listeners.add(listener);
  }
  removeListener(listener) {
    this.listeners.delete(listener);
  }
}

console.log('\n🧹 Lifecycle & Session Ownership Regressions\n');

await scenario('owned timeouts cancel id zero and fence already-queued callbacks', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks = [];
  const cleared = [];
  let nextHandle = 0;

  globalThis.setTimeout = (callback) => {
    const handle = nextHandle++;
    callbacks.push({ handle, callback });
    return handle;
  };
  globalThis.clearTimeout = (handle) => cleared.push(handle);

  try {
    const owner = new OwnedTimeouts();
    let calls = 0;
    const zero = owner.schedule(() => calls++, 10);
    assert.strictEqual(zero, 0);
    owner.cancel(zero);
    callbacks[0].callback();
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(cleared, [0]);

    const oldHandle = owner.schedule(() => calls++, 10);
    const newHandle = owner.replace(oldHandle, () => calls++, 10);
    callbacks.find((entry) => entry.handle === oldHandle).callback();
    callbacks.find((entry) => entry.handle === newHandle).callback();
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(cleared, [0, oldHandle]);

    owner.clearAll();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

await scenario('autoplay retry owns exactly one three-event listener group per peer', () => {
  const target = new FakeEventTarget();
  const registry = new GestureUnlockRegistry(target);
  registry.arm('peer-a', () => {});
  assert.strictEqual(registry.size, 1);
  assert.deepStrictEqual(
    ['click', 'keydown', 'touchstart'].map((event) => target.count(event)),
    [1, 1, 1]
  );
});

await scenario('first autoplay gesture removes every sibling listener before retrying', () => {
  const target = new FakeEventTarget();
  const registry = new GestureUnlockRegistry(target);
  let attempts = 0;
  registry.arm('peer-a', () => attempts++);
  target.dispatch('click');
  assert.strictEqual(attempts, 1);
  assert.strictEqual(registry.size, 0);
  assert.deepStrictEqual(
    ['click', 'keydown', 'touchstart'].map((event) => target.count(event)),
    [0, 0, 0]
  );
  target.dispatch('keydown');
  assert.strictEqual(attempts, 1, 'a sibling gesture retried playback twice');
});

await scenario('re-arming a peer replaces rather than accumulates autoplay retries', () => {
  const target = new FakeEventTarget();
  const registry = new GestureUnlockRegistry(target);
  let staleAttempts = 0;
  let currentAttempts = 0;
  registry.arm('peer-a', () => staleAttempts++);
  registry.arm('peer-a', () => currentAttempts++);
  assert.deepStrictEqual(
    ['click', 'keydown', 'touchstart'].map((event) => target.count(event)),
    [1, 1, 1]
  );
  target.dispatch('touchstart');
  assert.strictEqual(staleAttempts, 0);
  assert.strictEqual(currentAttempts, 1);
});

await scenario('peer removal and room teardown cancel pending autoplay retries', () => {
  const target = new FakeEventTarget();
  const registry = new GestureUnlockRegistry(target);
  registry.arm('peer-a', () => {});
  registry.arm('peer-b', () => {});
  registry.cancel('peer-a');
  assert.strictEqual(registry.size, 1);
  registry.clear();
  assert.strictEqual(registry.size, 0);
  assert.deepStrictEqual(
    ['click', 'keydown', 'touchstart'].map((event) => target.count(event)),
    [0, 0, 0]
  );
});

function installVoiceDom(playFactory) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const target = new FakeEventTarget();
  const elements = new Map();
  globalThis.window = target;
  globalThis.document = {
    body: {
      appendChild: (element) => elements.set(element.id, element),
    },
    createElement: () => ({
      id: '',
      autoplay: false,
      style: {},
      srcObject: null,
      play: playFactory,
      remove() {
        elements.delete(this.id);
      },
    }),
    getElementById: (id) => elements.get(id) || null,
  };
  return {
    target,
    elements,
    restore() {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
    },
  };
}

function makeVoiceHarness() {
  const service = Object.create(VoiceService.prototype);
  service.isInVoice = true;
  service.remoteAudioUnlocks = null;
  service.participants = new Map();
  service.speakingPeers = new Set();
  service.speakingListeners = new Set();
  return service;
}

await scenario('removing remote audio releases its blocked-autoplay gesture listeners', async () => {
  const env = installVoiceDom(() => Promise.reject(new Error('autoplay blocked')));
  try {
    const service = makeVoiceHarness();
    const stream = {};
    service.attachRemoteAudio('peer-a', stream);
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(service.remoteAudioUnlocks.size, 1);
    service.removeRemoteAudio('peer-a');
    assert.strictEqual(service.remoteAudioUnlocks.size, 0);
    assert.deepStrictEqual(
      ['click', 'keydown', 'touchstart'].map((event) => env.target.count(event)),
      [0, 0, 0]
    );
    assert.strictEqual(env.elements.size, 0);
  } finally {
    env.restore();
  }
});

await scenario('late autoplay rejection cannot resurrect a removed peer retry', async () => {
  let rejectPlay;
  const pendingPlay = new Promise((_resolve, reject) => {
    rejectPlay = reject;
  });
  const env = installVoiceDom(() => pendingPlay);
  try {
    const service = makeVoiceHarness();
    service.attachRemoteAudio('peer-a', {});
    service.removeRemoteAudio('peer-a');
    rejectPlay(new Error('late autoplay rejection'));
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(service.remoteAudioUnlocks.size, 0);
    assert.deepStrictEqual(
      ['click', 'keydown', 'touchstart'].map((event) => env.target.count(event)),
      [0, 0, 0]
    );
  } finally {
    env.restore();
  }
});

await scenario('VoiceService teardown releases room handlers, media owners, and analyser id zero', () => {
  const originalClearInterval = globalThis.clearInterval;
  const originalDocument = globalThis.document;
  const clearedIntervals = [];
  const networkHandlers = new Map();
  let remoteStreamHandler = null;
  let remoteStreamRemovedHandler = null;
  let unsubscribeCount = 0;
  let localAudioDetachCount = 0;
  let coordinatorReleaseCount = 0;
  let unlockClearCount = 0;
  const broadcasts = [];
  const localTrack = {
    enabled: true,
    onended: () => {},
    stopCalls: 0,
    stop() {
      this.stopCalls++;
    },
  };
  const localStream = {
    getTracks: () => [localTrack],
    getAudioTracks: () => [localTrack],
  };
  const audioContext = {
    state: 'running',
    closeCalls: 0,
    close() {
      this.closeCalls++;
      this.state = 'closed';
      return Promise.resolve();
    },
  };
  const makeUnsubscribe = () => () => {
    unsubscribeCount++;
  };
  globalThis.clearInterval = (id) => clearedIntervals.push(id);
  globalThis.document = undefined;

  try {
    const service = Object.create(VoiceService.prototype);
    service.localStream = localStream;
    service.audioContext = audioContext;
    service.analyser = {};
    service.volumeCheckInterval = 0;
    service.isInVoice = true;
    service.lifecycleState = 'JOINED';
    service.joinPromise = null;
    service.operationGeneration = 7;
    service.isMuted = false;
    service.permissionNeeded = false;
    service.speakingPeers = new Set(['self']);
    service.participants = new Map([['peer-live', { peerId: 'peer-live' }]]);
    service.optedInPeers = new Set();
    service.pendingRemoteStreams = new Map();
    service.remoteAudioUnlocks = {
      clear: () => {
        unlockClearCount++;
      },
    };
    service.currentRoomId = 'room-a';
    service.ownedUnsubscribers = [];
    service.destroyed = false;
    service.listeners = new Set([() => {}]);
    service.speakingListeners = new Set([() => {}]);
    service.network = {
      on: (type, handler) => {
        networkHandlers.set(type, handler);
        return makeUnsubscribe();
      },
      broadcast: (type, payload) => {
        broadcasts.push({ type, payload });
        return true;
      },
      send: () => true,
    };
    service.webrtc = {
      onRemoteStream: (handler) => {
        remoteStreamHandler = handler;
        return makeUnsubscribe();
      },
      onRemoteStreamRemoved: (handler) => {
        remoteStreamRemovedHandler = handler;
        return makeUnsubscribe();
      },
      setLocalAudioTrack: (track) => {
        assert.strictEqual(track, null);
        localAudioDetachCount++;
      },
    };
    service.mediaCoordinator = {
      register: () => makeUnsubscribe(),
      release: (owner) => {
        assert.strictEqual(owner, 'voice');
        coordinatorReleaseCount++;
      },
    };

    service.setupOwnershipListeners();
    service.setupWebRTCListeners();
    service.setupNetworkListeners();
    assert.strictEqual(service.ownedUnsubscribers.length, 5);

    const retiredPresenceHandler = networkHandlers.get('voice:presence');
    retiredPresenceHandler(
      { joined: true },
      { roomId: 'room-b', from: { peerId: 'peer-wrong' } }
    );
    assert.strictEqual(service.optedInPeers.size, 0);

    service.destroy();
    retiredPresenceHandler(
      { joined: true },
      { roomId: 'room-a', from: { peerId: 'peer-retired' } }
    );
    remoteStreamHandler('peer-retired', {
      getVideoTracks: () => [],
      getAudioTracks: () => [{}],
    });
    remoteStreamRemovedHandler('peer-live');

    assert.strictEqual(unsubscribeCount, 5);
    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.strictEqual(audioContext.closeCalls, 1);
    assert.strictEqual(localTrack.stopCalls, 1);
    assert.strictEqual(localTrack.onended, null);
    assert.strictEqual(localAudioDetachCount, 1);
    assert.strictEqual(coordinatorReleaseCount, 1);
    assert.strictEqual(unlockClearCount, 1);
    assert.deepStrictEqual(broadcasts, [
      { type: 'voice:hangup', payload: { left: true } },
    ]);
    assert.strictEqual(service.optedInPeers.size, 0);
    assert.strictEqual(service.pendingRemoteStreams.size, 0);
    assert.strictEqual(service.listeners.size, 0);
    assert.strictEqual(service.speakingListeners.size, 0);
    assert.strictEqual(service.currentRoomId, '');

    service.destroy();
    assert.strictEqual(unsubscribeCount, 5);
    assert.strictEqual(localTrack.stopCalls, 1);
    assert.strictEqual(audioContext.closeCalls, 1);
  } finally {
    globalThis.clearInterval = originalClearInterval;
    globalThis.document = originalDocument;
  }
});

await scenario('the app binds VoiceService to every room transition', () => {
  const source = fs.readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /voiceService\.setRoom\(nextRoomId\)/);
});

await scenario('debounce cancellation handles timer id zero and prevents stale work', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const tasks = new Map();
  let nextId = 0;
  globalThis.setTimeout = (callback) => {
    const id = nextId++;
    tasks.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => tasks.delete(id);
  try {
    const debounced = debounce(() => {}, 250);
    debounced();
    debounced();
    assert.strictEqual(tasks.size, 1, 'timer id 0 was not superseded');
    debounced.cancel();
    assert.strictEqual(tasks.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

function installPageObserverEnvironment() {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    chrome: globalThis.chrome,
    MutationObserver: globalThis.MutationObserver,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const target = new FakeEventTarget();
  const timeoutTasks = new Map();
  const intervalTasks = new Map();
  let nextTimerId = 0;
  const originalPushState = function () {};
  const originalReplaceState = function () {};
  const history = { pushState: originalPushState, replaceState: originalReplaceState };
  const fakeWindow = Object.assign(target, {
    history,
    location: { href: 'https://leetcode.com/problems/two-sum/' },
  });
  let mutationInstance = null;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      mutationInstance = this;
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  globalThis.window = fakeWindow;
  globalThis.document = {
    title: 'Two Sum',
    querySelector: () => ({}),
  };
  globalThis.chrome = { runtime: { id: 'test-extension' } };
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.setTimeout = (callback) => {
    const id = nextTimerId++;
    timeoutTasks.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timeoutTasks.delete(id);
  globalThis.setInterval = (callback) => {
    const id = nextTimerId++;
    intervalTasks.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => intervalTasks.delete(id);

  return {
    target,
    history,
    originalPushState,
    originalReplaceState,
    timeoutTasks,
    intervalTasks,
    mutation: () => mutationInstance,
    restore() {
      Object.assign(globalThis, originals);
    },
  };
}

await scenario('PageObserver teardown releases timers, DOM observers, navigation listeners, and History patches', () => {
  const env = installPageObserverEnvironment();
  try {
    let detections = 0;
    const observer = new PageObserver(() => detections++);
    assert.strictEqual(detections, 1);
    assert.notStrictEqual(env.history.pushState, env.originalPushState);
    assert.notStrictEqual(env.history.replaceState, env.originalReplaceState);
    assert.deepStrictEqual(
      ['popstate', 'hashchange', 'yt-navigate-finish'].map((event) => env.target.count(event)),
      [1, 1, 1]
    );
    assert.strictEqual(env.intervalTasks.size, 1);

    env.target.dispatch('popstate');
    assert.strictEqual(env.timeoutTasks.size, 1);
    observer.destroy();
    observer.destroy();

    assert.strictEqual(env.timeoutTasks.size, 0);
    assert.strictEqual(env.intervalTasks.size, 0);
    assert.strictEqual(env.mutation().disconnected, true);
    assert.strictEqual(env.history.pushState, env.originalPushState);
    assert.strictEqual(env.history.replaceState, env.originalReplaceState);
    assert.deepStrictEqual(
      ['popstate', 'hashchange', 'yt-navigate-finish'].map((event) => env.target.count(event)),
      [0, 0, 0]
    );

    env.mutation().callback([]);
    env.target.dispatch('hashchange');
    assert.strictEqual(env.timeoutTasks.size, 0, 'destroyed observer scheduled stale work');
  } finally {
    env.restore();
  }
});

await scenario('PageObserver never overwrites a later History API owner during teardown', () => {
  const env = installPageObserverEnvironment();
  try {
    const observer = new PageObserver(() => {});
    const laterOwner = function () {};
    env.history.pushState = laterOwner;
    observer.destroy();
    assert.strictEqual(env.history.pushState, laterOwner);
    assert.strictEqual(env.history.replaceState, env.originalReplaceState);
  } finally {
    env.restore();
  }
});

await scenario('PageObserver notifies content owners exactly once when the extension context dies', () => {
  const env = installPageObserverEnvironment();
  try {
    let invalidations = 0;
    const observer = new PageObserver(() => {}, () => invalidations++);
    const poll = [...env.intervalTasks.values()][0];
    globalThis.chrome.runtime.id = undefined;
    poll();
    poll();
    assert.strictEqual(invalidations, 1);
    assert.strictEqual(env.intervalTasks.size, 0);
    assert.deepStrictEqual(
      ['popstate', 'hashchange', 'yt-navigate-finish'].map((event) => env.target.count(event)),
      [0, 0, 0]
    );
    observer.destroy();
  } finally {
    env.restore();
  }
});

function installContentOwnerEnvironment() {
  const originals = {
    window: globalThis.window,
    document: globalThis.document,
    chrome: globalThis.chrome,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const windowTarget = new FakeEventTarget();
  const documentTarget = new FakeEventTarget();
  documentTarget.getElementById = () => null;
  const storageEvent = new FakeChromeEvent();
  const runtimeEvent = new FakeChromeEvent();
  const clearedTimeouts = [];
  const clearedIntervals = [];
  const cancelledFrames = [];
  globalThis.window = windowTarget;
  globalThis.document = documentTarget;
  globalThis.chrome = {
    runtime: { id: 'test-extension', onMessage: runtimeEvent },
    storage: { onChanged: storageEvent },
  };
  globalThis.clearTimeout = (id) => clearedTimeouts.push(id);
  globalThis.clearInterval = (id) => clearedIntervals.push(id);
  globalThis.cancelAnimationFrame = (id) => cancelledFrames.push(id);
  return {
    windowTarget,
    documentTarget,
    storageEvent,
    runtimeEvent,
    clearedTimeouts,
    clearedIntervals,
    cancelledFrames,
    restore() {
      Object.assign(globalThis, originals);
    },
  };
}

await scenario('CursorOverlay teardown removes global/Chrome listeners and all pending visuals', () => {
  const env = installContentOwnerEnvironment();
  try {
    const service = Object.create(CursorOverlay.prototype);
    let containerRemoved = 0;
    let cursorRemoved = 0;
    service.container = { innerHTML: 'cursor', remove: () => containerRemoved++ };
    service.cursorElements = new Map([['peer-a', { remove: () => cursorRemoved++ }]]);
    service.cursorTimeouts = new Map([['peer-a', 0]]);
    service.rippleTimeouts = new Set([1]);
    service.destroyed = false;
    service.storageListener = () => {};
    service.runtimeMessageListener = () => {};
    env.storageEvent.addListener(service.storageListener);
    env.runtimeEvent.addListener(service.runtimeMessageListener);
    env.windowTarget.addEventListener('mousemove', service.handleMouseMove);
    env.windowTarget.addEventListener('click', service.handleClick);

    service.destroy();
    service.destroy();
    assert.deepStrictEqual(env.clearedTimeouts.sort(), [0, 1]);
    assert.strictEqual(env.storageEvent.listeners.size, 0);
    assert.strictEqual(env.runtimeEvent.listeners.size, 0);
    assert.strictEqual(env.windowTarget.count('mousemove'), 0);
    assert.strictEqual(env.windowTarget.count('click'), 0);
    assert.strictEqual(cursorRemoved, 1);
    assert.strictEqual(containerRemoved, 1);
    assert.strictEqual(service.cursorElements.size, 0);
    assert.strictEqual(service.rippleTimeouts.size, 0);
  } finally {
    env.restore();
  }
});

await scenario('inactive remote cursors remove their DOM and map entries after the fade window', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let timeoutCallback = null;
  let removed = 0;
  const makeElement = () => ({
    style: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
    get firstElementChild() {
      return this.children[0] || null;
    },
    get lastElementChild() {
      return this.children.at(-1) || null;
    },
    remove() {
      removed++;
    },
  });
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 0;
    },
  };
  globalThis.document = { createElement: makeElement };
  try {
    const service = Object.create(CursorOverlay.prototype);
    service.container = makeElement();
    service.cursorElements = new Map();
    service.cursorTimeouts = new Map();
    service.renderCursor({
      peerId: 'peer-a',
      nickname: 'Ada',
      avatar: 'A',
      color: '#3b82f6',
      xPct: 50,
      yPct: 50,
      isTutor: false,
      timestamp: Date.now(),
    });
    assert.strictEqual(service.cursorElements.size, 1);
    assert.strictEqual(service.cursorTimeouts.size, 1);
    timeoutCallback();
    assert.strictEqual(service.cursorElements.size, 0);
    assert.strictEqual(service.cursorTimeouts.size, 0);
    assert.strictEqual(removed, 1);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

await scenario('InPageEditorSync teardown releases polling, drag, page, runtime, and storage owners', () => {
  const env = installContentOwnerEnvironment();
  try {
    const service = Object.create(InPageEditorSync.prototype);
    let dragCleanups = 0;
    let dockRemoved = 0;
    service.destroyed = false;
    service.cleanupInterval = 0;
    service.dragResetTimer = 1;
    service.activeDragCleanup = () => dragCleanups++;
    service.pageMessageListener = () => {};
    service.runtimeMessageListener = () => {};
    service.storageListener = () => {};
    service.containerEl = { remove: () => dockRemoved++ };
    service.activePeers = new Map([['peer-a', {}]]);
    service.attachedEditorKind = 'monaco';
    env.windowTarget.addEventListener('message', service.pageMessageListener);
    env.runtimeEvent.addListener(service.runtimeMessageListener);
    env.storageEvent.addListener(service.storageListener);

    service.destroy();
    service.destroy();
    assert.deepStrictEqual(env.clearedIntervals, [0]);
    assert.deepStrictEqual(env.clearedTimeouts, [1]);
    assert.strictEqual(dragCleanups, 1);
    assert.strictEqual(dockRemoved, 1);
    assert.strictEqual(env.windowTarget.count('message'), 0);
    assert.strictEqual(env.runtimeEvent.listeners.size, 0);
    assert.strictEqual(env.storageEvent.listeners.size, 0);
    assert.strictEqual(service.activePeers.size, 0);
    assert.strictEqual(service.attachedEditorKind, null);
  } finally {
    env.restore();
  }
});

await scenario('FloatingWidget invalidation stops recurring work while preserving its reload state', () => {
  const env = installContentOwnerEnvironment();
  try {
    const service = Object.create(FloatingWidget.prototype);
    let observerDisconnects = 0;
    let dragCleanups = 0;
    service.contextInvalidated = false;
    service.timerInterval = 0;
    service.wbClearArmTimer = 1;
    service.wbResizeObserver = { disconnect: () => observerDisconnects++ };
    service.wbAnimationRafId = 0;
    service.viewportResizeRaf = 2;
    service.wbResizeScheduled = true;
    service.wbDrawRafScheduled = true;
    service.wbPatternCache = new Map([['grid-dark', {}]]);
    service.wbLaserTrails = [{}];
    service.tempDisappearingStrokes = [{}];
    service.activeDragCleanup = () => dragCleanups++;
    service.viewportResizeListener = () => {};
    service.domReadyListener = () => {};
    service.runtimeMessageListener = () => {};
    service.storageChangeListener = () => {};
    service.shadow = { innerHTML: '' };
    env.windowTarget.addEventListener('resize', service.viewportResizeListener);
    env.windowTarget.addEventListener('load', service.domReadyListener);
    env.documentTarget.addEventListener('DOMContentLoaded', service.domReadyListener);
    env.runtimeEvent.addListener(service.runtimeMessageListener);
    env.storageEvent.addListener(service.storageChangeListener);

    service.handleContextInvalidated();
    service.handleContextInvalidated();
    assert.strictEqual(service.contextInvalidated, true);
    assert.deepStrictEqual(env.clearedIntervals, [0]);
    assert.deepStrictEqual(env.clearedTimeouts, [1]);
    assert.deepStrictEqual(env.cancelledFrames.sort(), [0, 2]);
    assert.strictEqual(observerDisconnects, 1);
    assert.strictEqual(dragCleanups, 1);
    assert.strictEqual(env.windowTarget.count('resize'), 0);
    assert.strictEqual(env.windowTarget.count('load'), 0);
    assert.strictEqual(env.documentTarget.count('DOMContentLoaded'), 0);
    assert.strictEqual(env.runtimeEvent.listeners.size, 0);
    assert.strictEqual(env.storageEvent.listeners.size, 0);
    assert.strictEqual(service.wbResizeScheduled, false);
    assert.strictEqual(service.wbDrawRafScheduled, false);
    assert.strictEqual(service.wbPatternCache.size, 0);
    assert.strictEqual(service.wbLaserTrails.length, 0);
    assert.strictEqual(service.tempDisappearingStrokes.length, 0);
    assert.match(service.shadow.innerHTML, /reload this page to reconnect/i);
    assert.doesNotMatch(service.shadow.innerHTML, /button|canvas|input/i);
  } finally {
    env.restore();
  }
});

await scenario('the content-script liveness sentinel coordinates every long-lived owner', () => {
  const source = fs.readFileSync(new URL('../src/content/content-script.ts', import.meta.url), 'utf8');
  assert.match(source, /cursorOverlay\?\.destroy\(\)/);
  assert.match(source, /editorSync\?\.destroy\(\)/);
  assert.match(source, /floatingWidget\?\.handleContextInvalidated\(\)/);
});

function makeDiscoveryHarness(roomId = 'room-a') {
  const service = Object.create(DiscoveryService.prototype);
  service.currentRoomId = roomId;
  service.sessionStartedAt = 1;
  service.onlinePeers = new Map([
    ['peer-old', { identity: { peerId: 'peer-old' }, lastSeen: Date.now() }],
  ]);
  service.listeners = new Set();
  service.alertListeners = new Set();
  service.networkUnsubscribers = [];
  service.heartbeatTimer = null;
  service.pruneTimer = null;
  service.destroyed = false;
  const emissions = [];
  const broadcasts = [];
  service.listeners.add((peers) => emissions.push(peers));
  service.network = {
    broadcast: (type, payload) => broadcasts.push({ type, payload }),
  };
  return { service, emissions, broadcasts };
}

await scenario('room changes immediately clear the previous room presence roster', () => {
  const { service, emissions, broadcasts } = makeDiscoveryHarness();
  service.resetForRoom('room-b');
  assert.strictEqual(service.currentRoomId, 'room-b');
  assert.strictEqual(service.onlinePeers.size, 0);
  assert.deepStrictEqual(emissions, [[]]);
  assert.strictEqual(broadcasts.at(-1).type, 'presence:ping');
  assert.ok(service.sessionStartedAt > 1);
});

await scenario('repeating the same room does not erase or re-announce presence', () => {
  const { service, emissions, broadcasts } = makeDiscoveryHarness();
  service.resetForRoom('room-a');
  assert.strictEqual(service.onlinePeers.size, 1);
  assert.strictEqual(emissions.length, 0);
  assert.strictEqual(broadcasts.length, 0);
});

await scenario('the app scopes discovery to every room-service transition', () => {
  const source = fs.readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /discoveryService\.resetForRoom\(nextRoomId\)/);
});

await scenario('DiscoveryService teardown is idempotent and releases every owned resource', () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const originalClearInterval = globalThis.clearInterval;
  const clearedTimeouts = [];
  const clearedIntervals = [];
  globalThis.clearTimeout = (id) => clearedTimeouts.push(id);
  globalThis.clearInterval = (id) => clearedIntervals.push(id);
  try {
    const { service, broadcasts } = makeDiscoveryHarness();
    let unsubscribed = 0;
    service.heartbeatTimer = 0;
    service.pruneTimer = 1;
    service.networkUnsubscribers = [() => unsubscribed++, () => unsubscribed++];
    service.destroy();
    service.destroy();
    assert.deepStrictEqual(clearedTimeouts, [0]);
    assert.deepStrictEqual(clearedIntervals, [1]);
    assert.strictEqual(unsubscribed, 2);
    assert.strictEqual(broadcasts.filter((entry) => entry.type === 'presence:leave').length, 1);
    assert.strictEqual(service.listeners.size, 0);
    assert.strictEqual(service.alertListeners.size, 0);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.clearInterval = originalClearInterval;
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeCoFocusHarness() {
  const service = Object.create(CoFocusService.prototype);
  let currentRoom = null;
  const queueJoins = [];
  const topologyListeners = [];
  let roomLeaves = 0;
  let queueLeaves = 0;

  service.state = { ...INITIAL_COFOCUS_STATE };
  service.listeners = new Set();
  service.countdownTimer = null;
  service.partnerArrivalTimer = null;
  service.unsubscribeLobby = [];
  service.unsubscribeTopology = null;
  service.unsubscribeRoom = null;
  service.unsubscribePartnerEnd = null;
  service.operationGeneration = 0;
  service.destroyed = false;
  service.completionAudioContexts = new Set();
  service.lastRequest = null;
  service.lobby = {
    leaveQueue: () => queueLeaves++,
    joinQueue: (request) => queueJoins.push(request),
  };
  service.identityService = {
    getOrCreateIdentity: async () => ({ peerId: 'me', nickname: 'Me' }),
  };
  service.roomService = {
    getCurrentRoom: () => currentRoom,
    joinCoFocusRoom: async (roomId) => {
      currentRoom = { roomId };
      return currentRoom;
    },
    leaveCurrentRoom: () => {
      roomLeaves++;
      currentRoom = null;
    },
  };
  service.network = {
    getMyIdentity: () => ({ peerId: 'me' }),
    onTopologyChange: (listener) => {
      topologyListeners.push(listener);
      return () => {};
    },
    broadcast: () => {},
  };

  return {
    service,
    queueJoins,
    topologyListeners,
    roomLeaves: () => roomLeaves,
    queueLeaves: () => queueLeaves,
    setCurrentRoom: (room) => {
      currentRoom = room;
    },
  };
}

await scenario('cancelling while identity loads cannot re-enter the CoFocus queue later', async () => {
  const pendingIdentity = deferred();
  const { service, queueJoins } = makeCoFocusHarness();
  service.identityService.getOrCreateIdentity = () => pendingIdentity.promise;

  const starting = service.startWatcher(25 * 60);
  service.cancelQueue();
  pendingIdentity.resolve({ peerId: 'me', nickname: 'Me' });
  await starting;

  assert.strictEqual(service.getState().phase, 'idle');
  assert.strictEqual(queueJoins.length, 0);
});

await scenario('a cancelled match join cannot install a partner watcher after its await', async () => {
  const pendingJoin = deferred();
  const harness = makeCoFocusHarness();
  const { service, topologyListeners } = harness;
  service.state = {
    ...INITIAL_COFOCUS_STATE,
    phase: 'queued',
    mode: 'WATCHER',
    sessionLengthSec: 1500,
  };
  service.operationGeneration = 7;
  service.roomService.joinCoFocusRoom = (_roomId) => {
    harness.setCurrentRoom({ roomId: 'room-old' });
    return pendingJoin.promise;
  };

  const matching = service.handleMatched(
    {
      roomId: 'room-old',
      partnerPeerId: 'peer-old',
      mode: 'WATCHER',
      sessionLengthSec: 1500,
    },
    7
  );
  service.cancelQueue();
  pendingJoin.resolve({ roomId: 'room-old' });
  await matching;

  assert.strictEqual(service.getState().phase, 'idle');
  assert.strictEqual(topologyListeners.length, 0);
  assert.strictEqual(service.partnerArrivalTimer, null);
});

await scenario('an explicit partner end leaves the captured room after resetting session state', () => {
  const harness = makeCoFocusHarness();
  const { service } = harness;
  let partnerEndHandler = null;
  service.state = {
    ...INITIAL_COFOCUS_STATE,
    phase: 'active',
    mode: 'TOGETHER',
    roomId: 'room-a',
  };
  harness.setCurrentRoom({ roomId: 'room-a' });
  service.network.on = (_type, handler) => {
    partnerEndHandler = handler;
    return () => {};
  };
  service.bindPartnerEndListener();

  partnerEndHandler(
    { roomId: 'room-a', reason: 'ended' },
    { from: { peerId: 'partner', nickname: 'Ada' } }
  );

  assert.strictEqual(service.getState().phase, 'idle');
  assert.match(service.getState().error, /Ada ended/);
  assert.strictEqual(harness.roomLeaves(), 1);
});

await scenario('a superseded partner-arrival timeout cannot leave or requeue a newer room', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeoutCallback = null;
  globalThis.setTimeout = (callback) => {
    timeoutCallback = callback;
    return 0;
  };
  globalThis.clearTimeout = () => {};
  try {
    const harness = makeCoFocusHarness();
    const { service, queueJoins } = harness;
    service.operationGeneration = 3;
    service.lastRequest = { mode: 'WATCHER', sessionLengthSec: 1500 };
    service.state = {
      ...INITIAL_COFOCUS_STATE,
      phase: 'matched',
      mode: 'WATCHER',
      roomId: 'room-old',
      sessionLengthSec: 1500,
      partnerPeerId: 'partner-old',
    };
    harness.setCurrentRoom({ roomId: 'room-old' });
    service.watchForPartner({ autoRequeueOnTimeout: true }, 3, 'room-old');

    service.operationGeneration = 4;
    service.state = { ...service.state, roomId: 'room-new' };
    harness.setCurrentRoom({ roomId: 'room-new' });
    timeoutCallback();

    assert.strictEqual(harness.roomLeaves(), 0);
    assert.strictEqual(queueJoins.length, 0);
    assert.strictEqual(service.getState().roomId, 'room-new');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

await scenario('a stale countdown callback cannot complete a superseding CoFocus session', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalCallback = null;
  const cleared = [];
  globalThis.setInterval = (callback) => {
    intervalCallback = callback;
    return 0;
  };
  globalThis.clearInterval = (id) => cleared.push(id);
  try {
    const { service } = makeCoFocusHarness();
    service.operationGeneration = 2;
    service.state = {
      ...INITIAL_COFOCUS_STATE,
      phase: 'active',
      mode: 'WATCHER',
      roomId: 'room-old',
      remainingSec: 1,
    };
    service.startCountdown(2, 'room-old');
    service.operationGeneration = 3;
    service.state = { ...service.state, roomId: 'room-new', remainingSec: 900 };
    intervalCallback();

    assert.deepStrictEqual(cleared, [0]);
    assert.strictEqual(service.getState().roomId, 'room-new');
    assert.strictEqual(service.getState().remainingSec, 900);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

await scenario('CoFocus teardown is idempotent and releases every subscription, timer, and audio context', async () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const originalClearInterval = globalThis.clearInterval;
  const clearedTimeouts = [];
  const clearedIntervals = [];
  globalThis.clearTimeout = (id) => clearedTimeouts.push(id);
  globalThis.clearInterval = (id) => clearedIntervals.push(id);
  try {
    const { service } = makeCoFocusHarness();
    let unsubscribed = 0;
    let audioCloses = 0;
    service.countdownTimer = 0;
    service.partnerArrivalTimer = 1;
    service.unsubscribeTopology = () => unsubscribed++;
    service.unsubscribeLobby = [() => unsubscribed++, () => unsubscribed++];
    service.unsubscribeRoom = () => unsubscribed++;
    service.unsubscribePartnerEnd = () => unsubscribed++;
    service.completionAudioContexts.add({
      close: () => {
        audioCloses++;
        return Promise.resolve();
      },
    });
    service.listeners.add(() => {});

    service.destroy();
    service.destroy();
    await Promise.resolve();

    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.deepStrictEqual(clearedTimeouts, [1]);
    assert.strictEqual(unsubscribed, 5);
    assert.strictEqual(audioCloses, 1);
    assert.strictEqual(service.listeners.size, 0);
    assert.strictEqual(service.completionAudioContexts.size, 0);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.clearInterval = originalClearInterval;
  }
});

await scenario('retired lobby sockets cannot dispatch messages or close a newer queue connection', () => {
  const OriginalWebSocket = globalThis.WebSocket;
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  globalThis.WebSocket = FakeWebSocket;
  try {
    const lobby = Object.create(LobbyService.prototype);
    lobby.ws = null;
    lobby.listeners = new Map();
    lobby.currentRequest = null;
    lobby.matched = false;
    lobby.getLobbyUrl = () => 'ws://test/ws/lobby';
    let matches = 0;
    let unexpectedCloses = 0;
    lobby.on('matched', () => matches++);
    lobby.on('closed', () => unexpectedCloses++);

    const request = (peerId) => ({ peerId, nickname: peerId, mode: 'WATCHER' });
    lobby.joinQueue(request('old'));
    const oldSocket = sockets[0];
    const staleMessage = oldSocket.onmessage;
    const staleClose = oldSocket.onclose;
    lobby.joinQueue(request('new'));
    const newSocket = sockets[1];

    staleMessage({
      data: JSON.stringify({
        type: 'lobby:matched',
        payload: { roomId: 'stale-room', partnerPeerId: 'stale-peer', mode: 'watcher' },
      }),
    });
    staleClose();

    assert.strictEqual(matches, 0);
    assert.strictEqual(unexpectedCloses, 0);
    assert.strictEqual(lobby.ws, newSocket);
    assert.strictEqual(lobby.currentRequest.peerId, 'new');
  } finally {
    globalThis.WebSocket = OriginalWebSocket;
  }
});

await scenario('LobbyService rejects malformed and cross-protocol matchmaking frames', () => {
  const lobby = Object.create(LobbyService.prototype);
  lobby.listeners = new Map();
  lobby.currentRequest = { peerId: 'peer:local', nickname: 'Local', mode: 'WATCHER' };
  lobby.matched = false;
  let closed = 0;
  let matches = 0;
  let waits = 0;
  let errors = 0;
  lobby.close = () => { closed++; };
  lobby.on('matched', () => { matches++; });
  lobby.on('waiting', () => { waits++; });
  lobby.on('error', () => { errors++; });

  lobby.handleMessage({
    type: 'lobby:matched',
    from: 'server',
    roomId: 'room:not-lobby',
    payload: { roomId: 'cofocus:12345678', partnerPeerId: 'peer:remote', mode: 'watcher' },
  });
  lobby.handleMessage({
    type: 'lobby:matched',
    from: 'server',
    roomId: 'lobby',
    payload: { roomId: '', partnerPeerId: 'peer:remote', mode: 'watcher' },
  });
  lobby.handleMessage({
    type: 'lobby:matched',
    from: 'server',
    roomId: 'lobby',
    payload: { roomId: 'cofocus:12345678', partnerPeerId: 'peer:remote', mode: 'together' },
  });
  lobby.handleMessage({
    type: 'lobby:waiting',
    from: 'server',
    roomId: 'lobby',
    payload: { mode: 'watcher', queuePosition: 0, timeoutSec: -1 },
  });

  assert.strictEqual(matches, 0);
  assert.strictEqual(waits, 0);
  assert.strictEqual(errors, 2, 'invalid match payloads should surface a bounded protocol error');
  assert.strictEqual(closed, 2);

  lobby.handleMessage({
    type: 'lobby:matched',
    from: 'server',
    roomId: 'lobby',
    payload: {
      roomId: 'cofocus:12345678',
      partnerPeerId: 'peer:remote',
      partnerNickname: 'Remote',
      mode: 'watcher',
      sessionLengthSec: 1500,
    },
  });
  assert.strictEqual(matches, 1);
  assert.strictEqual(lobby.matched, true);
});

function makeChatHarness(roomId = 'room-a', generation = 1) {
  const service = Object.create(ChatService.prototype);
  const broadcasts = [];
  const debouncedSave = () => {};
  debouncedSave.cancel = () => {};
  service.network = {
    broadcast: (type, payload) => {
      broadcasts.push({ type, payload });
      return true;
    },
  };
  service.currentRoomId = roomId;
  service.myPeerId = 'me';
  service.myNickname = 'Me';
  service.mySeq = 0;
  service.peerSeqs = new Map();
  service.lamportClock = 0;
  service.messages = [];
  service.unackedQueue = new Map();
  service.roomGeneration = generation;
  service.historyRetryTimer = null;
  service.networkUnsubscribers = [];
  service.destroyed = false;
  service.listeners = new Set();
  service.unreadCount = 0;
  service.unreadListeners = new Set();
  service.toastListeners = new Set();
  service.saveMessagesDebounced = debouncedSave;
  return { service, broadcasts };
}

await scenario('a late chat-cache read cannot disclose an old room history in the new room', async () => {
  const originalChrome = globalThis.chrome;
  const cacheRead = deferred();
  globalThis.chrome = {
    storage: {
      local: {
        get: () => cacheRead.promise,
      },
    },
  };
  try {
    const { service } = makeChatHarness('room-private', 5);
    const loading = service.loadCachedMessages('room-private', 'me', 5);
    service.currentRoomId = 'room-public';
    service.roomGeneration = 6;
    service.messages = [];
    cacheRead.resolve({
      'synqto_chat_room-private': [
        {
          id: 'secret',
          from: { peerId: 'partner', nickname: 'Partner' },
          text: 'private room message',
          timestamp: 1,
        },
      ],
    });
    await loading;

    assert.deepStrictEqual(service.messages, []);
    assert.strictEqual(service.currentRoomId, 'room-public');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('room switches cancel timer id zero and fence an already-delivered history retry', async () => {
  const originalChrome = globalThis.chrome;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 0;
  globalThis.chrome = undefined;
  globalThis.setTimeout = (callback) => {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
    timers.delete(id);
  };
  try {
    const { service, broadcasts } = makeChatHarness('', 0);
    service.init('room-a', 'me');
    const staleRetry = timers.get(0);
    service.init('room-b', 'me');
    const broadcastsAfterSwitch = broadcasts.length;
    staleRetry();
    await Promise.resolve();

    assert.deepStrictEqual(cleared, [0]);
    assert.strictEqual(broadcasts.length, broadcastsAfterSwitch);
    assert.strictEqual(service.currentRoomId, 'room-b');
    assert.strictEqual(service.historyRetryTimer, 1);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

await scenario('an already-delivered chat retry callback cannot broadcast into a newer room', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let retryCallback = null;
  globalThis.setTimeout = (callback) => {
    retryCallback = callback;
    return 0;
  };
  globalThis.clearTimeout = () => {};
  try {
    const { service, broadcasts } = makeChatHarness('room-a', 9);
    service.queueUnacked(
      { id: 'message-a', status: 'sent' },
      { id: 'message-a', text: 'must stay in A' }
    );
    service.currentRoomId = 'room-b';
    service.roomGeneration = 10;
    retryCallback();

    assert.strictEqual(broadcasts.length, 0);
    assert.strictEqual(service.unackedQueue.size, 0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

await scenario('ChatService teardown releases all room handlers and timer id zero', () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const clearedTimers = [];
  const networkHandlers = new Map();
  let unsubscribeCount = 0;
  let debounceCancelCount = 0;
  globalThis.clearTimeout = (id) => clearedTimers.push(id);

  try {
    const { service } = makeChatHarness('room-a', 4);
    service.network = {
      on: (type, handler) => {
        networkHandlers.set(type, handler);
        return () => {
          unsubscribeCount++;
        };
      },
      broadcast: () => true,
      send: () => true,
    };
    service.saveMessagesDebounced = () => {};
    service.saveMessagesDebounced.cancel = () => {
      debounceCancelCount++;
    };
    service.historyRetryTimer = 0;
    service.unackedQueue.set('pending', {
      message: { id: 'pending' },
      payload: { messageId: 'pending', text: 'pending' },
      attempts: 1,
      timer: 1,
    });
    service.listeners.add(() => {});
    service.unreadListeners.add(() => {});
    service.toastListeners.add(() => {});
    service.setupListeners();

    assert.strictEqual(service.networkUnsubscribers.length, 11);
    const retiredMessageHandler = networkHandlers.get('chat:message');
    retiredMessageHandler(
      { messageId: 'wrong-room', text: 'private' },
      {
        id: 'packet-wrong',
        roomId: 'room-b',
        from: { peerId: 'peer-b', nickname: 'Peer B' },
        timestamp: 1,
      }
    );
    assert.deepStrictEqual(service.messages, []);

    service.destroy();
    retiredMessageHandler(
      { messageId: 'retired', text: 'retired' },
      {
        id: 'packet-retired',
        roomId: 'room-a',
        from: { peerId: 'peer-a', nickname: 'Peer A' },
        timestamp: 2,
      }
    );

    assert.deepStrictEqual(service.messages, []);
    assert.deepStrictEqual(clearedTimers.sort(), [0, 1]);
    assert.strictEqual(unsubscribeCount, 11);
    assert.strictEqual(debounceCancelCount, 1);
    assert.strictEqual(service.unackedQueue.size, 0);
    assert.strictEqual(service.listeners.size, 0);
    assert.strictEqual(service.unreadListeners.size, 0);
    assert.strictEqual(service.toastListeners.size, 0);
    assert.strictEqual(service.currentRoomId, '');

    service.destroy();
    assert.strictEqual(unsubscribeCount, 11);
    assert.strictEqual(debounceCancelCount, 1);
    assert.deepStrictEqual(clearedTimers.sort(), [0, 1]);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
});

await scenario('TutorService teardown releases all subscriptions, admission waits, and media', () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const clearedTimeouts = [];
  const networkHandlers = new Map();
  const signalingHandlers = new Map();
  let remoteStreamHandler = null;
  let removedStreamHandler = null;
  let unsubscribeCount = 0;
  let admissionCancelCount = 0;
  let admissionReleaseCount = 0;
  let coordinatorReleaseCount = 0;
  let localMediaDetachCount = 0;

  const makeUnsubscribe = () => () => {
    unsubscribeCount++;
  };
  const localTrack = {
    enabled: true,
    onended: () => {},
    stopCalls: 0,
    stop() {
      this.stopCalls++;
    },
  };
  const remoteTrack = { enabled: true };
  const localStream = {
    getTracks: () => [localTrack],
  };
  const remoteStream = {
    getTracks: () => [remoteTrack],
  };
  const audioContext = {
    state: 'running',
    closeCalls: 0,
    close() {
      this.closeCalls++;
      this.state = 'closed';
      return Promise.resolve();
    },
  };
  globalThis.clearTimeout = (id) => clearedTimeouts.push(id);

  try {
    const service = Object.create(TutorService.prototype);
    service.state = {
      viewerState: 'NOT_WATCHING',
      broadcasterState: 'LIVE',
      isActive: true,
      tutorPeerId: null,
      tutorIdentity: null,
      guestSpeakers: [],
      handRaises: [],
      isMyHandRaised: false,
      myRole: 'tutor',
      isAudioLive: true,
      isVideoLive: false,
      broadcastType: 'audio',
      activeStreams: [],
    };
    service.remoteCursors = new Map();
    service.cursorListeners = new Set([() => {}]);
    service.stateListeners = new Set([() => {}]);
    service.remoteStreamListeners = new Set([() => {}]);
    service.localStream = localStream;
    service.localSourceStreams = [localStream];
    service.mixAudioContext = audioContext;
    service.remoteStreams = new Map([['peer-live', remoteStream]]);
    service.selectedStreamPeerId = 'peer-live';
    service.currentRoomId = 'room-a';
    service.startPromise = null;
    service.speakerMediaPromise = null;
    service.operationGeneration = 3;
    service.admissionHeld = true;
    service.admissionRequestPromise = null;
    service.ownedUnsubscribers = [];
    service.admissionTimeouts = new Set([0]);
    service.admissionCancellers = new Set([
      () => {
        admissionCancelCount++;
      },
    ]);
    service.destroyed = false;
    service.identityService = { getCachedIdentity: () => null };
    service.network = {
      on: (type, handler) => {
        networkHandlers.set(type, handler);
        return makeUnsubscribe();
      },
      broadcast: () => true,
      send: () => true,
      getCurrentRoomId: () => 'room-a',
    };
    service.webrtc = {
      onRemoteStream: (handler) => {
        remoteStreamHandler = handler;
        return makeUnsubscribe();
      },
      onRemoteStreamRemoved: (handler) => {
        removedStreamHandler = handler;
        return makeUnsubscribe();
      },
      setLocalMediaStream: () => {
        localMediaDetachCount++;
      },
    };
    service.signaling = {
      on: (event, handler) => {
        signalingHandlers.set(event, handler);
        return makeUnsubscribe();
      },
      releaseStreamAdmission: () => {
        admissionReleaseCount++;
      },
    };
    service.mediaCoordinator = {
      register: () => makeUnsubscribe(),
      release: (owner) => {
        assert.strictEqual(owner, 'live');
        coordinatorReleaseCount++;
      },
    };

    service.setupOwnershipListeners();
    service.setupNetworkListeners();
    service.setupWebRTCListeners();
    assert.strictEqual(service.ownedUnsubscribers.length, 13);

    const retiredCursorHandler = networkHandlers.get('canvas:cursor');
    retiredCursorHandler(
      { xPct: 10, yPct: 20 },
      { roomId: 'room-b', from: { peerId: 'peer-wrong', nickname: 'Wrong' } }
    );
    assert.strictEqual(service.remoteCursors.size, 0);

    service.destroy();
    retiredCursorHandler(
      { xPct: 30, yPct: 40 },
      { roomId: 'room-a', from: { peerId: 'peer-retired', nickname: 'Retired' } }
    );
    remoteStreamHandler('peer-retired', remoteStream);
    removedStreamHandler('peer-live');
    signalingHandlers.get('connection:change')({ connected: false });

    assert.strictEqual(unsubscribeCount, 13);
    assert.strictEqual(admissionCancelCount, 1);
    assert.deepStrictEqual(clearedTimeouts, [0]);
    assert.strictEqual(admissionReleaseCount, 1);
    assert.strictEqual(coordinatorReleaseCount, 1);
    assert.strictEqual(localMediaDetachCount, 1);
    assert.strictEqual(localTrack.stopCalls, 1);
    assert.strictEqual(audioContext.closeCalls, 1);
    assert.strictEqual(remoteTrack.enabled, false);
    assert.strictEqual(service.remoteStreams.size, 0);
    assert.strictEqual(service.remoteCursors.size, 0);
    assert.strictEqual(service.cursorListeners.size, 0);
    assert.strictEqual(service.stateListeners.size, 0);
    assert.strictEqual(service.remoteStreamListeners.size, 0);
    assert.strictEqual(service.currentRoomId, '');

    service.destroy();
    assert.strictEqual(unsubscribeCount, 13);
    assert.strictEqual(localTrack.stopCalls, 1);
    assert.strictEqual(audioContext.closeCalls, 1);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
  }
});

function whiteboardNotebook(id, strokeIds = []) {
  return {
    activePageId: id,
    pages: [
      {
        id,
        title: id,
        strokes: strokeIds.map((strokeId) => ({ id: strokeId })),
        undoStack: [],
        redoStack: [],
        background: 'grid',
        bgColor: '#090d16',
        createdAt: 1,
      },
    ],
  };
}

function makeWhiteboardHarness() {
  const service = Object.create(WhiteboardService.prototype);
  service.instanceId = 'window-me';
  service.localBus = null;
  service.privacyMode = 'collaborative';
  service.currentRoomId = '';
  service.roomGeneration = 0;
  service.collabRoomHydrated = false;
  service.collabDirtyBeforeHydration = false;
  service.personalNotebookHydrated = false;
  service.personalDirtyBeforeHydration = false;
  service.privacyModeHydrated = false;
  service.privacyModeChangedBeforeHydration = false;
  service.pendingStorageWrites = new Map();
  service.networkUnsubscribers = [];
  service.runtimeMessageListener = null;
  service.storageChangeListener = null;
  service.destroyed = false;
  service.collabNotebook = whiteboardNotebook('initial-collab');
  service.personalNotebook = whiteboardNotebook('personal-page');
  service.listeners = new Set();
  service.notebookListeners = new Set();
  service.backgroundListeners = new Set();
  service.bgColorListeners = new Set();
  service.privacyListeners = new Set();
  service.laserListeners = new Set();
  service.tempStrokeListeners = new Set();
  return service;
}

await scenario('concurrent whiteboard hydration cannot replace room B with room A or erase A with a blank placeholder', async () => {
  const originalChrome = globalThis.chrome;
  const roomARead = deferred();
  const roomBRead = deferred();
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: ([key]) =>
          key.endsWith('room-a') ? roomARead.promise : roomBRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  try {
    const service = makeWhiteboardHarness();
    const joiningA = service.setRoom('room-a');
    const joiningB = service.setRoom('room-b');

    roomBRead.resolve({
      'synqto_collab_notebook_room-b': whiteboardNotebook('page-b', ['stroke-b']),
    });
    await joiningB;
    roomARead.resolve({
      'synqto_collab_notebook_room-a': whiteboardNotebook('page-a', ['private-a']),
    });
    await joiningA;

    assert.strictEqual(service.currentRoomId, 'room-b');
    assert.strictEqual(service.collabNotebook.activePageId, 'page-b');
    assert.deepStrictEqual(
      service.collabNotebook.pages[0].strokes.map((stroke) => stroke.id),
      ['stroke-b']
    );
    assert.deepStrictEqual(writes, [], 'an unhydrated placeholder overwrote persisted room A');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('the whiteboard local bus rejects wrong-room and cross-privacy mutations', () => {
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  const channels = [];
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.posts = [];
      this.onmessage = null;
      channels.push(this);
    }
    postMessage(message) {
      this.posts.push(message);
    }
  }
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  try {
    const service = makeWhiteboardHarness();
    service.currentRoomId = 'room-b';
    service.collabNotebook = whiteboardNotebook('page-b');
    service.setupLocalBus();
    const channel = channels[0];

    channel.onmessage({
      data: {
        fromInstanceId: 'window-other',
        scope: 'collaborative',
        roomId: 'room-a',
        action: 'full_snapshot',
        notebook: whiteboardNotebook('page-a', ['private-a']),
      },
    });
    channel.onmessage({
      data: {
        fromInstanceId: 'window-other',
        scope: 'personal',
        action: 'stroke',
        pageId: 'page-b',
        stroke: { id: 'personal-stroke' },
      },
    });
    assert.strictEqual(service.collabNotebook.activePageId, 'page-b');
    assert.deepStrictEqual(service.collabNotebook.pages[0].strokes, []);

    channel.onmessage({
      data: {
        fromInstanceId: 'window-other',
        scope: 'collaborative',
        roomId: 'room-b',
        action: 'stroke',
        pageId: 'page-b',
        stroke: { id: 'valid-b' },
      },
    });
    assert.deepStrictEqual(
      service.collabNotebook.pages[0].strokes.map((stroke) => stroke.id),
      ['valid-b']
    );

    service.privacyMode = 'personal';
    service.broadcastLocal('clear', { pageId: 'page-b' }, 'collaborative');
    assert.deepStrictEqual(channel.posts.at(-1), {
      fromInstanceId: 'window-me',
      scope: 'collaborative',
      roomId: 'room-b',
      action: 'clear',
      pageId: 'page-b',
    });
  } finally {
    globalThis.BroadcastChannel = OriginalBroadcastChannel;
  }
});

await scenario('WhiteboardService teardown releases IPC, storage, and all room subscriptions', () => {
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  const originalChrome = globalThis.chrome;
  const channels = [];
  const networkHandlers = new Map();
  const runtimeListeners = [];
  const removedRuntimeListeners = [];
  const storageListeners = [];
  const removedStorageListeners = [];
  let unsubscribeCount = 0;

  class FakeBroadcastChannel {
    constructor() {
      this.onmessage = null;
      this.closeCalls = 0;
      channels.push(this);
    }
    postMessage() {}
    close() {
      this.closeCalls++;
    }
  }

  globalThis.BroadcastChannel = FakeBroadcastChannel;
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (listener) => runtimeListeners.push(listener),
        removeListener: (listener) => removedRuntimeListeners.push(listener),
      },
    },
    storage: {
      onChanged: {
        addListener: (listener) => storageListeners.push(listener),
        removeListener: (listener) => removedStorageListeners.push(listener),
      },
    },
  };

  try {
    const service = makeWhiteboardHarness();
    service.currentRoomId = 'room-a';
    service.network = {
      on: (type, handler) => {
        networkHandlers.set(type, handler);
        return () => {
          unsubscribeCount++;
        };
      },
      broadcast: () => true,
      send: () => true,
    };
    service.identityService = {
      getCachedIdentity: () => ({ peerId: 'me' }),
    };
    service.setupLocalBus();
    service.setupRuntimeMessageListener();
    service.setupStorageListener();
    service.setupNetworkListeners();

    assert.strictEqual(service.networkUnsubscribers.length, 11);
    assert.strictEqual(runtimeListeners.length, 1);
    assert.strictEqual(storageListeners.length, 1);
    const retiredBusListener = channels[0].onmessage;
    const retiredRuntimeListener = runtimeListeners[0];
    const retiredStorageListener = storageListeners[0];
    const retiredStrokeHandler = networkHandlers.get('whiteboard:stroke');

    service.destroy();
    retiredStrokeHandler(
      { pageId: 'initial-collab', stroke: { id: 'network-retired' } },
      { roomId: 'room-a', from: { peerId: 'peer-a' } }
    );
    retiredBusListener({
      data: {
        fromInstanceId: 'window-other',
        scope: 'collaborative',
        roomId: 'room-a',
        action: 'stroke',
        pageId: 'initial-collab',
        stroke: { id: 'bus-retired' },
      },
    });
    retiredRuntimeListener(
      {
        type: 'WHITEBOARD_STROKE_LOCAL',
        roomId: 'room-a',
        pageId: 'initial-collab',
        stroke: { id: 'runtime-retired' },
      },
      {},
      () => {}
    );
    retiredStorageListener(
      {
        synqto_personal_notebook: {
          newValue: whiteboardNotebook('stored-retired', ['storage-retired']),
        },
      },
      'local'
    );

    assert.deepStrictEqual(service.collabNotebook.pages[0].strokes, []);
    assert.strictEqual(service.personalNotebook.activePageId, 'personal-page');
    assert.strictEqual(unsubscribeCount, 11);
    assert.deepStrictEqual(removedRuntimeListeners, runtimeListeners);
    assert.deepStrictEqual(removedStorageListeners, storageListeners);
    assert.strictEqual(channels[0].closeCalls, 1);
    assert.strictEqual(channels[0].onmessage, null);
    assert.strictEqual(service.currentRoomId, '');

    service.destroy();
    assert.strictEqual(unsubscribeCount, 11);
    assert.strictEqual(channels[0].closeCalls, 1);
  } finally {
    globalThis.BroadcastChannel = OriginalBroadcastChannel;
    globalThis.chrome = originalChrome;
  }
});

await scenario('personal whiteboard hydration merges early drawing without first overwriting storage', async () => {
  const originalChrome = globalThis.chrome;
  const notebookRead = deferred();
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: () => notebookRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  try {
    const service = makeWhiteboardHarness();
    service.privacyMode = 'personal';
    service.personalNotebook = whiteboardNotebook('early-page');
    const loading = service.loadPersonalNotebook();

    service.personalNotebook.pages[0].strokes.push({ id: 'early-stroke' });
    service.savePersonalNotebook();
    assert.strictEqual(writes.length, 0, 'placeholder/partial personal board was saved before hydration');

    notebookRead.resolve({
      synqto_personal_notebook: whiteboardNotebook('stored-page', ['stored-stroke']),
    });
    await loading;

    const strokeIds = service.personalNotebook.pages
      .flatMap((page) => page.strokes)
      .map((stroke) => stroke.id)
      .sort();
    assert.deepStrictEqual(strokeIds, ['early-stroke', 'stored-stroke']);
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(
      writes[0].synqto_personal_notebook.pages
        .flatMap((page) => page.strokes)
        .map((stroke) => stroke.id)
        .sort(),
      ['early-stroke', 'stored-stroke']
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('a delayed privacy-mode read cannot undo the user choice made during hydration', async () => {
  const originalChrome = globalThis.chrome;
  const modeRead = deferred();
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: () => modeRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  try {
    const service = makeWhiteboardHarness();
    service.privacyMode = 'personal';
    const loading = service.loadPrivacyMode();
    service.setPrivacyMode('collaborative');
    modeRead.resolve({ synqto_whiteboard_privacy_mode: 'personal' });
    await loading;

    assert.strictEqual(service.privacyMode, 'collaborative');
    assert.strictEqual(service.privacyModeHydrated, true);
    assert.deepStrictEqual(writes.at(-1), {
      synqto_whiteboard_privacy_mode: 'collaborative',
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('timer actions made during storage hydration replay onto loaded state and timer id zero is owned', async () => {
  const originalChrome = globalThis.chrome;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const stateRead = deferred();
  const writes = [];
  const intervals = new Map();
  const cleared = [];
  let nextIntervalId = 0;
  globalThis.chrome = {
    storage: {
      local: {
        get: () => stateRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  globalThis.setInterval = (callback) => {
    const id = nextIntervalId++;
    intervals.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
    intervals.delete(id);
  };
  try {
    const service = Object.create(TimerService.prototype);
    service.config = {
      enabled: false,
      workDurationMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      autoStartBreaks: false,
      soundAlerts: true,
    };
    service.state = {
      mode: 'pomodoro',
      timeLeftSec: 1500,
      targetDurationSec: 1500,
      isRunning: false,
      sessionsCompleted: 0,
      lastUpdated: 1,
    };
    service.intervalId = null;
    service.listeners = new Set();
    service.initialized = false;
    service.pendingActions = [];
    service.destroyed = false;
    service.activeAudioContexts = new Set();

    const initializing = service.initialize();
    service.setMode('stopwatch');
    service.updateConfig({ soundAlerts: false });
    assert.strictEqual(service.state.mode, 'pomodoro');

    stateRead.resolve({
      synqto_pomodoro_config: {
        enabled: true,
        workDurationMin: 40,
        shortBreakMin: 7,
        longBreakMin: 20,
        autoStartBreaks: true,
        soundAlerts: true,
      },
      synqto_pomodoro_state: {
        mode: 'pomodoro',
        timeLeftSec: 1200,
        targetDurationSec: 2400,
        isRunning: false,
        sessionsCompleted: 3,
        lastUpdated: 2,
      },
    });
    await initializing;

    assert.strictEqual(service.state.mode, 'stopwatch');
    assert.strictEqual(service.state.timeLeftSec, 0);
    assert.strictEqual(service.state.sessionsCompleted, 3);
    assert.strictEqual(service.config.workDurationMin, 40);
    assert.strictEqual(service.config.soundAlerts, false);
    assert.strictEqual(service.intervalId, 0);
    assert.ok(writes.some((value) => value.synqto_pomodoro_state?.mode === 'stopwatch'));
    assert.ok(writes.some((value) => value.synqto_pomodoro_config?.soundAlerts === false));

    service.startTickLoop();
    assert.deepStrictEqual(cleared, [0]);
    assert.strictEqual(service.intervalId, 1);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

await scenario('TimerService teardown releases storage, timer id zero, and completion audio', async () => {
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const addedStorageListeners = [];
  const removedStorageListeners = [];
  const clearedIntervals = [];
  const contexts = [];

  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.oscillators = [];
      this.closeCalls = 0;
      contexts.push(this);
    }

    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
        onended: null,
      };
      this.oscillators.push(oscillator);
      return oscillator;
    }

    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      };
    }

    close() {
      this.closeCalls++;
      return Promise.resolve();
    }
  }

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: () => Promise.resolve(),
      },
      onChanged: {
        addListener: (listener) => addedStorageListeners.push(listener),
        removeListener: (listener) => removedStorageListeners.push(listener),
      },
    },
  };
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = (id) => clearedIntervals.push(id);

  try {
    const service = new TimerService();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(service.intervalId, 0);
    assert.strictEqual(addedStorageListeners.length, 1);

    service.playCompletionChime();
    assert.strictEqual(contexts.length, 1);
    contexts[0].oscillators.slice(0, 3).forEach((oscillator) => oscillator.onended());
    assert.strictEqual(contexts[0].closeCalls, 0);
    contexts[0].oscillators[3].onended();
    assert.strictEqual(contexts[0].closeCalls, 1);

    service.playCompletionChime();
    const savedConfig = service.config.workDurationMin;
    service.destroy();
    addedStorageListeners[0](
      { synqto_pomodoro_config: { newValue: { workDurationMin: 99 } } },
      'local'
    );

    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.deepStrictEqual(removedStorageListeners, addedStorageListeners);
    assert.strictEqual(contexts[1].closeCalls, 1);
    assert.strictEqual(service.activeAudioContexts.size, 0);
    assert.strictEqual(service.config.workDurationMin, savedConfig);

    service.destroy();
    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.deepStrictEqual(removedStorageListeners, addedStorageListeners);
    assert.strictEqual(contexts[1].closeCalls, 1);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.window = originalWindow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

await scenario('theme changes made during storage hydration merge with rather than overwrite saved customization', () => {
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  let storageCallback = null;
  const writes = [];
  globalThis.window = undefined;
  globalThis.chrome = {
    storage: {
      local: {
        get: (_keys, callback) => {
          storageCallback = callback;
        },
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  try {
    const service = Object.create(ThemeService.prototype);
    service.settings = { ...DEFAULT_THEME_SETTINGS };
    service.listeners = new Set();
    service.mediaQuery = null;
    service.initialized = false;
    service.pendingInitializationPatch = null;
    service.destroyed = false;
    service.applyAllSettings = () => {};

    service.init();
    service.updateSettings({ fontSize: 18, highContrast: true });
    assert.strictEqual(writes.length, 0, 'default settings were saved before hydration');
    storageCallback({
      synqto_theme_custom_settings: {
        ...DEFAULT_THEME_SETTINGS,
        mode: 'light',
        density: 'compact',
        fontSize: 12,
      },
    });

    assert.strictEqual(service.settings.mode, 'light');
    assert.strictEqual(service.settings.density, 'compact');
    assert.strictEqual(service.settings.fontSize, 18);
    assert.strictEqual(service.settings.highContrast, true);
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].synqto_theme_custom_settings.fontSize, 18);
    assert.strictEqual(writes[0].synqto_theme_custom_settings.density, 'compact');
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.window = originalWindow;
  }
});

await scenario('ThemeService teardown releases its stable system-theme listener exactly once', () => {
  const service = Object.create(ThemeService.prototype);
  let removed = 0;
  const handler = () => {};
  service.destroyed = false;
  service.handleSystemThemeChange = handler;
  service.mediaQuery = {
    removeEventListener: (type, listener) => {
      assert.strictEqual(type, 'change');
      assert.strictEqual(listener, handler);
      removed++;
    },
  };
  service.pendingInitializationPatch = { mode: 'dark' };
  service.listeners = new Set([() => {}]);

  service.destroy();
  service.destroy();

  assert.strictEqual(removed, 1);
  assert.strictEqual(service.mediaQuery, null);
  assert.strictEqual(service.pendingInitializationPatch, null);
  assert.strictEqual(service.listeners.size, 0);
});

await scenario('IdentityService keeps the latest storage identity and retires its stable listener', async () => {
  const originalChrome = globalThis.chrome;
  const identityRead = deferred();
  const addedListeners = [];
  const removedListeners = [];
  const writes = [];
  const newestIdentity = {
    peerId: 'peer-newest',
    nickname: 'Newest',
    avatar: '🦊',
    color: '#6366f1',
  };
  const staleIdentity = {
    peerId: 'peer-stale',
    nickname: 'Stale',
    avatar: '🦉',
    color: '#8b5cf6',
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: () => identityRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (listener) => addedListeners.push(listener),
        removeListener: (listener) => removedListeners.push(listener),
      },
    },
  };

  try {
    const service = Object.create(IdentityService.prototype);
    service.currentIdentity = null;
    service.provisionalIdentity = null;
    service.initPromise = null;
    service.listeners = new Set();
    service.storageChangeListener = null;
    service.operationGeneration = 0;
    service.identityRevision = 0;
    service.destroyed = false;
    const observed = [];
    service.listeners.add((identity) => observed.push(identity.peerId));
    service.setupStorageListener();

    const loading = service.getOrCreateIdentity();
    const retiredListener = addedListeners[0];
    retiredListener(
      { synqto_identity: { newValue: newestIdentity } },
      'local'
    );
    identityRead.resolve({ synqto_identity: staleIdentity });
    const resolved = await loading;

    assert.strictEqual(resolved.peerId, newestIdentity.peerId);
    assert.strictEqual(service.currentIdentity.peerId, newestIdentity.peerId);
    assert.deepStrictEqual(observed, [newestIdentity.peerId]);
    assert.deepStrictEqual(writes, []);

    service.destroy();
    retiredListener(
      {
        synqto_identity: {
          newValue: { ...staleIdentity, peerId: 'peer-retired' },
        },
      },
      'local'
    );

    assert.deepStrictEqual(removedListeners, addedListeners);
    assert.strictEqual(service.currentIdentity.peerId, newestIdentity.peerId);
    assert.deepStrictEqual(observed, [newestIdentity.peerId]);
    assert.strictEqual(service.listeners.size, 0);

    service.destroy();
    assert.deepStrictEqual(removedListeners, addedListeners);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('GamificationService teardown releases heartbeat id zero and queued work', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let heartbeat = null;
  const cleared = [];
  globalThis.setInterval = (callback) => {
    heartbeat = callback;
    return 0;
  };
  globalThis.clearInterval = (id) => cleared.push(id);

  try {
    const service = Object.create(GamificationService.prototype);
    service.stats = {
      currentStreak: 0,
      longestStreak: 0,
      totalDaysActive: 0,
      totalProblemsSolved: 0,
      totalFocusMinutes: 0,
      lastActiveDate: '',
      activityMap: {},
    };
    service.badges = {};
    service.listeners = new Set([() => {}]);
    service.initialized = true;
    service.pendingActions = [() => {}];
    service.focusHeartbeat = null;
    service.destroyed = false;

    service.startFocusHeartbeat();
    assert.strictEqual(service.focusHeartbeat, 0);
    service.destroy();
    heartbeat();

    assert.deepStrictEqual(cleared, [0]);
    assert.strictEqual(service.stats.totalFocusMinutes, 0);
    assert.strictEqual(service.pendingActions.length, 0);
    assert.strictEqual(service.listeners.size, 0);

    service.destroy();
    assert.deepStrictEqual(cleared, [0]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

await scenario('GroupService hydration waits and replays early problem registration onto stored groups', async () => {
  const originalChrome = globalThis.chrome;
  let storageCallback = null;
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: (_keys, callback) => {
          storageCallback = callback;
        },
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };

  try {
    const service = Object.create(GroupService.prototype);
    service.groups = [];
    service.listeners = new Set();
    service.initialized = false;
    service.initializationPromise = null;
    service.pendingMutations = [];
    service.destroyed = false;
    let settled = false;
    const loading = service.getGroups().then((groups) => {
      settled = true;
      return groups;
    });

    service.registerProblemGroup({
      platform: 'LeetCode',
      slug: 'two-sum',
      title: 'Two Sum',
      canonicalUrl: 'https://leetcode.com/problems/two-sum/',
      roomId: 'problem:leetcode:two-sum',
    });
    await Promise.resolve();
    assert.strictEqual(settled, false, 'getGroups resolved before storage hydration');
    assert.strictEqual(service.groups.length, 0);
    assert.strictEqual(service.pendingMutations.length, 1);

    storageCallback({
      synqto_saved_groups: [
        {
          id: 'stored-group',
          name: 'Stored Squad',
          slug: 'stored-squad',
          avatar: '🚀',
          isPrivate: false,
          topicTag: 'General',
          roomId: 'group:stored',
          createdAt: 1,
        },
      ],
    });
    const groups = await loading;

    assert.strictEqual(groups.length, 2);
    assert.ok(groups.some((group) => group.id === 'stored-group'));
    assert.ok(groups.some((group) => group.roomId === 'problem:leetcode:two-sum'));
    assert.ok(writes.some((value) =>
      value.synqto_saved_groups?.some((group) => group.id === 'stored-group') &&
      value.synqto_saved_groups?.some((group) => group.roomId === 'problem:leetcode:two-sum')
    ));
    assert.strictEqual(service.pendingMutations.length, 0);

    service.destroy();
    assert.strictEqual(service.listeners.size, 0);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

function diaryEntry(id, content) {
  return {
    id,
    title: id,
    content,
    tags: [],
    mood: 'productive',
    createdAt: 1,
    updatedAt: 1,
  };
}

function diaryBook(title, entries) {
  return {
    id: 'diary-a',
    title,
    icon: '📓',
    color: '#6366f1',
    entries,
    createdAt: 1,
    updatedAt: 1,
  };
}

await scenario('diary edits and deletes made during hydration replay without erasing untouched saved entries', async () => {
  const originalChrome = globalThis.chrome;
  const diaryRead = deferred();
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: () => diaryRead.promise,
        set: (value) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    },
  };
  try {
    const service = Object.create(DiaryService.prototype);
    service.state = {
      activeDiaryId: 'diary-a',
      activeEntryId: 'entry-edit',
      diaries: [
        diaryBook('Placeholder title', [
          diaryEntry('entry-edit', 'placeholder'),
          diaryEntry('entry-delete', 'visible before hydration'),
        ]),
      ],
    };
    service.listeners = new Set();
    service.hydrated = false;
    service.dirtyBeforeHydration = false;
    service.touchedDiaryIds = new Set();
    service.createdDiaryIds = new Set();
    service.deletedDiaryIds = new Set();
    service.touchedEntryKeys = new Set();
    service.createdEntryKeys = new Set();
    service.deletedEntryKeys = new Set();

    const loading = service.loadFromStorage();
    service.updateEntry('diary-a', 'entry-edit', { content: 'early user edit' });
    service.deleteEntry('diary-a', 'entry-delete');
    assert.strictEqual(writes.length, 0, 'partial diary snapshot was persisted before hydration');

    diaryRead.resolve({
      synqto_diaries_v1: {
        activeDiaryId: 'diary-a',
        activeEntryId: 'entry-other',
        diaries: [
          diaryBook('Persisted title', [
            diaryEntry('entry-edit', 'stored version'),
            diaryEntry('entry-delete', 'stored deletion target'),
            diaryEntry('entry-other', 'untouched saved entry'),
          ]),
        ],
      },
    });
    await loading;

    const diary = service.state.diaries[0];
    assert.strictEqual(diary.title, 'Persisted title');
    assert.strictEqual(diary.entries.find((entry) => entry.id === 'entry-edit').content, 'early user edit');
    assert.strictEqual(diary.entries.some((entry) => entry.id === 'entry-delete'), false);
    assert.strictEqual(diary.entries.find((entry) => entry.id === 'entry-other').content, 'untouched saved entry');
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(
      writes[0].synqto_diaries_v1.diaries[0].entries.map((entry) => entry.id).sort(),
      ['entry-edit', 'entry-other']
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

await scenario('notification eviction owns timer id zero and bounds dedupe history', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 0;
  globalThis.setTimeout = (callback) => {
    const id = nextTimerId++;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
    timers.delete(id);
  };
  try {
    const service = Object.create(NotificationService.prototype);
    service.items = [];
    service.listeners = new Set();
    service.timers = new Map();
    service.lastShown = new Map();

    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(service.notify('info', `notice-${i}`, undefined, 5000));
    }
    assert.strictEqual(service.items.length, 4);
    assert.strictEqual(service.timers.size, 4);
    assert.deepStrictEqual(cleared, [0]);
    assert.strictEqual(service.timers.has(ids[0]), false);

    service.dismiss(ids[1]);
    assert.deepStrictEqual(cleared, [0, 1]);
    for (let i = 0; i < 150; i++) service.notify('error', `unique-error-${i}`);
    assert.ok(service.lastShown.size <= 100);
    assert.strictEqual(service.items.length, 4);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

function makeCodeHarness() {
  const service = Object.create(CodeService.prototype);
  const broadcasts = [];
  service.state = {
    code: 'print("old room")',
    language: 'python',
    version: 1,
    lastEditedBy: 'Me',
    lastEditedAt: 1,
    activeCursors: [],
    isRunning: false,
    lastResult: null,
  };
  service.currentRoomId = 'room-a';
  service.roomGeneration = 1;
  service.runGeneration = 0;
  service.latestRemoteRunIds = new Map();
  service.listeners = new Set();
  service.networkUnsubscribers = [];
  service.cursorCleanInterval = null;
  service.destroyed = false;
  service.identityService = {
    getMyIdentity: () => ({ peerId: 'me', nickname: 'Me' }),
  };
  service.network = {
    broadcast: (type, payload) => {
      broadcasts.push({ type, payload });
      return true;
    },
  };
  service.broadcastToContentTabs = () => {};
  return { service, broadcasts };
}

await scenario('a code execution finishing after a room switch cannot publish into the new room', async () => {
  const pendingRun = deferred();
  const { service, broadcasts } = makeCodeHarness();
  service.simulateLanguageExecution = () => pendingRun.promise;

  const running = service.runCode();
  service.setRoom('room-b');
  pendingRun.resolve({
    stdout: 'old room result',
    executionTimeMs: 600,
    status: 'success',
    executedAt: 2,
  });
  await running;

  assert.strictEqual(service.currentRoomId, 'room-b');
  assert.strictEqual(service.state.lastResult, null);
  assert.strictEqual(service.state.isRunning, false);
  assert.strictEqual(
    broadcasts.filter((entry) => entry.type === 'code:run_result').length,
    0
  );
});

await scenario('a slower earlier code run cannot overwrite a newer run result', async () => {
  const first = deferred();
  const second = deferred();
  const { service, broadcasts } = makeCodeHarness();
  let invocation = 0;
  service.simulateLanguageExecution = () => (invocation++ === 0 ? first.promise : second.promise);

  const firstRun = service.runCode();
  service.state.code = 'print("newer")';
  const secondRun = service.runCode();
  second.resolve({
    stdout: 'newer result',
    executionTimeMs: 100,
    status: 'success',
    executedAt: 3,
  });
  await secondRun;
  first.resolve({
    stdout: 'stale result',
    executionTimeMs: 900,
    status: 'success',
    executedAt: 4,
  });
  await firstRun;

  assert.strictEqual(service.state.lastResult.stdout, 'newer result');
  const results = broadcasts.filter((entry) => entry.type === 'code:run_result');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].payload.stdout, 'newer result');
});

await scenario('remote code results must match the latest correlated run from that peer', () => {
  const { service } = makeCodeHarness();
  const handlers = new Map();
  service.network = {
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {};
    },
    send: () => true,
    broadcast: () => true,
  };
  service.setupNetworkListeners();
  const packet = {
    roomId: 'room-a',
    from: { peerId: 'peer-a', nickname: 'Ada' },
  };

  handlers.get('code:run')(
    { runId: 'run-1', code: 'first', language: 'python', initiatedBy: 'Ada' },
    packet
  );
  handlers.get('code:run')(
    { runId: 'run-2', code: 'second', language: 'python', initiatedBy: 'Ada' },
    packet
  );
  handlers.get('code:run_result')(
    { runId: 'run-1', stdout: 'stale', executionTimeMs: 500, status: 'success' },
    packet
  );
  assert.strictEqual(service.state.isRunning, true);
  assert.strictEqual(service.state.lastResult, null);

  handlers.get('code:run_result')(
    { runId: 'run-2', stdout: 'latest', executionTimeMs: 100, status: 'success' },
    packet
  );
  assert.strictEqual(service.state.isRunning, false);
  assert.strictEqual(service.state.lastResult.stdout, 'latest');
  assert.strictEqual(service.latestRemoteRunIds.size, 0);
});

await scenario('CodeService teardown releases subscriptions, runtime relay, and timer id zero', () => {
  const { service } = makeCodeHarness();
  const handlers = new Map();
  const removedRuntimeListeners = [];
  const clearedIntervals = [];
  let unsubscribeCount = 0;
  let runtimeMutations = 0;
  const originalChrome = globalThis.chrome;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const runtimeListener = () => {
    if (!service.destroyed) runtimeMutations++;
  };

  service.handleRuntimeMessage = runtimeListener;
  service.network = {
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {
        unsubscribeCount++;
      };
    },
    send: () => true,
    broadcast: () => true,
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: () => {},
        removeListener: (listener) => removedRuntimeListeners.push(listener),
      },
    },
  };
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = (id) => clearedIntervals.push(id);

  try {
    service.setupNetworkListeners();
    service.setupContentScriptRelay();
    service.startCursorCleanup();
    assert.strictEqual(service.networkUnsubscribers.length, 6);
    assert.strictEqual(service.cursorCleanInterval, 0);

    const retiredDelta = handlers.get('code:delta');
    const initialCode = service.state.code;
    service.destroy();
    retiredDelta(
      { code: 'retired mutation', language: 'python', version: 2 },
      { roomId: 'room-a', from: { peerId: 'peer-z', nickname: 'Zed' } }
    );
    runtimeListener();

    assert.strictEqual(service.state.code, initialCode);
    assert.strictEqual(runtimeMutations, 0);
    assert.strictEqual(unsubscribeCount, 6);
    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.deepStrictEqual(removedRuntimeListeners, [runtimeListener]);
    assert.strictEqual(service.networkUnsubscribers.length, 0);

    service.destroy();
    assert.strictEqual(unsubscribeCount, 6);
    assert.deepStrictEqual(clearedIntervals, [0]);
    assert.deepStrictEqual(removedRuntimeListeners, [runtimeListener]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

console.log(`\n${passed}/${total} lifecycle scenarios passed`);
if (failures.length) process.exitCode = 1;
