// ─── Icon system + version consistency harness ───
//
// Two classes of defect are covered here, both of which are invisible to tsc and to every
// other suite:
//
//   1. A toolbar button that renders an icon id with no matching <symbol> produces an EMPTY
//      button — <use href="#missing"> fails silently, so the control is still clickable and
//      still occupies space but shows nothing. A typo in an icon id is therefore a blank
//      toolbar, not a crash.
//   2. An icon-only control with no accessible name is unusable to a screen reader and
//      unidentifiable to anyone who does not recognise the glyph. Since the whole point of
//      the responsive collapse is to REMOVE the visible label, the accessible name stops
//      being a nicety and becomes the only remaining name.

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderIconSprite, icon, toolButton, ICON_BUTTON_CSS } from '../src/content/tool-icons.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const widgetSrc = fs.readFileSync(path.join(root, 'src', 'content', 'floating-widget.ts'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'src', 'app', 'App.tsx'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'SettingsCard.tsx'), 'utf8');
const chatInputSrc = fs.readFileSync(path.join(root, 'src', 'features', 'chat', 'ChatInput.tsx'), 'utf8');
const roomViewSrc = fs.readFileSync(path.join(root, 'src', 'features', 'room', 'ProblemRoomChatView.tsx'), 'utf8');
const timerBarSrc = fs.readFileSync(path.join(root, 'src', 'features', 'timer', 'FocusTimerBar.tsx'), 'utf8');
const sprite = renderIconSprite();
const definedIds = new Set([...sprite.matchAll(/<symbol id="nb-i-([a-z-]+)"/g)].map((m) => m[1]));

console.log('\n🎨 Icon System & Version Consistency\n');

console.log('── A: every referenced icon resolves ──');

scenario('no toolbar references an icon id that has no symbol', () => {
  // The failure this prevents is silent: <use> pointing at a missing id renders nothing.
  const referenced = new Set();
  for (const m of widgetSrc.matchAll(/icon\('([a-z-]+)'/g)) referenced.add(m[1]);
  for (const m of widgetSrc.matchAll(/icon:\s*'([a-z-]+)'/g)) referenced.add(m[1]);
  for (const m of widgetSrc.matchAll(/iconId:\s*'([a-z-]+)'/g)) referenced.add(m[1]);

  assert.ok(referenced.size > 30, `only found ${referenced.size} icon references — the scan is not matching`);

  const missing = [...referenced].filter((id) => !definedIds.has(id));
  assert.deepStrictEqual(missing, [], `icon ids with no <symbol>: ${missing.join(', ')}`);
});

scenario('every symbol in the sprite has drawable geometry', () => {
  // An id can exist with an empty body, which renders just as blank as a missing one.
  for (const id of definedIds) {
    const body = sprite.match(new RegExp(`<symbol id="nb-i-${id}" viewBox="0 0 24 24">(.*?)</symbol>`))?.[1] ?? '';
    assert.ok(/<(path|circle|rect|ellipse|line|polygon)\b/.test(body), `symbol "${id}" has no drawable element`);
    assert.ok(body.length > 10, `symbol "${id}" body looks empty: ${body}`);
  }
});

scenario('sprite ids are unique', () => {
  const ids = [...sprite.matchAll(/<symbol id="nb-i-([a-z-]+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, new Set(ids).size, 'duplicate symbol ids would shadow each other');
});

console.log('\n── B: accessible names survive the icon-only collapse ──');

scenario('toolButton always emits both title and aria-label', () => {
  const html = toolButton({ iconId: 'trash', label: 'Delete', title: 'Delete (Del)' });
  assert.ok(html.includes('title="Delete (Del)"'), 'missing title');
  assert.ok(html.includes('aria-label="Delete (Del)"'), 'missing aria-label');
  assert.ok(html.includes('nb-btn-label'), 'label span missing — nothing to collapse');
});

scenario('an active tool is announced via aria-pressed, not colour alone', () => {
  assert.ok(toolButton({ iconId: 'pen', label: 'Pen', title: 'Pen', active: true }).includes('aria-pressed="true"'));
  assert.ok(!toolButton({ iconId: 'pen', label: 'Pen', title: 'Pen', active: false }).includes('aria-pressed'));
});

scenario('every icon-bearing button in the widget has an accessible name', () => {
  // Icon-only controls are the ones that MUST have a name; scan the real markup rather than
  // trusting the helper, since several buttons are hand-written.
  const buttons = widgetSrc.match(/<button[^>]*>\$\{icon\(/g) || [];
  // Only the hand-written buttons are counted here; everything built through toolButton() is
  // covered by the helper's own scenario above. The floor exists to catch the scan silently
  // matching nothing after a refactor — not to assert a particular button count, which would
  // just be a number to update every time a control is added.
  assert.ok(buttons.length >= 5, `icon-button scan matched only ${buttons.length} — the regex has gone stale`);
  const unnamed = buttons.filter((b) => !/aria-label=/.test(b));
  assert.deepStrictEqual(unnamed, [], `icon buttons lacking aria-label:\n${unnamed.join('\n')}`);
});

scenario('drawer toggles expose open state machine-readably', () => {
  // The ▲/▼ caret was the only open/closed signal and it was part of the label, so it
  // disappeared exactly when the panel got too narrow to show labels.
  assert.ok(/aria-expanded=/.test(widgetSrc), 'no aria-expanded on drawer toggles');
});

scenario('React icon-only room and chat controls have explicit names', () => {
  assert.ok(/aria-label="Join custom room"/.test(roomViewSrc), 'custom-room arrow button is unnamed');
  assert.ok(/aria-label="Attach image, screenshot, code, poll, quiz, or file"/.test(chatInputSrc),
    'attachment button is unnamed');
  assert.ok(/aria-label="Send message"/.test(chatInputSrc), 'chat send button is unnamed');
});

scenario('settings switches expose their purpose to assistive technology', () => {
  const requiredLabels = [
    'Enable custom color palette',
    'Enable high contrast mode',
    'Show main Synqto floating button',
    'Show focus timer floating button',
    'Show Code Together dock',
    'Enable Pomodoro and timer bar',
    'Play audio chime when session completes',
  ];
  for (const label of requiredLabels) {
    assert.ok(settingsSrc.includes(`aria-label="${label}"`), `settings checkbox is unnamed: ${label}`);
  }
});

scenario('settings accordion headers are keyboard-operable disclosure controls', () => {
  const headers = settingsSrc.match(/className="glass-card-header"/g) || [];
  const roles = settingsSrc.match(/className="glass-card-header"[\s\S]{0,300}?role="button"/g) || [];
  const expanded = settingsSrc.match(/className="glass-card-header"[\s\S]{0,300}?aria-expanded=/g) || [];
  const keyboard = settingsSrc.match(/className="glass-card-header"[\s\S]{0,500}?onKeyDown=/g) || [];
  assert.ok(headers.length >= 6, `expected all settings disclosure headers, found ${headers.length}`);
  assert.strictEqual(roles.length, headers.length, 'a settings disclosure has no button role');
  assert.strictEqual(expanded.length, headers.length, 'a settings disclosure has no expanded state');
  assert.strictEqual(keyboard.length, headers.length, 'a settings disclosure cannot be toggled from the keyboard');
});

scenario('timer icon controls expose actions and disclosure state', () => {
  assert.ok(/aria-label="Reset timer"/.test(timerBarSrc), 'timer reset icon is unnamed');
  assert.ok(/aria-label=\{isExpanded \? 'Hide timer modes' : 'Show timer modes'\}/.test(timerBarSrc),
    'timer mode caret exposes only its glyph');
  assert.ok(/aria-expanded=\{isExpanded\}/.test(timerBarSrc), 'timer mode disclosure does not expose state');
});

scenario('signaling controls and status expose the configured endpoint accurately', () => {
  assert.ok(settingsSrc.includes('aria-label="Signaling server WebSocket URL"'),
    'the signaling URL input is named as a field, not merely by its default value');
  assert.ok(settingsSrc.includes('aria-label="Save signaling server URL and connect"'),
    'the signaling save action is unnamed');
  assert.ok(!settingsSrc.includes('Save &amp; Connect'),
    'React text contains a literal HTML entity instead of an ampersand');
  assert.ok(/signalingService\.getServerUrl\(\)/.test(appSrc),
    'the side-panel status still reports a hard-coded endpoint');
  assert.ok(/this\.escapeHtml\(this\.serverUrl\)/.test(widgetSrc),
    'the in-page status does not render the configured endpoint safely');
  assert.ok(!appSrc.includes('Connected (wss://synqto-server.onrender.com/ws/)'),
    'the side-panel status falsely claims the production endpoint');
  assert.ok(!widgetSrc.includes('Connected (wss://synqto-server.onrender.com/ws/)'),
    'the in-page status falsely claims the production endpoint');
});

console.log('\n── C: the responsive collapse is wired correctly ──');

scenario('collapse is driven by a container query, not a media query', () => {
  // The panel width is user-chosen and unrelated to the viewport: a 420px panel on a 2560px
  // display must still collapse. A media query would read the display.
  assert.ok(ICON_BUTTON_CSS.includes('@container'), 'no container query');
  assert.ok(ICON_BUTTON_CSS.includes('container-type: inline-size'), 'no container established');
  assert.ok(
    !/@media[^{]*max-width/.test(ICON_BUTTON_CSS),
    'a viewport media query would collapse on the wrong measurement'
  );
});

scenario('a non-container-query fallback exists', () => {
  assert.ok(ICON_BUTTON_CSS.includes('.nb-compact'), 'no explicit compact fallback class');
  assert.ok(widgetSrc.includes("classList.toggle('nb-compact'"), 'fallback class is never applied');
});

scenario('every toolstrip that collapses declares itself a container', () => {
  const strips = (widgetSrc.match(/class="nb-toolstrip/g) || []).length;
  assert.ok(strips >= 4, `only ${strips} toolstrips marked — drawers would not collapse`);
});

scenario('keyboard focus on toolbar buttons is visible', () => {
  assert.ok(ICON_BUTTON_CSS.includes(':focus-visible'), 'no focus indicator for keyboard users');
});

console.log('\n── D: SVG-bearing controls are never rewritten as text ──');

scenario('no handler assigns textContent to a button holding an icon', () => {
  // Assigning textContent to a button whose child is an <svg> deletes the icon permanently.
  // This is the regression the icon migration itself introduced in the drawer toggles.
  const offenders = [];
  for (const m of widgetSrc.matchAll(/(\w+)\.textContent\s*=/g)) {
    const target = m[1];
    if (/^(btns?|toggle|btn)$/i.test(target)) offenders.push(m[0]);
  }
  assert.deepStrictEqual(offenders, [], `textContent written to icon buttons: ${offenders.join(', ')}`);
  assert.ok(
    !/btns\.(shapes|dsa|arch|themes)\.textContent/.test(widgetSrc),
    'drawer toggles still rewrite textContent, which erases their icon'
  );
});

console.log('\n── E: version consistency ──');

scenario('package.json, manifest.json and version.ts agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const man = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.json'), 'utf8')).version;
  const ts = fs.readFileSync(path.join(root, 'src', 'core', 'version.ts'), 'utf8')
    .match(/FALLBACK_VERSION\s*=\s*'([^']+)'/)[1];
  assert.strictEqual(pkg, man, `package.json ${pkg} != manifest.json ${man}`);
  assert.strictEqual(pkg, ts, `package.json ${pkg} != version.ts ${ts}`);
});

scenario('no stale hardcoded version survives in the UI', () => {
  const settings = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'SettingsCard.tsx'), 'utf8');
  assert.ok(!/v?0\.2\.0/.test(settings), 'SettingsCard still contains the stale 0.2.0 literal');
  assert.ok(/getDisplayVersion\(\)|getAppVersion\(\)/.test(settings), 'SettingsCard does not read the real version');
});

scenario('the packaging script refuses to invent a version', () => {
  const pkgScript = fs.readFileSync(path.join(root, 'scripts', 'package.mjs'), 'utf8');
  assert.ok(!/let version = '0\.2\.0\.0'/.test(pkgScript), 'packager still defaults to a fabricated version');
  assert.ok(/process\.exit\(1\)/.test(pkgScript), 'packager does not fail on a missing version');
});

scenario('release aliases use only the real Synqto artifact identity', () => {
  const pkgScript = fs.readFileSync(path.join(root, 'scripts', 'package.mjs'), 'utf8');
  assert.ok(!/0\.0\.0\.0|synqme-|nerd-buddy-/i.test(pkgScript),
    'packager still emits fabricated-version or legacy-brand aliases');
  assert.ok(/synqto-v\$\{version4\}\.zip/.test(pkgScript), 'four-part Synqto release alias is missing');
  assert.ok(/synqto-v\$\{version3\}\.zip/.test(pkgScript), 'three-part Synqto release alias is missing');
  assert.ok(/synqto-latest\.zip/.test(pkgScript), 'stable Synqto latest alias is missing');
});

scenario('the packaging script does not depend on a shell-specific archive module', () => {
  const pkgScript = fs.readFileSync(path.join(root, 'scripts', 'package.mjs'), 'utf8');
  const executableSource = pkgScript.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/powershell\s+-Command|Compress-Archive/.test(executableSource),
    'Windows packaging still depends on the legacy PowerShell Archive module');
  assert.ok(/execFileSync\('tar\.exe',\s*\[/.test(pkgScript),
    'Windows packaging does not use an argument-safe native archive command');
  assert.ok(/execFileSync\('zip',\s*\[/.test(pkgScript),
    'Unix packaging does not use an argument-safe archive command');
});

console.log('\n── F: stylesheet cache must not collide ──');

scenario('CRITICAL: the style cache key is the stylesheet, not its length', () => {
  // The cache key was `styleHtml.length + ':' + contentMode`. Every boolean toggle
  // interpolated into that stylesheet switches between two CSS keywords of the SAME length,
  // so the key never changed and the stylesheet was never re-injected:
  //
  //   isOpen      'flex'                     vs 'none'                      4 = 4
  //   isNearTop   'top: 52px; bottom: auto;' vs 'bottom: 52px; top: auto;' 24 = 24
  //   isNearLeft  'left: 0; right: auto;'    vs 'right: 0; left: auto;'    21 = 21
  //
  // User-visible result: the in-page popup could not be opened or closed, and dragging the
  // FAB to another corner never flipped the popup to the opposite side.
  assert.ok(
    !/lastStyleSignature\s*=\s*styleHtml\.length/.test(widgetSrc),
    'style cache still keyed on length — same-length state changes will be invisible again'
  );
  assert.ok(
    /styleHtml\s*!==\s*this\.lastStyleSignature/.test(widgetSrc),
    'style cache does not compare the full stylesheet'
  );
});

scenario('popup visibility is a class, not a value baked into the stylesheet', () => {
  // Even with a correct cache key, re-parsing ~50KB of CSS to toggle a panel is the wrong
  // mechanism for the highest-frequency state change in the widget.
  assert.ok(/\.popup-card\.is-open\s*\{\s*display:\s*flex/.test(widgetSrc),
    'no .is-open rule — visibility is still stylesheet-driven');
  assert.ok(/class="popup-card \$\{this\.isOpen \? 'is-open' : ''\}"/.test(widgetSrc),
    'markup does not apply the is-open class');
  assert.ok(!/display:\s*\$\{this\.isOpen \? 'flex' : 'none'\}/.test(widgetSrc),
    'stylesheet still interpolates isOpen');
});

console.log('\n── G: theme + responsive nav ──');

scenario('the in-page popup follows the theme instead of hardcoding midnight', () => {
  // The side panel used theme vars while the popup hardcoded rgba(15,23,42,…), so picking
  // Day Light or Espresso restyled one surface and not the other.
  // Extracted by line range, NOT by /\{[^}]*\}/ — the rule body contains template-literal
  // interpolations (`${isNearTop ? … }`), so a naive brace match stops at the first `}`
  // inside one of those and never reaches the declarations being asserted on.
  const lines = widgetSrc.split('\n');
  const start = lines.findIndex((l) => /^\s*\.popup-card \{/.test(l));
  assert.ok(start !== -1, 'could not locate the .popup-card rule');
  const end = lines.findIndex((l, i) => i > start && /^\s{8}\}/.test(l));
  const popupRule = lines.slice(start, end).join('\n');
  assert.ok(/var\(--bg-card\)/.test(popupRule), 'popup-card does not use the theme surface token');
  assert.ok(!/rgba\(15,\s*23,\s*42/.test(popupRule), 'popup-card still hardcodes a dark surface');
});

scenario('primary navigation collapses to icons on a narrow panel', () => {
  assert.ok(/nb-navstrip/.test(ICON_BUTTON_CSS), 'no nav container defined');
  assert.ok(/nb-nav-label/.test(ICON_BUTTON_CSS), 'no collapsible nav label rule');
  assert.ok(/class="tab-switcher nb-navstrip"/.test(widgetSrc), 'tab strip is not a query container');
  assert.ok(/nb-nav-label/.test(widgetSrc), 'tab labels are not wrapped for collapse');
});

scenario('tabs keep an accessible name once their label is hidden', () => {
  const tabs = widgetSrc.match(/<button class="tab-btn[^>]*>/g) || [];
  assert.ok(tabs.length >= 2, `expected the tab buttons, found ${tabs.length}`);
  const unnamed = tabs.filter((t) => !/aria-label=/.test(t));
  assert.deepStrictEqual(unnamed, [], 'a tab would be unlabelled when collapsed to an icon');
});

scenario('toolbar controls meet a comfortable pointer-target size', () => {
  // Asserts the SCALE, not a literal px value — the geometry now derives from --nb-ctl so a
  // hardcoded 30px here would fail the moment the scale is retuned, which is exactly the
  // brittleness the variable exists to remove.
  assert.ok(/--nb-ctl:\s*(\d+)px/.test(ICON_BUTTON_CSS), 'no control-size variable');
  const ctl = Number(ICON_BUTTON_CSS.match(/--nb-ctl:\s*(\d+)px/)[1]);
  assert.ok(ctl >= 28, `control size ${ctl}px is below a comfortable pointer target`);
  assert.ok(/min-height: var\(--nb-ctl/.test(ICON_BUTTON_CSS), 'tool buttons are not sized from the scale');
  assert.ok(/\.wb-tool-btn\s*\{[^}]*min-width: var\(--nb-ctl/.test(ICON_BUTTON_CSS),
    'primary whiteboard tools are not sized from the scale');
});

scenario('the FAB opens the extension by default', () => {
  const fab = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'fab-settings.types.ts'), 'utf8');
  assert.ok(/clickAction:\s*'open_extension'/.test(fab),
    'the FAB still defaults to the reduced in-page popup');
});

console.log('\n── H: non-structural state must not rebuild the DOM (the blink) ──');

scenario('render() supports a style-only mode that skips the body rebuild', () => {
  // render() ends in `bodyNode.innerHTML = bodyHtml` + attachEventListeners(). That destroys
  // the canvas, the chat scroll position, focus, every <img> and ~50 listeners, and paints
  // the empty intermediate state — the visible blink on every click that called it.
  assert.ok(/private render\(mode: 'full' \| 'style-only'/.test(widgetSrc),
    'render() has no mode parameter');
  assert.ok(/if \(mode === 'style-only'\) \{[\s\S]{0,200}?return;/.test(widgetSrc),
    'style-only mode does not short-circuit before the innerHTML assignment');
});

scenario('open, close and resize take the no-rebuild path', () => {
  // Rather than regex-slicing handler bodies (brittle: comments and formatting shift the
  // boundaries), assert on the statements themselves. Each of these three state changes has
  // a dedicated no-rebuild path; a `this.render();` next to any of them is the blink.
  const mustNotFullRender = [
    ['close button', /this\.isOpen = false;\s*(?:\/\/[^\n]*\n\s*)*this\.render\(\);/],
    ['FAB toggle',   /this\.unreadCount = 0;\s*(?:\/\/[^\n]*\n\s*)*this\.render\(\);/],
    ['size pills',   /this\.popupSize = sz;\s*(?:\/\/[^\n]*\n\s*)*this\.render\(\);/],
  ];
  for (const [name, re] of mustNotFullRender) {
    assert.ok(!re.test(widgetSrc), `${name} still calls full render() — that is the blink`);
  }
  // And the cheap paths must actually exist, or the above passes vacuously.
  assert.ok(/this\.applyLightweightState\(\);/.test(widgetSrc), 'no lightweight state path');
  assert.ok(/this\.renderStyleOnly\(\);/.test(widgetSrc), 'no style-only path');
});

scenario('there is exactly one stylesheet definition', () => {
  // A second copy would drift, and the panel would look different depending on which path
  // last rendered it — the inconsistency this work exists to remove.
  const defs = (widgetSrc.match(/const styleHtml = `/g) || []).length;
  assert.strictEqual(defs, 1, `found ${defs} stylesheet templates; expected exactly 1`);
});

console.log('\n── I: whiteboard drawer + canvas correctness ──');

scenario('CRITICAL: drawer tools carry the class their click handler binds to', () => {
  // Migrating the shapes/DSA/architecture drawers to toolButton() emitted class="nb-tbtn",
  // but the tool-selection handler binds '.wb-tool-btn[data-wbtool]'. Every one of those
  // tools silently stopped responding to clicks while still rendering, hovering and
  // highlighting like a live control — a regression with no visible symptom until you
  // tried to use it.
  const selector = widgetSrc.match(/querySelectorAll\('\.([a-z-]+)\[data-wbtool\]'\)/)?.[1];
  assert.ok(selector, 'could not find the tool-selection handler selector');
  const calls = widgetSrc.match(/toolButton\(\{[\s\S]*?dataAttr: `data-wbtool[^`]*`/g) || [];
  assert.ok(calls.length >= 3, `expected the three tool drawers, found ${calls.length}`);
  for (const c of calls) {
    assert.ok(
      new RegExp(`className: '${selector}'`).test(c),
      `a drawer emits data-wbtool without class "${selector}" — those tools will not respond to clicks`
    );
  }
});

scenario('the canvas buffer tracks its CSS box', () => {
  // setupDimensions ran once at init, so resizing the popup stretched the old bitmap
  // instead of revealing more canvas — the board appeared to zoom, and switching tabs
  // "fixed" it only because that path re-ran init.
  assert.ok(/new ResizeObserver/.test(widgetSrc), 'no ResizeObserver on the canvas');
  assert.ok(/this\.wbResizeObserver/.test(widgetSrc), 'observer is not retained for teardown');
  assert.ok(/wbResizeScheduled/.test(widgetSrc), 'resize is not coalesced per frame');
});

scenario('drawer geometry derives from one scale, not per-drawer inline styles', () => {
  // The three drawers looked different heights because each is overflow-x:auto and only the
  // overflowing one grew a scrollbar. Height now comes from --nb-ctl and the scrollbar is
  // overlaid, so a drawer is the same height whether or not it scrolls.
  assert.ok(/--nb-ctl:/.test(ICON_BUTTON_CSS), 'no control-size variable');
  assert.ok(/min-height: calc\(var\(--nb-ctl/.test(ICON_BUTTON_CSS), 'drawer height is not derived');
  assert.ok(/scrollbar-width: none/.test(ICON_BUTTON_CSS), 'scrollbar still takes layout space');
  const inline = widgetSrc.match(/class="nb-toolstrip" style="[^"]*"/g) || [];
  for (const el of inline) {
    assert.ok(!/[;"]\s*(gap|padding):/.test(el),
      `a toolstrip sets gap/padding inline, overriding the shared scale: ${el.slice(0, 90)}`);
  }
});

scenario('timer operations update in place instead of rebuilding', () => {
  // Five timer ops ended in render(), and the storage listener rebuilt the whole popup every
  // time the timer owner persisted — a full DOM rebuild on a running clock, with no user
  // interaction at all.
  assert.ok(/private updateTimerControls\(\)/.test(widgetSrc), 'no targeted control updater');
  assert.ok(
    !/this\.saveTimerState\(\);\s*\n\s*this\.render\(\);/.test(widgetSrc),
    'a timer operation still ends in a full render'
  );
  assert.ok(
    !/this\.timerState = incomingState;[\s\S]{0,400}?this\.render\(\);/.test(widgetSrc),
    'the timer storage listener still rebuilds the popup on every persist'
  );
});

scenario('a new chat message appends one bubble instead of rebuilding', () => {
  assert.ok(/private renderChatBubble\(/.test(widgetSrc), 'bubble markup is not extracted');
  assert.ok(/private appendChatBubble\(/.test(widgetSrc), 'no incremental append path');
  assert.ok(/this\.renderChatBubble\(m, idx\)/.test(widgetSrc),
    'the full render does not reuse the extracted bubble renderer — the two would drift');
});

console.log('\n── J: layout cannot squeeze content out of view ──');

scenario('every scrolling flex child can actually shrink', () => {
  // A flex item defaults to min-height:auto and so refuses to shrink below its content. In
  // a column container that turns a scrolling child into a growing one, pushing its
  // siblings (the composer, the toolbars) outside the popup. The symptom looks intermittent
  // because it only appears once enough content accumulates.
  const rules = [...widgetSrc.matchAll(/\n        ([.#][a-z0-9-]+) \{([^}]*)\}/g)];
  const offenders = rules
    .filter(([, , body]) => /flex(?:-grow)?:\s*1/.test(body) && /overflow[^:]*:\s*(auto|scroll)/.test(body))
    .filter(([, , body]) => !/min-height:\s*0/.test(body))
    .map(([, name]) => name);
  assert.deepStrictEqual(offenders, [], `scrolling flex children without min-height:0: ${offenders.join(', ')}`);
});

scenario('the working area has a floor the chrome cannot eat', () => {
  // Open every drawer at the smallest popup size and the canvas could otherwise be squeezed
  // toward zero. The content is the last thing that should give way, not the first.
  assert.ok(/min-height: max\(120px, calc\(var\(--nb-ctl/.test(widgetSrc),
    'no minimum height budget for the content area');
});

scenario('sizing selectors reference elements that exist', () => {
  // A rule targeting a class no element carries is silently inert — it looks like the
  // constraint is enforced when nothing is constrained.
  const styled = new Set([...widgetSrc.matchAll(/\n        \.([a-z0-9-]+)[ ,{]/g)].map((m) => m[1]));
  const emitted = new Set();
  for (const m of widgetSrc.matchAll(/class="([^"$]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) emitted.add(c);
  }
  for (const m of widgetSrc.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (c) emitted.add(c);
  }
  const sizing = ['message-list', 'nb-toolstrip', 'nb-tbtn', 'nb-swatch', 'popup-card'];
  for (const cls of sizing) {
    if (!styled.has(cls)) continue;
    assert.ok(emitted.has(cls), `.${cls} is styled but no element carries it — the rule is inert`);
  }
});

console.log('\n── K: side panel uses icon-first, not shrink-to-fit ──');

scenario('narrowing drops labels instead of shrinking type', () => {
  // The panel answered narrowing by shrinking nav labels — 10.5px at 720px, then 9.5/10px at
  // 420px, in TWO duplicate breakpoint sets. Shrinking type to fit degrades the thing being
  // read in order to preserve a label that has already stopped being readable; dropping the
  // label and keeping the glyph at full size is the correct lever.
  //
  // Scoped to RESPONSIVE blocks deliberately. A blanket floor would also condemn badges and
  // counters, where ~10px is conventional and legitimate — the defect is shrink-as-a-
  // -strategy, not small text per se.
  const css = fs.readFileSync(path.join(root, 'src', 'app', 'synqtoDesign.css'), 'utf8');
  const offenders = [];
  const re = /@media[^{]*max-width[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    for (const f of css.slice(start, i).matchAll(/font-size:\s*([0-9.]+)px/g)) {
      if (Number(f[1]) < 11) offenders.push(`${m[0].trim()} -> ${f[1]}px`);
    }
  }
  assert.deepStrictEqual(offenders, [],
    `responsive blocks still shrink type below the legibility floor:\n  ${offenders.join('\n  ')}`);
});

scenario('panel nav collapses to icons and keeps its accessible name', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'app', 'synqtoDesign.css'), 'utf8');
  const nav = fs.readFileSync(path.join(root, 'src', 'features', 'navigation', 'NavBar.tsx'), 'utf8');
  assert.ok(/nav-tab-label\s*\{\s*display:\s*none/.test(css.replace(/\s+/g, ' ')),
    'no icon-first collapse rule for the nav');
  assert.ok(/className="nav-tab-label"/.test(nav), 'nav label is not wrapped for collapse');
  assert.ok(/aria-label=\{tab\.label\}/.test(nav), 'nav tab loses its name when collapsed');
});

scenario('the panel has its own control scale', () => {
  const css = fs.readFileSync(path.join(root, 'src', 'app', 'synqtoDesign.css'), 'utf8');
  assert.ok(/--sq-ctl:\s*\d+px/.test(css), 'no control-size token for the panel');
  assert.ok(/min-height: var\(--sq-ctl/.test(css), 'panel controls are not sized from the scale');
});

console.log('\n========================================');
console.log(`🏁 Icons & Versions: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log('========================================\n');

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
