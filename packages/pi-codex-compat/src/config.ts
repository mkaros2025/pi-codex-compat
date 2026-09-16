import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_BASENAME = "pi-codex-compat.json";
export const LEGACY_CONFIG_BASENAME = "pi-codex-tools.json";
export type CodexCompatMode = "auto" | "on" | "off";

export interface CodexCompatConfig {
  mode: CodexCompatMode;
  modelPrefixes: string[];
}

export interface CodexCompatConfigPatch {
  mode?: CodexCompatMode;
  modelPrefixes?: string[];
}

export const DEFAULT_CODEX_COMPAT_CONFIG: CodexCompatConfig = {
  mode: "auto",
  modelPrefixes: ["gpt"],
};

export type ConfigScope = "global" | "project";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const warnedLegacyPaths = new Set<string>();

function readDocument(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    console.warn(
      `[pi-codex-compat] Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
}

function readPatch(path: string): CodexCompatConfigPatch {
  return readPatchFromDocument(readDocument(path));
}

function readPatchWithLegacy(primaryPath: string, legacyPath: string): CodexCompatConfigPatch {
  if (existsSync(primaryPath)) return readPatch(primaryPath);
  if (!existsSync(legacyPath)) return {};
  if (!warnedLegacyPaths.has(legacyPath)) {
    warnedLegacyPaths.add(legacyPath);
    console.warn(`[pi-codex-compat] Using legacy config ${legacyPath}; migrate it to ${primaryPath}`);
  }
  return readPatch(legacyPath);
}

export function normalizeConfig(value: unknown): CodexCompatConfig {
  const patch = isRecord(value) ? readPatchFromDocument(value) : {};
  return {
    mode: patch.mode ?? DEFAULT_CODEX_COMPAT_CONFIG.mode,
    modelPrefixes: patch.modelPrefixes ?? [...DEFAULT_CODEX_COMPAT_CONFIG.modelPrefixes],
  };
}

function readPatchFromDocument(document: Record<string, unknown>): CodexCompatConfigPatch {
  const patch: CodexCompatConfigPatch = {};
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

export function getLegacyGlobalConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, LEGACY_CONFIG_BASENAME);
}

export function getProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_BASENAME);
}

export function getLegacyProjectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, LEGACY_CONFIG_BASENAME);
}

export function readEffectiveConfig(options: {
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
}): CodexCompatConfig {
  const global = readPatchWithLegacy(
    getGlobalConfigPath(options.agentDir),
    getLegacyGlobalConfigPath(options.agentDir),
  );
  const project = options.projectTrusted
    ? readPatchWithLegacy(getProjectConfigPath(options.cwd), getLegacyProjectConfigPath(options.cwd))
    : {};
  return normalizeConfig({ ...global, ...project });
}

export function writeConfig(
  scope: ConfigScope,
  patch: CodexCompatConfigPatch,
  options: { cwd: string; projectTrusted: boolean; agentDir?: string },
): { ok: true; path: string } | { ok: false; error: string; path: string } {
  const path = scope === "project"
    ? getProjectConfigPath(options.cwd)
    : getGlobalConfigPath(options.agentDir);
  const legacyPath = scope === "project"
    ? getLegacyProjectConfigPath(options.cwd)
    : getLegacyGlobalConfigPath(options.agentDir);
  if (scope === "project" && !options.projectTrusted) {
    return { ok: false, path, error: "Trust this project before writing project settings" };
  }

  const sourcePath = existsSync(path) ? path : legacyPath;
  if (sourcePath === legacyPath) readPatchWithLegacy(path, legacyPath);
  const document = readDocument(sourcePath);
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
