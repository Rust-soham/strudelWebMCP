import { Result } from 'better-result';

import {
  CheckpointNotFound,
  CheckpointWriteFailed,
  OperationCancelled,
  StaleCheckpoint,
} from '../../domain/errors.ts';
import { checkpointId } from '../../domain/model.ts';
import type { Checkpoint, CheckpointCandidate, CheckpointId } from '../../domain/model.ts';
import type { CheckpointRepository } from '../../domain/ports.ts';

/** Process-local checkpoint history used to prove the live agent loop before IndexedDB. */
export class InMemoryCheckpointRepository implements CheckpointRepository {
  private readonly checkpoints = new Map<CheckpointId, Checkpoint>();
  private headId: CheckpointId | null = null;
  private nextSequence = 1;

  /** Reads one immutable checkpoint by identifier. */
  async getById(id: CheckpointId): Promise<Result<Checkpoint, CheckpointNotFound>> {
    const checkpoint = this.checkpoints.get(id);

    return checkpoint === undefined
      ? Result.err(
          new CheckpointNotFound({ checkpointId: id, message: `Checkpoint ${id} was not found` }),
        )
      : Result.ok(checkpoint);
  }

  /** Selects a previously read checkpoint as the parent for the active branch. */
  setHead(id: CheckpointId): void {
    this.headId = id;
  }

  /** Appends a checkpoint only when its parent is still the current history head. */
  async commit(
    candidate: CheckpointCandidate,
  ): Promise<Result<Checkpoint, CheckpointWriteFailed | StaleCheckpoint | OperationCancelled>> {
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

    this.checkpoints.set(checkpoint.id, checkpoint);
    this.headId = checkpoint.id;
    this.nextSequence += 1;
    return Result.ok(checkpoint);
  }

  /** Lists checkpoint history in commit order for the visible iteration timeline. */
  list(): ReadonlyArray<Checkpoint> {
    return [...this.checkpoints.values()];
  }

  /** Returns the current history head, or null before the first attempt. */
  getHeadId(): CheckpointId | null {
    return this.headId;
  }
}
