import { describe, expect, it } from 'vitest';

import { BrowserReferenceRepository } from '../src/adapters/browser/browser-reference-repository.ts';

describe('BrowserReferenceRepository', () => {
  it('reports absence before a reference is loaded', async () => {
    const repository = new BrowserReferenceRepository();

    const result = await repository.get();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error._tag).toBe('ReferenceNotLoaded');
  });

  it('stores the uploaded source with decoded audio metadata', async () => {
    const decode = async () => ({ duration: 3.5, sampleRate: 48_000, numberOfChannels: 2 });
    const repository = new BrowserReferenceRepository(decode, () => 'reference-1');
    const file = new File(['encoded audio'], 'loop.wav', { type: 'audio/wav' });

    const loaded = await repository.load(file, new AbortController().signal);
    const stored = await repository.get();

    expect(loaded.isOk()).toBe(true);
    expect(stored.isOk()).toBe(true);
    if (stored.isOk()) {
      expect(stored.value).toMatchObject({
        id: 'reference-1',
        blob: file,
        fileName: 'loop.wav',
        mimeType: 'audio/wav',
        durationSeconds: 3.5,
        sampleRate: 48_000,
        numberOfChannels: 2,
      });
    }
  });

  it('keeps the previous reference when replacement decoding fails', async () => {
    let shouldFail = false;
    const decode = async () => {
      if (shouldFail) throw new Error('Unsupported encoding');
      return { duration: 2, sampleRate: 44_100, numberOfChannels: 1 };
    };
    const repository = new BrowserReferenceRepository(decode, () => 'reference-1');
    const first = new File(['first'], 'first.wav', { type: 'audio/wav' });
    const invalid = new File(['invalid'], 'invalid.bin');

    await repository.load(first, new AbortController().signal);
    shouldFail = true;
    const replacement = await repository.load(invalid, new AbortController().signal);
    const stored = await repository.get();

    expect(replacement.isErr()).toBe(true);
    expect(stored.isOk()).toBe(true);
    if (stored.isOk()) expect(stored.value.fileName).toBe('first.wav');
  });
});
