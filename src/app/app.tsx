import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import {
  EnergyEnvelopeAnalyzer,
  referenceComparisonWindowSeconds,
} from '../adapters/audio/energy-envelope-analyzer.ts';
import { BrowserReferenceRepository } from '../adapters/browser/browser-reference-repository.ts';
import { IndexedDbCheckpointRepository } from '../adapters/browser/indexeddb-checkpoint-repository.ts';
import { MediabunnyAudioNormalizer } from '../adapters/browser/mediabunny-audio-normalizer.ts';
import { StrudelAttemptRenderer } from '../adapters/strudel/strudel-attempt-renderer.ts';
import type { StrudelReplWorkspace } from '../adapters/strudel/strudel-repl-workspace.ts';
import {
  registerWorkspaceTools,
  type WorkspaceToolError,
  type WorkspaceToolHandlers,
  type WorkspaceToolResult,
} from '../adapters/webmcp/register-workspace-tools.ts';
import { makeRestoreCheckpoint } from '../domain/restore-checkpoint.ts';
import { makeRunIteration } from '../domain/run-iteration.ts';
import { strudelCode } from '../domain/model.ts';
import type {
  Checkpoint,
  CheckpointId,
  Comparison,
  ReferenceAudio,
  RenderedAttempt,
} from '../domain/model.ts';
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

type WebMcpStatus =
  | Readonly<{ tag: 'waiting'; message: string }>
  | Readonly<{ tag: 'connected'; message: string }>
  | Readonly<{ tag: 'unsupported'; message: string }>
  | Readonly<{ tag: 'failed'; message: string }>;

const toolError = (code: string, message: string): WorkspaceToolError => ({
  ok: false,
  error: { code, message },
});

const checkpointSimilarity = (checkpoint: Checkpoint): number =>
  checkpoint.comparison.measurements[0]?.similarity ?? 0;

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
  const [checkpointRepository] = useState(() => new IndexedDbCheckpointRepository());
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
  const [checkpoints, setCheckpoints] = useState<ReadonlyArray<Checkpoint>>([]);
  const [currentCheckpointId, setCurrentCheckpointId] = useState<CheckpointId | null>(null);
  const [hydratedWorkspace, setHydratedWorkspace] = useState<StrudelReplWorkspace | null>(null);
  const [webMcp, setWebMcp] = useState<WebMcpStatus>({
    tag: 'waiting',
    message: 'Waiting for the Strudel workspace…',
  });
  const operationInFlight = useRef(false);
  const toolHandlers = useRef<WorkspaceToolHandlers | null>(null);
  const referenceState = useRef(reference);
  const captureState = useRef(capture);

  referenceState.current = reference;
  captureState.current = capture;

  useEffect(() => {
    setHydratedWorkspace(null);
    if (workspace === null) {
      return;
    }

    let cancelled = false;
    void checkpointRepository.waitUntilReady().then(async () => {
      if (cancelled) return;

      const persistedCheckpoints = checkpointRepository.list();
      const headId = checkpointRepository.getHeadId();
      setCheckpoints(persistedCheckpoints);
      setCurrentCheckpointId(headId);

      if (headId !== null) {
        const restored = await makeRestoreCheckpoint({
          checkpointRepository,
          programWorkspace: workspace,
        })(headId);
        if (cancelled) return;
        if (restored.isErr()) {
          setStatus({ tag: 'failed', message: restored.error.message });
          return;
        }

        const checkpoint = restored.value;
        setCapture({
          tag: 'ready',
          message: `Restored ${checkpoint.id} · ${checkpoint.audio.durationSeconds.toFixed(2)} seconds`,
          attempt: checkpoint.audio,
        });
        setComparison({ tag: 'ready', comparison: checkpoint.comparison });
        setStatus({ tag: 'stopped', message: `Restored persisted checkpoint ${checkpoint.id}.` });
      }

      setHydratedWorkspace(workspace);
    });
    return () => {
      cancelled = true;
    };
  }, [checkpointRepository, workspace]);

  useEffect(() => {
    let cancelled = false;
    void referenceRepository.waitUntilReady().then(async () => {
      if (cancelled) return;
      const result = await referenceRepository.get();
      if (result.isOk()) {
        const restored = result.value;
        setReference({
          tag: 'ready',
          message: `${restored.durationSeconds.toFixed(2)}s file · comparing first ${Math.min(restored.durationSeconds, referenceComparisonWindowSeconds).toFixed(2)}s · ${restored.sampleRate.toLocaleString()} Hz · ${restored.numberOfChannels} channel${restored.numberOfChannels === 1 ? '' : 's'} · restored`,
          reference: restored,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [referenceRepository]);

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

  const evaluateAttempt = useCallback(
    async (signal: AbortSignal): Promise<WorkspaceToolResult> => {
      if (workspace === null)
        return toolError('workspace_not_ready', 'Strudel editor is not ready');
      if (operationInFlight.current) {
        return toolError('iteration_in_progress', 'Another attempt is already being evaluated');
      }

      operationInFlight.current = true;
      setCapture({ tag: 'recording', message: 'Evaluating, then recording 4 complete cycles…' });
      setComparison({ tag: 'idle', message: 'Waiting for the captured attempt…' });
      setStatus({ tag: 'starting', message: 'Preparing captured playback…' });

      try {
        const runIteration = makeRunIteration({
          programWorkspace: workspace,
          attemptRenderer: new StrudelAttemptRenderer(workspace),
          referenceRepository,
          similarityAnalyzer,
          checkpointRepository,
        });
        const result = await runIteration({ duration: { cycles: 4 } }, signal);

        if (result.isErr()) {
          setCapture({ tag: 'failed', message: result.error.message });
          setComparison({ tag: 'failed', message: result.error.message });
          setStatus({ tag: 'failed', message: result.error.message });
          return toolError(result.error._tag, result.error.message);
        }

        const checkpoint = result.value;
        setCapture({
          tag: 'ready',
          message: `Captured ${checkpoint.audio.durationSeconds.toFixed(2)} seconds`,
          attempt: checkpoint.audio,
        });
        setComparison({ tag: 'ready', comparison: checkpoint.comparison });
        setCheckpoints(checkpointRepository.list());
        setCurrentCheckpointId(checkpoint.id);
        setStatus({ tag: 'stopped', message: `Checkpoint ${checkpoint.id} committed.` });

        return {
          ok: true,
          referenceWindowSeconds: referenceComparisonWindowSeconds,
          checkpoint: {
            id: checkpoint.id,
            parentId: checkpoint.parentId,
            changeSummary: checkpoint.changeSummary,
            durationSeconds: checkpoint.audio.durationSeconds,
            completeness: checkpoint.comparison.completeness,
            measurements: checkpoint.comparison.measurements,
            observations: checkpoint.comparison.observations,
            warnings: checkpoint.comparison.warnings,
          },
        };
      } finally {
        operationInFlight.current = false;
      }
    },
    [checkpointRepository, referenceRepository, similarityAnalyzer, workspace],
  );

  const writeProgram = useCallback(
    async (
      codeInput: string,
      changeSummary: string,
      signal: AbortSignal,
    ): Promise<WorkspaceToolResult> => {
      if (signal.aborted) return toolError('operation_cancelled', 'Draft update was cancelled');
      if (workspace === null)
        return toolError('workspace_not_ready', 'Strudel editor is not ready');
      if (operationInFlight.current) {
        return toolError('iteration_in_progress', 'Wait for the active attempt to finish');
      }

      const code = strudelCode(codeInput);
      if (code.isErr()) return toolError(code.error._tag, code.error.message);
      const currentDraft = workspace.getDraft();
      if (currentDraft.isErr()) {
        return toolError(currentDraft.error._tag, currentDraft.error.message);
      }
      const written = workspace.writeDraft({
        baseCheckpointId: currentDraft.value.baseCheckpointId,
        code: code.value,
        changeSummary,
      });
      if (written.isErr()) return toolError(written.error._tag, written.error.message);

      setCapture({ tag: 'idle', message: 'Draft changed. Evaluate it to create an attempt.' });
      setComparison({ tag: 'idle', message: 'Evaluate the updated draft for new feedback.' });
      setStatus({ tag: 'ready', message: 'Agent updated the visible Strudel program.' });
      return {
        ok: true,
        draft: {
          code: code.value,
          baseCheckpointId: currentDraft.value.baseCheckpointId,
          changeSummary,
        },
      };
    },
    [workspace],
  );

  const listCheckpoints = useCallback(
    async (signal: AbortSignal): Promise<WorkspaceToolResult> => {
      if (signal.aborted) return toolError('operation_cancelled', 'Checkpoint list was cancelled');

      return {
        ok: true,
        checkpoints: checkpointRepository.list().map((checkpoint) => ({
          id: checkpoint.id,
          parentId: checkpoint.parentId,
          changeSummary: checkpoint.changeSummary,
          durationSeconds: checkpoint.audio.durationSeconds,
          similarity: checkpointSimilarity(checkpoint),
        })),
      };
    },
    [checkpointRepository],
  );

  const inspectCheckpoint = useCallback(
    async (id: CheckpointId, signal: AbortSignal): Promise<WorkspaceToolResult> => {
      if (signal.aborted)
        return toolError('operation_cancelled', 'Checkpoint inspection was cancelled');
      const result = await checkpointRepository.getById(id);
      if (result.isErr()) return toolError(result.error._tag, result.error.message);
      const checkpoint = result.value;

      return {
        ok: true,
        inspectedCheckpoint: {
          id: checkpoint.id,
          parentId: checkpoint.parentId,
          code: checkpoint.code,
          changeSummary: checkpoint.changeSummary,
          createdAt: checkpoint.createdAt.toISOString(),
          durationSeconds: checkpoint.audio.durationSeconds,
          completeness: checkpoint.comparison.completeness,
          measurements: checkpoint.comparison.measurements,
          observations: checkpoint.comparison.observations,
          warnings: checkpoint.comparison.warnings,
        },
      };
    },
    [checkpointRepository],
  );

  const checkoutCheckpoint = useCallback(
    async (id: CheckpointId, signal: AbortSignal): Promise<WorkspaceToolResult> => {
      if (signal.aborted)
        return toolError('operation_cancelled', 'Checkpoint restoration was cancelled');
      if (workspace === null)
        return toolError('workspace_not_ready', 'Strudel editor is not ready');
      if (operationInFlight.current) {
        return toolError('iteration_in_progress', 'Wait for the active attempt to finish');
      }

      operationInFlight.current = true;
      try {
        const stopped = await workspace.stop();
        if (stopped.isErr()) return toolError(stopped.error._tag, stopped.error.message);

        const result = await makeRestoreCheckpoint({
          checkpointRepository,
          programWorkspace: workspace,
        })(id);
        if (result.isErr()) return toolError(result.error._tag, result.error.message);

        const checkpoint = result.value;
        setCapture({
          tag: 'ready',
          message: `Restored ${checkpoint.id} · ${checkpoint.audio.durationSeconds.toFixed(2)} seconds`,
          attempt: checkpoint.audio,
        });
        setComparison({ tag: 'ready', comparison: checkpoint.comparison });
        setCurrentCheckpointId(checkpoint.id);
        setStatus({
          tag: 'stopped',
          message: `Restored ${checkpoint.id}. The next evaluation will branch from it.`,
        });

        return {
          ok: true,
          restoredCheckpointId: checkpoint.id,
          draft: {
            code: checkpoint.code,
            baseCheckpointId: checkpoint.id,
            changeSummary: 'Restored checkpoint',
          },
        };
      } finally {
        operationInFlight.current = false;
      }
    },
    [checkpointRepository, workspace],
  );

  toolHandlers.current = {
    getWorkspaceState: async (signal) => {
      if (signal.aborted) return toolError('operation_cancelled', 'Workspace read was cancelled');
      if (workspace === null)
        return toolError('workspace_not_ready', 'Strudel editor is not ready');
      const draft = workspace.getDraft();
      if (draft.isErr()) return toolError(draft.error._tag, draft.error.message);

      return {
        ok: true,
        referenceLoaded: referenceState.current.tag === 'ready',
        referenceWindowSeconds: referenceComparisonWindowSeconds,
        operation: captureState.current.tag,
        currentCheckpointId: checkpointRepository.getHeadId(),
        checkpointCount: checkpointRepository.list().length,
        draft: draft.value,
      };
    },
    writeProgram: async (command, signal) =>
      writeProgram(command.code, command.changeSummary, signal),
    evaluateAttempt,
    listCheckpoints,
    inspectCheckpoint,
    checkoutCheckpoint,
  };

  useEffect(() => {
    if (workspace === null || hydratedWorkspace !== workspace) return;

    let disposed = false;
    const registration = new AbortController();
    const proxyHandlers: WorkspaceToolHandlers = {
      getWorkspaceState: async (signal) =>
        toolHandlers.current?.getWorkspaceState(signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
      writeProgram: async (command, signal) =>
        toolHandlers.current?.writeProgram(command, signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
      evaluateAttempt: async (signal) =>
        toolHandlers.current?.evaluateAttempt(signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
      listCheckpoints: async (signal) =>
        toolHandlers.current?.listCheckpoints(signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
      inspectCheckpoint: async (id, signal) =>
        toolHandlers.current?.inspectCheckpoint(id, signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
      checkoutCheckpoint: async (id, signal) =>
        toolHandlers.current?.checkoutCheckpoint(id, signal) ??
        toolError('workspace_not_ready', 'Workspace tools are not ready'),
    };

    void registerWorkspaceTools(proxyHandlers, registration.signal).then((registered) => {
      if (registered.isErr()) {
        if (!disposed) setWebMcp({ tag: 'failed', message: registered.error.message });
        return;
      }

      if (disposed) return;
      setWebMcp(
        registered.value.supported
          ? { tag: 'connected', message: '6 agent tools connected' }
          : { tag: 'unsupported', message: 'WebMCP unavailable in this browser' },
      );
    });

    return () => {
      disposed = true;
      registration.abort();
    };
  }, [hydratedWorkspace, workspace]);

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
            message: `${loaded.value.durationSeconds.toFixed(2)}s file · comparing first ${Math.min(loaded.value.durationSeconds, referenceComparisonWindowSeconds).toFixed(2)}s · ${loaded.value.sampleRate.toLocaleString()} Hz · ${loaded.value.numberOfChannels} channel${loaded.value.numberOfChannels === 1 ? '' : 's'}`,
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
            onClick={() => void evaluateAttempt(new AbortController().signal)}
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

      <section className="checkpoint-panel" aria-labelledby="checkpoint-heading">
        <div>
          <p className="eyebrow">05 · ITERATIONS</p>
          <h2 id="checkpoint-heading">Checkpoint timeline</h2>
          <p className="capture-message">
            {checkpoints.length === 0
              ? 'Successful evaluations will appear here.'
              : `${checkpoints.length} committed attempt${checkpoints.length === 1 ? '' : 's'} · survives reload`}
          </p>
          {checkpoints.length === 0 ? null : (
            <button
              className="file-button"
              disabled={capture.tag === 'recording' || transitionIsPending}
              onClick={() => {
                void checkpointRepository.clear().then(() => {
                  setCheckpoints([]);
                  setCurrentCheckpointId(null);
                  setCapture({ tag: 'idle', message: 'History cleared.' });
                  setComparison({
                    tag: 'idle',
                    message: 'Capture an attempt to compare its energy contour.',
                  });
                });
              }}
              type="button"
            >
              Clear history
            </button>
          )}
        </div>
        <ol className="checkpoint-list">
          {checkpoints.map((checkpoint) => {
            const similarity = checkpointSimilarity(checkpoint);
            return (
              <li data-current={checkpoint.id === currentCheckpointId} key={checkpoint.id}>
                <button
                  aria-label={`Restore checkpoint ${checkpoint.id}`}
                  aria-pressed={checkpoint.id === currentCheckpointId}
                  disabled={capture.tag === 'recording' || transitionIsPending}
                  onClick={() =>
                    void checkoutCheckpoint(checkpoint.id, new AbortController().signal)
                  }
                  type="button"
                >
                  <span>{checkpoint.id}</span>
                  <strong>{Math.round(similarity * 100)}%</strong>
                  <small>{checkpoint.changeSummary}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <footer>
        <span>Reference input — connected</span>
        <span>Master output capture — connected</span>
        <span>WebMCP — {webMcp.message}</span>
      </footer>
    </main>
  );
};
