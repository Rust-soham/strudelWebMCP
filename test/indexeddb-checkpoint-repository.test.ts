import 'fake-indexeddb/auto';

import { Result } from 'better-result';
import { beforeEach, describe, expect, it } from 'vitest';

import { IndexedDbCheckpointRepository } from '../src/adapters/browser/indexeddb-checkpoint-repository.ts';
import { strudelCode } from '../src/domain/model.ts';
import type { CheckpointCandidate, CheckpointId } from '../src/domain/model.ts';

const unwrap = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result.isErr()) throw result.error;
  return result.value;
};

const candidate = (parentId: CheckpointId | null = null): CheckpointCandidate => ({
  parentId,
  code: unwrap(strudelCode('sound("bd")')),
  audio: { blob: new Blob(['audio']), durationSeconds: 1, mimeType: 'audio/webm' },
  comparison: {
    measurements: [{ name: 'energyEnvelope', similarity: 0.75 }],
    observations: ['Test observation'],
    warnings: [],
    completeness: 1,
  },
  changeSummary: 'Test checkpoint',
});

const emptyRepository = async (): Promise<IndexedDbCheckpointRepository> => {
  const repository = new IndexedDbCheckpointRepository();
  await repository.waitUntilReady();
  await repository.clear();
  return repository;
};

describe('IndexedDbCheckpointRepository', () => {
  beforeEach(async () => {
    await emptyRepository();
  });

  it('hydrates checkpoint data and head metadata together', async () => {
    const writer = new IndexedDbCheckpointRepository();
    await writer.waitUntilReady();
    const first = unwrap(await writer.commit(candidate()));
    const second = unwrap(await writer.commit(candidate(first.id)));

    const reader = new IndexedDbCheckpointRepository();
    await reader.waitUntilReady();

    expect(reader.list().map(({ id }) => id)).toEqual(['a1', 'a2']);
    expect(reader.getHeadId()).toBe(second.id);
    expect(unwrap(await reader.getById(first.id)).audio.blob.size).toBeGreaterThan(0);
  });

  it('does not advance metadata when a competing checkpoint insert fails', async () => {
    const firstWriter = new IndexedDbCheckpointRepository();
    const competingWriter = new IndexedDbCheckpointRepository();
    await Promise.all([firstWriter.waitUntilReady(), competingWriter.waitUntilReady()]);

    const committed = unwrap(await firstWriter.commit(candidate()));
    const conflict = await competingWriter.commit(candidate());

    expect(conflict.isErr()).toBe(true);
    if (conflict.isErr()) expect(conflict.error._tag).toBe('CheckpointWriteFailed');

    const reader = new IndexedDbCheckpointRepository();
    await reader.waitUntilReady();
    expect(reader.list().map(({ id }) => id)).toEqual([committed.id]);
    expect(reader.getHeadId()).toBe(committed.id);
  });
});
