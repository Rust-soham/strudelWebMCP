import { TaggedError } from 'better-result';

import type { CheckpointId } from './model.ts';

export class ReferenceNotLoaded extends TaggedError('ReferenceNotLoaded')<{
  readonly message: string;
}> {}

export class ReferenceLoadFailed extends TaggedError('ReferenceLoadFailed')<{
  readonly cause: unknown;
  readonly fileName: string;
  readonly message: string;
}> {}

export class DraftReadFailed extends TaggedError('DraftReadFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class DraftWriteFailed extends TaggedError('DraftWriteFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class StrudelEvaluationFailed extends TaggedError('StrudelEvaluationFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class StrudelPlaybackFailed extends TaggedError('StrudelPlaybackFailed')<{
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

export class CheckpointReadFailed extends TaggedError('CheckpointReadFailed')<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export class CheckpointNotFound extends TaggedError('CheckpointNotFound')<{
  readonly checkpointId: CheckpointId;
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

export type RestoreCheckpointError = CheckpointNotFound | CheckpointReadFailed | DraftWriteFailed;
