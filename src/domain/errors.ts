import { TaggedError } from 'better-result';

import type { CheckpointId } from './model.ts';

export class ReferenceNotLoaded extends TaggedError('ReferenceNotLoaded')<{
  readonly message: string;
}> {}

export class DraftReadFailed extends TaggedError('DraftReadFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class StrudelEvaluationFailed extends TaggedError('StrudelEvaluationFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class AttemptRenderFailed extends TaggedError('AttemptRenderFailed')<{
  readonly cause: unknown;
  readonly retryable: boolean;
  readonly message: string;
}> {}

export class AnalysisFailed extends TaggedError('AnalysisFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class CheckpointWriteFailed extends TaggedError('CheckpointWriteFailed')<{
  readonly cause: unknown;
  readonly retryable: boolean;
  readonly message: string;
}> {}

export class StaleCheckpoint extends TaggedError('StaleCheckpoint')<{
  readonly expectedParentId: CheckpointId | null;
  readonly actualParentId: CheckpointId | null;
  readonly message: string;
}> {}

export class OperationCancelled extends TaggedError('OperationCancelled')<{
  readonly message: string;
}> {}

export type RunIterationError =
  | ReferenceNotLoaded
  | DraftReadFailed
  | StrudelEvaluationFailed
  | AttemptRenderFailed
  | AnalysisFailed
  | CheckpointWriteFailed
  | StaleCheckpoint
  | OperationCancelled;
