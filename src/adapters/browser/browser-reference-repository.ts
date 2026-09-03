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

/** Stores the browser's currently loaded reference and decodes its acoustic metadata once. */
export class BrowserReferenceRepository implements ReferenceRepository {
  private reference: ReferenceAudio | null = null;

  /** Creates a repository with replaceable decode and identity boundaries for deterministic tests. */
  constructor(
    private readonly decode: DecodeReferenceAudio = decodeWithWebAudio,
    private readonly createId: CreateReferenceId = createReferenceId,
  ) {}

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

  /** Returns the currently loaded reference or a typed absence result. */
  async get(): Promise<Result<ReferenceAudio, ReferenceNotLoaded>> {
    return this.reference === null
      ? Result.err(new ReferenceNotLoaded({ message: 'Upload a reference audio file first' }))
      : Result.ok(this.reference);
  }
}
