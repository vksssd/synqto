// ─── Toolbar icon system ───
//
// Replaces the emoji-and-text tool labels with a real SVG icon set.
//
// WHY NOT EMOJI. The toolbars were labelled with emoji ("📏", "⭕") or emoji-plus-text
// ("Two Pointers (L/R)", "HashMap Bucket"). Three problems, all of which get worse as the
// panel narrows:
//
//   1. Emoji are FONT glyphs, so they are rendered by whatever emoji font the OS supplies.
//      The same button is a flat blue square on one machine and a glossy 3D one on another,
//      at different optical weights and baselines, and a few (▢, ⇢, ↖️) fall back to a
//      tofu box on systems without them. A toolbar cannot be visually consistent when its
//      symbols are chosen by the operating system.
//   2. They cannot inherit colour. An emoji ignores `color`, so an active tool cannot be
//      tinted with the accent and a destructive action cannot be tinted red — which is why
//      the clear button had to set `color:#f87171` that the glyph then ignored.
//   3. Text labels like "Two Pointers (L/R)" are ~130px wide. In the 420px compact popup a
//      drawer of eight of those is a 1000px scroll strip, so most tools are off-screen and
//      the user has to scroll horizontally to find anything.
//
// SVG fixes all three: identical rendering everywhere, `currentColor` inheritance, and a
// fixed 14px footprint that lets a label be dropped independently of the symbol.
//
// SPRITE, NOT INLINE COPIES. Icons are emitted once into a hidden <svg><symbol> block and
// referenced with <use href="#id">. A drawer with 19 architecture tools would otherwise
// repeat full path data 19 times in a string that is re-rendered on every state change.
// <use> works across the shadow boundary here because the sprite lives in the same shadow
// root as the buttons.

export type ToolIconId =
  // primary tools
  | 'select' | 'hand' | 'pen' | 'brush' | 'highlighter' | 'temp-pen' | 'laser'
  | 'torch' | 'eraser' | 'text'
  // shapes
  | 'line' | 'arrow' | 'arrow-bi' | 'rect' | 'rounded-rect' | 'circle'
  | 'triangle' | 'star' | 'diamond' | 'sticky' | 'code'
  // dsa
  | 'array' | 'two-pointers' | 'stack' | 'queue' | 'tree' | 'hashmap'
  // architecture
  | 'database' | 'nosql' | 'cache' | 'queue-mq' | 'balancer' | 'server'
  | 'cloud' | 'cdn' | 'storage' | 'shield' | 'socket' | 'search' | 'dns'
  | 'firewall' | 'user' | 'mobile' | 'async' | 'scales'
  // actions
  | 'undo' | 'redo' | 'trash' | 'copy' | 'duplicate' | 'paste' | 'close'
  | 'lock' | 'users' | 'shapes' | 'palette' | 'save' | 'popout' | 'reset';

/**
 * Path geometry for each icon, drawn on a 24x24 grid.
 *
 * Stroke-based rather than filled so every icon shares one visual weight and picks up
 * `currentColor` from the button — that is what makes an active tool tint with the accent
 * and the destructive action tint red, neither of which an emoji can do.
 */
const ICON_PATHS: Record<ToolIconId, string> = {
  // ── primary ──
  select: '<path d="M5 3l6 16 2-6 6-2z"/>',
  hand: '<path d="M9 11V6a1.5 1.5 0 013 0v5m0-1V5a1.5 1.5 0 013 0v6m0-2a1.5 1.5 0 013 0v6a6 6 0 01-6 6h-1a6 6 0 01-6-6v-4a1.5 1.5 0 013 0"/>',
  pen: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/>',
  brush: '<path d="M6 20c3 0 4-2 4-4l8-9-3-3-9 8c-2 0-4 1-4 4 0 2 1 4 4 4z"/>',
  highlighter: '<path d="M5 18h6l7-7-4-4-7 7z"/><path d="M3 21h8"/>',
  'temp-pen': '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  laser: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  torch: '<path d="M12 3l3 6h-6z"/><path d="M9 9v10a3 3 0 006 0V9"/>',
  eraser: '<path d="M6 18l-3-3 9-9 6 6-6 6z"/><path d="M9 21h12"/>',
  text: '<path d="M5 5h14"/><path d="M12 5v14"/><path d="M9 19h6"/>',

  // ── shapes ──
  line: '<path d="M4 20L20 4"/>',
  arrow: '<path d="M4 12h15"/><path d="M14 7l5 5-5 5"/>',
  'arrow-bi': '<path d="M4 12h16"/><path d="M8 7l-4 5 4 5"/><path d="M16 7l4 5-4 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  'rounded-rect': '<rect x="4" y="6" width="16" height="12" rx="4"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  triangle: '<path d="M12 4l8 15H4z"/>',
  star: '<path d="M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.2L12 17.2 6.4 20.2l1.2-6.2L3 9.6l6.3-.8z"/>',
  diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
  sticky: '<path d="M5 4h14v10l-5 5H5z"/><path d="M19 14h-5v5"/>',
  code: '<path d="M9 7l-5 5 5 5"/><path d="M15 7l5 5-5 5"/>',

  // ── dsa ──
  array: '<rect x="2" y="9" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="16" y="9" width="6" height="6"/>',
  'two-pointers': '<path d="M3 16h18"/><path d="M6 16v-5l2 2 2-2v5"/><path d="M14 16v-5l2 2 2-2v5"/>',
  stack: '<rect x="5" y="15" width="14" height="4"/><rect x="5" y="10" width="14" height="4"/><rect x="5" y="5" width="14" height="4"/>',
  queue: '<rect x="3" y="8" width="5" height="8"/><rect x="9" y="8" width="5" height="8"/><rect x="15" y="8" width="5" height="8"/><path d="M21 12h1"/>',
  tree: '<circle cx="12" cy="5" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M10.5 7.5L7.5 15.5M13.5 7.5l3 8"/>',
  hashmap: '<rect x="3" y="4" width="18" height="16"/><path d="M3 10h18M9 4v16"/>',

  // ── architecture ──
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  nosql: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M11 11l2 2"/>',
  cache: '<path d="M13 3l-8 10h6l-2 8 8-10h-6z"/>',
  'queue-mq': '<rect x="3" y="7" width="18" height="10"/><path d="M7 7v10M12 7v10M17 7v10"/>',
  balancer: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5H5v5M12 11.5h7v5M12 11.5v5"/>',
  server: '<rect x="3" y="4" width="18" height="7"/><rect x="3" y="13" width="18" height="7"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 6 6 0 0111-2 4 4 0 011 8z"/>',
  cdn: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  storage: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8v4H8z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  socket: '<path d="M4 8l8 8 8-8"/><path d="M4 16h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15 15l5 5"/>',
  dns: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
  firewall: '<rect x="3" y="5" width="18" height="14"/><path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/>',
  mobile: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  async: '<path d="M4 9h12"/><path d="M12 5l4 4-4 4"/><path d="M20 15H8"/><path d="M12 19l-4-4 4-4"/>',
  scales: '<path d="M12 4v16M6 8h12"/><path d="M6 8l-3 6h6zM18 8l-3 6h6z"/>',

  // ── actions ──
  undo: '<path d="M4 10h11a5 5 0 010 10h-4"/><path d="M8 6l-4 4 4 4"/>',
  redo: '<path d="M20 10H9a5 5 0 000 10h4"/><path d="M16 6l4 4-4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/>',
  duplicate: '<rect x="4" y="4" width="10" height="10" rx="2"/><rect x="10" y="10" width="10" height="10" rx="2"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M7 5H5v15h14V5h-2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 19a7 7 0 0114 0"/><path d="M16 5.5a3.5 3.5 0 010 7M17 19a7 7 0 00-2-5"/>',
  shapes: '<circle cx="8" cy="8" r="4"/><rect x="12" y="12" width="8" height="8"/>',
  palette: '<path d="M12 3a9 9 0 000 18c1.7 0 2-1.3 1.3-2-.8-.9-.3-2 1-2H16a5 5 0 005-5c0-5-4-9-9-9z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="11.5" r="1"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3"/><rect x="8" y="13" width="8" height="6"/>',
  popout: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  reset: '<path d="M4 12a8 8 0 108-8 8 8 0 00-5.7 2.4L4 9"/><path d="M4 4v5h5"/>',
};

/**
 * The one-time sprite definition. Injected alongside the stylesheet, not per render.
 *
 * aria-hidden and display:none because this block is a definition, not content — without it
 * a screen reader would announce the entire icon set before the first button.
 */
export function renderIconSprite(): string {
  const symbols = (Object.keys(ICON_PATHS) as ToolIconId[])
    .map((id) => `<symbol id="nb-i-${id}" viewBox="0 0 24 24">${ICON_PATHS[id]}</symbol>`)
    .join('');
  return `<svg aria-hidden="true" focusable="false" style="display:none;position:absolute;width:0;height:0;">${symbols}</svg>`;
}

/**
 * An icon reference for use inside a button.
 *
 * fill=none + stroke=currentColor is what lets the same markup render muted in a toolbar,
 * accent-tinted when its tool is active, and red on the destructive action — the property
 * emoji could not provide.
 */
export function icon(id: ToolIconId, size = 14): string {
  return `<svg class="nb-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#nb-i-${id}"/></svg>`;
}

/**
 * A toolbar button: icon always, label only when there is room.
 *
 * The label is wrapped in `.nb-btn-label`, which a container query hides on narrow panels —
 * see the CSS in floating-widget. Collapsing to icon-only is why `title` and `aria-label`
 * are mandatory here rather than optional: once the text is hidden, they are the ONLY
 * accessible name the control has, and an icon-only button with neither is unusable both to
 * a screen reader and to anyone who does not recognise the glyph.
 */
export function toolButton(opts: {
  iconId: ToolIconId;
  label: string;
  title: string;
  dataAttr?: string;
  id?: string;
  className?: string;
  active?: boolean;
  style?: string;
}): string {
  const cls = ['nb-tbtn', opts.className || '', opts.active ? 'active' : ''].filter(Boolean).join(' ');
  return `<button class="${cls}"${opts.id ? ` id="${opts.id}"` : ''}${opts.dataAttr ? ` ${opts.dataAttr}` : ''} title="${escapeAttr(opts.title)}" aria-label="${escapeAttr(opts.title)}"${opts.active ? ' aria-pressed="true"' : ''}${opts.style ? ` style="${opts.style}"` : ''}>${icon(opts.iconId)}<span class="nb-btn-label">${escapeText(opts.label)}</span></button>`;
}

/** Local escapers — this module must not depend on the widget class it is rendered into. */
function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function escapeText(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * CSS for the icon buttons and the icon-first responsive collapse.
 *
 * The collapse is a CONTAINER query, not a media query. The widget is a floating panel whose
 * width is chosen by the user (compact 420px / medium 620px / large 860px / fullscreen) and
 * is unrelated to the viewport — a page can be 2560px wide while the panel is 420px. A media
 * query would read the wrong number and keep full labels in the narrowest panel, which is
 * precisely where they do not fit.
 */
export const ICON_BUTTON_CSS = `
  .nb-tbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* Sized against the ~24px comfortable minimum for a pointer target rather than the
       smallest box the glyph fits in. The previous 4px/7px padding produced ~22px controls
       that were fiddly to hit and read as cramped next to the panel's other chrome. */
    padding: 7px 10px;
    min-height: 30px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-size-2xs);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .nb-tbtn:hover { background: rgba(255, 255, 255, 0.07); color: var(--text-primary); }
  .nb-tbtn:focus-visible {
    /* Keyboard focus was previously invisible on these controls. */
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .nb-tbtn.active {
    border-color: var(--primary);
    background: rgba(99, 102, 241, 0.25);
    color: #c7d2fe;
  }
  .nb-tbtn .nb-icon { flex: 0 0 auto; }

  /* The toolbar strip is the query container. */
  .nb-toolstrip { container-type: inline-size; }

  /* Icon-first: below this width the label is dropped and only the symbol remains.
     380px is where a drawer of ~8 labelled buttons stops fitting in the compact panel once
     padding and the drawer's own caption are accounted for. Raised from 360 with the larger
     control size above, since each labelled button is now wider. */
  @container (max-width: 380px) {
    .nb-tbtn .nb-btn-label { display: none; }
    /* Square when icon-only: equal padding keeps the glyph optically centred, and the
       min-width stops a 1-glyph button collapsing narrower than its neighbours. */
    .nb-tbtn { padding: 7px; gap: 0; min-width: 30px; justify-content: center; }
  }

  /* Browsers without container-query support still get a usable toolbar via the explicit
     compact class the widget sets from its own popupSize state. */
  .nb-compact .nb-tbtn .nb-btn-label { display: none; }
  .nb-compact .nb-tbtn { padding: 7px; gap: 0; min-width: 30px; justify-content: center; }

  /* ── Primary whiteboard tools and header actions ──
     These are icon-only at every width, so they are sized as square targets rather than
     inheriting the label-bearing geometry above. */
  .wb-tool-btn {
    min-width: 30px;
    min-height: 30px;
    padding: 6px;
  }

  /* ── Tab bar and header: icon-first below the same breakpoint ──
     The tab strip is the panel's primary navigation, so it collapses on the SAME threshold
     as the toolbars — a panel narrow enough to hide tool labels is narrow enough that
     "💬 Live Chat" wraps or truncates mid-word, which reads as breakage rather than as a
     deliberately compact layout. Icons stay; the accessible name is on the control. */
  .nb-navstrip { container-type: inline-size; }
  @container (max-width: 380px) {
    .nb-navstrip .nb-nav-label { display: none; }
    .nb-navstrip .tab-btn { gap: 0; }
  }
  .nb-compact .nb-navstrip .nb-nav-label { display: none; }
  .nb-compact .nb-navstrip .tab-btn { gap: 0; }
`;
