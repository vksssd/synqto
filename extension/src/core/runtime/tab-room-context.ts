import { detectResource, DetectedResource } from '@/content/resource-detector';
import { computeRoomId } from '@/features/room/room-utils';

export type RoutedResource = DetectedResource & { roomId: string };

/** Derives the authoritative deterministic room context for one browser tab. */
export function detectRoutedResource(
  url: string | null | undefined,
  title?: string
): RoutedResource | null {
  if (!url || !/^https?:/i.test(url)) return null;
  const resource = detectResource(url, title);
  if (!resource) return null;
  return {
    ...resource,
    roomId: computeRoomId(resource.slug, resource.canonicalUrl),
  };
}

/** Fail-closed room fence for messages crossing extension execution contexts. */
export function messageBelongsToRoom(
  messageRoomId: unknown,
  currentRoomId: string | null | undefined
): boolean {
  return (
    typeof messageRoomId === 'string' &&
    messageRoomId.length > 0 &&
    typeof currentRoomId === 'string' &&
    currentRoomId.length > 0 &&
    messageRoomId === currentRoomId
  );
}
