import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  DEFAULT_CODEX_COMPAT_CONFIG,
  getGlobalConfigPath,
  readEffectiveConfig,
  writeConfig,
} from "../src/config.ts";

const execFile = promisify(execFileCallback);
const tsxLoader = createRequire(import.meta.url).resolve("tsx/esm");

async function readConfigFromProjectCwd(agentDir: string, projectDir: string) {
  const configModule = pathToFileURL(join(process.cwd(), "src/config.ts")).href;
  const script = `import { readEffectiveConfig } from ${JSON.stringify(configModule)}; console.log(JSON.stringify(readEffectiveConfig(${JSON.stringify(agentDir)})));`;
  const result = await execFile(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "-e", script],
    { cwd: projectDir, encoding: "utf8" },
  );
  return JSON.parse(String(result.stdout).trim()) as typeof DEFAULT_CODEX_COMPAT_CONFIG;
}

test("global config is persisted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-codex-compat-config-"));
  const agentDir = join(root, "agent");
  try {
    const global = writeConfig({ mode: "off", modelPrefixes: ["custom"] }, agentDir);
    assert.equal(global.ok, true);
    assert.deepEqual(
      readEffectiveConfig(agentDir),
      { mode: "off", modelPrefixes: ["custom"] },
    );
    const saved = JSON.parse(await readFile(global.path, "utf8")) as Record<string, unknown>;
    assert.deepEqual(saved["modelPrefixes"], ["custom"]);
    assert.equal(global.path, getGlobalConfigPath(agentDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores non-global config files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-codex-compat-config-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(projectDir, ".pi"), { recursive: true });
    await writeFile(join(agentDir, "pi-codex-tools.json"), JSON.stringify({ mode: "on", modelPrefixes: ["old"] }));
    await writeFile(join(projectDir, ".pi", "pi-codex-compat.json"), JSON.stringify({ mode: "on", modelPrefixes: ["project"] }));
    await writeFile(join(projectDir, ".pi", "pi-codex-tools.json"), JSON.stringify({ mode: "off", modelPrefixes: ["legacy-project"] }));

    assert.deepEqual(await readConfigFromProjectCwd(agentDir, projectDir), DEFAULT_CODEX_COMPAT_CONFIG);

    const global = writeConfig({ mode: "off", modelPrefixes: ["global"] }, agentDir);
    assert.equal(global.ok, true);
    assert.deepEqual(await readConfigFromProjectCwd(agentDir, projectDir), { mode: "off", modelPrefixes: ["global"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing config uses the GPT prefix default", () => {
  assert.deepEqual(DEFAULT_CODEX_COMPAT_CONFIG, { mode: "auto", modelPrefixes: ["gpt"] });
});
