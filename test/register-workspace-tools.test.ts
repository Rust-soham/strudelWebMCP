import { describe, expect, it } from 'vitest';

import { registerWorkspaceTools } from '../src/adapters/webmcp/register-workspace-tools.ts';

describe('registerWorkspaceTools', () => {
  it('reports unsupported browsers without registering tools', async () => {
    const unavailable = { ok: false, error: { code: 'test', message: 'Unavailable' } } as const;
    const result = await registerWorkspaceTools(
      {
        getWorkspaceState: async () => unavailable,
        writeProgram: async () => unavailable,
        evaluateAttempt: async () => unavailable,
        listCheckpoints: async () => unavailable,
        inspectCheckpoint: async () => unavailable,
        checkoutCheckpoint: async () => unavailable,
      },
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.supported).toBe(false);
  });

  it('registers the three task-level tools and parses write input', async () => {
    const registeredTools: Array<WebMcpTool> = [];
    const registrationSignals: Array<AbortSignal | undefined> = [];
    const writtenPrograms: Array<Readonly<{ code: string; changeSummary: string }>> = [];
    const inspectedCheckpoints: Array<string> = [];
    const checkedOutCheckpoints: Array<string> = [];
    const modelContext: ModelContext = {
      registerTool: async (tool, options) => {
        registeredTools.push(tool);
        registrationSignals.push(options?.signal);
      },
    };
    const lifecycle = new AbortController();
    const unavailable = { ok: false, error: { code: 'test', message: 'Unavailable' } } as const;

    const result = await registerWorkspaceTools(
      {
        getWorkspaceState: async () => unavailable,
        writeProgram: async (command) => {
          writtenPrograms.push(command);
          return unavailable;
        },
        evaluateAttempt: async () => unavailable,
        listCheckpoints: async () => unavailable,
        inspectCheckpoint: async (id) => {
          inspectedCheckpoints.push(id);
          return unavailable;
        },
        checkoutCheckpoint: async (id) => {
          checkedOutCheckpoints.push(id);
          return unavailable;
        },
      },
      lifecycle.signal,
      modelContext,
    );

    expect(result.isOk()).toBe(true);
    expect(registeredTools.map(({ name }) => name).sort()).toEqual([
      'checkout_checkpoint',
      'evaluate_attempt',
      'get_workspace_state',
      'inspect_checkpoint',
      'list_checkpoints',
      'write_program',
    ]);

    const writeTool = registeredTools.find(({ name }) => name === 'write_program');
    const stateTool = registeredTools.find(({ name }) => name === 'get_workspace_state');
    expect(writeTool).toBeDefined();
    expect(stateTool).toBeDefined();
    if (writeTool === undefined || stateTool === undefined) return;

    await stateTool.execute({});

    const invalid = await writeTool.execute({ code: '' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    await writeTool.execute(
      { code: 'sound("bd")', changeSummary: 'Add kick' },
      { signal: lifecycle.signal },
    );
    expect(writtenPrograms).toEqual([{ code: 'sound("bd")', changeSummary: 'Add kick' }]);

    const inspectTool = registeredTools.find(({ name }) => name === 'inspect_checkpoint');
    const checkoutTool = registeredTools.find(({ name }) => name === 'checkout_checkpoint');
    expect(inspectTool).toBeDefined();
    expect(checkoutTool).toBeDefined();
    if (inspectTool === undefined || checkoutTool === undefined) return;

    const invalidCheckpoint = await checkoutTool.execute({ checkpointId: ' ' });
    expect(invalidCheckpoint).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments' },
    });
    await inspectTool.execute({ checkpointId: 'a1' });
    await checkoutTool.execute({ checkpointId: 'a2' });
    expect(inspectedCheckpoints).toEqual(['a1']);
    expect(checkedOutCheckpoints).toEqual(['a2']);

    lifecycle.abort();
    expect(registrationSignals.every((signal) => signal?.aborted === true)).toBe(true);
  });
});
