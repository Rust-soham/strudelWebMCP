import { Result } from 'better-result';

import type { RestoreCheckpointError } from './errors.ts';
import type { Checkpoint, CheckpointId } from './model.ts';
import type { CheckpointRepository, ProgramWorkspace } from './ports.ts';

export type RestoreCheckpoint = (
  id: CheckpointId,
) => Promise<Result<Checkpoint, RestoreCheckpointError>>;

export type RestoreCheckpointDependencies = Readonly<{
  checkpointRepository: CheckpointRepository;
  programWorkspace: ProgramWorkspace;
}>;

/**
 * Restores source code without evaluating it. Keeping restore and playback separate
 * lets the agent inspect or edit an earlier branch before producing new audio.
 */
export const makeRestoreCheckpoint = (
  dependencies: RestoreCheckpointDependencies,
): RestoreCheckpoint => {
  const { checkpointRepository, programWorkspace } = dependencies;

  return async (id) =>
    Result.gen(async function* () {
      const checkpoint = yield* Result.await(checkpointRepository.getById(id));

      yield* programWorkspace.restore({
        baseCheckpointId: checkpoint.id,
        code: checkpoint.code,
      });

      return Result.ok(checkpoint);
    });
};
