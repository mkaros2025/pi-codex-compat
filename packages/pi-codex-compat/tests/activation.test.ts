import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function harness(activeTools: string[]) {
  const handlers = new Map<string, ((event: never, ctx: never) => unknown)[]>();
  const registered = new Set<string>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> | void }>();
  const pi = {
    getActiveTools: () => activeTools,
    setActiveTools(next: string[]) { activeTools = next; },
    registerTool(tool: { name: string }) { registered.add(tool.name); },
    registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> | void }) {
      commands.set(name, options);
    },
    events: { on(_channel: string, _handler: (data: unknown) => void) { return () => undefined; } },
    on(event: string, handler: (event: never, ctx: never) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  return {
    pi,
    registered,
    commands,
    emit(event: string, value: unknown, ctx: unknown) {
      return (handlers.get(event) ?? []).map((handler) => handler(value as never, ctx as never));
    },
  };
}

type Panel = { handleInput(data: string): void };
type PanelFactory = (
  tui: { requestRender(): void },
  theme: { fg(color: string, text: string): string; bold(text: string): string },
  keybindings: object,
  done: (value: unknown) => void,
) => Panel;

function panelUi(run: (panel: Panel) => void) {
  return {
    custom: async (factory: PanelFactory) => {
      let result: unknown;
      const panel = factory(
        { requestRender() {} },
        { fg: (_color, text) => text, bold: (text) => text },
        {},
        (value) => { result = value; },
      );
      run(panel);
      return result;
    },
    notify() {},
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

test("the settings command applies an immediate mode change without removing other tools", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-codex-compat-command-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = agentDir;
  try {
    const { default: piCodexCompat, CODEX_COMPAT_TOOL_NAMES } = await import("../src/index.ts");
    const testHarness = harness(["read", "bash", "write", "other-extension"]);
    piCodexCompat(testHarness.pi as never);
    const command = testHarness.commands.get("codex-compat");
    assert.ok(command);

    await command.handler("", {
      ...context(agentDir, { id: "gpt-test" }),
      mode: "tui",
      hasUI: true,
      ui: panelUi((panel) => {
        panel.handleInput("\r");
        panel.handleInput("\u001b");
      }),
    });

    assert.deepEqual(
      testHarness.pi.getActiveTools(),
      [...CODEX_COMPAT_TOOL_NAMES, "other-extension"],
    );
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, "pi-codex-compat.json"), "utf8")), {
      mode: "on",
      modelPrefixes: ["gpt"],
    });
  } finally {
    if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("Esc exits and failed settings changes leave the active tools unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-codex-compat-command-"));
  const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
  const initialTools = ["read", "bash", "write", "other-extension"];
  try {
    const { default: piCodexCompat } = await import("../src/index.ts");

    const cancelAgentDir = join(root, "cancel-agent");
    process.env["PI_CODING_AGENT_DIR"] = cancelAgentDir;
    const cancelledHarness = harness([...initialTools]);
    piCodexCompat(cancelledHarness.pi as never);
    const cancelCommand = cancelledHarness.commands.get("codex-compat");
    assert.ok(cancelCommand);
    await cancelCommand.handler("", {
      ...context(cancelAgentDir, { id: "gpt-test" }),
      mode: "tui",
      hasUI: true,
      ui: panelUi((panel) => {
        panel.handleInput("\u001b");
      }),
    });
    assert.deepEqual(cancelledHarness.pi.getActiveTools(), initialTools);

    const failedAgentDir = join(root, "failed-agent");
    await writeFile(failedAgentDir, "not a directory");
    process.env["PI_CODING_AGENT_DIR"] = failedAgentDir;
    const failedHarness = harness([...initialTools]);
    piCodexCompat(failedHarness.pi as never);
    const failedCommand = failedHarness.commands.get("codex-compat");
    assert.ok(failedCommand);
    await failedCommand.handler("", {
      ...context(failedAgentDir, { id: "gpt-test" }),
      mode: "tui",
      hasUI: true,
      ui: panelUi((panel) => {
        panel.handleInput("\r");
        panel.handleInput("\u001b");
      }),
    });
    assert.deepEqual(failedHarness.pi.getActiveTools(), initialTools);
    assert.equal(await readFile(failedAgentDir, "utf8"), "not a directory");
  } finally {
    if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});
