import { Result } from 'better-result';
import { describe, expect, it } from 'vitest';

import { checkpointId, strudelCode } from '../src/domain/model.ts';
import {
  StrudelReplWorkspace,
  type StrudelMirror,
  type StrudelReplElement,
} from '../src/adapters/strudel/strudel-repl-workspace.ts';

const unwrap = <Value, Error>(result: Result<Value, Error>): Value => {
  if (result.isErr()) throw result.error;
  return result.value;
};

const initialCode = unwrap(strudelCode('note("c a f e")'));
const restoredCode = unwrap(strudelCode('sound("bd sd")'));
const parentId = unwrap(checkpointId('a1'));

type EditorHarness = Readonly<{
  editor: StrudelMirror;
  element: StrudelReplElement;
  evaluatedWithAutostart: ReadonlyArray<boolean | undefined>;
  stopped: () => boolean;
}>;

const makeEditorHarness = (): EditorHarness => {
  const evaluatedWithAutostart: Array<boolean | undefined> = [];
  let stopped = false;
  const editor: StrudelMirror = {
    code: initialCode,
    repl: { scheduler: { cps: 0.5 }, state: {} },
    evaluate: async (autostart) => {
      evaluatedWithAutostart.push(autostart);
    },
    setCode(nextCode) {
      // SAFETY: This test harness owns the mutable implementation of Strudel's readonly public code view.
      (this as { code: string }).code = nextCode;
    },
    stop: async () => {
      stopped = true;
    },
  };

  // SAFETY: The adapter uses only the editor property represented by this boundary fixture.
  const element = { editor } as StrudelReplElement;

  return { editor, element, evaluatedWithAutostart, stopped: () => stopped };
};

describe('StrudelReplWorkspace', () => {
  it('evaluates without autostart and derives whole-cycle duration from scheduler cps', async () => {
    const harness = makeEditorHarness();
    const workspace = new StrudelReplWorkspace(harness.element);

    const result = await workspace.evaluate(initialCode, new AbortController().signal);

    expect(result).toEqual(Result.ok({ code: initialCode, cycleDurationSeconds: 2 }));
    expect(harness.evaluatedWithAutostart).toEqual([false]);
  });

  it('reports evaluation errors stored by Strudel even when evaluate resolves', async () => {
    const harness = makeEditorHarness();
    const syntaxError = new SyntaxError('Unexpected token');
    // SAFETY: This test recreates Strudel mutating its otherwise readonly observable state.
    (harness.editor.repl as { state: { error?: unknown } }).state.error = syntaxError;
    const workspace = new StrudelReplWorkspace(harness.element);

    const result = await workspace.evaluate(initialCode, new AbortController().signal);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.cause).toBe(syntaxError);
  });

  it('restores editor source and uses the checkpoint as subsequent branch metadata', () => {
    const harness = makeEditorHarness();
    const workspace = new StrudelReplWorkspace(harness.element);

    const restored = workspace.restore({ baseCheckpointId: parentId, code: restoredCode });
    const draft = workspace.getDraft();

    expect(restored.isOk()).toBe(true);
    expect(draft).toEqual(
      Result.ok({
        baseCheckpointId: parentId,
        code: restoredCode,
        changeSummary: 'Restored checkpoint',
      }),
    );
  });

  it('delegates stop to Strudel without changing the draft', async () => {
    const harness = makeEditorHarness();
    const workspace = new StrudelReplWorkspace(harness.element);
    const before = workspace.getDraft();

    await workspace.stop();

    expect(harness.stopped()).toBe(true);
    expect(workspace.getDraft()).toEqual(before);
  });
});
