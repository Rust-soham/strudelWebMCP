import { Result, TaggedError } from 'better-result';

import { checkpointId } from '../../domain/model.ts';
import type { AnalysisWarning, CheckpointId, Measurement } from '../../domain/model.ts';

/** Parsed input for replacing the visible Strudel draft. */
export type WriteProgramCommand = Readonly<{
  code: string;
  changeSummary: string;
}>;

/** Application operations exposed to a browser-integrated agent. */
export type WorkspaceToolHandlers = Readonly<{
  getWorkspaceState(signal: AbortSignal): Promise<WorkspaceToolResult>;
  writeProgram(command: WriteProgramCommand, signal: AbortSignal): Promise<WorkspaceToolResult>;
  evaluateAttempt(signal: AbortSignal): Promise<WorkspaceToolResult>;
  listCheckpoints(signal: AbortSignal): Promise<WorkspaceToolResult>;
  inspectCheckpoint(id: CheckpointId, signal: AbortSignal): Promise<WorkspaceToolResult>;
  checkoutCheckpoint(id: CheckpointId, signal: AbortSignal): Promise<WorkspaceToolResult>;
}>;

/** Stable error envelope returned to an agent without rejecting a tool execution. */
export type WorkspaceToolError = Readonly<{
  ok: false;
  error: Readonly<{ code: string; message: string }>;
}>;

/** Serializable results returned by the Strudel workspace tools. */
export type WorkspaceToolResult =
  | WorkspaceToolError
  | Readonly<{
      ok: true;
      referenceLoaded: boolean;
      referenceWindowSeconds: number;
      operation: string;
      currentCheckpointId: CheckpointId | null;
      checkpointCount: number;
      draft: Readonly<{
        code: string;
        baseCheckpointId: CheckpointId | null;
        changeSummary: string;
      }>;
    }>
  | Readonly<{
      ok: true;
      draft: Readonly<{
        code: string;
        baseCheckpointId: CheckpointId | null;
        changeSummary: string;
      }>;
    }>
  | Readonly<{
      ok: true;
      referenceWindowSeconds: number;
      checkpoint: Readonly<{
        id: CheckpointId;
        parentId: CheckpointId | null;
        changeSummary: string;
        durationSeconds: number;
        completeness: number;
        measurements: ReadonlyArray<Measurement>;
        observations: ReadonlyArray<string>;
        warnings: ReadonlyArray<AnalysisWarning>;
      }>;
    }>
  | Readonly<{
      ok: true;
      checkpoints: ReadonlyArray<{
        id: CheckpointId;
        parentId: CheckpointId | null;
        changeSummary: string;
        durationSeconds: number;
        similarity: number;
      }>;
    }>
  | Readonly<{
      ok: true;
      inspectedCheckpoint: Readonly<{
        id: CheckpointId;
        parentId: CheckpointId | null;
        code: string;
        changeSummary: string;
        createdAt: string;
        durationSeconds: number;
        completeness: number;
        measurements: ReadonlyArray<Measurement>;
        observations: ReadonlyArray<string>;
        warnings: ReadonlyArray<AnalysisWarning>;
      }>;
    }>
  | Readonly<{
      ok: true;
      restoredCheckpointId: CheckpointId;
      draft: Readonly<{
        code: string;
        baseCheckpointId: CheckpointId;
        changeSummary: string;
      }>;
    }>;

/** Whether the current browser accepted the workspace tool registration. */
export type WorkspaceToolRegistration = Readonly<{
  supported: boolean;
}>;

/** Browser failure while registering the workspace tool surface. */
export class WorkspaceToolRegistrationFailed extends TaggedError(
  'WorkspaceToolRegistrationFailed',
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

const invalidArguments = (message: string): WorkspaceToolError => ({
  ok: false,
  error: { code: 'invalid_arguments', message },
});

const parseWriteProgram = (input: Readonly<object>): Result<WriteProgramCommand, string> => {
  if (
    !('code' in input) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This protocol parser establishes the string field before constructing WriteProgramCommand.
    typeof input.code !== 'string' ||
    input.code.trim().length === 0 ||
    input.code.length > 20_000
  ) {
    return Result.err('code must be a non-empty string of at most 20000 characters');
  }
  if (
    !('changeSummary' in input) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This protocol parser establishes the string field before constructing WriteProgramCommand.
    typeof input.changeSummary !== 'string' ||
    input.changeSummary.trim().length === 0 ||
    input.changeSummary.length > 240
  ) {
    return Result.err('changeSummary must be a non-empty string of at most 240 characters');
  }

  return Result.ok({ code: input.code, changeSummary: input.changeSummary });
};

const parseCheckpointId = (input: Readonly<object>): Result<CheckpointId, string> => {
  if (
    !('checkpointId' in input) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This protocol parser establishes the string field before invoking the domain parser.
    typeof input.checkpointId !== 'string'
  ) {
    return Result.err('checkpointId must be a non-empty string');
  }

  const parsed = checkpointId(input.checkpointId);
  return parsed.isErr() ? Result.err(parsed.error.message) : Result.ok(parsed.value);
};

const emptyInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const checkpointInputSchema = {
  type: 'object',
  properties: { checkpointId: { type: 'string', minLength: 1 } },
  required: ['checkpointId'],
  additionalProperties: false,
} as const;

const executionSignal = (options: WebMcpToolExecutionOptions | undefined): AbortSignal =>
  options?.signal ?? new AbortController().signal;

/** Registers the task-level Strudel tools when the current browser supports WebMCP. */
export const registerWorkspaceTools = async (
  handlers: WorkspaceToolHandlers,
  lifecycle: AbortSignal,
  modelContextOverride: ModelContext | undefined = undefined,
): Promise<Result<WorkspaceToolRegistration, WorkspaceToolRegistrationFailed>> => {
  let modelContext = modelContextOverride;
  if (modelContext === undefined) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- WebMCP is optional, so server-side and unsupported runtimes require feature detection.
    if (typeof document === 'undefined') {
      return Result.ok({ supported: false });
    }
    modelContext = document.modelContext;
  }
  if (modelContext === undefined) {
    return Result.ok({ supported: false });
  }

  const registration = new AbortController();
  const dispose = (): void => registration.abort(lifecycle.reason);
  lifecycle.addEventListener('abort', dispose, { once: true });
  if (lifecycle.aborted) dispose();

  try {
    await Promise.all([
      modelContext.registerTool(
        {
          name: 'get_workspace_state',
          title: 'Inspect Strudel workspace',
          description:
            'Read the visible Strudel draft, reference readiness, operation state, and checkpoint count.',
          inputSchema: emptyInputSchema,
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (_input, options) => handlers.getWorkspaceState(executionSignal(options)),
        },
        { signal: registration.signal },
      ),
      modelContext.registerTool(
        {
          name: 'write_program',
          title: 'Write Strudel program',
          description:
            'Replace the visible Strudel editor draft. This does not evaluate, play, capture, or create a checkpoint.',
          inputSchema: {
            type: 'object',
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 20_000 },
              changeSummary: { type: 'string', minLength: 1, maxLength: 240 },
            },
            required: ['code', 'changeSummary'],
            additionalProperties: false,
          },
          execute: async (input, options) => {
            const parsed = parseWriteProgram(input);
            return parsed.isErr()
              ? invalidArguments(parsed.error)
              : handlers.writeProgram(parsed.value, executionSignal(options));
          },
        },
        { signal: registration.signal },
      ),
      modelContext.registerTool(
        {
          name: 'evaluate_attempt',
          title: 'Evaluate Strudel attempt',
          description:
            'Evaluate the visible program, capture four complete cycles, compare it with the uploaded reference, and commit one checkpoint.',
          inputSchema: emptyInputSchema,
          execute: async (_input, options) => handlers.evaluateAttempt(executionSignal(options)),
        },
        { signal: registration.signal },
      ),
      modelContext.registerTool(
        {
          name: 'list_checkpoints',
          title: 'List Strudel checkpoints',
          description:
            'List immutable attempt summaries in commit order, including lineage and similarity.',
          inputSchema: emptyInputSchema,
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (_input, options) => handlers.listCheckpoints(executionSignal(options)),
        },
        { signal: registration.signal },
      ),
      modelContext.registerTool(
        {
          name: 'inspect_checkpoint',
          title: 'Inspect Strudel checkpoint',
          description:
            'Read the exact code, lineage, measurements, and observations stored for one checkpoint.',
          inputSchema: checkpointInputSchema,
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input, options) => {
            const parsed = parseCheckpointId(input);
            return parsed.isErr()
              ? invalidArguments(parsed.error)
              : handlers.inspectCheckpoint(parsed.value, executionSignal(options));
          },
        },
        { signal: registration.signal },
      ),
      modelContext.registerTool(
        {
          name: 'checkout_checkpoint',
          title: 'Restore Strudel checkpoint',
          description:
            'Restore one immutable checkpoint into the visible editor and use it as the parent of the next evaluated attempt.',
          inputSchema: checkpointInputSchema,
          execute: async (input, options) => {
            const parsed = parseCheckpointId(input);
            return parsed.isErr()
              ? invalidArguments(parsed.error)
              : handlers.checkoutCheckpoint(parsed.value, executionSignal(options));
          },
        },
        { signal: registration.signal },
      ),
    ]);

    return Result.ok({ supported: true });
  } catch (cause) {
    registration.abort();
    return Result.err(
      new WorkspaceToolRegistrationFailed({
        cause,
        message: 'Could not register the Strudel WebMCP tools',
      }),
    );
  }
};
