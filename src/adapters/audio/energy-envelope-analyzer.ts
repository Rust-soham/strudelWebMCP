import { Result } from 'better-result';

import { AnalysisFailed, OperationCancelled } from '../../domain/errors.ts';
import type {
  Comparison,
  NormalizedAudio,
  ReferenceAudio,
  RenderedAttempt,
} from '../../domain/model.ts';
import type { AudioNormalizer, SimilarityAnalyzer } from '../../domain/ports.ts';

const envelopeFrameCount = 32;

const rms = (samples: Float32Array, start: number, end: number): number => {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
};

const energyEnvelope = (audio: NormalizedAudio): ReadonlyArray<number> =>
  Array.from({ length: envelopeFrameCount }, (_, frame) => {
    const start = Math.floor((frame * audio.samples.length) / envelopeFrameCount);
    const end = Math.floor(((frame + 1) * audio.samples.length) / envelopeFrameCount);
    return rms(audio.samples, start, end);
  });

const peakNormalize = (envelope: ReadonlyArray<number>): ReadonlyArray<number> => {
  const peak = Math.max(...envelope);
  return peak === 0 ? envelope : envelope.map((value) => value / peak);
};

const overallRms = (audio: NormalizedAudio): number => rms(audio.samples, 0, audio.samples.length);

/** Compares the relative loudness contour of reference and attempt PCM. */
export class EnergyEnvelopeAnalyzer implements SimilarityAnalyzer {
  /** Creates the analyzer around the shared encoded-audio normalization boundary. */
  constructor(private readonly normalizer: AudioNormalizer) {}

  /** Returns energy-contour similarity plus observations the agent can act on. */
  async compare(
    reference: ReferenceAudio,
    attempt: RenderedAttempt,
    signal: AbortSignal,
  ): Promise<Result<Comparison, AnalysisFailed | OperationCancelled>> {
    const normalizedReference = await this.normalizer.normalize(reference.blob, signal);
    if (normalizedReference.isErr()) {
      if (normalizedReference.error._tag === 'OperationCancelled') {
        return Result.err(normalizedReference.error);
      }
      return Result.err(
        new AnalysisFailed({
          cause: normalizedReference.error,
          message: 'Could not normalize the reference audio',
        }),
      );
    }

    const normalizedAttempt = await this.normalizer.normalize(attempt.blob, signal);
    if (normalizedAttempt.isErr()) {
      if (normalizedAttempt.error._tag === 'OperationCancelled') {
        return Result.err(normalizedAttempt.error);
      }
      return Result.err(
        new AnalysisFailed({
          cause: normalizedAttempt.error,
          message: 'Could not normalize the captured attempt',
        }),
      );
    }

    const referenceEnvelope = peakNormalize(energyEnvelope(normalizedReference.value));
    const attemptEnvelope = peakNormalize(energyEnvelope(normalizedAttempt.value));
    const distance = referenceEnvelope.reduce(
      (total, value, index) => total + Math.abs(value - (attemptEnvelope[index] ?? 0)),
      0,
    );
    const similarity = Math.max(0, Math.min(1, 1 - distance / envelopeFrameCount));
    const referenceRms = overallRms(normalizedReference.value);
    const attemptRms = overallRms(normalizedAttempt.value);
    const loudnessRatio = referenceRms === 0 ? 1 : attemptRms / referenceRms;
    const loudnessObservation =
      loudnessRatio < 0.8
        ? 'The attempt is quieter than the reference.'
        : loudnessRatio > 1.25
          ? 'The attempt is louder than the reference.'
          : 'Overall loudness is close to the reference.';
    const contourObservation =
      similarity >= 0.8
        ? 'The energy contour is close to the reference.'
        : 'The energy rises and falls differently from the reference.';

    return Result.ok({
      measurements: [
        {
          name: 'energyEnvelope',
          similarity,
          referenceValue: referenceRms,
          attemptValue: attemptRms,
        },
      ],
      observations: [loudnessObservation, contourObservation],
      warnings: [],
      completeness: 1,
    });
  }
}
