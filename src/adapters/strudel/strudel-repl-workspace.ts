import { Result } from 'better-result';

import {
  DraftReadFailed,
  DraftWriteFailed,
  OperationCancelled,
  StrudelEvaluationFailed,
  StrudelPlaybackFailed,
} from '../../domain/errors.ts';
import { strudelCode } from '../../domain/model.ts';
import type {
  CheckpointId,
  DraftProgram,
  EvaluatedProgram,
  RestoredProgram,
  StrudelCode,
} from '../../domain/model.ts';
import type { ProgramWorkspace } from '../../domain/ports.ts';

/** The stable subset of Strudel's scheduler used by the workspace adapter. */
export type StrudelScheduler = Readonly<{
  cps: number;
}>;

/** Evaluation state exposed by Strudel's internal REPL. */
export type StrudelReplState = Readonly<{
  error?: unknown;
}>;

/**
 * The subset of `StrudelMirror` used by the application.
 *
 * `@strudel/repl` does not publish TypeScript declarations, so this structural
 * boundary prevents its untyped implementation details from entering the domain.
 */
export type StrudelMirror = {
  readonly code: string;
  readonly repl: Readonly<{
    scheduler: StrudelScheduler;
    state: StrudelReplState;
  }>;
  evaluate(autostart?: boolean): Promise<void>;
  setCode(code: string): void;
  stop(): Promise<void>;
};

/** The custom element shape registered by `@strudel/repl`. */
export type StrudelReplElement = HTMLElement & {
  readonly editor: StrudelMirror | null;
};

/** Input used when the agent or user writes a new editor draft. */
export type WriteStrudelDraft = Readonly<{
  baseCheckpointId: CheckpointId | null;
  code: StrudelCode;
  changeSummary: string;
}>;

/**
 * Adapts the browser's live `strudel-editor` element to the application-owned
 * `ProgramWorkspace` port while preserving native CodeMirror history and flashing.
 */
export class StrudelReplWorkspace implements ProgramWorkspace {
  readonly #element: StrudelReplElement;
  #baseCheckpointId: CheckpointId | null;
  #changeSummary: string;

  /** Creates a workspace around an already-connected `strudel-editor` element. */
  constructor(
    element: StrudelReplElement,
    baseCheckpointId: CheckpointId | null = null,
    changeSummary = 'Initial program',
  ) {
    this.#element = element;
    this.#baseCheckpointId = baseCheckpointId;
    this.#changeSummary = changeSummary;
  }

  /** Reads and parses the live CodeMirror source together with its branch metadata. */
  getDraft(): Result<DraftProgram, DraftReadFailed> {
    const editor = this.#element.editor;

    if (editor === null) {
      return Result.err(
        new DraftReadFailed({
          cause: new Error('The strudel-editor element is not connected'),
          message: 'Strudel editor is not ready',
        }),
      );
    }

    const parsedCode = strudelCode(editor.code);

    if (parsedCode.isErr()) {
      return Result.err(
        new DraftReadFailed({
          cause: parsedCode.error,
          message: parsedCode.error.message,
        }),
      );
    }

    return Result.ok({
      baseCheckpointId: this.#baseCheckpointId,
      code: parsedCode.value,
      changeSummary: this.#changeSummary,
    });
  }

  /**
   * Evaluates source without starting playback and reports errors captured in
   * Strudel's REPL state, because `StrudelMirror.evaluate` swallows those errors.
   */
  async evaluate(
    code: StrudelCode,
    signal: AbortSignal,
  ): Promise<Result<EvaluatedProgram, StrudelEvaluationFailed | OperationCancelled>> {
    return this.#evaluate(code, signal, 'remainStopped');
  }

  /** Evaluates the current source and starts Strudel's scheduler and native highlighting. */
  async play(
    code: StrudelCode,
    signal: AbortSignal,
  ): Promise<Result<EvaluatedProgram, StrudelEvaluationFailed | OperationCancelled>> {
    return this.#evaluate(code, signal, 'start');
  }

  /** Writes a new draft while preserving CodeMirror's native undo history. */
  writeDraft(draft: WriteStrudelDraft): Result<void, DraftWriteFailed> {
    return this.#replaceDraft(draft.code, draft.baseCheckpointId, draft.changeSummary);
  }

  /** Restores source and makes the restored checkpoint the next branch parent. */
  restore(program: RestoredProgram): Result<void, DraftWriteFailed> {
    return this.#replaceDraft(program.code, program.baseCheckpointId, 'Restored checkpoint');
  }

  /** Makes a committed iteration the parent of the next editor draft. */
  markCommitted(checkpointId: CheckpointId): void {
    this.#baseCheckpointId = checkpointId;
    this.#changeSummary = 'Continue from committed attempt';
  }

  /** Stops scheduler playback without changing the current draft or branch metadata. */
  async stop(): Promise<Result<void, StrudelPlaybackFailed>> {
    const editor = this.#element.editor;

    if (editor === null) {
      return Result.err(
        new StrudelPlaybackFailed({
          cause: new Error('The strudel-editor element is not connected'),
          message: 'Strudel editor is not ready',
        }),
      );
    }

    try {
      await editor.stop();
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(new StrudelPlaybackFailed({ cause, message: 'Could not stop Strudel' }));
    }
  }

  async #evaluate(
    code: StrudelCode,
    signal: AbortSignal,
    playback: 'start' | 'remainStopped',
  ): Promise<Result<EvaluatedProgram, StrudelEvaluationFailed | OperationCancelled>> {
    if (signal.aborted) {
      return Result.err(new OperationCancelled({ message: 'Strudel evaluation was cancelled' }));
    }

    const editor = this.#element.editor;

    if (editor === null) {
      return Result.err(
        new StrudelEvaluationFailed({
          cause: new Error('The strudel-editor element is not connected'),
          message: 'Strudel editor is not ready',
        }),
      );
    }

    try {
      if (editor.code !== code) editor.setCode(code);
      await editor.evaluate(playback === 'start');
    } catch (cause) {
      return Result.err(
        new StrudelEvaluationFailed({ cause, message: 'Strudel evaluation failed' }),
      );
    }

    if (signal.aborted) {
      return Result.err(new OperationCancelled({ message: 'Strudel evaluation was cancelled' }));
    }

    const evaluationError = editor.repl.state.error;

    if (evaluationError !== undefined) {
      return Result.err(
        new StrudelEvaluationFailed({
          cause: evaluationError,
          message: 'Strudel rejected the program',
        }),
      );
    }

    const { cps } = editor.repl.scheduler;

    if (!Number.isFinite(cps) || cps <= 0) {
      return Result.err(
        new StrudelEvaluationFailed({
          cause: new Error(`Invalid scheduler rate: ${cps}`),
          message: 'Strudel produced an invalid cycle rate',
        }),
      );
    }

    return Result.ok({ code, cycleDurationSeconds: 1 / cps });
  }

  #replaceDraft(
    code: StrudelCode,
    baseCheckpointId: CheckpointId | null,
    changeSummary: string,
  ): Result<void, DraftWriteFailed> {
    const editor = this.#element.editor;

    if (editor === null) {
      return Result.err(
        new DraftWriteFailed({
          cause: new Error('The strudel-editor element is not connected'),
          message: 'Strudel editor is not ready',
        }),
      );
    }

    try {
      editor.setCode(code);
      this.#baseCheckpointId = baseCheckpointId;
      this.#changeSummary = changeSummary;
      return Result.ok(undefined);
    } catch (cause) {
      return Result.err(
        new DraftWriteFailed({ cause, message: 'Could not update Strudel source' }),
      );
    }
  }
}
