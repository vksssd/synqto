// ─── Single source of truth for the app version ───
//
// There were three version strings in the codebase and they disagreed. package.json and
// manifest.json both said 0.13.1, while the Settings "About" panel rendered a hardcoded
// v0.2.0 badge and a second line that read the manifest but fell back to '0.2.0' when it
// could not. So the number users actually saw was eleven minor releases stale, and the bug
// reports they filed would have carried the wrong version with them — the one piece of
// context that makes a report actionable.
//
// The manifest is the correct runtime authority: Chrome loads it, it is what shows on
// chrome://extensions, and it cannot drift from the installed build. Everything user-facing
// reads through here so there is one place to be wrong instead of several.

/**
 * Compile-time fallback, used only outside an extension context — unit tests, the stress
 * harnesses, and the Vite dev preview, where chrome.runtime does not exist.
 *
 * MUST match package.json and public/manifest.json. scripts/check-versions.mjs enforces that
 * on every build rather than trusting the three to be updated together by hand, which is the
 * habit that produced the original drift.
 */
export const FALLBACK_VERSION = '0.14.0';

/**
 * The running extension's version.
 *
 * Deliberately has no "unknown" branch: a version string is used in bug reports and support
 * conversations, and rendering "unknown" there is worse than rendering a value that is
 * provably in sync with the bundle it shipped in.
 */
export function getAppVersion(): string {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const v = chrome.runtime.getManifest().version;
      if (v) return v;
    }
  } catch {
    // Extension context invalidated (see floating-widget's contextInvalidated note) — the
    // fallback is still the version this bundle was built from, so it stays accurate.
  }
  return FALLBACK_VERSION;
}

/** Version prefixed with "v", for display in badges and chips. */
export function getDisplayVersion(): string {
  return `v${getAppVersion()}`;
}
