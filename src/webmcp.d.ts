import type { WorkspaceToolResult } from './adapters/webmcp/register-workspace-tools.ts';

declare global {
  interface WebMcpToolAnnotations {
    readonly readOnlyHint?: boolean;
    readonly untrustedContentHint?: boolean;
  }

  interface WebMcpToolExecutionOptions {
    readonly signal?: AbortSignal;
  }

  interface WebMcpJsonSchema {
    readonly type: string;
    readonly properties?: Readonly<Record<string, WebMcpJsonSchema>>;
    readonly required?: ReadonlyArray<string>;
    readonly additionalProperties?: boolean;
    readonly minLength?: number;
    readonly maxLength?: number;
  }

  interface WebMcpTool {
    readonly name: string;
    readonly title?: string;
    readonly description: string;
    readonly inputSchema?: WebMcpJsonSchema;
    readonly annotations?: WebMcpToolAnnotations;
    readonly execute: (
      input: Readonly<object>,
      options?: WebMcpToolExecutionOptions,
    ) => Promise<WorkspaceToolResult>;
  }

  interface ModelContext {
    registerTool(tool: WebMcpTool, options?: { readonly signal?: AbortSignal }): Promise<void>;
  }

  interface Document {
    readonly modelContext?: ModelContext;
  }
}
