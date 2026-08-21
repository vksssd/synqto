// ─── Timer display formatting — one definition ───
//
// There were three, and they did not agree:
//
//   FocusTimerBar.tsx      `${mins.padStart(2,'0')}:${secs.padStart(2,'0')}`   -> 05:09
//   floating-widget.ts     identical logic, separately written                 -> 05:09
//   App.tsx                `${Math.floor(s/60)}:${secs.padStart(2,'0')}`       ->  5:09
//
// The App.tsx copy omitted the minutes pad, so the same countdown rendered as "5:09" in the
// header and "05:09" in the timer bar directly below it — and the width of the header label
// changed as the timer crossed each ten-minute boundary, nudging the layout beside it.
//
// The two that agreed did so by coincidence: they are separate implementations that happen
// to have been written the same way. Nothing prevented the next edit to either from
// re-introducing the drift, which is what makes this worth centralising even though two of
// the three were already correct.

/**
 * Formats a duration for display as MM:SS, zero-padded on both fields.
 *
 * Padding minutes is what keeps the label a fixed width, so a countdown does not shift the
 * layout around it every time it crosses from 10:00 to 9:59.
 *
 * Durations of an hour or more render as MMM:SS (e.g. 90 minutes -> "90:00") rather than
 * H:MM:SS. That is deliberate: this is a focus timer, sessions are set in minutes, and an
 * hours field would be zero for essentially every real session while costing width in a
 * panel that is already tight.
 */
export function formatTimerTime(totalSec: number): string {
  const safe = Number.isFinite(totalSec) ? Math.max(0, Math.floor(totalSec)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
