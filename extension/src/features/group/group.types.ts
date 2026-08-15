// ─── Group / Community Types ───

export interface GroupSchedule {
  openTime?: string;     // e.g. "19:00"
  closeTime?: string;    // e.g. "21:00"
  timezone?: string;     // e.g. "IST", "EST"
  days?: string[];       // e.g. ["Mon","Wed","Fri"]
}

export interface StudyGroup {
  id: string;              // unique local ID
  name: string;            // group title (e.g. "LeetCode Grind Squad" or "Two Sum")
  slug: string;            // cleaned slug
  description?: string;    // group objective or problem URL
  goals?: string;          // group mission statement / goals
  rules?: string;          // group rules text
  schedule?: GroupSchedule;// when everyone should be online to discuss
  avatar: string;          // emoji icon (e.g. 🚀, 💻, 🧠, ⚡)
  isPrivate: boolean;      // true if password protected
  passwordHash?: string;   // local sha256 verification hash
  topicTag: string;        // category (e.g. "LeetCode", "System Design", "Problems")
  tags?: string[];         // #tag sub-channels (e.g. ["#general","#doubts","#resources"])
  activeTag?: string;      // currently selected sub-channel
  roomId: string;          // derived deterministic signaling room ID
  createdAt: number;       // timestamp
  creatorPeerId?: string;  // peer ID of creator
  adminPeerIds?: string[]; // peer IDs who can edit group info
  isCreator?: boolean;
  isMember?: boolean;      // true if user has joined and is persistent member
  joinedAt?: number;       // timestamp when user joined
  memberCount?: number;    // online buddies count
  isProblemGroup?: boolean;// true if auto-created from problem detection
  canonicalUrl?: string;   // problem link
  lastMessagePreview?: string;
  lastMessageTimestamp?: number;
  welcomeMessageRead?: boolean; // has this user read the welcome/rules message?
}

export interface CreateGroupParams {
  name: string;
  description?: string;
  goals?: string;
  rules?: string;
  schedule?: GroupSchedule;
  avatar: string;
  isPrivate: boolean;
  password?: string;
  topicTag?: string;
  tags?: string[];
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
