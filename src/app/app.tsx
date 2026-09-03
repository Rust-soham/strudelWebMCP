import { useCallback, useState } from 'react';

import type { StrudelReplWorkspace } from '../adapters/strudel/strudel-repl-workspace.ts';
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

/** The first browser shell proving the real Strudel editor and workspace adapter together. */
export const App = (): React.JSX.Element => {
  const [workspace, setWorkspace] = useState<StrudelReplWorkspace | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>({
    tag: 'loading',
    message: 'Connecting to Strudel…',
  });

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
              disabled={workspace === null || transitionIsPending}
              onClick={togglePlayback}
              type="button"
            >
              {transportLabel}
            </button>
          </div>
        </div>
        <StrudelEditor initialCode={initialCode} onWorkspaceReady={handleWorkspaceReady} />
      </section>

      <footer>
        <span>Reference input — next slice</span>
        <span>Attempt capture — next slice</span>
      </footer>
    </main>
  );
};
