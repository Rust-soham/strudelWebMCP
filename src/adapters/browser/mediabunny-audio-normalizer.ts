import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { Result } from 'better-result';

import { AudioNormalizationFailed, OperationCancelled } from '../../domain/errors.ts';
import type { NormalizedAudio } from '../../domain/model.ts';
import type { AudioNormalizer } from '../../domain/ports.ts';

const comparisonSampleRate = 16_000;

const mixToMono = (buffer: AudioBuffer): Float32Array => {
  const mono = new Float32Array(buffer.length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      mono[index] = (mono[index] ?? 0) + (samples[index] ?? 0) / buffer.numberOfChannels;
    }
  }

  return mono;
};

const concatenate = (chunks: ReadonlyArray<Float32Array>): Float32Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  return samples;
};

const resample = (source: Float32Array, sourceRate: number, targetRate: number): Float32Array => {
  if (sourceRate === targetRate) return source;

  const targetLength = Math.max(1, Math.round((source.length * targetRate) / sourceRate));
  const target = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.min(Math.floor(position), source.length - 1);
    const rightIndex = Math.min(leftIndex + 1, source.length - 1);
    const fraction = position - leftIndex;
    const left = source[leftIndex] ?? 0;
    const right = source[rightIndex] ?? left;
    target[index] = left + (right - left) * fraction;
  }

  return target;
};

/** Decodes browser audio Blobs with Mediabunny and normalizes them to mono 16 kHz PCM. */
export class MediabunnyAudioNormalizer implements AudioNormalizer {
  /** Produces a common PCM representation for reference and attempt audio. */
  async normalize(
    blob: Blob,
    signal: AbortSignal,
  ): Promise<Result<NormalizedAudio, AudioNormalizationFailed | OperationCancelled>> {
    if (signal.aborted) {
      return Result.err(new OperationCancelled({ message: 'Audio normalization was cancelled' }));
    }

    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

    try {
      const track = await input.getPrimaryAudioTrack();
      if (track === null) {
        return Result.err(
          new AudioNormalizationFailed({
            cause: new Error('The media contains no audio track'),
            message: 'The media contains no decodable audio track',
          }),
        );
      }

      const sourceRate = await track.getSampleRate();
      const sink = new AudioBufferSink(track);
      const chunks: Array<Float32Array> = [];

      for await (const wrapped of sink.buffers()) {
        if (signal.aborted) {
          return Result.err(
            new OperationCancelled({ message: 'Audio normalization was cancelled' }),
          );
        }
        chunks.push(mixToMono(wrapped.buffer));
      }

      const source = concatenate(chunks);
      if (source.length === 0) {
        return Result.err(
          new AudioNormalizationFailed({
            cause: new Error('The decoded audio track is empty'),
            message: 'The decoded audio track contains no samples',
          }),
        );
      }

      const samples = resample(source, sourceRate, comparisonSampleRate);
      return Result.ok({
        samples,
        sampleRate: comparisonSampleRate,
        durationSeconds: samples.length / comparisonSampleRate,
      });
    } catch (cause) {
      return Result.err(
        new AudioNormalizationFailed({ cause, message: 'Audio normalization failed' }),
      );
    } finally {
      input.dispose();
    }
  }
}
