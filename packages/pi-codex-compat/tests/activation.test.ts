import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function harness(activeTools: string[]) {
  const handlers = new Map<string, ((event: never, ctx: never) => unknown)[]>();
  const registered = new Set<string>();
  const pi = {
    getActiveTools: () => activeTools,
    setActiveTools(next: string[]) { activeTools = next; },
    registerTool(tool: { name: string }) { registered.add(tool.name); },
    registerCommand() {},
    events: { on(_channel: string, _handler: (data: unknown) => void) { return () => undefined; } },
    on(event: string, handler: (event: never, ctx: never) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  return {
    pi,
    registered,
    emit(event: string, value: unknown, ctx: unknown) {
      return (handlers.get(event) ?? []).map((handler) => handler(value as never, ctx as never));
    },
  };
}

function context(cwd: string, model: { id: string }) {
  return { model, cwd, isProjectTrusted: () => false };
}

test("model changes replace and restore only the native tool set", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-codex-compat-agent-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  try {
    const { default: piCodexCompat, CODEX_COMPAT_TOOL_NAMES } = await import("../src/index.ts");
    const testHarness = harness(["read", "bash", "write", "other-extension"]);
    piCodexCompat(testHarness.pi as never);
    assert.deepEqual([...testHarness.registered], CODEX_COMPAT_TOOL_NAMES);
    assert.deepEqual(
      testHarness.emit("tool_result", { toolName: "apply_patch", details: { status: "partial_failure" } }, {}),
      [{ isError: true }],
    );
    assert.deepEqual(
      testHarness.emit("tool_result", { toolName: "apply_patch", details: { status: "success" } }, {}),
      [undefined],
    );

    testHarness.emit("session_start", {}, context(agentDir, { id: "claude-3" }));
    assert.deepEqual(testHarness.pi.getActiveTools(), ["read", "bash", "write", "other-extension"]);

    testHarness.emit("model_select", { model: { id: "gpt-5" } }, context(agentDir, { id: "gpt-5" }));
    assert.deepEqual(testHarness.pi.getActiveTools(), [...CODEX_COMPAT_TOOL_NAMES, "other-extension"]);

    testHarness.pi.setActiveTools([...CODEX_COMPAT_TOOL_NAMES, "other-extension", "edit"]);
    testHarness.emit("model_select", { model: { id: "gpt-5" } }, context(agentDir, { id: "gpt-5" }));
    assert.deepEqual(testHarness.pi.getActiveTools(), [...CODEX_COMPAT_TOOL_NAMES, "other-extension"]);

    testHarness.emit("model_select", { model: { id: "claude-3" } }, context(agentDir, { id: "claude-3" }));
    assert.deepEqual(testHarness.pi.getActiveTools(), ["other-extension", "read", "bash", "write", "edit"]);
  } finally {
    if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
