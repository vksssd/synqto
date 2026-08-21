export type PopupWindowPreset = 'small' | 'medium' | 'large' | 'near-maximized';

export interface PopupRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PopupDisplay {
  isPrimary?: boolean;
  bounds: PopupRect;
  workArea: PopupRect;
}

export interface PopupWindowCandidate {
  id?: number;
  tabs?: Array<{ url?: string; pendingUrl?: string }>;
}

const PRESET_SIZE: Record<Exclude<PopupWindowPreset, 'near-maximized'>, { width: number; height: number }> = {
  small: { width: 640, height: 560 },
  medium: { width: 800, height: 650 },
  large: { width: 960, height: 720 },
};

/** Selects the display containing the source-window centre, then primary, then the first. */
export function selectPopupDisplay(
  displays: PopupDisplay[],
  sourceWindow?: Partial<PopupRect> | null
): PopupDisplay | null {
  if (displays.length === 0) return null;
  if (
    sourceWindow &&
    typeof sourceWindow.left === 'number' &&
    typeof sourceWindow.top === 'number' &&
    typeof sourceWindow.width === 'number' &&
    typeof sourceWindow.height === 'number'
  ) {
    const centerX = sourceWindow.left + sourceWindow.width / 2;
    const centerY = sourceWindow.top + sourceWindow.height / 2;
    const containing = displays.find(({ bounds }) =>
      centerX >= bounds.left &&
      centerX < bounds.left + bounds.width &&
      centerY >= bounds.top &&
      centerY < bounds.top + bounds.height
    );
    if (containing) return containing;
  }
  return displays.find((display) => display.isPrimary) ?? displays[0];
}

/** Computes centred bounds that never exceed the display's actual available work area. */
export function computePopupBounds(
  workArea: PopupRect,
  preset: PopupWindowPreset,
  margin = 24
): PopupRect {
  const availableWidth = Math.max(1, workArea.width - margin * 2);
  const availableHeight = Math.max(1, workArea.height - margin * 2);
  const requested = preset === 'near-maximized'
    ? { width: availableWidth, height: availableHeight }
    : PRESET_SIZE[preset];
  const width = Math.min(requested.width, availableWidth);
  const height = Math.min(requested.height, availableHeight);

  return {
    left: Math.round(workArea.left + (workArea.width - width) / 2),
    top: Math.round(workArea.top + (workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Identifies the canonical whiteboard popout without matching unrelated extension windows. */
export function isWhiteboardPopupWindow(
  candidate: PopupWindowCandidate,
  canonicalUrl: string
): boolean {
  return candidate.id !== undefined && Boolean(candidate.tabs?.some((tab) => {
    const value = tab.pendingUrl || tab.url;
    if (!value) return false;
    try {
      const actual = new URL(value);
      const expected = new URL(canonicalUrl);
      return actual.origin === expected.origin &&
        actual.pathname === expected.pathname &&
        actual.searchParams.get('view') === 'whiteboard';
    } catch {
      return false;
    }
  }));
}
