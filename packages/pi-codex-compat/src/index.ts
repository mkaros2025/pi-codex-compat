import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerApplyPatchTool } from "./tools/apply-patch/tool.ts";
import { createExecSessionManager } from "./tools/exec/session-manager.ts";
import { createExecCommandTool } from "./tools/exec/command-tool.ts";
import { createWriteStdinTool } from "./tools/exec/write-stdin-tool.ts";
import { createViewImageTool } from "./tools/view-image/tool.ts";
import {
  DEFAULT_CODEX_COMPAT_CONFIG,
  getGlobalConfigPath,
  getProjectConfigPath,
  readEffectiveConfig,
  writeConfig,
  type ConfigScope,
  type CodexCompatMode,
} from "./config.ts";
import { shouldActivate } from "./model.ts";
import { createPermissionBridge } from "./permissions.ts";

export const CODEX_COMPAT_TOOL_NAMES = [
  "exec_command",
  "write_stdin",
  "apply_patch",
  "view_image",
] as const;

const NATIVE_TOOL_NAMES = new Set(["read", "bash", "edit", "write"]);
const OWNED_TOOL_NAMES = new Set<string>(CODEX_COMPAT_TOOL_NAMES);

interface ActivationState {
  enabled: boolean;
  nativeTools: string[];
}

function setActiveTools(pi: ExtensionAPI, names: string[]): void {
  const current = pi.getActiveTools();
  if (current.length === names.length && current.every((name, index) => name === names[index])) return;
  pi.setActiveTools(names);
}

function enableTools(pi: ExtensionAPI, state: ActivationState): void {
  const currentTools = pi.getActiveTools();
  for (const name of currentTools) {
    if (NATIVE_TOOL_NAMES.has(name) && !state.nativeTools.includes(name)) state.nativeTools.push(name);
  }
  state.enabled = true;
  const otherTools = currentTools.filter(
    (name) => !NATIVE_TOOL_NAMES.has(name) && !OWNED_TOOL_NAMES.has(name),
  );
  setActiveTools(pi, [...CODEX_COMPAT_TOOL_NAMES, ...otherTools]);
}

function disableTools(pi: ExtensionAPI, state: ActivationState): void {
  const otherTools = pi.getActiveTools().filter((name) => !OWNED_TOOL_NAMES.has(name));
  const restored = [...otherTools];
  for (const name of state.nativeTools) if (!restored.includes(name)) restored.push(name);
  setActiveTools(pi, restored);
  state.enabled = false;
  state.nativeTools = [];
}

function parseCommand(args: string): {
  scope: ConfigScope;
  action: "mode" | "prefixes" | "show";
  value?: string;
} | { error: string } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  let scope: ConfigScope = "global";
  if (tokens[0] === "global" || tokens[0] === "project") scope = tokens.shift() as ConfigScope;
  const action = tokens.shift();
  if (!action || action === "show") return { scope, action: "show" };
  if (action === "auto" || action === "on" || action === "off") {
    if (tokens.length > 0) return { error: "Mode takes no extra arguments" };
    return { scope, action: "mode", value: action };
  }
  if (action === "prefixes") {
    const value = tokens.join(" ").split(/[\s,]+/).filter(Boolean);
    if (value.length === 0) return { error: "Provide at least one model prefix" };
    return { scope, action: "prefixes", value: value.join("\n") };
  }
  return { error: "Use auto, on, off, or prefixes <prefix,...>" };
}

function sync(pi: ExtensionAPI, ctx: ExtensionContext, state: ActivationState, model = ctx.model): void {
  const config = readEffectiveConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
  if (shouldActivate(model, config)) enableTools(pi, state);
  else disableTools(pi, state);
}

export default function piCodexCompat(pi: ExtensionAPI): void {
  const permissionBridge = createPermissionBridge(pi);
  const sessions = createExecSessionManager();
  pi.registerTool(createExecCommandTool(sessions));
  pi.registerTool(createWriteStdinTool(sessions));
  registerApplyPatchTool(pi, { permissionBridge });
  pi.registerTool(createViewImageTool());

  const state: ActivationState = {
    enabled: false,
    nativeTools: [],
  };

  pi.on("session_start", (_event, ctx) => sync(pi, ctx, state));
  pi.on("model_select", (event, ctx) => sync(pi, ctx, state, event.model));
  pi.on("session_shutdown", async () => {
    permissionBridge.dispose();
    await sessions.shutdown();
  });

  pi.registerCommand("codex-compat", {
    description: "Configure Codex tool activation",
    handler: async (args, ctx) => {
      const command = parseCommand(args);
      if ("error" in command) {
        ctx.ui.notify(command.error, "warning");
        return;
      }
      if (command.action === "show") {
        const config = readEffectiveConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
        ctx.ui.notify(
          `mode=${config.mode}; modelPrefixes=${config.modelPrefixes.join(", ")}; active=${shouldActivate(ctx.model, config)}\n` +
            `global: ${getGlobalConfigPath()}\n` +
            `project: ${getProjectConfigPath(ctx.cwd)} (${ctx.isProjectTrusted() ? "enabled" : "ignored until trusted"})`,
        );
        return;
      }
      const patch = command.action === "mode"
        ? { mode: command.value as CodexCompatMode }
        : { modelPrefixes: command.value!.split("\n") };
      const result = writeConfig(command.scope, patch, {
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
      });
      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
        return;
      }
      sync(pi, ctx, state);
      ctx.ui.notify(`Saved ${result.path}`);
    },
  });
}

export {
  DEFAULT_CODEX_COMPAT_CONFIG,
  readEffectiveConfig,
  shouldActivate,
  writeConfig,
};
