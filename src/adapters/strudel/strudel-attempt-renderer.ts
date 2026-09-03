import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';
import { Result } from 'better-result';

import { AttemptRenderFailed, OperationCancelled } from '../../domain/errors.ts';
import type { EvaluatedProgram, RenderDuration, RenderedAttempt } from '../../domain/model.ts';
import type { AttemptRenderer } from '../../domain/ports.ts';
import type { StrudelReplWorkspace } from './strudel-repl-workspace.ts';

const recorderMimeTypes = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

const makeRecorder = (stream: MediaStream): Result<MediaRecorder, AttemptRenderFailed> => {
  try {
    const mimeType = recorderMimeTypes.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );
    const recorder =
      mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType });

    return Result.ok(recorder);
  } catch (cause) {
    return Result.err(
      new AttemptRenderFailed({
        cause,
        retryable: false,
        message: 'This browser cannot record Strudel audio',
      }),
    );
  }
};

const collectRecording = (recorder: MediaRecorder): Promise<Result<Blob, AttemptRenderFailed>> =>
  new Promise((resolve) => {
    const chunks: Array<Blob> = [];

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener(
      'error',
      (event) => {
        resolve(
          Result.err(
            new AttemptRenderFailed({
              cause: event,
              retryable: true,
              message: 'The browser failed while recording Strudel audio',
            }),
          ),
        );
      },
      { once: true },
    );
    recorder.addEventListener(
      'stop',
      () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        resolve(
          blob.size === 0
            ? Result.err(
                new AttemptRenderFailed({
                  cause: new Error('MediaRecorder produced an empty Blob'),
                  retryable: true,
                  message: 'The captured Strudel audio was empty',
                }),
              )
            : Result.ok(blob),
        );
      },
      { once: true },
    );
  });

const waitForDuration = (
  durationMilliseconds: number,
  signal: AbortSignal,
): Promise<Result<void, OperationCancelled>> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(Result.err(new OperationCancelled({ message: 'Attempt capture was cancelled' })));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve(Result.ok(undefined));
    }, durationMilliseconds);
    const cancel = (): void => {
      window.clearTimeout(timeout);
      resolve(Result.err(new OperationCancelled({ message: 'Attempt capture was cancelled' })));
    };

    signal.addEventListener('abort', cancel, { once: true });
  });

/** Captures Strudel's post-effects master output while it remains audible to the user. */
export class StrudelAttemptRenderer implements AttemptRenderer {
  /** Creates a renderer that controls playback through the live Strudel workspace. */
  constructor(private readonly workspace: StrudelReplWorkspace) {}

  /** Records a fixed number of whole cycles from Strudel's master gain node. */
  async render(
    program: EvaluatedProgram,
    duration: RenderDuration,
    signal: AbortSignal,
  ): Promise<Result<RenderedAttempt, AttemptRenderFailed | OperationCancelled>> {
    if (signal.aborted) {
      return Result.err(new OperationCancelled({ message: 'Attempt capture was cancelled' }));
    }

    if (!Number.isInteger(duration.cycles) || duration.cycles <= 0) {
      return Result.err(
        new AttemptRenderFailed({
          cause: new Error(`Invalid cycle count: ${duration.cycles}`),
          retryable: false,
          message: 'Capture duration must contain at least one whole cycle',
        }),
      );
    }

    const audioContext = getAudioContext();
    const masterOutput = getSuperdoughAudioController().output.destinationGain;
    const captureDestination = audioContext.createMediaStreamDestination();
    const recorderResult = makeRecorder(captureDestination.stream);

    if (recorderResult.isErr()) return recorderResult;

    const recorder = recorderResult.value;
    const recordedBlob = collectRecording(recorder);
    const durationSeconds = program.cycleDurationSeconds * duration.cycles;

    try {
      masterOutput.connect(captureDestination);
      recorder.start();

      const playback = await this.workspace.play(program.code, signal);
      if (playback.isErr()) {
        if (recorder.state !== 'inactive') recorder.stop();
        await recordedBlob;
        return playback.error._tag === 'OperationCancelled'
          ? Result.err(playback.error)
          : Result.err(
              new AttemptRenderFailed({
                cause: playback.error,
                retryable: false,
                message: 'Strudel could not start the attempt',
              }),
            );
      }

      const elapsed = await waitForDuration(durationSeconds * 1_000, signal);
      const stopped = await this.workspace.stop();
      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await recordedBlob;

      if (elapsed.isErr()) return elapsed;
      if (stopped.isErr()) {
        return Result.err(
          new AttemptRenderFailed({
            cause: stopped.error,
            retryable: true,
            message: 'Strudel playback could not be stopped after capture',
          }),
        );
      }
      if (blob.isErr()) return blob;

      return Result.ok({
        blob: blob.value,
        durationSeconds,
        mimeType: blob.value.type,
      });
    } catch (cause) {
      if (recorder.state !== 'inactive') recorder.stop();
      return Result.err(
        new AttemptRenderFailed({
          cause,
          retryable: true,
          message: 'Could not capture Strudel output',
        }),
      );
    } finally {
      masterOutput.disconnect(captureDestination);
      for (const track of captureDestination.stream.getTracks()) track.stop();
    }
  }
}
