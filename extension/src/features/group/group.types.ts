// ─── Group / Community Types ───

export interface StudyGroup {
  id: string;              // unique local ID
  name: string;            // group title (e.g. "LeetCode Grind Squad" or "Two Sum")
  slug: string;            // cleaned slug
  description?: string;    // group objective or problem URL
  avatar: string;          // emoji icon (e.g. 🚀, 💻, 🧠, ⚡)
  isPrivate: boolean;      // true if password protected
  passwordHash?: string;   // local sha256 verification hash
  topicTag: string;        // category (e.g. "LeetCode", "System Design", "Problems")
  roomId: string;          // derived deterministic signaling room ID
  createdAt: number;       // timestamp
  creatorPeerId?: string;  // peer ID of creator
  isCreator?: boolean;
  isMember?: boolean;      // true if user has joined and is persistent member
  joinedAt?: number;       // timestamp when user joined
  memberCount?: number;    // online buddies count
  isProblemGroup?: boolean;// true if auto-created from problem detection
  canonicalUrl?: string;   // problem link
  lastMessagePreview?: string;
  lastMessageTimestamp?: number;
}

export interface CreateGroupParams {
  name: string;
  description?: string;
  avatar: string;
  isPrivate: boolean;
  password?: string;
  topicTag?: string;
}

export interface GroupInvitePayload {
  version: number;
  name: string;
  slug: string;
  avatar: string;
  isPrivate: boolean;
  topicTag?: string;
  description?: string;
  pwd?: string;
}
