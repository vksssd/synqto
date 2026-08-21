import type { RoomContext } from './room-utils';

/**
 * Chooses what a newly-active extension surface may resume.
 *
 * A selected room is explicit user state and wins over active-tab detection. CoFocus is
 * intentionally panel-bound, so a persisted CoFocus record is never resumed as a background
 * mesh after its panel has gone away.
 */
export function chooseResumableRoom(
  selectedRoom: RoomContext | null | undefined,
  detectedProblem: RoomContext | null | undefined
): RoomContext | undefined {
  if (selectedRoom?.roomId && !selectedRoom.cofocusMode) return selectedRoom;
  return detectedProblem ?? undefined;
}

/** Active-tab detection may seed an empty surface, but must not evict an existing selection. */
export function shouldAdoptDetectedProblem(currentRoom: RoomContext | null): boolean {
  return currentRoom === null;
}
