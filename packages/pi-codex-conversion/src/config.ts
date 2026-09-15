import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_BASENAME = "pi-codex-tools.json";
export type CodexToolsMode = "auto" | "on" | "off";

export interface CodexToolsConfig {
  mode: CodexToolsMode;
  modelPrefixes: string[];
}

export interface CodexToolsConfigPatch {
  mode?: CodexToolsMode;
  modelPrefixes?: string[];
}

export const DEFAULT_CODEX_TOOLS_CONFIG: CodexToolsConfig = {
  mode: "auto",
  modelPrefixes: ["gpt"],
};

export type ConfigScope = "global" | "project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readDocument(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    console.warn(
      `[pi-codex-tools] Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}

function readPatch(path: string): CodexToolsConfigPatch {
  return readPatchFromDocument(readDocument(path));
}

export function normalizeConfig(value: unknown): CodexToolsConfig {
  const patch = isRecord(value) ? readPatchFromDocument(value) : {};
  return {
    mode: patch.mode ?? DEFAULT_CODEX_TOOLS_CONFIG.mode,
    modelPrefixes: patch.modelPrefixes ?? [...DEFAULT_CODEX_TOOLS_CONFIG.modelPrefixes],
  };
}

function readPatchFromDocument(document: Record<string, unknown>): CodexToolsConfigPatch {
  const patch: CodexToolsConfigPatch = {};
  if (document["mode"] === "auto" || document["mode"] === "on" || document["mode"] === "off") {
    patch.mode = document["mode"];
  }
  if (Array.isArray(document["modelPrefixes"])) {
    patch.modelPrefixes = document["modelPrefixes"]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
  }
  return patch;
}

export function getGlobalConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, CONFIG_BASENAME);
}

export function getProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_BASENAME);
}

export function readEffectiveConfig(options: {
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
}): CodexToolsConfig {
  const global = readPatch(getGlobalConfigPath(options.agentDir));
  const project = options.projectTrusted ? readPatch(getProjectConfigPath(options.cwd)) : {};
  return normalizeConfig({ ...global, ...project });
}

export function writeConfig(
  scope: ConfigScope,
  patch: CodexToolsConfigPatch,
  options: { cwd: string; projectTrusted: boolean; agentDir?: string },
): { ok: true; path: string } | { ok: false; error: string; path: string } {
  const path = scope === "project"
    ? getProjectConfigPath(options.cwd)
    : getGlobalConfigPath(options.agentDir);
  if (scope === "project" && !options.projectTrusted) {
    return { ok: false, path, error: "Trust this project before writing project settings" };
  }

  const document = readDocument(path);
  if (patch.mode !== undefined) document["mode"] = patch.mode;
  if (patch.modelPrefixes !== undefined) document["modelPrefixes"] = [...patch.modelPrefixes];
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
    return { ok: true, path };
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    return {
      ok: false,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
