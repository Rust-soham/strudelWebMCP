import { Result } from 'better-result';

import {
  CheckpointNotFound,
  CheckpointReadFailed,
  CheckpointWriteFailed,
  OperationCancelled,
  StaleCheckpoint,
} from '../../domain/errors.ts';
import { checkpointId } from '../../domain/model.ts';
import type { Checkpoint, CheckpointCandidate, CheckpointId } from '../../domain/model.ts';
import type { CheckpointRepository } from '../../domain/ports.ts';

const dbName = 'strudel-webmcp';
const dbVersion = 1;
const storeCheckpoints = 'checkpoints';
const storeMeta = 'meta';
const metaKey = 'head';

type MetaRecord = Readonly<{
  key: string;
  headId: CheckpointId | null;
  nextSequence: number;
}>;

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeCheckpoints)) {
        db.createObjectStore(storeCheckpoints, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(storeMeta)) {
        db.createObjectStore(storeMeta, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getMeta = (db: IDBDatabase): Promise<MetaRecord | undefined> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(storeMeta, 'readonly');
    const request = tx.objectStore(storeMeta).get(metaKey);
    // SAFETY: Object store schema guarantees MetaRecord shape for key head.
    request.onsuccess = () => resolve(request.result as MetaRecord | undefined);
    request.onerror = () => reject(request.error);
  });

const putMeta = (db: IDBDatabase, meta: MetaRecord): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(storeMeta, 'readwrite');
    tx.objectStore(storeMeta).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

const getAllCheckpoints = (db: IDBDatabase): Promise<ReadonlyArray<Checkpoint>> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(storeCheckpoints, 'readonly');
    const request = tx.objectStore(storeCheckpoints).getAll();
    // SAFETY: Checkpoints store contains only Checkpoint objects written by putCheckpoint.
    request.onsuccess = () => resolve((request.result as ReadonlyArray<Checkpoint>) ?? []);
    request.onerror = () => reject(request.error);
  });

const putCheckpoint = (db: IDBDatabase, checkpoint: Checkpoint): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(storeCheckpoints, 'readwrite');
    tx.objectStore(storeCheckpoints).put(checkpoint);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

const hasIndexedDb = (): boolean => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- IndexedDB is optional; feature detection requires typeof.
  return typeof indexedDB !== 'undefined';
};

/** Durable checkpoint history that survives page reloads. Falls back to memory when IndexedDB is unavailable. */
export class IndexedDbCheckpointRepository implements CheckpointRepository {
  private readonly checkpoints = new Map<CheckpointId, Checkpoint>();
  private headId: CheckpointId | null = null;
  private nextSequence = 1;
  private readonly ready: Promise<void>;
  private db: IDBDatabase | null = null;

  constructor() {
    this.ready = hasIndexedDb() ? this.hydrate() : Promise.resolve();
  }

  /** Resolves when persisted history has been restored. */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  private async hydrate(): Promise<void> {
    try {
      const db = await openDatabase();
      this.db = db;
      const meta = await getMeta(db);
      if (meta !== undefined) {
        this.headId = meta.headId;
        this.nextSequence = meta.nextSequence;
      }
      const stored = await getAllCheckpoints(db);
      for (const checkpoint of stored) {
        const rawCreatedAt: unknown = checkpoint.createdAt;
        // SAFETY: IDB deserialization may return string for Date; string constructor handles both.
        const createdAt =
          rawCreatedAt instanceof Date ? rawCreatedAt : new Date(rawCreatedAt as string);
        this.checkpoints.set(checkpoint.id, { ...checkpoint, createdAt });
      }
      // Derive nextSequence if missing from meta (legacy data).
      if (stored.length > 0) {
        const maxSequence = stored.reduce((max, cp) => {
          const n = Number.parseInt(cp.id.slice(1), 10);
          return Number.isNaN(n) ? max : Math.max(max, n);
        }, 0);
        this.nextSequence = Math.max(this.nextSequence, maxSequence + 1);
      }
    } catch {
      // Persistence is best-effort; keep in-memory behaviour on failure.
      this.db = null;
    }
  }

  /** Reads one immutable checkpoint by identifier. */
  async getById(
    id: CheckpointId,
  ): Promise<Result<Checkpoint, CheckpointNotFound | CheckpointReadFailed>> {
    await this.ready;
    const checkpoint = this.checkpoints.get(id);
    if (checkpoint !== undefined) return Result.ok(checkpoint);

    // Fallback: try direct IDB read for cross-tab consistency.
    if (this.db !== null) {
      try {
        const stored = await new Promise<Checkpoint | undefined>((resolve, reject) => {
          const tx = this.db!.transaction(storeCheckpoints, 'readonly');
          const request = tx.objectStore(storeCheckpoints).get(id);
          // SAFETY: Checkpoints store returns Checkpoint or undefined for id lookup.
          request.onsuccess = () => resolve(request.result as Checkpoint | undefined);
          request.onerror = () => reject(request.error);
        });
        if (stored !== undefined) {
          this.checkpoints.set(stored.id, stored);
          return Result.ok(stored);
        }
      } catch (cause) {
        return Result.err(
          new CheckpointReadFailed({ cause, message: 'Could not read checkpoint' }),
        );
      }
    }

    return Result.err(
      new CheckpointNotFound({ checkpointId: id, message: `Checkpoint ${id} was not found` }),
    );
  }

  /** Selects a previously read checkpoint as the parent for the active branch. */
  setHead(id: CheckpointId): void {
    this.headId = id;
    if (this.db !== null) {
      void putMeta(this.db, {
        key: metaKey,
        headId: this.headId,
        nextSequence: this.nextSequence,
      }).catch(() => {});
    }
  }

  /** Atomically appends an immutable attempt under its expected parent. */
  async commit(
    candidate: CheckpointCandidate,
  ): Promise<Result<Checkpoint, CheckpointWriteFailed | StaleCheckpoint | OperationCancelled>> {
    await this.ready;
    if (candidate.parentId !== this.headId) {
      return Result.err(
        new StaleCheckpoint({
          expectedParentId: candidate.parentId,
          actualParentId: this.headId,
          message: 'The draft is based on an older checkpoint',
        }),
      );
    }

    const parsedId = checkpointId(`a${this.nextSequence}`);
    if (parsedId.isErr()) {
      return Result.err(
        new CheckpointWriteFailed({
          cause: parsedId.error,
          retryable: false,
          message: 'Could not allocate a checkpoint identifier',
        }),
      );
    }

    const checkpoint: Checkpoint = {
      ...candidate,
      id: parsedId.value,
      createdAt: new Date(),
    };

    try {
      if (this.db !== null) {
        await putCheckpoint(this.db, checkpoint);
        await putMeta(this.db, {
          key: metaKey,
          headId: checkpoint.id,
          nextSequence: this.nextSequence + 1,
        });
      }
    } catch (cause) {
      return Result.err(
        new CheckpointWriteFailed({
          cause,
          retryable: true,
          message: 'Could not persist checkpoint',
        }),
      );
    }

    this.checkpoints.set(checkpoint.id, checkpoint);
    this.headId = checkpoint.id;
    this.nextSequence += 1;
    return Result.ok(checkpoint);
  }

  /** Lists checkpoint history in commit order for the visible iteration timeline. */
  list(): ReadonlyArray<Checkpoint> {
    return [...this.checkpoints.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /** Returns the current history head, or null before the first attempt. */
  getHeadId(): CheckpointId | null {
    return this.headId;
  }

  /** Clears persisted history. Useful for manual reset. */
  async clear(): Promise<void> {
    await this.ready;
    this.checkpoints.clear();
    this.headId = null;
    this.nextSequence = 1;
    if (this.db === null) return;
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction([storeCheckpoints, storeMeta], 'readwrite');
      tx.objectStore(storeCheckpoints).clear();
      tx.objectStore(storeMeta).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
