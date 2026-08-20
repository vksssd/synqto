// ─── Sanitizers for values that arrive from other peers ───
//
// Every function here guards a sink where remote data reaches a browser parser — an HTML
// attribute, a CSS declaration, a URL fetch. The rule this module encodes is that a value
// which crossed the network is not a string, it is a *claim*, and it may only be used in a
// sink after being narrowed to a shape that cannot change that sink's meaning.
//
// These are allowlists rather than blocklists. A blocklist has to enumerate every escape
// sequence a browser's HTML, CSS and URL parsers will accept — including the ones they
// disagree about — and is wrong the moment any of them adds a form. An allowlist is wrong
// only if a legitimate value falls outside it, which is a visible bug rather than a silent
// hole.

/** Result of a failed sanitisation: render nothing rather than render something unsafe. */
export const REJECTED = '';

/**
 * Narrows a peer-supplied media URL to something safe to place in an `<img src>`.
 *
 * THE BUG THIS CLOSES. ChatMessagePayload.imageUrl was taken straight off the wire
 * (chat.service.ts assigns `imageUrl: payload.imageUrl` with no validation) and interpolated
 * raw into an HTML attribute in the content script's message renderer:
 *
 *     <img src="${msgObj.imageUrl}" alt="Shared image" ... />
 *
 * ...which is then assigned via innerHTML. Every other value in that renderer goes through
 * escapeHtml; this one did not. A peer sending
 *
 *     imageUrl: 'x" onerror="<attacker script>'
 *
 * closes the src attribute and adds an event handler, giving arbitrary script execution in
 * the content script's world on the victim's page — with access to chrome.runtime messaging
 * and to the page the victim is reading.
 *
 * Escaping alone would fix the attribute break-out but still permit `javascript:` and
 * `data:text/html` URLs, so the scheme is checked too:
 *
 *   - `data:image/<type>` — how this app's own screenshots travel (chat.service.ts sets
 *     imageUrl from a canvas data URL), so it must be allowed. Narrowed to image/* so
 *     `data:text/html` cannot ride the same allowance.
 *   - `https:` — remote images.
 *
 * Everything else, including `javascript:`, `vbscript:`, `file:`, `blob:` and protocol
 * relative `//host`, is rejected.
 */
export function safeMediaUrl(raw: unknown): string {
  if (typeof raw !== 'string') return REJECTED;

  // Leading whitespace and control characters are stripped by URL parsers before the scheme
  // is read, so `\njavascript:alert(1)` is a javascript URL to the browser. Strip first, then
  // test, or the check reads a different string than the browser will.
  const url = stripUrlNoiseChars(raw);
  if (url.length === 0 || url.length > 2_000_000) return REJECTED;

  const lower = url.toLowerCase();

  if (lower.startsWith('data:')) {
    // Only images, and only the base64/charset forms a real encoder emits.
    return /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(url)
      ? url
      : REJECTED;
  }

  if (lower.startsWith('https://')) {
    // Quotes and angle brackets cannot appear in a well-formed URL and are the characters an
    // attribute break-out needs; refuse rather than escape, so the value is safe in any sink
    // and not only in the one it is about to be used in.
    if (/["'<>`\\]/.test(url)) return REJECTED;
    return url;
  }

  return REJECTED;
}

/**
 * Narrows a peer-supplied colour to something safe to place in a CSS declaration.
 *
 * THE BUG THIS CLOSES. cursor-overlay renders remote cursors and click ripples by building
 * `element.style.cssText` with the peer's colour interpolated in:
 *
 *     border: 3px solid ${color} !important;
 *     box-shadow: 0 0 16px ${color}, inset 0 0 8px ${color} !important;
 *
 * A colour of `red !important; width: 100vw !important; height: 100vh` injects extra
 * declarations. Inline styles cannot open a new rule, so this is not a route to script — but
 * it is enough to:
 *
 *   - cover the victim's entire viewport with an element (the width/height set earlier in the
 *     same cssText are overridden by later declarations, and z-index is already maximal), a
 *     defacement/denial-of-service any peer in the room can trigger; and
 *   - issue an unconsented outbound request via `background: url(https://attacker/…)`, which
 *     leaks the victim's IP and the fact they are on the page, and works as a beacon.
 *
 * The allowlist covers exactly the forms the app itself generates (identity palette hex) plus
 * the standard functional notations, with the argument list constrained to digits, separators
 * and units so no `url(`, `expression(` or extra declaration can appear inside them.
 */
export function safeCssColor(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;

  const color = raw.trim();
  if (color.length === 0 || color.length > 64) return fallback;

  // #rgb | #rgba | #rrggbb | #rrggbbaa
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;

  // rgb()/rgba()/hsl()/hsla() with a strictly numeric argument list. The character class is
  // the load-bearing part: it admits no letters, so `url`, `var` and `expression` cannot
  // appear, and no ';' or '}', so no declaration can be appended.
  if (/^(?:rgb|hsl)a?\([0-9.,%\s/+-]+\)$/i.test(color)) return color;

  // A small set of plain keywords. Deliberately not the full CSS named-colour list: these are
  // the only ones this codebase uses as defaults, and every addition is a string that must be
  // re-checked for meaning in a declaration context.
  if (/^(?:transparent|currentcolor|white|black|red|green|blue|orange|purple|gray|grey)$/i.test(color)) {
    return color;
  }

  return fallback;
}

/**
 * Escapes text for interpolation into HTML.
 *
 * Includes the single quote, which the content script's own escapeHtml omitted. That omission
 * was not exploitable there because every attribute in that file happens to be double-quoted,
 * but "safe only because of an unrelated formatting convention" is not a property worth
 * relying on — one single-quoted attribute added later would silently reopen it.
 */
export function escapeHtml(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Clamps peer-supplied display text to a bounded, control-character-free string.
 *
 * Mirrors the server's SanitizeNickname (internal/protocol/identifiers.go). Both exist
 * because neither side can assume the other ran: the server sanitises what it fans out in
 * rosters, but chat payloads travel peer-to-peer over a DataChannel and never touch the
 * server at all, so a client that trusts server-side sanitisation alone is trusting a hop
 * that the P2P path does not include.
 */
export function safeDisplayText(raw: unknown, maxLength = 64): string {
  if (typeof raw !== 'string') return '';
  const stripped = stripControlChars(raw);
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}

/**
 * Removes C0 control characters and DEL.
 *
 * Written as a code-point scan rather than a regex with a control-character class on purpose:
 * such a class has to be spelled with escapes, and a single mis-escape (`\\u0000` instead of
 * the character itself) silently turns the class into "the literal characters backslash, u, 0…" — a
 * filter that matches nothing and reports success. A comparison against charCodeAt cannot
 * degrade that way.
 */
function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) continue;
    out += input[i];
  }
  return out;
}

/**
 * Removes the characters a URL parser ignores before it decides on a scheme: C0 controls,
 * DEL, and space.
 *
 * This must run BEFORE the scheme test, not after, because the browser does it too. A value
 * of "\njavascript:..." or " javascript:..." is a javascript URL as far as the parser is
 * concerned, so a scheme check performed on the unstripped string is inspecting a different
 * string than the one that will eventually be navigated — the classic way a scheme allowlist
 * is bypassed while appearing correct.
 */
function stripUrlNoiseChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) continue;
    out += input[i];
  }
  return out;
}
