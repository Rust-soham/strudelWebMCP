import { Result } from 'better-result';
import { describe, expect, it } from 'vitest';

import { EnergyEnvelopeAnalyzer } from '../src/adapters/audio/energy-envelope-analyzer.ts';
import type { NormalizedAudio, ReferenceAudio, RenderedAttempt } from '../src/domain/model.ts';
import type { AudioNormalizer } from '../src/domain/ports.ts';

const referenceBlob = new Blob(['reference']);
const attemptBlob = new Blob(['attempt']);
const reference: ReferenceAudio = {
  id: 'reference',
  blob: referenceBlob,
  fileName: 'reference.wav',
  mimeType: 'audio/wav',
  durationSeconds: 1,
  sampleRate: 16_000,
  numberOfChannels: 1,
};
const attempt: RenderedAttempt = {
  blob: attemptBlob,
  durationSeconds: 1,
  mimeType: 'audio/webm',
};

const normalized = (samples: ReadonlyArray<number>): NormalizedAudio => ({
  samples: Float32Array.from(samples),
  sampleRate: 16_000,
  durationSeconds: samples.length / 16_000,
});

describe('EnergyEnvelopeAnalyzer', () => {
  it('reports matching contours and a quieter attempt independently', async () => {
    const referenceAudio = normalized(Array.from({ length: 320 }, (_, index) => index / 320));
    const attemptAudio = normalized(Array.from({ length: 320 }, (_, index) => (index / 320) * 0.5));
    const normalizer: AudioNormalizer = {
      normalize: async (blob) => Result.ok(blob === referenceBlob ? referenceAudio : attemptAudio),
    };
    const analyzer = new EnergyEnvelopeAnalyzer(normalizer);

    const result = await analyzer.compare(reference, attempt, new AbortController().signal);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.measurements[0]?.similarity).toBeCloseTo(1);
      expect(result.value.observations).toContain('The attempt is quieter than the reference.');
      expect(result.value.observations).toContain('The energy contour is close to the reference.');
    }
  });

  it('ignores reference audio after the first ten seconds', async () => {
    const matchingWindow = Array.from({ length: 100 }, (_, index) => index / 100);
    const referenceAudio: NormalizedAudio = {
      samples: Float32Array.from([...matchingWindow, ...Array.from({ length: 100 }, () => 1)]),
      sampleRate: 10,
      durationSeconds: 20,
    };
    const attemptAudio: NormalizedAudio = {
      samples: Float32Array.from(matchingWindow),
      sampleRate: 10,
      durationSeconds: 10,
    };
    const normalizer: AudioNormalizer = {
      normalize: async (blob) => Result.ok(blob === referenceBlob ? referenceAudio : attemptAudio),
    };

    const result = await new EnergyEnvelopeAnalyzer(normalizer).compare(
      reference,
      attempt,
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.measurements[0]?.similarity).toBeCloseTo(1);
  });
});
