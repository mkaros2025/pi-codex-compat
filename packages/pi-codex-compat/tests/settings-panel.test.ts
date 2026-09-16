import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openSettingsPanel, type SettingsPanelResult } from "../src/settings-panel.ts";
import type { CodexCompatConfig } from "../src/config.ts";

const config: CodexCompatConfig = { mode: "auto", modelPrefixes: ["gpt"] };
type PanelComponent = { render(width: number): string[]; handleInput?(data: string): void };

function context(ui: Record<string, unknown>, mode: "rpc" | "tui"): ExtensionContext {
  return { mode, hasUI: true, ui } as unknown as ExtensionContext;
}

function options(save: (value: CodexCompatConfig) => { ok: true; path: string } | { ok: false; error: string; path: string }) {
  return {
    config,
    model: { id: "gpt-test" },
    activeToolCount: 4,
    save,
  };
}

test("TUI panel shows settings and saves the global draft", async () => {
  let component: PanelComponent | undefined;
  let resolved: SettingsPanelResult | undefined;
  let customOptions: unknown;
  const saved: CodexCompatConfig[] = [];
  const ui = {
    custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: SettingsPanelResult) => void) => PanelComponent, options?: unknown) => {
      customOptions = options;
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        (value) => { resolved = value; },
      );
      const panel = component;
      const rendered = panel.render(100).join("\n");
      assert.match(rendered, /Pi Codex Compat/);
      assert.match(rendered, /Current tools: 4\/4/);
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\r");
      return resolved;
    },
  };
  const result = await openSettingsPanel(
    context(ui, "tui"),
    options((value) => {
      saved.push(value);
      return { ok: true, path: "/tmp/pi-codex-compat.json" };
    }),
  );
  assert.equal(customOptions, undefined);
  assert.deepEqual(result, { kind: "saved", config, path: "/tmp/pi-codex-compat.json" });
  assert.deepEqual(saved, [config]);
});

test("RPC panel saves, cancels, and reports write errors", async () => {
  const notifications: string[] = [];
  const makeRpc = (actions: string[], inputs: string[], save: (value: CodexCompatConfig) => { ok: true; path: string } | { ok: false; error: string; path: string }) => {
    const ui = {
      select: async () => actions.shift(),
      input: async () => inputs.shift(),
      notify: (message: string) => notifications.push(message),
    };
    return openSettingsPanel(context(ui, "rpc"), options(save));
  };

  const saved = await makeRpc(
    ["on", "Save"],
    ["gpt,o3"],
    () => ({ ok: true, path: "/tmp/pi-codex-compat.json" }),
  );
  assert.deepEqual(saved, {
    kind: "saved",
    config: { mode: "on", modelPrefixes: ["gpt", "o3"] },
    path: "/tmp/pi-codex-compat.json",
  });

  const cancelled = await makeRpc(["off", "Cancel"], ["gpt"], () => {
    throw new Error("cancelled panel must not write");
  });
  assert.deepEqual(cancelled, { kind: "cancelled" });

  const failed = await makeRpc(["auto", "Save"], ["gpt"], () => ({
    ok: false,
    error: "permission denied",
    path: "/tmp/pi-codex-compat.json",
  }));
  assert.deepEqual(failed, { kind: "cancelled" });
  assert.deepEqual(notifications, ["permission denied"]);
});

test("TUI panel discards edited mode and prefixes on cancel", async () => {
  let component: PanelComponent | undefined;
  let resolved: SettingsPanelResult | undefined;
  const saved: CodexCompatConfig[] = [];
  const ui = {
    custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: SettingsPanelResult) => void) => PanelComponent) => {
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        (value) => { resolved = value; },
      );
      const panel = component;
      panel.handleInput?.("\r");
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\r");
      panel.handleInput?.("\u0001");
      panel.handleInput?.("\u000b");
      panel.handleInput?.("gpt,o3");
      panel.handleInput?.("\r");
      panel.handleInput?.("\u001b");
      panel.handleInput?.("\u001b");
      return resolved;
    },
  };
  const result = await openSettingsPanel(
    context(ui, "tui"),
    options((value) => {
      saved.push(value);
      return { ok: true, path: "/tmp/pi-codex-compat.json" };
    }),
  );
  assert.deepEqual(result, { kind: "cancelled" });
  assert.deepEqual(saved, []);
});

test("TUI panel keeps a save error visible until cancelled", async () => {
  let component: PanelComponent | undefined;
  let doneCalled = false;
  const ui = {
    custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: SettingsPanelResult) => void) => PanelComponent) => {
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => { doneCalled = true; },
      );
      const panel = component;
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\r");
      assert.equal(doneCalled, false);
      assert.match(panel.render(100).join("\n"), /Save failed: permission denied/);
      return { kind: "cancelled" };
    },
  };
  const result = await openSettingsPanel(
    context(ui, "tui"),
    options(() => ({ ok: false, error: "permission denied", path: "/tmp/pi-codex-compat.json" })),
  );
  assert.deepEqual(result, { kind: "cancelled" });
});

test("TUI panel can retry a failed save", async () => {
  let component: PanelComponent | undefined;
  let resolved: SettingsPanelResult | undefined;
  let attempts = 0;
  const ui = {
    custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: SettingsPanelResult) => void) => PanelComponent) => {
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        (value) => { resolved = value; },
      );
      const panel = component;
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\r");
      assert.equal(resolved, undefined);
      assert.match(panel.render(100).join("\n"), /Save failed: try again/);
      panel.handleInput?.("\r");
      return resolved;
    },
  };
  const result = await openSettingsPanel(
    context(ui, "tui"),
    options(() => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, error: "try again", path: "/tmp/pi-codex-compat.json" }
        : { ok: true, path: "/tmp/pi-codex-compat.json" };
    }),
  );
  assert.deepEqual(result, { kind: "saved", config, path: "/tmp/pi-codex-compat.json" });
  assert.equal(attempts, 2);
});
