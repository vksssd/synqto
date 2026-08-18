// ─── Shared modal accessibility behaviour ───

import { useEffect, useRef } from 'react';

/**
 * Gives a modal the keyboard and screen-reader behaviour users expect.
 *
 * Every modal in the side panel previously implemented dismissal as "click the X or the
 * backdrop" only. That fails in three ways:
 *   - Escape did nothing, which is the first thing most people try.
 *   - Nothing announced the dialog to assistive tech, and focus stayed behind it on the
 *     page underneath, so a screen-reader user could tab straight out of an open modal.
 *   - Focus was never restored on close, dumping keyboard users back at the top of the panel.
 *
 * Centralising it means the five existing modals behave identically and any new one gets
 * the same behaviour by construction.
 *
 * Usage:
 *   const { dialogProps } = useModalA11y(isOpen, onClose);
 *   <div className="modal-content" {...dialogProps} aria-labelledby="my-title">
 */
export function useModalA11y(
  isOpen: boolean,
  onClose: () => void,
  options: { closeOnEscape?: boolean; trapFocus?: boolean } = {}
) {
  const { closeOnEscape = true, trapFocus = true } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // Remember what had focus so it can be restored when the dialog closes.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement;
    return () => {
      const el = previouslyFocused.current as HTMLElement | null;
      if (el && typeof el.focus === 'function' && document.contains(el)) {
        el.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (!trapFocus || e.key !== 'Tab') return;

      const root = containerRef.current;
      if (!root) return;

      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Wrap focus at the edges so Tab cannot escape the dialog into the page behind it.
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose, closeOnEscape, trapFocus]);

  return {
    dialogProps: {
      ref: containerRef,
      role: 'dialog' as const,
      'aria-modal': true,
    },
  };
}
