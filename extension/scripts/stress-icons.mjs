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
  assert.ok(/min-height:\s*30px/.test(ICON_BUTTON_CSS), 'tool buttons are not sized');
  assert.ok(/\.wb-tool-btn\s*\{[^}]*min-width:\s*30px/.test(ICON_BUTTON_CSS),
    'primary whiteboard tools are not sized');
});

scenario('the FAB opens the extension by default', () => {
  const fab = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'fab-settings.types.ts'), 'utf8');
  assert.ok(/clickAction:\s*'open_extension'/.test(fab),
    'the FAB still defaults to the reduced in-page popup');
});

console.log('\n========================================');
console.log(`🏁 Icons & Versions: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log('========================================\n');

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
