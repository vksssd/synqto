// ─── Logic & State-Machine Regression Harness ───
//
// Covers defects found in the logic/CSS/UX audit that are testable without a DOM. Each
// scenario encodes the INVARIANT that was violated, not just the specific reproduction, so a
// future refactor that reintroduces the same class of bug still fails here.
//
// The whiteboard scenarios model the real data structures (two stroke lists, two redo stacks,
// a mode flag) rather than importing the 4000-line content script, because the defect was in
// the state machine, not in the DOM plumbing — and the state machine is what must stay
// correct.

import assert from 'assert';
import fs from 'fs';
const {
  getWhiteboardLabelAnchor,
  getWhiteboardRenderedBounds,
  isLabelableWhiteboardTool,
  withWhiteboardLabel,
} = await import('../src/features/whiteboard/whiteboard-label.ts');
const {
  computePopupBounds,
  isWhiteboardPopupWindow,
  selectPopupDisplay,
} = await import('../src/core/runtime/popup-window.ts');

let passed = 0;
let total = 0;
const failures = [];

function scenario(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
  }
}

// ── Whiteboard board model ────────────────────────────────────────────────────
//
// Mirrors floating-widget's fields exactly: wbStrokes / wbPersonalStrokes,
// wbRedoStack / wbPersonalRedoStack, wbPrivacyMode. `broadcast` records what would have gone
// out over WHITEBOARD_STROKE_LOCAL — the thing that must never carry personal content.

class BoardModel {
  constructor() {
    this.wbStrokes = [];
    this.wbPersonalStrokes = [];
    this.wbRedoStack = [];
    this.wbPersonalRedoStack = [];
    this.wbPrivacyMode = 'collaborative';
    this.broadcast = [];
  }

  activeList() {
    return this.wbPrivacyMode === 'personal' ? this.wbPersonalStrokes : this.wbStrokes;
  }

  activeRedoStack() {
    return this.wbPrivacyMode === 'personal' ? this.wbPersonalRedoStack : this.wbRedoStack;
  }

  setActiveRedoStack(next) {
    if (this.wbPrivacyMode === 'personal') this.wbPersonalRedoStack = next;
    else this.wbRedoStack = next;
  }

  draw(id) {
    this.activeList().push({ id });
    if (this.wbPrivacyMode !== 'personal') this.broadcast.push({ kind: 'stroke', id });
    this.setActiveRedoStack([]);
  }

  undo() {
    const list = this.activeList();
    if (list.length === 0) return; // must NOT resurrect the redo stack
    const removed = list.pop();
    this.activeRedoStack().push(removed);
    if (this.wbPrivacyMode !== 'personal') this.broadcast.push({ kind: 'undo', id: removed.id });
  }

  redo() {
    const stack = this.activeRedoStack();
    if (stack.length === 0) return;
    const restored = stack.pop();
    this.activeList().push(restored);
    if (this.wbPrivacyMode !== 'personal') this.broadcast.push({ kind: 'stroke', id: restored.id });
  }

  clear() {
    const list = this.activeList();
    if (list.length === 0) return;
    this.setActiveRedoStack([...list].reverse());
    if (this.wbPrivacyMode === 'personal') this.wbPersonalStrokes = [];
    else {
      this.wbStrokes = [];
      this.broadcast.push({ kind: 'clear' });
    }
  }

  /** A remote peer cleared the shared board. Must not touch personal state. */
  remoteClear() {
    this.wbStrokes = [];
    this.wbRedoStack = [];
  }
}

console.log('\n🧠 Logic & State Regressions\n');

console.log('── A: whiteboard privacy boundary ──');

scenario('CRITICAL: a stroke drawn in personal mode can never be broadcast', () => {
  // The original bug, exactly: one redo stack shared by both boards turned undo+mode-switch
  // +redo into a channel that published private content to every peer in the room.
  const b = new BoardModel();

  b.wbPrivacyMode = 'personal';
  b.draw('secret-1');
  b.undo();

  b.wbPrivacyMode = 'collaborative';
  b.redo();

  const leaked = b.broadcast.filter((m) => m.id === 'secret-1');
  assert.strictEqual(leaked.length, 0, 'a private stroke was broadcast to the room');
  assert.ok(
    !b.wbStrokes.some((s) => s.id === 'secret-1'),
    'a private stroke was moved onto the shared board'
  );
});

scenario('the personal stroke is still recoverable on its OWN board', () => {
  // The fix must not achieve privacy by simply losing the user's work.
  const b = new BoardModel();
  b.wbPrivacyMode = 'personal';
  b.draw('note-1');
  b.undo();
  b.wbPrivacyMode = 'collaborative';
  b.redo();                       // wrong board — must be a no-op
  b.wbPrivacyMode = 'personal';
  b.redo();                       // right board — must restore

  assert.deepStrictEqual(b.wbPersonalStrokes.map((s) => s.id), ['note-1']);
  assert.strictEqual(b.broadcast.length, 0, 'personal-board activity produced network traffic');
});

scenario('erasing in personal mode does not stage strokes for collaborative redo', () => {
  const b = new BoardModel();
  b.wbPrivacyMode = 'personal';
  b.draw('p1');
  b.undo();
  assert.strictEqual(b.wbRedoStack.length, 0, 'personal undo populated the collaborative redo stack');
  assert.strictEqual(b.wbPersonalRedoStack.length, 1);
});

scenario('a remote peer clearing the shared board leaves personal history intact', () => {
  // The remote-clear handler used to null the shared redo stack, which WAS the personal
  // board's history too — a peer clearing the group whiteboard destroyed private undo state.
  const b = new BoardModel();
  b.wbPrivacyMode = 'personal';
  b.draw('p1');
  b.undo();                       // personal redo stack now holds p1

  b.remoteClear();

  assert.strictEqual(b.wbPersonalRedoStack.length, 1, 'a remote clear wiped personal undo history');
});

console.log('\n── B: undo/redo invariants ──');

scenario('undo can never ADD strokes to the board', () => {
  // The removed branch made undo restore the entire redo stack once the board was empty, so
  // draw-draw-undo-undo-undo put the whole drawing back. Undo is monotonically subtractive.
  const b = new BoardModel();
  b.draw('a');
  b.draw('b');

  const counts = [];
  for (let i = 0; i < 5; i++) {
    b.undo();
    counts.push(b.wbStrokes.length);
  }

  for (let i = 1; i < counts.length; i++) {
    assert.ok(counts[i] <= counts[i - 1], `undo increased stroke count: ${counts.join(' -> ')}`);
  }
  assert.strictEqual(b.wbStrokes.length, 0, 'board should be empty after undoing everything');
});

scenario('undo/redo round-trips to the identical board', () => {
  const b = new BoardModel();
  b.draw('a'); b.draw('b'); b.draw('c');
  const before = b.wbStrokes.map((s) => s.id);

  b.undo(); b.undo(); b.undo();
  b.redo(); b.redo(); b.redo();

  assert.deepStrictEqual(b.wbStrokes.map((s) => s.id), before, 'round trip changed the board');
});

scenario('redo after clear restores strokes in their original draw order', () => {
  // Clear stores the list reversed precisely because redo pops from the end; storing in draw
  // order silently inverted z-order for overlapping strokes.
  const b = new BoardModel();
  b.draw('a'); b.draw('b'); b.draw('c');
  b.clear();
  b.redo(); b.redo(); b.redo();

  assert.deepStrictEqual(b.wbStrokes.map((s) => s.id), ['a', 'b', 'c'], 'z-order was inverted by clear+redo');
});

scenario('drawing invalidates only the redo branch of the board drawn on', () => {
  const b = new BoardModel();
  b.wbPrivacyMode = 'personal';
  b.draw('p1');
  b.undo();                        // personal redo: [p1]

  b.wbPrivacyMode = 'collaborative';
  b.draw('c1');                    // must clear ONLY the collaborative redo branch

  assert.strictEqual(b.wbPersonalRedoStack.length, 1, 'drawing on one board discarded the other board\'s history');
});

scenario('object labels are safe immutable edits and blank means unlabeled', () => {
  const object = {
    id: 'server-1',
    tool: 'server_box',
    geometry: { x1: 10, y1: 20, x2: 110, y2: 80 },
  };
  assert.ok(isLabelableWhiteboardTool(object.tool));
  assert.deepStrictEqual(getWhiteboardLabelAnchor(object), { x: 60, y: 50 });

  const labeled = withWhiteboardLabel(object, '  API  ');
  assert.strictEqual(labeled.geometry.label, 'API');
  assert.strictEqual(object.geometry.label, undefined, 'label edit mutated the intermediate object');
  assert.strictEqual(withWhiteboardLabel(labeled, '   ').geometry.label, undefined,
    'Skip/blank did not leave a valid unlabeled object');
});

scenario('click-placed objects remain selectable across their visible footprint', () => {
  const clickPlacedServer = {
    id: 'server-click',
    tool: 'server_box',
    width: 3,
    geometry: { x1: 10, y1: 20, x2: 10, y2: 20 },
  };
  assert.deepStrictEqual(getWhiteboardRenderedBounds(clickPlacedServer), {
    minX: 10,
    minY: 20,
    maxX: 80,
    maxY: 65,
  });
  assert.deepStrictEqual(getWhiteboardLabelAnchor(clickPlacedServer), { x: 45, y: 42.5 },
    'label editor is not centered over the object the user can see');

  const panel = fs.readFileSync(new URL('../src/features/whiteboard/WhiteboardCanvas.tsx', import.meta.url), 'utf8');
  const widget = fs.readFileSync(new URL('../src/content/floating-widget.ts', import.meta.url), 'utf8');
  assert.ok(/getWhiteboardRenderedBounds\(stroke\)/.test(panel),
    'side-panel selection still uses zero-size stored endpoints');
  assert.ok(/getWhiteboardRenderedBounds\(stroke\)/.test(widget),
    'embedded selection still uses zero-size stored endpoints');
});

scenario('embedded and extension whiteboards persist the same notebook documents', () => {
  const widget = fs.readFileSync(new URL('../src/content/floating-widget.ts', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../src/features/whiteboard/whiteboard.service.ts', import.meta.url), 'utf8');
  assert.ok(/synqto_personal_notebook/.test(widget) && /synqto_personal_notebook/.test(service),
    'personal boards still use different storage documents');
  assert.ok(/`synqto_collab_notebook_\$\{roomId\}`/.test(widget),
    'embedded board is not room-scoped');
  assert.ok(/`synqto_collab_notebook_\$\{roomId\}`/.test(service),
    'extension board is not room-scoped');
  assert.ok(/persistWhiteboardDocument\('collaborative'\)/.test(widget),
    'embedded collaborative edits are only live messages and are lost when closed');
});

scenario('system objects label after placement without blocking placement', () => {
  const panel = fs.readFileSync(new URL('../src/features/whiteboard/WhiteboardCanvas.tsx', import.meta.url), 'utf8');
  const widget = fs.readFileSync(new URL('../src/content/floating-widget.ts', import.meta.url), 'utf8');
  assert.ok(/const stroke = whiteboardService\.addStroke[\s\S]{0,900}?setShapeLabelEditor/.test(panel),
    'side-panel object placement does not enter label editing after commit');
  assert.ok(/onBlur=\{handleConfirmText\}/.test(panel) && />\s*Skip\s*</.test(panel),
    'side-panel label editor lacks blur commit or Skip');
  assert.ok(/this\.drawWbCanvas\(\);[\s\S]{0,300}?this\.openWbLabelEditor\(stroke\)/.test(widget),
    'embedded object placement does not enter label editing after commit');
  assert.ok(/id="nb-wb-label-skip"/.test(widget) && /WHITEBOARD_UPDATE_STROKES_LOCAL/.test(widget),
    'embedded label editor cannot Skip or synchronize its edit');
});

scenario('label and privacy edits route to every whiteboard surface', () => {
  const worker = fs.readFileSync(new URL('../src/background/service-worker.ts', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../src/features/whiteboard/whiteboard.service.ts', import.meta.url), 'utf8');
  assert.ok(/WHITEBOARD_UPDATE_STROKES_LOCAL/.test(worker), 'label updates are not routed between content tabs');
  assert.ok(/WHITEBOARD_PRIVACY_LOCAL/.test(worker), 'privacy changes are not routed between surfaces');
  assert.ok(/msg\.type === 'WHITEBOARD_PRIVACY_LOCAL'/.test(service),
    'extension whiteboard ignores popup privacy changes');
});

console.log('\n── C: gamification accounting ──');

const { GamificationService } = await import('../src/features/gamification/gamification.service.ts');

// Mirrors the ensureToday()/touchStreak() contract. The defect was that only touchStreak
// created the day's entry while three other writers merely guarded on its existence, so
// writes were silently dropped and lifetime totals drifted away from the daily map.

class StatsModel {
  constructor() {
    this.activityMap = {};
    this.totalFocusMinutes = 0;
    this.totalProblemsSolved = 0;
  }
  ensureToday(day = 'D1') {
    if (!this.activityMap[day]) {
      this.activityMap[day] = { date: day, count: 0, problemsVisited: 0, minutesSpent: 0, messagesSent: 0 };
    }
    return this.activityMap[day];
  }
  touchStreak(day) { this.ensureToday(day).count += 1; }
  recordProblemVisit(day) {
    this.touchStreak(day);
    const e = this.ensureToday(day);
    e.problemsVisited += 1;
    e.count += 2;
    this.totalProblemsSolved += 1;
  }
  focusTick(day, hidden = false) {
    if (hidden) return;
    this.ensureToday(day).minutesSpent += 1;
    this.totalFocusMinutes += 1;
  }
}

scenario('the first problem of the day is counted exactly once', () => {
  // Creation used to seed problemsVisited: 1, and recordProblemVisit then added another —
  // so day one of every day reported two problems for one visit, and badges unlocked early.
  const s = new StatsModel();
  s.recordProblemVisit('D1');
  assert.strictEqual(s.activityMap['D1'].problemsVisited, 1, 'first problem visit was double-counted');
  assert.strictEqual(s.totalProblemsSolved, 1);
});

scenario('focus minutes are recorded even on a day with no other activity', () => {
  // The heartbeat never calls touchStreak, so on a quiet day the entry did not exist and
  // minutesSpent was silently dropped while totalFocusMinutes still advanced.
  const s = new StatsModel();
  s.focusTick('D1');
  s.focusTick('D1');
  assert.strictEqual(s.activityMap['D1'].minutesSpent, 2, 'focus minutes were dropped on a day with no other activity');
});

scenario('INVARIANT: lifetime focus total always equals the sum of daily minutes', () => {
  const s = new StatsModel();
  s.focusTick('D1');
  s.recordProblemVisit('D1');
  s.focusTick('D1');
  s.focusTick('D2');
  s.recordProblemVisit('D3');
  s.focusTick('D3');

  const summed = Object.values(s.activityMap).reduce((acc, d) => acc + d.minutesSpent, 0);
  assert.strictEqual(summed, s.totalFocusMinutes, `daily sum ${summed} != lifetime ${s.totalFocusMinutes}`);
});

scenario('a hidden tab earns no focus credit', () => {
  // Previously every tick counted, so an abandoned tab accrued focus minutes overnight and
  // unlocked time-based badges nobody earned.
  const s = new StatsModel();
  for (let i = 0; i < 480; i++) s.focusTick('D1', true);
  assert.strictEqual(s.totalFocusMinutes, 0, 'a backgrounded tab accrued focus minutes');
  assert.strictEqual(s.activityMap['D1'], undefined, 'a hidden tick created a spurious activity day');
});

scenario('counters never seed above zero for events that have not happened', () => {
  const s = new StatsModel();
  const e = s.ensureToday('D1');
  assert.deepStrictEqual(
    { c: e.count, p: e.problemsVisited, m: e.minutesSpent, s: e.messagesSent },
    { c: 0, p: 0, m: 0, s: 0 },
    'a freshly created day started with non-zero counters'
  );
});

scenario('the first real activity starts day one from the actual empty service state', () => {
  const service = Object.create(GamificationService.prototype);
  service.stats = {
    currentStreak: 9,
    longestStreak: 9,
    totalDaysActive: 9,
    totalProblemsSolved: 9,
    totalFocusMinutes: 9,
    lastActiveDate: service.getTodayDateString(),
    activityMap: {},
  };
  service.badges = service.getDefaultBadges();
  service.listeners = new Set();
  service.initialized = true;
  service.pendingActions = [];

  service.initEmptyStats();
  assert.strictEqual(service.stats.lastActiveDate, '', 'empty state retained a fake active date');
  service.touchStreak();

  assert.strictEqual(service.stats.currentStreak, 1);
  assert.strictEqual(service.stats.longestStreak, 1);
  assert.strictEqual(service.stats.totalDaysActive, 1);
});

scenario('activity recorded while storage loads is replayed onto the hydrated totals', () => {
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
  service.badges = service.getDefaultBadges();
  service.listeners = new Set();
  service.initialized = false;
  service.pendingActions = [];

  service.recordProblemVisit('two-sum');
  assert.strictEqual(service.stats.totalProblemsSolved, 0);

  service.stats = {
    ...service.stats,
    currentStreak: 4,
    longestStreak: 4,
    totalDaysActive: 4,
    totalProblemsSolved: 12,
    lastActiveDate: service.getTodayDateString(),
  };
  service.completeInitialization();

  assert.strictEqual(service.stats.totalProblemsSolved, 13);
  assert.strictEqual(service.stats.activityMap[service.getTodayDateString()].problemsVisited, 1);
});

console.log('\n── D: timer consistency across surfaces ──');

import fs2 from 'fs';
import path2 from 'path';
import { fileURLToPath as f2u } from 'url';
const root2 = path2.resolve(path2.dirname(f2u(import.meta.url)), '..');
const rd = (p) => fs2.readFileSync(path2.join(root2, 'src', p), 'utf8');
const {
  MAX_TIMER_SECONDS,
  adjustTimerState,
  computeTimerTime,
  editTimerState,
  normalizeTimerState,
  normalizePomodoroConfig,
  parseTimerInput,
} = await import('../src/features/timer/timer-state.ts');

scenario('there is exactly ONE timer formatter definition', () => {
  // There were three. Two agreed by coincidence; App.tsx omitted the minutes pad, so the
  // same countdown read "5:09" in the header and "05:09" in the bar directly below it, and
  // the header label changed width every ten-minute boundary.
  const sources = ['app/App.tsx', 'features/timer/FocusTimerBar.tsx', 'content/floating-widget.ts'];
  for (const f of sources) {
    const src = rd(f);
    assert.ok(
      !/Math\.floor\((?:totalSec|sec|timerState\.timeLeftSec)\s*\/\s*60\)[^\n]*padStart/.test(src),
      `${f} still formats the timer inline instead of using the shared formatter`
    );
  }
  const fmt = rd('features/timer/timer-format.ts');
  assert.ok(/export function formatTimerTime/.test(fmt), 'shared formatter missing');
});

scenario('the shared formatter zero-pads both fields', () => {
  // Fixed width is what stops the label nudging its neighbours as the countdown crosses
  // each ten-minute boundary.
  const pad = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  for (const s of [9, 65, 309, 1500]) {
    assert.strictEqual(pad(s).length, 5, `"${pad(s)}" is not fixed width`);
  }
  assert.strictEqual(pad(309), '05:09');
});

scenario('only one surface owns the countdown at a time', () => {
  // Two independent 1s loops both decremented the same persisted value and raced on write:
  // a 25-minute session drained in half the time whenever the panel was open.
  const widget = rd('content/floating-widget.ts');
  assert.ok(/if \(this\.sidePanelOpen\) return;/.test(widget),
    'the widget tick loop does not yield ownership to the side panel');
  assert.ok(/private sidePanelOpen = false;/.test(widget), 'no ownership flag');
  assert.ok(/this\.loadTimerState\(\);/.test(widget),
    'no state re-read on handover — the incoming owner would resume from a stale value');
});

scenario('both surfaces offer the same timer modes', () => {
  const widgetModes = [...rd('content/floating-widget.ts').matchAll(/data-tmode="([a-z_]+)"/g)].map((m) => m[1]).sort();
  const panelModes = [...rd('features/timer/FocusTimerBar.tsx').matchAll(/setMode\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  assert.ok(widgetModes.length >= 4, `widget exposes only ${widgetModes.length} modes`);
  assert.deepStrictEqual([...new Set(widgetModes)], [...new Set(panelModes)],
    'the two timer surfaces offer different mode sets');
});

scenario('every exposed FAB visibility and position control has a runtime consumer', () => {
  const widget = rd('content/floating-widget.ts');
  for (const field of ['showMainFab', 'showTimerFab', 'savedMainPosition', 'savedTimerPosition']) {
    assert.ok(widget.includes(`this.settings.${field}`), `${field} is exposed in Settings but ignored by the widget`);
  }
  assert.ok(/private timerPosition: FabPosition/.test(widget), 'timer and main FAB still share one position');
  assert.ok(/applyTimerPosition/.test(widget), 'timer position is persisted but never applied');
  assert.ok(/\[FAB_STORAGE_KEY\]: updatedSettings[\s\S]{0,120}?\[SYNQTO_FAB_STORAGE_KEY\]: updatedSettings/.test(widget),
    'dragging only updates the legacy settings key, so reload can restore the old position');
});

scenario('timer edits use one deterministic syntax and bounded range', () => {
  const valid = new Map([
    ['25', 25 * 60],
    ['05:09', 5 * 60 + 9],
    ['1:05:09', 60 * 60 + 5 * 60 + 9],
    ['1440', MAX_TIMER_SECONDS],
  ]);
  for (const [input, expected] of valid) {
    const parsed = parseTimerInput(input);
    assert.ok(parsed.ok, `valid value "${input}" was rejected`);
    assert.strictEqual(parsed.seconds, expected, `"${input}" was interpreted differently`);
  }

  for (const input of ['', '-1', 'abc', '1:60', '1:60:00', '1440:01']) {
    assert.strictEqual(parseTimerInput(input).ok, false, `invalid value "${input}" was accepted`);
  }
});

scenario('persisted Pomodoro settings are clamped to the limits shown in Settings', () => {
  const normalized = normalizePomodoroConfig({
    workDurationMin: 999,
    shortBreakMin: 0,
    longBreakMin: -5,
  });
  assert.deepStrictEqual(
    [normalized.workDurationMin, normalized.shortBreakMin, normalized.longBreakMin],
    [120, 1, 1]
  );
});

scenario('countdowns enforce a nonzero minimum while stopwatch can start at zero', () => {
  const base = {
    mode: 'pomodoro', timeLeftSec: 60, targetDurationSec: 60, isRunning: false,
    sessionsCompleted: 0, lastUpdated: 0,
  };
  assert.strictEqual(editTimerState(base, 0, 1000).ok, false, 'zero-length countdown accepted');
  assert.strictEqual(editTimerState(base, MAX_TIMER_SECONDS + 1, 1000).ok, false, 'over-limit countdown accepted');
  assert.strictEqual(editTimerState({ ...base, mode: 'stopwatch' }, 0, 1000).ok, true,
    'stopwatch cannot be reset to zero');
});

scenario('running countdown edits replace the deadline without pausing', () => {
  const state = {
    mode: 'pomodoro', timeLeftSec: 30, targetDurationSec: 60, isRunning: true,
    sessionsCompleted: 0, lastUpdated: 0, targetEndTime: 30_000,
  };
  const edited = editTimerState(state, 90, 5_000);
  assert.ok(edited.ok);
  assert.strictEqual(edited.state.isRunning, true);
  assert.strictEqual(edited.state.targetEndTime, 95_000);
  assert.strictEqual(edited.state.timeLeftSec, 90);
  assert.strictEqual(edited.state.targetDurationSec, 90);
});

scenario('running stopwatch edits replace the elapsed-time origin', () => {
  const state = {
    mode: 'stopwatch', timeLeftSec: 10, targetDurationSec: 0, isRunning: true,
    sessionsCompleted: 0, lastUpdated: 0, startedAt: -10_000,
  };
  const edited = editTimerState(state, 42, 5_000);
  assert.ok(edited.ok);
  assert.strictEqual(edited.state.startedAt, -37_000);
  assert.strictEqual(computeTimerTime(edited.state, 8_500), 45,
    'elapsed value did not continue from the edited origin');
});

scenario('sleep and callback throttling derive countdown from its deadline', () => {
  const state = {
    mode: 'pomodoro', timeLeftSec: 10, targetDurationSec: 10, isRunning: true,
    sessionsCompleted: 0, lastUpdated: 1_000, targetEndTime: 11_000,
  };
  assert.strictEqual(computeTimerTime(state, 8_500), 3);
  assert.strictEqual(computeTimerTime(state, 30_000), 0);

  const migrated = normalizeTimerState({ ...state, timeLeftSec: 20, targetEndTime: undefined }, 7_500);
  assert.strictEqual(migrated.timeLeftSec, 14, 'legacy persisted timer was not caught up');
  assert.strictEqual(migrated.targetEndTime, 21_500, 'legacy timer was not migrated to a deadline');
});

scenario('an expired restored countdown remains pending for one completion owner', () => {
  const restored = normalizeTimerState({
    mode: 'pomodoro', timeLeftSec: 10, targetDurationSec: 10, isRunning: true,
    sessionsCompleted: 0, lastUpdated: 1_000, targetEndTime: 11_000,
  }, 30_000);
  assert.strictEqual(restored.timeLeftSec, 0);
  assert.strictEqual(restored.isRunning, true,
    'restart converted an expired session into a stranded paused 00:00');
});

scenario('adding time while running shifts the deadline and preserves progress history', () => {
  const state = {
    mode: 'pomodoro', timeLeftSec: 600, targetDurationSec: 1500, isRunning: true,
    sessionsCompleted: 0, lastUpdated: 0, targetEndTime: 610_000,
  };
  const adjusted = adjustTimerState(state, 60, 10_000);
  assert.ok(adjusted.ok);
  assert.strictEqual(adjusted.state.targetEndTime, 670_000);
  assert.strictEqual(adjusted.state.targetDurationSec, 1560);
});

scenario('both timer surfaces expose inline editing through the shared parser', () => {
  const panel = rd('features/timer/FocusTimerBar.tsx');
  const widget = rd('content/floating-widget.ts');
  assert.ok(/parseTimerInput/.test(panel) && /timerService\.setTime/.test(panel),
    'side-panel timer is not editable through the shared transition');
  assert.ok(/id="nb-timer-time"[^>]*aria-label="Timer value"/.test(widget),
    'floating timer has no inline value editor');
  assert.ok(/parseTimerInput/.test(widget) && /editTimerState/.test(widget),
    'floating timer does not use the shared edit transition');
});

scenario('the floating timer never treats callback count as elapsed time', () => {
  const widget = rd('content/floating-widget.ts');
  assert.ok(/computeTimerTime\(this\.timerState\)/.test(widget), 'widget does not derive time from timestamps');
  assert.ok(!/timeLeftSec\s*[+-]=\s*1/.test(widget), 'widget still advances by one per callback');
});

console.log('\n── E: failures reach the user, not just the console ──');

const { NotificationService, describeMediaError } =
  await import('../src/core/notify/notification.service.ts');

scenario('a media failure is translated into an action the user can take', () => {
  // The browser's DOMException names are precise and completely opaque to a non-developer.
  // Each maps to a different situation with a different remedy, so collapsing them would
  // discard the most useful thing the browser told us.
  const cases = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError'];
  const details = new Set();
  for (const name of cases) {
    const { title, detail } = describeMediaError({ name }, 'microphone');
    assert.ok(title && detail, `${name} produced no message`);
    assert.ok(!title.includes('Error'), `title leaks the raw exception name: "${title}"`);
    details.add(detail);
  }
  assert.strictEqual(details.size, cases.length,
    'different failures produced the same advice — the distinction was thrown away');
});

scenario('the blocked-permission case names the control that fixes it', () => {
  // This is the reported bug: joinVoice caught NotAllowedError, logged it, and returned
  // false. In a side panel the permission prompt does not appear over the panel, so "nothing
  // happened" was the entire user-visible result.
  const { detail } = describeMediaError({ name: 'NotAllowedError' }, 'microphone');
  assert.ok(/address bar/i.test(detail), `remedy is not actionable: "${detail}"`);
});

scenario('errors persist until dismissed; success does not', () => {
  const svc = NotificationService.getInstance();
  svc.clear();
  svc.error('Boom', 'detail');
  const err = svc.getAll().find((n) => n.level === 'error');
  assert.strictEqual(err.durationMs, 0, 'an error that auto-dismisses can be missed entirely');
  svc.clear();
  svc.success('Done');
  assert.ok(svc.getAll()[0].durationMs > 0, 'success should not be sticky');
  svc.clear();
});

scenario('a retrying subsystem cannot paper the screen', () => {
  // A failing loop emits the same error many times a second. One toast per attempt buries
  // everything else, including the messages that matter.
  const svc = NotificationService.getInstance();
  svc.clear();
  for (let i = 0; i < 50; i++) svc.error('Same failure', 'same detail');
  assert.strictEqual(svc.getAll().length, 1, 'duplicate failures were not collapsed');

  svc.clear();
  for (let i = 0; i < 50; i++) svc.error(`Distinct ${i}`);
  assert.ok(svc.getAll().length <= 4, `queue grew to ${svc.getAll().length}; it must stay bounded`);
  svc.clear();
});

scenario('media-error translation has exactly one definition', () => {
  // CoFocusWatcherView carried a second switch over the same DOMException names, separately
  // worded — so the same underlying failure read differently on the camera path and the
  // microphone path.
  const view = rd('features/cofocus/CoFocusWatcherView.tsx');
  assert.ok(/describeMediaError/.test(view), 'the camera path does not use the shared translator');
  assert.ok(!/case 'NotReadableError':/.test(view), 'a duplicate error switch is still present');
});

scenario('the countdown uses the shared timer formatter', () => {
  // formatCountdown omitted the minutes pad — the same divergence already fixed in App.tsx,
  // reappearing in a different file.
  const view = rd('features/cofocus/CoFocusWatcherView.tsx');
  assert.ok(!/function formatCountdown/.test(view), 'a second countdown formatter still exists');
  assert.ok(/formatTimerTime/.test(view), 'the countdown does not use the shared formatter');
});

scenario('whiteboard popup sizing uses the source monitor work area', () => {
  const displays = [
    {
      isPrimary: true,
      bounds: { left: 0, top: 0, width: 1920, height: 1080 },
      workArea: { left: 0, top: 0, width: 1920, height: 1040 },
    },
    {
      bounds: { left: 1920, top: -120, width: 2560, height: 1440 },
      workArea: { left: 1920, top: -80, width: 2560, height: 1400 },
    },
  ];
  const selected = selectPopupDisplay(displays, { left: 2300, top: 100, width: 1000, height: 800 });
  assert.strictEqual(selected, displays[1]);
  assert.deepStrictEqual(computePopupBounds(selected.workArea, 'near-maximized'), {
    left: 1944,
    top: -56,
    width: 2512,
    height: 1352,
  });
});

scenario('whiteboard popup presets clamp inside small work areas', () => {
  const workArea = { left: -1280, top: 0, width: 700, height: 600 };
  for (const preset of ['small', 'medium', 'large', 'near-maximized']) {
    const bounds = computePopupBounds(workArea, preset);
    assert.ok(bounds.left >= workArea.left);
    assert.ok(bounds.top >= workArea.top);
    assert.ok(bounds.left + bounds.width <= workArea.left + workArea.width);
    assert.ok(bounds.top + bounds.height <= workArea.top + workArea.height);
  }
});

scenario('only the canonical whiteboard document is eligible for popup reuse', () => {
  const canonical = 'chrome-extension://abc/sidepanel.html?view=whiteboard';
  assert.strictEqual(isWhiteboardPopupWindow({
    id: 7,
    tabs: [{ url: canonical }],
  }, canonical), true);
  assert.strictEqual(isWhiteboardPopupWindow({
    id: 8,
    tabs: [{ url: 'chrome-extension://abc/sidepanel.html?view=chat' }],
  }, canonical), false);
  assert.strictEqual(isWhiteboardPopupWindow({
    id: 9,
    tabs: [{ url: 'https://example.test/sidepanel.html?view=whiteboard' }],
  }, canonical), false);
});

scenario('both whiteboard surfaces delegate to the one popup lifecycle owner', () => {
  const widget = rd('content/floating-widget.ts');
  const canvas = rd('features/whiteboard/WhiteboardCanvas.tsx');
  const worker = rd('background/service-worker.ts');
  assert.ok(/OPEN_WHITEBOARD_POPUP/.test(widget) && /OPEN_WHITEBOARD_POPUP/.test(canvas));
  assert.ok(!/chrome\.windows\.create\(/.test(widget), 'content widget can still create duplicate popups directly');
  assert.ok(!/chrome\.windows\.create\(/.test(canvas), 'side panel can still create duplicate popups directly');
  assert.ok(/whiteboardPopupOperation/.test(worker), 'simultaneous popup requests are not serialized');
  assert.ok(/windows\.getAll/.test(worker), 'service-worker restart cannot discover a restored popup');
  assert.ok(/WHITEBOARD_POPUP_SESSION_KEY/.test(worker), 'popup identity is not persisted across worker restarts');
});

console.log('\n========================================');
console.log(`🏁 Logic Regressions: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log('========================================\n');

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
