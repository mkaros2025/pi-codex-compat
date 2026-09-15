import { Type } from "typebox";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parsePatchActions } from "../../patch/parser.ts";
import { resolvePatchPath } from "../../patch/paths.ts";
import { ExecutePatchError, type ExecutePatchResult } from "../../patch/types.ts";
import { checkPatchPermissions, type PermissionBridge } from "../../permissions.ts";
import { executePatchWithRust } from "./executor.ts";

const PARAMETERS = Type.Object({
  input: Type.String({ description: "Full *** Begin Patch / *** End Patch text" }),
});

function prepareArguments(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const record = args as Record<string, unknown>;
  if (typeof record["input"] === "string") return record;
  if (typeof record["patchText"] === "string") return { ...record, input: record["patchText"] };
  if (typeof record["patch"] === "string") return { ...record, input: record["patch"] };
  return args;
}

export interface ApplyPatchToolOptions {
  permissionBridge?: PermissionBridge;
}

function parseArguments(params: unknown): string {
  if (!params || typeof params !== "object") throw new Error("apply_patch requires an object parameter");
  const input = (params as Record<string, unknown>)["input"];
  if (typeof input !== "string") throw new Error("apply_patch requires a string 'input' parameter");
  return input;
}

function touchedPaths(cwd: string, patchText: string): string[] {
  try {
    return [
      ...new Set(
        parsePatchActions({ text: patchText })
          .flatMap((action) => [action.path, action.movePath])
          .filter((path): path is string => Boolean(path))
          .map((path) => resolvePatchPath({ cwd, patchPath: path })),
      ),
    ];
  } catch {
    return [];
  }
}

function summary(result: ExecutePatchResult): string {
  return [
    "Applied patch successfully",
    `Changed files: ${result.changedFiles.length}`,
    `Created files: ${result.createdFiles.length}`,
    `Deleted files: ${result.deletedFiles.length}`,
    `Moved files: ${result.movedFiles.length}`,
    `Fuzz: ${result.fuzz}`,
  ].join("\n");
}

function partialFailure(error: ExecutePatchError): {
  content: [{ type: "text"; text: string }];
  details: { status: "partial_failure"; result: ExecutePatchResult };
} {
  const failed = error.failures.map(({ action }) => action.path).filter(Boolean);
  const suffix = failed.length > 0 ? `\nFailed files: ${[...new Set(failed)].join(", ")}` : "";
  return {
    content: [{ type: "text", text: `apply_patch partially failed: ${error.message}${suffix}` }],
    details: { status: "partial_failure", result: error.result },
  };
}

async function withTouchedQueues<T>(cwd: string, patchText: string, fn: () => Promise<T>): Promise<T> {
  const paths = touchedPaths(cwd, patchText);
  const run = (index: number): Promise<T> =>
    index >= paths.length
      ? fn()
      : withFileMutationQueue(paths[index]!, () => run(index + 1));
  return run(0);
}

export function createApplyPatchTool(options: ApplyPatchToolOptions = {}): Parameters<ExtensionAPI["registerTool"]>[0] {
  return {
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply a Codex patch. Put the complete *** Begin Patch ... *** End Patch text in `input`; do not put a JSON object or Markdown fence inside `input`.",
    promptSnippet: "Edit files with patch",
    parameters: PARAMETERS,
    executionMode: "sequential",
    prepareArguments,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("apply_patch aborted");
      const patchText = parseArguments(params);
      await checkPatchPermissions(patchText, ctx, options.permissionBridge);
      try {
        const result = await withTouchedQueues(ctx.cwd, patchText, () =>
          executePatchWithRust({ cwd: ctx.cwd, patchText, signal }),
        );
        return { content: [{ type: "text", text: summary(result) }], details: { status: "success", result } };
      } catch (error) {
        if (error instanceof ExecutePatchError && error.hasPartialSuccess()) return partialFailure(error);
        throw error;
      }
    },
  };
}

export function registerApplyPatchResultHook(pi: ExtensionAPI): void {
  pi.on("tool_result", (event) => {
    const details = event.details;
    if (
      event.toolName === "apply_patch" &&
      details &&
      typeof details === "object" &&
      (details as Record<string, unknown>)["status"] === "partial_failure"
    ) {
      return { isError: true };
    }
    return undefined;
  });
}

export function registerApplyPatchTool(pi: ExtensionAPI, options: ApplyPatchToolOptions = {}): void {
  pi.registerTool(createApplyPatchTool(options));
  registerApplyPatchResultHook(pi);
}
