import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_CODEX_COMPAT_CONFIG,
  getGlobalConfigPath,
  getLegacyGlobalConfigPath,
  getProjectConfigPath,
  readEffectiveConfig,
  writeConfig,
} from "../src/config.ts";

test("global config is overridden only by trusted project config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-codex-compat-config-"));
  const agentDir = join(root, "agent");
  try {
    const global = writeConfig("global", { mode: "off", modelPrefixes: ["custom"] }, {
      cwd: root,
      projectTrusted: false,
      agentDir,
    });
    assert.equal(global.ok, true);
    assert.deepEqual(
      readEffectiveConfig({ cwd: root, projectTrusted: false, agentDir }),
      { mode: "off", modelPrefixes: ["custom"] },
    );
    await import("node:fs/promises").then(({ writeFile, mkdir }) =>
      mkdir(join(root, ".pi"), { recursive: true }).then(() =>
        writeFile(getProjectConfigPath(root), JSON.stringify({ mode: "on" }))),
    );
    assert.equal(
      readEffectiveConfig({ cwd: root, projectTrusted: false, agentDir }).mode,
      "off",
    );
    assert.equal(
      readEffectiveConfig({ cwd: root, projectTrusted: true, agentDir }).mode,
      "on",
    );
    const saved = JSON.parse(await readFile(global.ok ? global.path : "", "utf8")) as Record<string, unknown>;
    assert.deepEqual(saved["modelPrefixes"], ["custom"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy config is read and migrated by writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-codex-compat-legacy-"));
  const agentDir = join(root, "agent");
  const warnings: string[] = [];
  const previousWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  try {
    const legacyPath = getLegacyGlobalConfigPath(agentDir);
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(agentDir, { recursive: true }).then(() =>
        writeFile(legacyPath, JSON.stringify({ mode: "on", modelPrefixes: ["legacy"] }))),
    );
    assert.deepEqual(
      readEffectiveConfig({ cwd: root, projectTrusted: false, agentDir }),
      { mode: "on", modelPrefixes: ["legacy"] },
    );
    const saved = writeConfig("global", { mode: "off" }, {
      cwd: root,
      projectTrusted: false,
      agentDir,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.path, getGlobalConfigPath(agentDir));
    assert.deepEqual(JSON.parse(await readFile(saved.path, "utf8")) as Record<string, unknown>, {
      mode: "off",
      modelPrefixes: ["legacy"],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings.join("\n"), /migrate it/);
  } finally {
    console.warn = previousWarn;
    await rm(root, { recursive: true, force: true });
  }
});

test("missing config uses the GPT prefix default", () => {
  assert.deepEqual(DEFAULT_CODEX_COMPAT_CONFIG, { mode: "auto", modelPrefixes: ["gpt"] });
});
