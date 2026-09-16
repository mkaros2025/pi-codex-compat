import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_CODEX_COMPAT_CONFIG,
  getGlobalConfigPath,
  readEffectiveConfig,
  writeConfig,
} from "../src/config.ts";

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

test("missing config uses the GPT prefix default", () => {
  assert.deepEqual(DEFAULT_CODEX_COMPAT_CONFIG, { mode: "auto", modelPrefixes: ["gpt"] });
});
