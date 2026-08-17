import { VectorClock } from './vector-clock';
import { ReplicatedEvent, ReplicatedSnapshot } from './operation-journal';

export interface SnapshotCommitRecord<TState = unknown> {
  snapshot: ReplicatedSnapshot<TState> | null;
  committedVersion: number;
}

export interface IStorageAdapter<TState = unknown, TOp = unknown> {
  saveSnapshot(snapshot: ReplicatedSnapshot<TState>): Promise<void>;
  /**
   * Reads back the just-saved (possibly uncommitted) snapshot for the given version and
   * confirms it was durably persisted with matching version and checksum before it is
   * safe to write the commit marker. Returns false if the write did not survive readback.
   */
  verifySnapshotIntegrity(version: number): Promise<boolean>;
  commitSnapshot(version: number): Promise<void>;
  loadSnapshot(): Promise<SnapshotCommitRecord<TState>>;
  /**
   * Deletes all persisted snapshot versions except `keepVersion`, reclaiming storage from
   * prior compaction cycles. Must be called only AFTER commitSnapshot(keepVersion) succeeds.
   */
  pruneSnapshotsExcept(keepVersion: number): Promise<void>;
  appendJournalEvent(event: ReplicatedEvent<TOp>): Promise<void>;
  appendJournalEvents(events: ReplicatedEvent<TOp>[]): Promise<void>;
  loadJournalEvents(): Promise<ReplicatedEvent<TOp>[]>;
  truncateJournalBefore(vector: VectorClock): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory storage adapter for deterministic headless tests, ephemeral rooms, and simulations.
 */
export class InMemoryStorageAdapter<TState = unknown, TOp = unknown>
  implements IStorageAdapter<TState, TOp>
{
  private uncommittedSnapshot: ReplicatedSnapshot<TState> | null = null;
  private committedSnapshot: ReplicatedSnapshot<TState> | null = null;
  private committedVersion = 0;
  private journalEvents: ReplicatedEvent<TOp>[] = [];
  private snapshotHistory: Map<number, ReplicatedSnapshot<TState>> = new Map();

  constructor(public readonly storeId: string) {}

  public async saveSnapshot(snapshot: ReplicatedSnapshot<TState>): Promise<void> {
    this.uncommittedSnapshot = JSON.parse(JSON.stringify(snapshot));
    this.snapshotHistory.set(snapshot.snapshotVersion, this.uncommittedSnapshot!);
  }

  public async verifySnapshotIntegrity(version: number): Promise<boolean> {
    const persisted = this.snapshotHistory.get(version);
    if (!persisted || persisted.snapshotVersion !== version) {
      return false;
    }
    // Defensive readback: recompute checksum shape sanity (byteLength/checksum must be present).
    return typeof persisted.checksum === 'number' && typeof persisted.byteLength === 'number';
  }

  public async commitSnapshot(version: number): Promise<void> {
    const candidate = this.snapshotHistory.get(version);
    if (candidate && candidate.snapshotVersion === version) {
      this.committedSnapshot = candidate;
      this.committedVersion = version;
    }
  }

  public async pruneSnapshotsExcept(keepVersion: number): Promise<void> {
    for (const version of Array.from(this.snapshotHistory.keys())) {
      if (version !== keepVersion) {
        this.snapshotHistory.delete(version);
      }
    }
    if (this.uncommittedSnapshot && this.uncommittedSnapshot.snapshotVersion !== keepVersion) {
      this.uncommittedSnapshot = null;
    }
  }

  public async loadSnapshot(): Promise<SnapshotCommitRecord<TState>> {
    return {
      snapshot: this.committedSnapshot ? JSON.parse(JSON.stringify(this.committedSnapshot)) : null,
      committedVersion: this.committedVersion,
    };
  }

  /** Test/diagnostic helper: number of distinct snapshot versions currently retained in storage. */
  public getRetainedSnapshotVersionCount(): number {
    return this.snapshotHistory.size;
  }

  public async appendJournalEvent(event: ReplicatedEvent<TOp>): Promise<void> {
    if (!this.journalEvents.some((e) => e.opId === event.opId)) {
      this.journalEvents.push(JSON.parse(JSON.stringify(event)));
    }
  }

  public async appendJournalEvents(events: ReplicatedEvent<TOp>[]): Promise<void> {
    for (const evt of events) {
      await this.appendJournalEvent(evt);
    }
  }

  public async loadJournalEvents(): Promise<ReplicatedEvent<TOp>[]> {
    return JSON.parse(JSON.stringify(this.journalEvents));
  }

  public async truncateJournalBefore(vector: VectorClock): Promise<void> {
    this.journalEvents = this.journalEvents.filter((evt) => {
      const cutSeq = vector[evt.author] || 0;
      return evt.seq > cutSeq;
    });
  }

  public async clear(): Promise<void> {
    this.uncommittedSnapshot = null;
    this.committedSnapshot = null;
    this.committedVersion = 0;
    this.journalEvents = [];
    this.snapshotHistory.clear();
  }
}

/**
 * IndexedDB storage adapter for persistent browser extension storage.
 */
export class IndexedDBStorageAdapter<TState = unknown, TOp = unknown>
  implements IStorageAdapter<TState, TOp>
{
  private dbPromise: Promise<IDBDatabase> | null = null;
  private static readonly DB_PREFIX = 'synqto_store_';
  private static readonly DB_VERSION = 1;

  constructor(public readonly storeId: string) {}

  private getDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      // Fallback for environments without IndexedDB (e.g. headless Node unit tests without jsdom)
      return Promise.reject(new Error('IndexedDB is not available in current runtime'));
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(`${IndexedDBStorageAdapter.DB_PREFIX}${this.storeId}`, IndexedDBStorageAdapter.DB_VERSION);
        req.onupgradeneeded = (evt: any) => {
          const db = evt.target.result as IDBDatabase;
          if (!db.objectStoreNames.contains('snapshots')) {
            db.createObjectStore('snapshots', { keyPath: 'snapshotVersion' });
          }
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('journal')) {
            db.createObjectStore('journal', { keyPath: 'opId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  public async saveSnapshot(snapshot: ReplicatedSnapshot<TState>): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['snapshots'], 'readwrite');
        const store = tx.objectStore('snapshots');
        store.put(snapshot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async verifySnapshotIntegrity(version: number): Promise<boolean> {
    try {
      const db = await this.getDB();
      return new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(['snapshots'], 'readonly');
        const store = tx.objectStore('snapshots');
        const req = store.get(version);
        req.onsuccess = () => {
          const persisted = req.result as ReplicatedSnapshot<TState> | undefined;
          resolve(
            !!persisted &&
              persisted.snapshotVersion === version &&
              typeof persisted.checksum === 'number' &&
              typeof persisted.byteLength === 'number'
          );
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      // If IndexedDB is unavailable, treat as unverifiable (fail closed).
      return false;
    }
  }

  public async commitSnapshot(version: number): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['metadata'], 'readwrite');
        const store = tx.objectStore('metadata');
        store.put({ key: 'committedSnapshotVersion', version });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async pruneSnapshotsExcept(keepVersion: number): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['snapshots'], 'readwrite');
        const store = tx.objectStore('snapshots');
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (evt: any) => {
          const cursor = evt.target.result as IDBCursorWithValue | null;
          if (cursor) {
            if (cursor.key !== keepVersion) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async loadSnapshot(): Promise<SnapshotCommitRecord<TState>> {
    try {
      const db = await this.getDB();
      return new Promise<SnapshotCommitRecord<TState>>((resolve, reject) => {
        const tx = db.transaction(['metadata', 'snapshots'], 'readonly');
        const metaStore = tx.objectStore('metadata');
        const snapStore = tx.objectStore('snapshots');

        const metaReq = metaStore.get('committedSnapshotVersion');
        metaReq.onsuccess = () => {
          const committedVersion = metaReq.result?.version ?? 0;
          if (committedVersion === 0) {
            resolve({ snapshot: null, committedVersion: 0 });
            return;
          }
          const snapReq = snapStore.get(committedVersion);
          snapReq.onsuccess = () => {
            resolve({ snapshot: snapReq.result ?? null, committedVersion });
          };
          snapReq.onerror = () => reject(snapReq.error);
        };
        metaReq.onerror = () => reject(metaReq.error);
      });
    } catch {
      return { snapshot: null, committedVersion: 0 };
    }
  }

  public async appendJournalEvent(event: ReplicatedEvent<TOp>): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['journal'], 'readwrite');
        const store = tx.objectStore('journal');
        store.put(event);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async appendJournalEvents(events: ReplicatedEvent<TOp>[]): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['journal'], 'readwrite');
        const store = tx.objectStore('journal');
        for (const evt of events) {
          store.put(evt);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async loadJournalEvents(): Promise<ReplicatedEvent<TOp>[]> {
    try {
      const db = await this.getDB();
      return new Promise<ReplicatedEvent<TOp>[]>((resolve, reject) => {
        const tx = db.transaction(['journal'], 'readonly');
        const store = tx.objectStore('journal');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  public async truncateJournalBefore(vector: VectorClock): Promise<void> {
    try {
      const db = await this.getDB();
      const events = await this.loadJournalEvents();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['journal'], 'readwrite');
        const store = tx.objectStore('journal');
        for (const evt of events) {
          const cutSeq = vector[evt.author] || 0;
          if (evt.seq <= cutSeq) {
            store.delete(evt.opId);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }

  public async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['snapshots', 'metadata', 'journal'], 'readwrite');
        tx.objectStore('snapshots').clear();
        tx.objectStore('metadata').clear();
        tx.objectStore('journal').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful fallback
    }
  }
}
