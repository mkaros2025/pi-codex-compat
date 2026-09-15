import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_TOOLS_CONFIG } from "../src/config.ts";
import { shouldActivate } from "../src/model.ts";

test("auto mode matches model IDs by configurable prefix", () => {
  assert.equal(shouldActivate({ id: "gpt-5.6" }, DEFAULT_CODEX_TOOLS_CONFIG), true);
  assert.equal(shouldActivate({ id: "claude-sonnet" }, DEFAULT_CODEX_TOOLS_CONFIG), false);
  assert.equal(
    shouldActivate({ id: "o3-mini" }, { mode: "auto", modelPrefixes: ["o3"] }),
    true,
  );
  assert.equal(shouldActivate({ id: "gpt-5" }, { mode: "off", modelPrefixes: ["gpt"] }), false);
  assert.equal(shouldActivate({ id: "anything" }, { mode: "on", modelPrefixes: [] }), true);
});
