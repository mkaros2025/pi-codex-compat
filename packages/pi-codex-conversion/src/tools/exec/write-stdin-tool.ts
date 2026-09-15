import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatUnifiedExecResult } from "./format.ts";
import type { ExecSessionManager, UnifiedExecResult, WriteStdinInput } from "./session-manager.ts";

const PARAMETERS = Type.Object({
  session_id: Type.Number({ description: "Session ID" }),
  chars: Type.Optional(Type.String({ description: "Input; empty polls output" })),
  yield_time_ms: Type.Optional(Type.Number({ description: "Wait milliseconds" })),
  max_output_tokens: Type.Optional(Type.Number({ description: "Output limit" })),
});

function parseArguments(params: unknown): WriteStdinInput {
  if (!params || typeof params !== "object") throw new Error("write_stdin requires an object parameter");
  const record = params as Record<string, unknown>;
  if (typeof record["session_id"] !== "number") throw new Error("write_stdin requires numeric 'session_id'");
  return {
    session_id: record["session_id"],
    ...(typeof record["chars"] === "string" ? { chars: record["chars"] } : {}),
    ...(typeof record["yield_time_ms"] === "number" ? { yield_time_ms: record["yield_time_ms"] } : {}),
    ...(typeof record["max_output_tokens"] === "number" ? { max_output_tokens: record["max_output_tokens"] } : {}),
  };
}

function resultFor(result: UnifiedExecResult, command: string) {
  return {
    content: [{ type: "text" as const, text: formatUnifiedExecResult(result, command) }],
    details: result,
  };
}

export function createWriteStdinTool(
  sessions: ExecSessionManager,
): Parameters<ExtensionAPI["registerTool"]>[0] {
  return {
    name: "write_stdin",
    label: "write_stdin",
    description: "Write to or poll an exec session",
    promptSnippet: "Write to exec session",
    parameters: PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      const input = parseArguments(params);
      const command = sessions.getSessionCommand(input.session_id) ?? "";
      const toToolResult = (partial: UnifiedExecResult) => resultFor(partial, command);
      try {
        const result = await sessions.write(
          input,
          signal,
          onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined,
        );
        return resultFor(result, command);
      } catch (error) {
        throw new Error(`write_stdin failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

export function registerWriteStdinTool(
  pi: ExtensionAPI,
  sessions: ExecSessionManager,
): void {
  pi.registerTool(createWriteStdinTool(sessions));
}
