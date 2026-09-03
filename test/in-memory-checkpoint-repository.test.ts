import { Result } from 'better-result';
import { describe, expect, it } from 'vitest';

import { InMemoryCheckpointRepository } from '../src/adapters/browser/in-memory-checkpoint-repository.ts';
import { strudelCode } from '../src/domain/model.ts';
import type { CheckpointCandidate, CheckpointId } from '../src/domain/model.ts';

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) throw result.error;
  return result.value;
};

const candidate = (parentId: CheckpointId | null = null): CheckpointCandidate => ({
  parentId,
  code: unwrap(strudelCode('sound("bd")')),
  audio: { blob: new Blob(['audio']), durationSeconds: 1, mimeType: 'audio/webm' },
  comparison: {
    measurements: [],
    observations: [],
    warnings: [],
    completeness: 1,
  },
  changeSummary: 'Add kick',
});

describe('InMemoryCheckpointRepository', () => {
  it('commits immutable attempts in order', async () => {
    const repository = new InMemoryCheckpointRepository();
    const first = unwrap(await repository.commit(candidate()));
    const second = unwrap(await repository.commit(candidate(first.id)));

    expect(repository.list().map(({ id }) => id)).toEqual(['a1', 'a2']);
    expect(repository.getHeadId()).toBe(second.id);
    expect(unwrap(await repository.getById(first.id))).toBe(first);
  });

  it('rejects an attempt based on a stale parent', async () => {
    const repository = new InMemoryCheckpointRepository();
    await repository.commit(candidate());

    const result = await repository.commit(candidate());

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error._tag).toBe('StaleCheckpoint');
    expect(repository.list()).toHaveLength(1);
  });

  it('creates a new branch after selecting an earlier checkpoint', async () => {
    const repository = new InMemoryCheckpointRepository();
    const first = unwrap(await repository.commit(candidate()));
    await repository.commit(candidate(first.id));

    repository.setHead(first.id);
    const branch = unwrap(await repository.commit(candidate(first.id)));

    expect(branch.parentId).toBe(first.id);
    expect(repository.list().map(({ id }) => id)).toEqual(['a1', 'a2', 'a3']);
    expect(repository.getHeadId()).toBe(branch.id);
  });
});
