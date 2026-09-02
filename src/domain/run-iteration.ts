import { Result, type Result as ResultType } from 'better-result';

import type { RunIterationError } from './errors.ts';
import type { Checkpoint, RunIterationCommand } from './model.ts';
import type { RunIterationDependencies } from './ports.ts';

export type RunIteration = (
  command: RunIterationCommand,
  signal: AbortSignal,
) => Promise<ResultType<Checkpoint, RunIterationError>>;

/**
 * Composes browser, audio, analysis, and persistence boundaries into one checkpoint.
 * The orchestration deliberately owns no retries; each leaf service knows which of
 * its failures are safe to retry without duplicating an audible attempt.
 */
export const makeRunIteration = (dependencies: RunIterationDependencies): RunIteration => {
  const {
    attemptRenderer,
    checkpointRepository,
    programWorkspace,
    referenceRepository,
    similarityAnalyzer,
  } = dependencies;

  return async (command, signal) =>
    Result.gen(async function* () {
      const reference = yield* Result.await(referenceRepository.get());
      const draft = yield* programWorkspace.getDraft();
      const program = yield* Result.await(programWorkspace.evaluate(draft.code));
      const attempt = yield* Result.await(
        attemptRenderer.render(program, command.duration, signal),
      );
      const comparison = yield* Result.await(
        similarityAnalyzer.compare(reference, attempt, signal),
      );
      const checkpoint = yield* Result.await(
        checkpointRepository.commit({
          parentId: draft.baseCheckpointId,
          code: draft.code,
          audio: attempt,
          comparison,
          changeSummary: draft.changeSummary,
        }),
      );

      return Result.ok(checkpoint);
    });
};
