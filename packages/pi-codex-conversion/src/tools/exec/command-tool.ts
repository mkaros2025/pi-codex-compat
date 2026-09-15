import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfiguredShellPath } from "../../runtime-shell.ts";
import { formatUnifiedExecResult } from "./format.ts";
import type { ExecCommandInput, ExecSessionManager, UnifiedExecResult } from "./session-manager.ts";
import { MAX_EXEC_YIELD_TIME_MS } from "./shell.ts";

const PARAMETERS = Type.Object({
  cmd: Type.String({ description: "Shell command; do not quote the whole command" }),
  workdir: Type.Optional(Type.String({ description: "Working directory" })),
  shell: Type.Optional(Type.String({ description: "Shell executable" })),
  tty: Type.Optional(Type.Boolean({ description: "Keep stdin open" })),
  yield_time_ms: Type.Optional(Type.Number({ description: "Wait milliseconds" })),
  max_output_tokens: Type.Optional(Type.Number({ description: "Output limit" })),
  login: Type.Optional(Type.Boolean({ description: "Use a login shell" })),
});

interface ExecCommandParams {
  cmd: string;
  workdir?: string | undefined;
  shell?: string | undefined;
  tty?: boolean | undefined;
  yield_time_ms?: number | undefined;
  max_output_tokens?: number | undefined;
  login?: boolean | undefined;
}

function prepareArguments(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const prepared = { ...(args as Record<string, unknown>) };
  if (!("cmd" in prepared) && "command" in prepared) prepared["cmd"] = prepared["command"];
  if (!("workdir" in prepared)) {
    if ("cwd" in prepared) prepared["workdir"] = prepared["cwd"];
    else if ("working_directory" in prepared) prepared["workdir"] = prepared["working_directory"];
  }
  return prepared;
}

function parseArguments(params: unknown): ExecCommandParams {
  if (!params || typeof params !== "object") throw new Error("exec_command requires an object parameter");
  const record = params as Record<string, unknown>;
  if (typeof record["cmd"] !== "string") throw new Error("exec_command requires a string 'cmd' parameter");
  return {
    cmd: record["cmd"],
    ...(typeof record["workdir"] === "string" ? { workdir: record["workdir"] } : {}),
    ...(typeof record["shell"] === "string" ? { shell: record["shell"] } : {}),
    ...(typeof record["tty"] === "boolean" ? { tty: record["tty"] } : {}),
    ...(typeof record["yield_time_ms"] === "number" ? { yield_time_ms: record["yield_time_ms"] } : {}),
    ...(typeof record["max_output_tokens"] === "number" ? { max_output_tokens: record["max_output_tokens"] } : {}),
    ...(typeof record["login"] === "boolean" ? { login: record["login"] } : {}),
  };
}

export function createExecCommandTool(
  sessions: ExecSessionManager,
): Parameters<ExtensionAPI["registerTool"]>[0] {
  return {
    name: "exec_command",
    label: "exec_command",
    description: "Run a shell command; long commands return session_id",
    promptSnippet: "Run command",
    parameters: PARAMETERS,
    prepareArguments,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) throw new Error("exec_command aborted");
      const parsed = parseArguments(params);
      const input: ExecCommandInput = {
        ...parsed,
        ...(parsed.shell === undefined
          ? { defaultShell: getConfiguredShellPath(ctx) }
          : {}),
      };
      const toToolResult = (result: UnifiedExecResult) => ({
        content: [{ type: "text" as const, text: formatUnifiedExecResult(result, input.cmd) }],
        details: result,
      });
      const execInput = input.tty
        ? input
        : { ...input, max_yield_time_ms: MAX_EXEC_YIELD_TIME_MS };
      const result = await sessions.exec(
        execInput,
        ctx.cwd,
        signal,
        onUpdate ? (partial) => onUpdate(toToolResult(partial)) : undefined,
      );
      return toToolResult(result);
    },
  };
}

export function registerExecCommandTool(
  pi: ExtensionAPI,
  sessions: ExecSessionManager,
): void {
  pi.registerTool(createExecCommandTool(sessions));
}
