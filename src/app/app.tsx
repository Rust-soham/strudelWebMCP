import { useCallback, useEffect, useState } from 'react';

import { StrudelAttemptRenderer } from '../adapters/strudel/strudel-attempt-renderer.ts';
import type { StrudelReplWorkspace } from '../adapters/strudel/strudel-repl-workspace.ts';
import type { RenderedAttempt } from '../domain/model.ts';
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
  const [attemptUrl, setAttemptUrl] = useState<string | null>(null);

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
    setCapture({ tag: 'recording', message: 'Recording 4 complete cycles…' });
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
    setStatus({ tag: 'stopped', message: 'Capture complete. Playback stopped.' });
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

      <section className="attempt-panel" aria-labelledby="attempt-heading">
        <div>
          <p className="eyebrow">02 · CAPTURED ATTEMPT</p>
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

      <footer>
        <span>Reference input — next slice</span>
        <span>Master output capture — connected</span>
      </footer>
    </main>
  );
};
