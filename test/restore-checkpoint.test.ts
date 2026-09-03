import { Result } from 'better-result';
import { describe, expect, it, vi } from 'vitest';

import {
  CheckpointNotFound,
  checkpointId,
  makeRestoreCheckpoint,
  strudelCode,
  type Checkpoint,
  type CheckpointRepository,
  type ProgramWorkspace,
} from '../src/domain/index.ts';

const unwrap = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result.isErr()) throw result.error;
  return result.value;
};

const id = unwrap(checkpointId('a1'));
const missingId = unwrap(checkpointId('missing'));
const code = unwrap(strudelCode('note("c a f e")'));
const checkpoint: Checkpoint = {
  id,
  parentId: null,
  code,
  audio: {
    blob: new Blob(['audio'], { type: 'audio/webm' }),
    durationSeconds: 4,
    mimeType: 'audio/webm',
  },
  comparison: { measurements: [], observations: [], warnings: [], completeness: 1 },
  changeSummary: 'Initial rhythm',
  createdAt: new Date('2026-09-02T00:00:00.000Z'),
};

type TestPorts = Readonly<{
  checkpointRepository: CheckpointRepository;
  programWorkspace: ProgramWorkspace;
}>;

const makePorts = (): TestPorts => ({
  checkpointRepository: {
    getById: vi.fn(async () => Result.ok(checkpoint)),
    setHead: vi.fn(),
    commit: vi.fn(async () => Result.ok(checkpoint)),
  },
  programWorkspace: {
    getDraft: vi.fn(() => Result.ok({ baseCheckpointId: id, code, changeSummary: 'Draft' })),
    evaluate: vi.fn(async () => Result.ok({ code, cycleDurationSeconds: 1 })),
    restore: vi.fn(() => Result.ok(undefined)),
    markCommitted: vi.fn(),
  },
});

describe('restoreCheckpoint', () => {
  it('restores source and sets the restored checkpoint as the next branch parent', async () => {
    const ports = makePorts();
    const restoreCheckpoint = makeRestoreCheckpoint(ports);

    const result = await restoreCheckpoint(id);

    expect(result.isOk()).toBe(true);
    expect(ports.programWorkspace.restore).toHaveBeenCalledWith({
      baseCheckpointId: id,
      code,
    });
    expect(ports.checkpointRepository.setHead).toHaveBeenCalledWith(id);
  });

  it('does not modify the editor when the checkpoint cannot be loaded', async () => {
    const ports = makePorts();
    vi.mocked(ports.checkpointRepository.getById).mockResolvedValue(
      Result.err(
        new CheckpointNotFound({
          checkpointId: missingId,
          message: 'Checkpoint was not found',
        }),
      ),
    );
    const restoreCheckpoint = makeRestoreCheckpoint(ports);

    const result = await restoreCheckpoint(missingId);

    expect(result.isErr()).toBe(true);
    expect(ports.programWorkspace.restore).not.toHaveBeenCalled();
    expect(ports.checkpointRepository.setHead).not.toHaveBeenCalled();
  });
});
