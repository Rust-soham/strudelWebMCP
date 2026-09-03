import { Result } from 'better-result';

import {
  OperationCancelled,
  ReferenceLoadFailed,
  ReferenceNotLoaded,
} from '../../domain/errors.ts';
import type { ReferenceAudio } from '../../domain/model.ts';
import type { ReferenceRepository } from '../../domain/ports.ts';

type DecodedAudioMetadata = Readonly<{
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
}>;

type DecodeReferenceAudio = (encodedAudio: ArrayBuffer) => Promise<DecodedAudioMetadata>;
type CreateReferenceId = () => string;

const decodeWithWebAudio: DecodeReferenceAudio = async (encodedAudio) => {
  const { getAudioContext } = await import('@strudel/webaudio');
  return getAudioContext().decodeAudioData(encodedAudio);
};

const createReferenceId: CreateReferenceId = () => crypto.randomUUID();

const referenceDbName = 'strudel-webmcp-reference';
const referenceStoreName = 'reference';
const referenceKey = 'current';

const hasIndexedDb = (): boolean => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- IndexedDB is optional; feature detection requires typeof.
  return typeof indexedDB !== 'undefined';
};

const openReferenceDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(referenceDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(referenceStoreName)) {
        db.createObjectStore(referenceStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const persistReference = async (reference: ReferenceAudio): Promise<void> => {
  if (!hasIndexedDb()) return;
  try {
    const db = await openReferenceDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(referenceStoreName, 'readwrite');
      tx.objectStore(referenceStoreName).put(reference, referenceKey);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Persistence is best-effort; keep in-memory behaviour on failure.
  }
};

const loadPersistedReference = async (): Promise<ReferenceAudio | null> => {
  if (!hasIndexedDb()) return null;
  try {
    const db = await openReferenceDatabase();
    const stored = await new Promise<ReferenceAudio | null>((resolve, reject) => {
      const tx = db.transaction(referenceStoreName, 'readonly');
      const request = tx.objectStore(referenceStoreName).get(referenceKey);
      // SAFETY: Reference store contains only ReferenceAudio written by persistReference.
      request.onsuccess = () => resolve((request.result as ReferenceAudio | null) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return stored;
  } catch {
    return null;
  }
};

/** Stores the browser's currently loaded reference and decodes its acoustic metadata once. */
export class BrowserReferenceRepository implements ReferenceRepository {
  private reference: ReferenceAudio | null = null;
  private readonly ready: Promise<void>;

  /** Creates a repository with replaceable decode and identity boundaries for deterministic tests. */
  constructor(
    private readonly decode: DecodeReferenceAudio = decodeWithWebAudio,
    private readonly createId: CreateReferenceId = createReferenceId,
  ) {
    this.ready = this.hydrate();
  }

  /** Resolves when any persisted reference has been restored. */
  async waitUntilReady(): Promise<void> {
    await this.ready;
  }

  private async hydrate(): Promise<void> {
    const persisted = await loadPersistedReference();
    if (persisted !== null) {
      this.reference = persisted;
    }
  }

  /** Parses an uploaded audio file into the reference used by subsequent iterations. */
  async load(
    file: File,
    signal: AbortSignal,
  ): Promise<Result<ReferenceAudio, ReferenceLoadFailed | OperationCancelled>> {
    if (signal.aborted) {
      return Result.err(new OperationCancelled({ message: 'Reference loading was cancelled' }));
    }

    if (file.size === 0) {
      return Result.err(
        new ReferenceLoadFailed({
          cause: new Error('The selected file is empty'),
          fileName: file.name,
          message: 'The selected reference file is empty',
        }),
      );
    }

    try {
      const encodedAudio = await file.arrayBuffer();
      const decoded = await this.decode(encodedAudio);

      if (signal.aborted) {
        return Result.err(new OperationCancelled({ message: 'Reference loading was cancelled' }));
      }

      const reference = {
        id: this.createId(),
        blob: file,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        durationSeconds: decoded.duration,
        sampleRate: decoded.sampleRate,
        numberOfChannels: decoded.numberOfChannels,
      } satisfies ReferenceAudio;

      this.reference = reference;
      await persistReference(reference);
      return Result.ok(reference);
    } catch (cause) {
      return Result.err(
        new ReferenceLoadFailed({
          cause,
          fileName: file.name,
          message: 'The selected file could not be decoded as audio',
        }),
      );
    }
  }

  /** Clears the persisted reference. Useful for manual reset. */
  async clear(): Promise<void> {
    this.reference = null;
    if (!hasIndexedDb()) return;
    try {
      const db = await openReferenceDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(referenceStoreName, 'readwrite');
        tx.objectStore(referenceStoreName).delete(referenceKey);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Best-effort.
    }
  }

  /** Returns the currently loaded reference or a typed absence result. */
  async get(): Promise<Result<ReferenceAudio, ReferenceNotLoaded>> {
    return this.reference === null
      ? Result.err(new ReferenceNotLoaded({ message: 'Upload a reference audio file first' }))
      : Result.ok(this.reference);
  }
}
