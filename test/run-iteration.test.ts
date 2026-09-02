import { Result } from 'better-result';
import { describe, expect, it, vi } from 'vitest';

import {
  ReferenceNotLoaded,
  checkpointId,
  makeRunIteration,
  strudelCode,
  type Checkpoint,
  type CheckpointCandidate,
  type RunIterationDependencies,
} from '../src/domain/index.ts';

const unwrap = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result.isErr()) throw result.error;
  return result.value;
};

const code = unwrap(strudelCode('note("c a f e")'));
const parentId = unwrap(checkpointId('a0'));
const checkpointIdA1 = unwrap(checkpointId('a1'));

const comparison = {
  measurements: [{ name: 'tempo' as const, similarity: 0.75 }],
  warnings: [],
  completeness: 1,
};

const renderedAttempt = {
  blob: new Blob(['audio'], { type: 'audio/webm' }),
  durationSeconds: 4,
  mimeType: 'audio/webm',
};

const checkpoint = (candidate: CheckpointCandidate): Checkpoint => ({
  ...candidate,
  id: checkpointIdA1,
  createdAt: new Date('2026-09-02T00:00:00.000Z'),
});

const makeDependencies = (): RunIterationDependencies => ({
  referenceRepository: {
    get: vi.fn(async () =>
      Result.ok({ id: 'reference', durationSeconds: 4, sampleRate: 48_000, numberOfChannels: 2 }),
    ),
  },
  programWorkspace: {
    getDraft: vi.fn(() =>
      Result.ok({ baseCheckpointId: parentId, code, changeSummary: 'Changed the notes' }),
    ),
    evaluate: vi.fn(async () => Result.ok({ code, cycleDurationSeconds: 1 })),
    restore: vi.fn(() => Result.ok(undefined)),
  },
  attemptRenderer: {
    render: vi.fn(async () => Result.ok(renderedAttempt)),
  },
  similarityAnalyzer: {
    compare: vi.fn(async () => Result.ok(comparison)),
  },
  checkpointRepository: {
    getById: vi.fn(async () =>
      Result.ok(
        checkpoint({
          parentId,
          code,
          audio: renderedAttempt,
          comparison,
          changeSummary: 'Changed the notes',
        }),
      ),
    ),
    commit: vi.fn(async (candidate) => Result.ok(checkpoint(candidate))),
  },
});

describe('runIteration', () => {
  it('commits one checkpoint after evaluation, rendering, and comparison succeed', async () => {
    const dependencies = makeDependencies();
    const runIteration = makeRunIteration(dependencies);

    const result = await runIteration({ duration: { cycles: 4 } }, new AbortController().signal);

    expect(result.isOk()).toBe(true);
    expect(dependencies.checkpointRepository.commit).toHaveBeenCalledWith({
      parentId,
      code,
      audio: renderedAttempt,
      comparison,
      changeSummary: 'Changed the notes',
    });
  });

  it('does not read the draft or commit when the reference is absent', async () => {
    const dependencies = makeDependencies();
    vi.mocked(dependencies.referenceRepository.get).mockResolvedValue(
      Result.err(new ReferenceNotLoaded({ message: 'Upload a reference first' })),
    );
    const runIteration = makeRunIteration(dependencies);

    const result = await runIteration({ duration: { cycles: 4 } }, new AbortController().signal);

    expect(result.isErr()).toBe(true);
    expect(dependencies.programWorkspace.getDraft).not.toHaveBeenCalled();
    expect(dependencies.checkpointRepository.commit).not.toHaveBeenCalled();
  });
});
