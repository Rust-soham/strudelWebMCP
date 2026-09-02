import { Result, TaggedError } from 'better-result';

declare const checkpointIdBrand: unique symbol;
declare const strudelCodeBrand: unique symbol;

export type CheckpointId = string & { readonly [checkpointIdBrand]: true };
export type StrudelCode = string & { readonly [strudelCodeBrand]: true };

export class InvalidCheckpointId extends TaggedError('InvalidCheckpointId')<{
  readonly input: string;
  readonly message: string;
}> {}

export class InvalidStrudelCode extends TaggedError('InvalidStrudelCode')<{
  readonly message: string;
}> {}

export const checkpointId = (input: string): Result<CheckpointId, InvalidCheckpointId> => {
  const value = input.trim();

  if (value.length === 0) {
    return Result.err(new InvalidCheckpointId({ input, message: 'Checkpoint id cannot be empty' }));
  }

  // SAFETY: Trimming and the length check establish the branded non-empty id invariant.
  return Result.ok(value as CheckpointId);
};

export const strudelCode = (input: string): Result<StrudelCode, InvalidStrudelCode> => {
  if (input.trim().length === 0) {
    return Result.err(new InvalidStrudelCode({ message: 'Strudel code cannot be empty' }));
  }

  // SAFETY: The length check establishes the branded non-empty source invariant.
  return Result.ok(input as StrudelCode);
};

export type ReferenceAudio = Readonly<{
  id: string;
  durationSeconds: number;
  sampleRate: number;
  numberOfChannels: number;
}>;

export type DraftProgram = Readonly<{
  baseCheckpointId: CheckpointId | null;
  code: StrudelCode;
  changeSummary: string;
}>;

export type RestoredProgram = Readonly<{
  baseCheckpointId: CheckpointId;
  code: StrudelCode;
}>;

export type EvaluatedProgram = Readonly<{
  code: StrudelCode;
  cycleDurationSeconds: number;
}>;

export type RenderDuration = Readonly<{
  cycles: number;
}>;

export type RenderedAttempt = Readonly<{
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}>;

export type MeasurementName =
  | 'tempo'
  | 'onsetAlignment'
  | 'eventDensity'
  | 'chroma'
  | 'energyEnvelope'
  | 'spectralProfile';

export type Measurement = Readonly<{
  name: MeasurementName;
  similarity: number;
  referenceValue?: number;
  attemptValue?: number;
}>;

export type AnalysisWarning = Readonly<{
  feature: MeasurementName;
  message: string;
}>;

export type Comparison = Readonly<{
  measurements: ReadonlyArray<Measurement>;
  warnings: ReadonlyArray<AnalysisWarning>;
  completeness: number;
}>;

export type CheckpointCandidate = Readonly<{
  parentId: CheckpointId | null;
  code: StrudelCode;
  audio: RenderedAttempt;
  comparison: Comparison;
  changeSummary: string;
}>;

/** An immutable, playable record of one completed agent iteration. */
export type Checkpoint = CheckpointCandidate &
  Readonly<{
    id: CheckpointId;
    createdAt: Date;
  }>;

export type RunIterationCommand = Readonly<{
  duration: RenderDuration;
}>;
