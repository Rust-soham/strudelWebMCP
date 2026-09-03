import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { BrowserReferenceRepository } from '../adapters/browser/browser-reference-repository.ts';
import { MediabunnyAudioNormalizer } from '../adapters/browser/mediabunny-audio-normalizer.ts';
import { EnergyEnvelopeAnalyzer } from '../adapters/audio/energy-envelope-analyzer.ts';
import { StrudelAttemptRenderer } from '../adapters/strudel/strudel-attempt-renderer.ts';
import type { StrudelReplWorkspace } from '../adapters/strudel/strudel-repl-workspace.ts';
import type { Comparison, ReferenceAudio, RenderedAttempt } from '../domain/model.ts';
import { StrudelEditor } from './strudel-editor.tsx';

const initialCode = `setcpm(112 / 4)
stack(
  sound("bd ~ sd ~").gain(0.9),
  note("c3 eb3 g3 bb3").sound("sawtooth").lpf(1400).slow(2),
  sound("hh*8").gain(0.28)
).room(0.2)`;

type PlaybackStatus =
  | Readonly<{ tag: 'loading'; message: string }>
  | Readonly<{ tag: 'ready'; message: string }>
  | Readonly<{ tag: 'starting'; message: string }>
  | Readonly<{ tag: 'playing'; message: string }>
  | Readonly<{ tag: 'stopping'; message: string }>
  | Readonly<{ tag: 'stopped'; message: string }>
  | Readonly<{ tag: 'failed'; message: string }>;

type CaptureStatus =
  | Readonly<{ tag: 'idle'; message: string }>
  | Readonly<{ tag: 'recording'; message: string }>
  | Readonly<{ tag: 'ready'; message: string; attempt: RenderedAttempt }>
  | Readonly<{ tag: 'failed'; message: string }>;

type ReferenceStatus =
  | Readonly<{ tag: 'idle'; message: string }>
  | Readonly<{ tag: 'loading'; message: string }>
  | Readonly<{ tag: 'ready'; message: string; reference: ReferenceAudio }>
  | Readonly<{ tag: 'failed'; message: string }>;

type ComparisonStatus =
  | Readonly<{ tag: 'idle'; message: string }>
  | Readonly<{ tag: 'analyzing'; message: string }>
  | Readonly<{ tag: 'ready'; comparison: Comparison }>
  | Readonly<{ tag: 'failed'; message: string }>;

/** The first browser shell proving the real Strudel editor and workspace adapter together. */
export const App = (): React.JSX.Element => {
  const [workspace, setWorkspace] = useState<StrudelReplWorkspace | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>({
    tag: 'loading',
    message: 'Connecting to Strudel…',
  });
  const [capture, setCapture] = useState<CaptureStatus>({
    tag: 'idle',
    message: 'No attempt captured yet.',
  });
  const [referenceRepository] = useState(() => new BrowserReferenceRepository());
  const [similarityAnalyzer] = useState(
    () => new EnergyEnvelopeAnalyzer(new MediabunnyAudioNormalizer()),
  );
  const [reference, setReference] = useState<ReferenceStatus>({
    tag: 'idle',
    message: 'Upload the original clip once. Every iteration will reuse it.',
  });
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [attemptUrl, setAttemptUrl] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonStatus>({
    tag: 'idle',
    message: 'Capture an attempt to compare its energy contour.',
  });

  useEffect(() => {
    if (reference.tag !== 'ready') {
      setReferenceUrl(null);
      return;
    }

    const url = URL.createObjectURL(reference.reference.blob);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);

  useEffect(() => {
    if (capture.tag !== 'ready') {
      setAttemptUrl(null);
      return;
    }

    const url = URL.createObjectURL(capture.attempt.blob);
    setAttemptUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capture]);

  const handleWorkspaceReady = useCallback((nextWorkspace: StrudelReplWorkspace | null) => {
    setWorkspace(nextWorkspace);
    setStatus(
      nextWorkspace === null
        ? { tag: 'loading', message: 'Connecting to Strudel…' }
        : { tag: 'ready', message: 'Editor ready. Press Play to enable audio.' },
    );
  }, []);

  const play = async (): Promise<void> => {
    if (workspace === null) return;
    setStatus({ tag: 'starting', message: 'Starting playback…' });

    const draft = workspace.getDraft();
    if (draft.isErr()) {
      setStatus({ tag: 'failed', message: draft.error.message });
      return;
    }

    const result = await workspace.play(draft.value.code, new AbortController().signal);
    setStatus(
      result.isErr()
        ? { tag: 'failed', message: result.error.message }
        : {
            tag: 'playing',
            message: `Playing · ${result.value.cycleDurationSeconds.toFixed(2)}s per cycle`,
          },
    );
  };

  const stop = async (): Promise<void> => {
    if (workspace === null) return;
    setStatus({ tag: 'stopping', message: 'Stopping playback…' });

    const result = await workspace.stop();
    setStatus(
      result.isErr()
        ? { tag: 'failed', message: result.error.message }
        : { tag: 'stopped', message: 'Playback stopped.' },
    );
  };

  const playbackIsActive = status.tag === 'starting' || status.tag === 'playing';
  const transitionIsPending = status.tag === 'starting' || status.tag === 'stopping';
  const transportLabel =
    status.tag === 'starting'
      ? 'Starting…'
      : status.tag === 'playing'
        ? '■ Stop'
        : status.tag === 'stopping'
          ? 'Stopping…'
          : '▶ Play';

  const togglePlayback = (): void => {
    if (playbackIsActive) {
      void stop();
      return;
    }

    void play();
  };

  const captureAttempt = async (): Promise<void> => {
    if (workspace === null) return;

    const loadedReference = await referenceRepository.get();
    if (loadedReference.isErr()) {
      setCapture({ tag: 'failed', message: loadedReference.error.message });
      return;
    }

    setCapture({ tag: 'recording', message: 'Recording 4 complete cycles…' });
    setComparison({ tag: 'idle', message: 'Waiting for the captured attempt…' });
    setStatus({ tag: 'starting', message: 'Starting captured playback…' });

    const draft = workspace.getDraft();
    if (draft.isErr()) {
      setCapture({ tag: 'failed', message: draft.error.message });
      setStatus({ tag: 'failed', message: draft.error.message });
      return;
    }

    const signal = new AbortController().signal;
    const evaluated = await workspace.evaluate(draft.value.code, signal);
    if (evaluated.isErr()) {
      setCapture({ tag: 'failed', message: evaluated.error.message });
      setStatus({ tag: 'failed', message: evaluated.error.message });
      return;
    }

    setStatus({ tag: 'playing', message: 'Playing and recording Strudel master output…' });
    const renderer = new StrudelAttemptRenderer(workspace);
    const rendered = await renderer.render(evaluated.value, { cycles: 4 }, signal);

    if (rendered.isErr()) {
      setCapture({ tag: 'failed', message: rendered.error.message });
      setStatus({ tag: 'failed', message: rendered.error.message });
      return;
    }

    setCapture({
      tag: 'ready',
      message: `Captured ${rendered.value.durationSeconds.toFixed(2)} seconds`,
      attempt: rendered.value,
    });
    setComparison({ tag: 'analyzing', message: 'Normalizing and comparing both recordings…' });
    setStatus({ tag: 'stopped', message: 'Capture complete. Comparing energy contours…' });

    const analyzed = await similarityAnalyzer.compare(
      loadedReference.value,
      rendered.value,
      signal,
    );
    if (analyzed.isErr()) {
      setComparison({ tag: 'failed', message: analyzed.error.message });
      return;
    }

    setComparison({ tag: 'ready', comparison: analyzed.value });
    setStatus({ tag: 'stopped', message: 'Capture and comparison complete.' });
  };

  const loadReference = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.item(0) ?? null;
    event.currentTarget.value = '';
    if (file === null) return;

    const previousReference = reference.tag === 'ready' ? reference.reference : null;
    setComparison({ tag: 'idle', message: 'Capture a new attempt for this reference.' });
    setReference({ tag: 'loading', message: `Decoding ${file.name}…` });
    const loaded = await referenceRepository.load(file, new AbortController().signal);
    setReference(
      loaded.isErr()
        ? previousReference === null
          ? { tag: 'failed', message: loaded.error.message }
          : {
              tag: 'ready',
              message: `${loaded.error.message}. Keeping ${previousReference.fileName}.`,
              reference: previousReference,
            }
        : {
            tag: 'ready',
            message: `${loaded.value.durationSeconds.toFixed(2)}s · ${loaded.value.sampleRate.toLocaleString()} Hz · ${loaded.value.numberOfChannels} channel${loaded.value.numberOfChannels === 1 ? '' : 's'}`,
            reference: loaded.value,
          },
    );
  };

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">WEBMCP AUDIO LAB</p>
          <h1>Strudel reconstruction workspace</h1>
        </div>
        <div className={`status status-${status.tag}`} role="status">
          <span aria-hidden="true" />
          {status.message}
        </div>
      </header>

      <section className="workspace" aria-label="Strudel workspace">
        <div className="workspace-bar">
          <div>
            <span className="panel-index">01</span>
            <span>PROGRAM</span>
          </div>
          <div className="transport">
            <button
              aria-label={playbackIsActive ? 'Stop playback' : 'Start playback'}
              aria-pressed={playbackIsActive}
              data-state={status.tag}
              disabled={workspace === null || transitionIsPending || capture.tag === 'recording'}
              onClick={togglePlayback}
              type="button"
            >
              {transportLabel}
            </button>
          </div>
        </div>
        <StrudelEditor initialCode={initialCode} onWorkspaceReady={handleWorkspaceReady} />
      </section>

      <section className="reference-panel" aria-labelledby="reference-heading">
        <div>
          <p className="eyebrow">02 · REFERENCE</p>
          <h2 id="reference-heading">
            {reference.tag === 'ready' ? reference.reference.fileName : 'Load the original clip'}
          </h2>
          <p className="capture-message" role="status">
            {reference.message}
          </p>
        </div>
        <div className="reference-controls">
          <label className="file-button">
            {reference.tag === 'loading' ? 'Decoding…' : 'Choose audio'}
            <input
              accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm"
              disabled={reference.tag === 'loading' || capture.tag === 'recording'}
              onChange={(event) => void loadReference(event)}
              type="file"
            />
          </label>
          {referenceUrl === null ? null : (
            <audio aria-label="Reference audio" controls src={referenceUrl} />
          )}
        </div>
      </section>

      <section className="attempt-panel" aria-labelledby="attempt-heading">
        <div>
          <p className="eyebrow">03 · CAPTURED ATTEMPT</p>
          <h2 id="attempt-heading">Render the live program</h2>
          <p className="capture-message" role="status">
            {capture.message}
          </p>
        </div>
        <div className="capture-controls">
          <button
            className="capture-button"
            data-state={capture.tag}
            disabled={workspace === null || capture.tag === 'recording' || transitionIsPending}
            onClick={() => void captureAttempt()}
            type="button"
          >
            {capture.tag === 'recording' ? '● Recording…' : '● Capture 4 cycles'}
          </button>
          {attemptUrl === null ? null : (
            <audio aria-label="Captured Strudel attempt" controls src={attemptUrl} />
          )}
        </div>
      </section>

      <section className="comparison-panel" aria-labelledby="comparison-heading">
        <div>
          <p className="eyebrow">04 · COMPARISON</p>
          <h2 id="comparison-heading">Energy envelope</h2>
          {comparison.tag === 'ready' ? (
            <p className="similarity-score">
              {Math.round((comparison.comparison.measurements[0]?.similarity ?? 0) * 100)}%
            </p>
          ) : null}
        </div>
        <div className="comparison-result" role="status">
          {comparison.tag === 'ready' ? (
            <ul>
              {comparison.comparison.observations.map((observation) => (
                <li key={observation}>{observation}</li>
              ))}
            </ul>
          ) : (
            <p>{comparison.message}</p>
          )}
        </div>
      </section>

      <footer>
        <span>Reference input — connected</span>
        <span>Master output capture — connected</span>
      </footer>
    </main>
  );
};
