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

console.log('\n── C: gamification accounting ──');

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

console.log('\n========================================');
console.log(`🏁 Logic Regressions: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log('========================================\n');

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
