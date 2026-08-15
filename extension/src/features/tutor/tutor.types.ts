// ─── Tutor Stage & Cursor Types ───

import { PeerIdentity } from '@/core/network/packet';

export type StageRole = 'audience' | 'speaker' | 'tutor';
export type BroadcastType = 'audio' | 'camera' | 'screen';

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
  timestamp: number;
}

export interface HandRaiseRequest {
  peerId: string;
  nickname: string;
  avatar: string;
  requestedAt: number;
}

export interface TutorStageState {
  isActive: boolean;
  tutorPeerId: string | null;
  tutorIdentity: PeerIdentity | null;
  guestSpeakers: PeerIdentity[]; // Max 2 interactive guest speakers
  handRaises: HandRaiseRequest[];
  isMyHandRaised: boolean;
  myRole: StageRole;
  isAudioLive: boolean;
  isVideoLive: boolean;
  broadcastType: BroadcastType;
}
