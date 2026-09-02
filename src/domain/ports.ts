import type { Result as ResultType } from 'better-result';

import type {
  AnalysisFailed,
  AttemptRenderFailed,
  CheckpointWriteFailed,
  DraftReadFailed,
  OperationCancelled,
  ReferenceNotLoaded,
  StaleCheckpoint,
  StrudelEvaluationFailed,
} from './errors.ts';
import type {
  Checkpoint,
  CheckpointCandidate,
  Comparison,
  DraftProgram,
  EvaluatedProgram,
  ReferenceAudio,
  RenderDuration,
  RenderedAttempt,
  StrudelCode,
} from './model.ts';

export interface ProgramWorkspace {
  /** Reads the current editor state without owning editor undo history. */
  getDraft(): ResultType<DraftProgram, DraftReadFailed>;
  evaluate(
    code: StrudelCode,
  ): Promise<ResultType<EvaluatedProgram, StrudelEvaluationFailed | OperationCancelled>>;
}

export interface AttemptRenderer {
  /** Captures whole Strudel cycles so comparisons do not end mid-pattern. */
  render(
    program: EvaluatedProgram,
    duration: RenderDuration,
    signal: AbortSignal,
  ): Promise<ResultType<RenderedAttempt, AttemptRenderFailed | OperationCancelled>>;
}

export interface ReferenceRepository {
  get(): Promise<ResultType<ReferenceAudio, ReferenceNotLoaded>>;
}

export interface SimilarityAnalyzer {
  /** Produces measurements only; interpretation remains with the calling agent. */
  compare(
    reference: ReferenceAudio,
    attempt: RenderedAttempt,
    signal: AbortSignal,
  ): Promise<ResultType<Comparison, AnalysisFailed | OperationCancelled>>;
}

export interface CheckpointRepository {
  /** Atomically appends an immutable attempt under its expected parent. */
  commit(
    candidate: CheckpointCandidate,
  ): Promise<ResultType<Checkpoint, CheckpointWriteFailed | StaleCheckpoint | OperationCancelled>>;
}

export type RunIterationDependencies = Readonly<{
  programWorkspace: ProgramWorkspace;
  attemptRenderer: AttemptRenderer;
  referenceRepository: ReferenceRepository;
  similarityAnalyzer: SimilarityAnalyzer;
  checkpointRepository: CheckpointRepository;
}>;
