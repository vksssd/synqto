// ─── Persistent Peer Identity & Reconnection Hints ───
//
// What can and cannot be cached across sessions, and why the distinction matters.
//
// CANNOT BE CACHED — ICE candidates and SDP. This is worth stating plainly because it is the
// intuitive thing to try and it cannot be made to work:
//
//   * A host candidate is an address plus a port allocated per RTCPeerConnection and released
//     when it closes. Replaying it points at nothing, or at whatever took the port next.
//   * A server-reflexive candidate is the NAT's mapping for that specific local port. UDP
//     bindings expire in 30 seconds to a few minutes.
//   * A relay candidate is a TURN allocation with a lifetime tied to credentials.
//   * SDP carries `ice-ufrag` and `ice-pwd`, which browsers regenerate every session.
//     Replaying old SDP fails the handshake by design — that is the anti-replay mechanism.
//
// Two NATed hosts cannot discover each other's *current* transport addresses without either
// a third party or a pre-shared address. That is information-theoretic, not a gap in the
// implementation, and no amount of caching changes it.
//
// CAN BE CACHED, AND IS WORTH CACHING:
//
//   1. The DTLS certificate. RTCCertificate is structured-cloneable, so it survives in
//      IndexedDB. This gives a peer a stable cryptographic identity across sessions — the
//      fingerprint in its SDP stays the same — so a returning peer can be recognised
//      without the server vouching for it, and an impersonator using the same peer ID with
//      a different key is detectable.
//
//   2. Room membership and topology, from the link-state database. A returning peer then
//      needs to reach exactly ONE live member and learns the rest from the mesh.
//
//   3. Which ICE candidate type actually worked last time. If a peer needed TURN before, it
//      will almost certainly need TURN again — same NATs, same network. Skipping the doomed
//      direct attempt removes several seconds from reconnection.
//
// The honest ceiling: this reduces server dependency to one bootstrap contact per cold
// start. It does not eliminate it.

import { PeerId, RoomId } from '../types/identifiers';

const DB_NAME = 'synqto_identity';
const DB_VERSION = 1;
const STORE_CERT = 'certificates';
const STORE_ROOMS = 'rooms';
const STORE_HINTS = 'peer_hints';

/** How a peer was last reached. Drives iceTransportPolicy on the next attempt. */
export type CandidateKind = 'host' | 'srflx' | 'relay';

export interface PeerHint {
  peerId: PeerId;
  /** Candidate type that carried the successful connection. */
  lastSuccessfulKind: CandidateKind;
  /** DTLS fingerprint observed last time, for impersonation detection. */
  fingerprint?: string;
  lastSeenAt: number;
  successCount: number;
  failureCount: number;
}

export interface RoomSnapshot {
  roomId: RoomId;
  /** Peers known to have been in the room. */
  members: PeerId[];
  /** Verified topology, for warm-starting the routing table. */
  topology: Array<{ a: PeerId; b: PeerId; costMs: number }>;
  savedAt: number;
}

/** Snapshots older than this are discarded — the room has almost certainly moved on. */
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Bounds on stored state: this is a browser profile, not a database. */
const MAX_ROOMS = 50;
const MAX_HINTS = 500;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CERT)) db.createObjectStore(STORE_CERT);
      if (!db.objectStoreNames.contains(STORE_ROOMS)) db.createObjectStore(STORE_ROOMS, { keyPath: 'roomId' });
      if (!db.objectStoreNames.contains(STORE_HINTS)) db.createObjectStore(STORE_HINTS, { keyPath: 'peerId' });
    };
    req.onsuccess = () => resolve(req.result);
    // Private browsing, disabled storage, or a corrupt database. Every caller degrades to
    // "no cache", which is exactly the pre-existing behaviour.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class PeerIdentityStore {
  private static instance: PeerIdentityStore | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private certificate: RTCCertificate | null = null;

  public static getInstance(): PeerIdentityStore {
    if (!PeerIdentityStore.instance) PeerIdentityStore.instance = new PeerIdentityStore();
    return PeerIdentityStore.instance;
  }

  private db(): Promise<IDBDatabase | null> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DTLS certificate
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Returns a certificate that is stable across browser restarts, generating and persisting
   * one on first use.
   *
   * Stability is the point. Without it a peer's DTLS fingerprint changes every session, so
   * "is this the same peer who was here a minute ago" is a question only the server can
   * answer. With it, the mesh can answer for itself.
   *
   * An expired certificate is regenerated: RTCPeerConnection rejects one past its expiry, so
   * returning it would break every connection rather than merely losing continuity.
   */
  public async getCertificate(): Promise<RTCCertificate | null> {
    if (this.certificate && this.certificate.expires > Date.now() + 60_000) {
      return this.certificate;
    }
    if (typeof RTCPeerConnection === 'undefined') return null;

    const db = await this.db();
    if (db) {
      const stored = await tx<RTCCertificate>(db, STORE_CERT, 'readonly', (s) => s.get('self'));
      if (stored && typeof stored.expires === 'number' && stored.expires > Date.now() + 60_000) {
        this.certificate = stored;
        return stored;
      }
    }

    try {
      const cert = await RTCPeerConnection.generateCertificate({
        name: 'ECDSA',
        namedCurve: 'P-256',
      } as any);
      this.certificate = cert;
      if (db) await tx(db, STORE_CERT, 'readwrite', (s) => s.put(cert, 'self'));
      return cert;
    } catch {
      // Certificate generation can fail on old browsers or restricted contexts. Returning
      // null lets WebRTC generate an ephemeral one, which is the old behaviour.
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Room snapshots
  // ───────────────────────────────────────────────────────────────────────────

  public async saveRoomSnapshot(snapshot: Omit<RoomSnapshot, 'savedAt'>): Promise<void> {
    const db = await this.db();
    if (!db || !snapshot.roomId) return;

    await tx(db, STORE_ROOMS, 'readwrite', (s) =>
      s.put({ ...snapshot, savedAt: Date.now() } as RoomSnapshot)
    );
    await this.pruneRooms();
  }

  public async getRoomSnapshot(roomId: RoomId): Promise<RoomSnapshot | null> {
    const db = await this.db();
    if (!db) return null;

    const snap = await tx<RoomSnapshot>(db, STORE_ROOMS, 'readonly', (s) => s.get(roomId));
    if (!snap) return null;

    // A stale snapshot is worse than none: it would send a returning peer chasing members
    // who left hours ago, delaying the fallback that would actually have worked.
    if (Date.now() - snap.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
    return snap;
  }

  private async pruneRooms(): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const all = await tx<RoomSnapshot[]>(db, STORE_ROOMS, 'readonly', (s) => s.getAll());
    if (!all || all.length <= MAX_ROOMS) return;

    const doomed = all.sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - MAX_ROOMS);
    for (const room of doomed) {
      await tx(db, STORE_ROOMS, 'readwrite', (s) => s.delete(room.roomId));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Per-peer connection hints
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Records how a connection to this peer was established.
   *
   * The useful signal is the candidate type. A peer behind a symmetric NAT needed TURN last
   * time and will need it again — the NATs have not changed — so the next attempt can go
   * straight to relay instead of spending the full ICE timeout discovering that direct
   * connectivity is impossible.
   */
  public async recordSuccess(
    peerId: PeerId,
    kind: CandidateKind,
    fingerprint?: string
  ): Promise<void> {
    const db = await this.db();
    if (!db) return;

    const existing = await tx<PeerHint>(db, STORE_HINTS, 'readonly', (s) => s.get(peerId));
    const hint: PeerHint = {
      peerId,
      lastSuccessfulKind: kind,
      fingerprint: fingerprint ?? existing?.fingerprint,
      lastSeenAt: Date.now(),
      successCount: (existing?.successCount ?? 0) + 1,
      failureCount: existing?.failureCount ?? 0,
    };
    await tx(db, STORE_HINTS, 'readwrite', (s) => s.put(hint));
    await this.pruneHints();
  }

  public async recordFailure(peerId: PeerId): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const existing = await tx<PeerHint>(db, STORE_HINTS, 'readonly', (s) => s.get(peerId));
    if (!existing) return;
    await tx(db, STORE_HINTS, 'readwrite', (s) =>
      s.put({ ...existing, failureCount: existing.failureCount + 1, lastSeenAt: Date.now() })
    );
  }

  public async getHint(peerId: PeerId): Promise<PeerHint | null> {
    const db = await this.db();
    if (!db) return null;
    return (await tx<PeerHint>(db, STORE_HINTS, 'readonly', (s) => s.get(peerId))) ?? null;
  }

  /**
   * Whether a peer should skip straight to relay candidates.
   *
   * Requires repeated evidence rather than a single observation: one TURN success might have
   * been a transient network condition, and forcing relay unnecessarily makes a connection
   * that could have been direct both slower and dependent on someone else's TURN server.
   */
  public async shouldForceRelay(peerId: PeerId): Promise<boolean> {
    const hint = await this.getHint(peerId);
    if (!hint) return false;
    return hint.lastSuccessfulKind === 'relay' && hint.successCount >= 2;
  }

  /**
   * Detects a peer ID presenting a different DTLS fingerprint than we recorded.
   *
   * Returns false for an unknown peer or an unknown fingerprint — absence of evidence is not
   * evidence of impersonation, and treating it as such would break every legitimate first
   * connection.
   */
  public async isFingerprintMismatch(peerId: PeerId, fingerprint: string): Promise<boolean> {
    if (!fingerprint) return false;
    const hint = await this.getHint(peerId);
    if (!hint?.fingerprint) return false;
    return hint.fingerprint !== fingerprint;
  }

  private async pruneHints(): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const all = await tx<PeerHint[]>(db, STORE_HINTS, 'readonly', (s) => s.getAll());
    if (!all || all.length <= MAX_HINTS) return;

    const doomed = all.sort((a, b) => a.lastSeenAt - b.lastSeenAt).slice(0, all.length - MAX_HINTS);
    for (const hint of doomed) {
      await tx(db, STORE_HINTS, 'readwrite', (s) => s.delete(hint.peerId));
    }
  }

  public async clear(): Promise<void> {
    const db = await this.db();
    if (!db) return;
    for (const store of [STORE_CERT, STORE_ROOMS, STORE_HINTS]) {
      await tx(db, store, 'readwrite', (s) => s.clear());
    }
    this.certificate = null;
  }
}

/** Extracts the DTLS fingerprint from an SDP blob, for identity pinning. */
export function extractFingerprint(sdp: string | undefined): string | undefined {
  if (!sdp) return undefined;
  const match = /^a=fingerprint:\s*\S+\s+(\S+)/m.exec(sdp);
  return match?.[1];
}

/** Reads the candidate type that carried a connection, from its selected pair. */
export async function detectCandidateKind(
  pc: RTCPeerConnection
): Promise<CandidateKind | null> {
  try {
    const stats = await pc.getStats();
    let selectedPairId: string | undefined;

    stats.forEach((report: any) => {
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        selectedPairId = report.selectedCandidatePairId;
      }
    });

    let localCandidateId: string | undefined;
    stats.forEach((report: any) => {
      const isSelected =
        report.type === 'candidate-pair' &&
        (report.id === selectedPairId || (report.selected && report.state === 'succeeded'));
      if (isSelected) localCandidateId = report.localCandidateId;
    });

    let kind: CandidateKind | null = null;
    stats.forEach((report: any) => {
      if (report.type === 'local-candidate' && report.id === localCandidateId) {
        if (report.candidateType === 'relay') kind = 'relay';
        else if (report.candidateType === 'srflx' || report.candidateType === 'prflx') kind = 'srflx';
        else kind = 'host';
      }
    });
    return kind;
  } catch {
    return null;
  }
}
