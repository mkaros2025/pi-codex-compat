import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_BASENAME = "pi-codex-compat.json";
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
      `[pi-codex-compat] Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {};
  }
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

export function readEffectiveConfig(agentDir = getAgentDir()): CodexCompatConfig {
  return normalizeConfig(readDocument(getGlobalConfigPath(agentDir)));
}

export function writeConfig(
  patch: CodexCompatConfigPatch,
  agentDir = getAgentDir(),
): { ok: true; path: string } | { ok: false; error: string; path: string } {
  const path = getGlobalConfigPath(agentDir);
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
