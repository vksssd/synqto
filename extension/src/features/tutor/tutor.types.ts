// ─── Tutor Stage, Multi-Broadcaster & Cursor Types ───

import { PeerIdentity } from '@/core/network/packet';

export type StageRole = 'audience' | 'speaker' | 'tutor';
export type BroadcastType = 'audio' | 'camera' | 'screen';
export type LiveViewerState = 'NOT_WATCHING' | 'REQUESTING' | 'WATCHING' | 'LEAVING';
export type LiveBroadcasterState =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'REQUESTING_ADMISSION'
  | 'LIVE'
  | 'STOPPING';

export interface CursorPosition {
  peerId: string;
  nickname: string;
  avatar: string;
  color: string;
  xPct: number; // percentage width (0-100)
  yPct: number; // percentage height (0-100)
  isTutor: boolean;
  timestamp: number;
}

export interface ClickPulse {
  peerId: string;
  nickname: string;
  xPct: number;
  yPct: number;
  color: string;
  isTutor: boolean;
  timestamp: number;
}

export interface HandRaiseRequest {
  peerId: string;
  nickname: string;
  avatar: string;
  requestedAt: number;
}

export interface ActiveStreamInfo {
  streamId: string;
  broadcasterPeerId: string;
  broadcasterIdentity: PeerIdentity;
  title: string;
  broadcastType: BroadcastType;
  withMic?: boolean;
  isMicMuted?: boolean;
  startedAt: number;
}

export interface TutorStageState {
  viewerState: LiveViewerState;
  broadcasterState: LiveBroadcasterState;
  isActive: boolean;
  tutorPeerId: string | null;
  tutorIdentity: PeerIdentity | null;
  guestSpeakers: PeerIdentity[]; // Interactive guest speakers
  handRaises: HandRaiseRequest[];
  isMyHandRaised: boolean;
  myRole: StageRole;
  isAudioLive: boolean;
  isVideoLive: boolean;
  withMic?: boolean;
  isMicMuted?: boolean;
  broadcastType: BroadcastType;
  streamTitle?: string;
  activeStreams: ActiveStreamInfo[]; // All concurrent active streams in room
  /**
   * Most recent media/stage failure, surfaced to the user.
   *
   * Media errors were previously only console.debug'd, so a denied microphone, a failed
   * camera, or accepting a guest onto an already-full stage all appeared to the user as
   * "the button did nothing". Carrying it on state lets the stage UI explain itself.
   */
  lastMediaError?: string;
}
