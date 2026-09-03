import type { Result } from 'better-result';

import type {
  AnalysisFailed,
  AudioNormalizationFailed,
  AttemptRenderFailed,
  CheckpointNotFound,
  CheckpointReadFailed,
  CheckpointWriteFailed,
  DraftReadFailed,
  DraftWriteFailed,
  OperationCancelled,
  ReferenceNotLoaded,
  StaleCheckpoint,
  StrudelEvaluationFailed,
} from './errors.ts';
import type {
  Checkpoint,
  CheckpointCandidate,
  CheckpointId,
  Comparison,
  DraftProgram,
  EvaluatedProgram,
  NormalizedAudio,
  ReferenceAudio,
  RenderDuration,
  RenderedAttempt,
  RestoredProgram,
  StrudelCode,
} from './model.ts';

export interface ProgramWorkspace {
  /** Reads the current editor state without owning editor undo history. */
  getDraft(): Result<DraftProgram, DraftReadFailed>;
  evaluate(
    code: StrudelCode,
    signal: AbortSignal,
  ): Promise<Result<EvaluatedProgram, StrudelEvaluationFailed | OperationCancelled>>;
  /** Replaces the editor draft and makes subsequent attempts branch from this checkpoint. */
  restore(program: RestoredProgram): Result<void, DraftWriteFailed>;
}

export interface AttemptRenderer {
  /** Captures whole Strudel cycles so comparisons do not end mid-pattern. */
  render(
    program: EvaluatedProgram,
    duration: RenderDuration,
    signal: AbortSignal,
  ): Promise<Result<RenderedAttempt, AttemptRenderFailed | OperationCancelled>>;
}

export interface ReferenceRepository {
  get(): Promise<Result<ReferenceAudio, ReferenceNotLoaded>>;
}

export interface SimilarityAnalyzer {
  /** Produces measurements only; interpretation remains with the calling agent. */
  compare(
    reference: ReferenceAudio,
    attempt: RenderedAttempt,
    signal: AbortSignal,
  ): Promise<Result<Comparison, AnalysisFailed | OperationCancelled>>;
}

export interface AudioNormalizer {
  /** Decodes encoded audio into mono PCM at the application's comparison sample rate. */
  normalize(
    blob: Blob,
    signal: AbortSignal,
  ): Promise<Result<NormalizedAudio, AudioNormalizationFailed | OperationCancelled>>;
}

export interface CheckpointRepository {
  getById(id: CheckpointId): Promise<Result<Checkpoint, CheckpointNotFound | CheckpointReadFailed>>;
  /** Atomically appends an immutable attempt under its expected parent. */
  commit(
    candidate: CheckpointCandidate,
  ): Promise<Result<Checkpoint, CheckpointWriteFailed | StaleCheckpoint | OperationCancelled>>;
}

export type RunIterationDependencies = Readonly<{
  programWorkspace: ProgramWorkspace;
  attemptRenderer: AttemptRenderer;
  referenceRepository: ReferenceRepository;
  similarityAnalyzer: SimilarityAnalyzer;
  checkpointRepository: CheckpointRepository;
}>;
