import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openSettingsPanel } from "../src/settings-panel.ts";
import type { CodexCompatConfig } from "../src/config.ts";

const config: CodexCompatConfig = { mode: "auto", modelPrefixes: ["gpt"] };
type PanelComponent = { render(width: number): string[]; handleInput?(data: string): void };

function context(ui: Record<string, unknown>, mode: "rpc" | "tui"): ExtensionContext {
  return { mode, hasUI: true, ui } as unknown as ExtensionContext;
}

function options(
  save: (value: CodexCompatConfig) => { ok: true; path: string } | { ok: false; error: string; path: string },
  apply: (value: CodexCompatConfig) => void = () => {},
) {
  return { config, model: { id: "gpt-test" }, save, apply };
}

test("TUI changes mode and prefixes immediately and Esc exits", async () => {
  let component: PanelComponent | undefined;
  let closed = false;
  let customOptions: unknown;
  const saved: CodexCompatConfig[] = [];
  const applied: CodexCompatConfig[] = [];
  const ui = {
    custom: async (
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => PanelComponent,
      receivedOptions?: unknown,
    ) => {
      customOptions = receivedOptions;
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => { closed = true; },
      );
      const panel = component;
      const rendered = panel.render(100).join("\n");
      assert.match(rendered, /Activation mode/);
      assert.match(rendered, /Model prefixes/);
      assert.equal(rendered.includes("Save"), false);
      assert.equal(rendered.includes("Cancel"), false);

      panel.handleInput?.("\r");
      panel.handleInput?.("\u001b[B");
      panel.handleInput?.("\r");
      panel.handleInput?.("\u0001");
      panel.handleInput?.("\u000b");
      panel.handleInput?.("gpt,o3");
      panel.handleInput?.("\r");
      panel.handleInput?.("\r");
      panel.handleInput?.("\u001b");
    },
  };

  await openSettingsPanel(
    context(ui, "tui"),
    options(
      (value) => {
        saved.push(value);
        return { ok: true, path: "/tmp/pi-codex-compat.json" };
      },
      (value) => applied.push(value),
    ),
  );
  assert.equal(customOptions, undefined);
  assert.equal(closed, true);
  assert.deepEqual(saved, [
    { mode: "on", modelPrefixes: ["gpt"] },
    { mode: "on", modelPrefixes: ["gpt", "o3"] },
  ]);
  assert.deepEqual(applied, saved);
});

test("TUI restores a failed change and retries it", async () => {
  let component: PanelComponent | undefined;
  let closed = false;
  let attempts = 0;
  const applied: CodexCompatConfig[] = [];
  const ui = {
    custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => PanelComponent) => {
      component = factory(
        { requestRender() {} },
        { fg: (_color: string, text: string) => text, bold: (text: string) => text },
        {},
        () => { closed = true; },
      );
      const panel = component;
      panel.handleInput?.("\r");
      assert.equal(closed, false);
      assert.match(panel.render(100).join("\n"), /Change failed: try again/);
      panel.handleInput?.("\r");
      panel.handleInput?.("\u001b");
    },
  };

  await openSettingsPanel(
    context(ui, "tui"),
    options(
      () => {
        attempts += 1;
        return attempts === 1
          ? { ok: false, error: "try again", path: "/tmp/pi-codex-compat.json" }
          : { ok: true, path: "/tmp/pi-codex-compat.json" };
      },
      (value) => applied.push(value),
    ),
  );
  assert.equal(closed, true);
  assert.equal(attempts, 2);
  assert.deepEqual(applied, [{ mode: "on", modelPrefixes: ["gpt"] }]);
});

test("RPC fallback applies each confirmed field without Save or Cancel", async () => {
  const selected: string[] = [];
  const inputs: string[] = [];
  const saved: CodexCompatConfig[] = [];
  const applied: CodexCompatConfig[] = [];
  const ui = {
    select: async (_title: string, values: string[]) => {
      selected.push(values.join(","));
      return "on";
    },
    input: async (_title: string, placeholder: string) => {
      inputs.push(placeholder);
      return "gpt,o3";
    },
    notify: () => {},
  };

  await openSettingsPanel(
    context(ui, "rpc"),
    options(
      (value) => {
        saved.push(value);
        return { ok: true, path: "/tmp/pi-codex-compat.json" };
      },
      (value) => applied.push(value),
    ),
  );
  assert.deepEqual(selected, ["auto,on,off"]);
  assert.deepEqual(inputs, ["gpt"]);
  assert.deepEqual(saved, [
    { mode: "on", modelPrefixes: ["gpt"] },
    { mode: "on", modelPrefixes: ["gpt", "o3"] },
  ]);
  assert.deepEqual(applied, saved);
});
