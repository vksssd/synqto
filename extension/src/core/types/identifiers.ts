// ─── Synqto Strongly Typed Domain Identifiers ───

/** Stable user / device peer identity (e.g. "nb-a1b2c3d4") */
export type PeerId = string;

/** Single runtime connection session within an extension context */
export type SessionId = string;

/** Collaborative namespace or problem room (e.g. "group:squad-xyz", "prob:two-sum") */
export type RoomId = string;

/** Browser tab execution context ID */
export type TabId = number;

/** Unique WebRTC peer connection identifier */
export type ConnectionId = string;

/** Universal packet / message tracking ID */
export type MessageId = string;

/** Replicated state machine operation identifier (e.g. "peerId:seq:lamport") */
export type OperationId = string;

/** Monotonically increasing topology epoch counter */
export type TopologyEpoch = number;

/** Extension context runtime types */
export type ExtensionContextType = 'SIDE_PANEL' | 'CONTENT_SCRIPT' | 'OFFSCREEN' | 'POPUP' | 'BACKGROUND';

/** Collaboration capabilities */
export type Capability = 'chat' | 'code' | 'whiteboard' | 'timer' | 'cursor' | 'voice' | 'stage';
