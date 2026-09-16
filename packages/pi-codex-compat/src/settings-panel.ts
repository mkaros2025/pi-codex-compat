import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SettingsList,
  Text,
  type Component,
  type SettingItem,
  type SettingsListTheme,
} from "@earendil-works/pi-tui";
import {
  type CodexCompatConfig,
  normalizeConfig,
} from "./config.ts";
import { type ModelLike, shouldActivate } from "./model.ts";

const MODE_VALUES = ["auto", "on", "off"] as const;

type SaveResult =
  | { ok: true; path: string }
  | { ok: false; error: string; path: string };

export interface SettingsPanelOptions {
  config: CodexCompatConfig;
  model: ModelLike | undefined;
  activeToolCount: number;
  save: (config: CodexCompatConfig) => SaveResult;
}

export type SettingsPanelResult =
  | { kind: "saved"; config: CodexCompatConfig; path: string }
  | { kind: "cancelled" };

function parsePrefixes(value: string): string[] {
  return value.split(/[\s,]+/).map((prefix) => prefix.trim()).filter(Boolean);
}

function formatPrefixes(prefixes: string[]): string {
  return prefixes.join(",");
}

function settingsListTheme(theme: Pick<Theme, "fg">): SettingsListTheme {
  return {
    label: (text, selected) => selected ? theme.fg("accent", text) : text,
    value: (text, selected) => selected ? theme.fg("accent", text) : theme.fg("muted", text),
    description: (text) => theme.fg("dim", text),
    cursor: theme.fg("accent", "→ "),
    hint: (text) => theme.fg("dim", text),
  };
}

function statusText(
  theme: Pick<Theme, "fg" | "bold">,
  model: ModelLike | undefined,
  config: CodexCompatConfig,
  activeToolCount: number,
): string {
  const modelId = model?.id ?? "(none)";
  const desired = shouldActivate(model, config) ? "enabled" : "disabled";
  return [
    theme.fg("accent", theme.bold("Pi Codex Compat")),
    `Model: ${modelId}`,
    `Current tools: ${activeToolCount}/4` + ` · after save: ${desired}`,
    `Mode: ${config.mode} · Prefixes: ${formatPrefixes(config.modelPrefixes) || "(none)"}`,
  ].join("\n");
}

function prefixEditor(
  tui: { requestRender: () => void },
  theme: Pick<Theme, "fg">,
  currentValue: string,
  done: (selectedValue?: string) => void,
): Component {
  const input = new Input({ prompt: "Prefixes: ", placeholder: "gpt,o3" });
  input.setValue(currentValue);
  let error = "";
  const errorText = new Text();
  const updateError = (message: string) => {
    error = message;
    errorText.setText(message ? theme.fg("warning", message) : "");
    tui.requestRender();
  };
  input.onSubmit = (value) => {
    const prefixes = parsePrefixes(value);
    if (prefixes.length === 0 && value.trim().length > 0) {
      updateError("Enter comma-separated model prefixes, or leave it blank.");
      return;
    }
    done(formatPrefixes(prefixes));
  };
  input.onEscape = () => done();

  const container = new Container();
  container.addChild(new Text(theme.fg("dim", "Enter prefixes separated by commas. Blank disables auto matching.")));
  container.addChild(input);
  container.addChild(errorText);
  return {
    render(width: number) {
      return container.render(width);
    },
    invalidate() {
      container.invalidate();
    },
    handleInput(data: string) {
      if (error) updateError("");
      input.handleInput(data);
      tui.requestRender();
    },
  };
}

function openDialogPanel(
  ctx: ExtensionContext,
  options: SettingsPanelOptions,
): Promise<SettingsPanelResult> {
  if (!ctx.hasUI) return Promise.resolve({ kind: "cancelled" });
  return (async () => {
    const mode = await ctx.ui.select("Codex Compat · Activation mode", [...MODE_VALUES]);
    if (mode === undefined) return { kind: "cancelled" };
    const prefixes = await ctx.ui.input(
      "Codex Compat · Model prefixes",
      formatPrefixes(options.config.modelPrefixes),
    );
    if (prefixes === undefined) return { kind: "cancelled" };
    const action = await ctx.ui.select("Save Codex Compat settings?", ["Save", "Cancel"]);
    if (action !== "Save") return { kind: "cancelled" };

    const config = normalizeConfig({ mode, modelPrefixes: parsePrefixes(prefixes) });
    const result = options.save(config);
    if (!result.ok) {
      ctx.ui.notify(result.error, "error");
      return { kind: "cancelled" };
    }
    return { kind: "saved", config, path: result.path };
  })();
}

export async function openSettingsPanel(
  ctx: ExtensionContext,
  options: SettingsPanelOptions,
): Promise<SettingsPanelResult> {
  if (ctx.mode !== "tui") return openDialogPanel(ctx, options);

  const result = await ctx.ui.custom<SettingsPanelResult>((tui, theme, _keybindings, done) => {
    const draft = normalizeConfig(options.config);
    const status = new Text(statusText(theme, options.model, draft, options.activeToolCount));
    const errorText = new Text();
    const updateStatus = () => {
      status.setText(statusText(theme, options.model, draft, options.activeToolCount));
      tui.requestRender();
    };

    const items: SettingItem[] = [
      {
        id: "mode",
        label: "Activation mode",
        description: "auto follows model prefixes; on always enables; off always disables.",
        currentValue: draft.mode,
        values: [...MODE_VALUES],
      },
      {
        id: "prefixes",
        label: "Model prefixes",
        description: "Models beginning with one of these prefixes activate in auto mode.",
        currentValue: formatPrefixes(draft.modelPrefixes),
        submenu: (currentValue, close) => prefixEditor(tui, theme, currentValue, close),
      },
      {
        id: "save",
        label: "Save and apply",
        description: "Write the global config and apply the selected activation mode now.",
        currentValue: "Enter",
        values: ["Enter"],
      },
      {
        id: "cancel",
        label: "Cancel",
        description: "Close without changing the global config.",
        currentValue: "Enter",
        values: ["Enter"],
      },
    ];

    const container = new Container();
    container.addChild(status);
    container.addChild(new Text(""));
    container.addChild(errorText);

    const settings = new SettingsList(
      items,
      items.length,
      settingsListTheme(theme),
      (id, newValue) => {
        if (id === "mode") {
          draft.mode = newValue as CodexCompatConfig["mode"];
          updateStatus();
        } else if (id === "prefixes") {
          draft.modelPrefixes = parsePrefixes(newValue);
          updateStatus();
        } else if (id === "save") {
          const saveResult = options.save(normalizeConfig(draft));
          if (!saveResult.ok) {
            errorText.setText(theme.fg("error", `Save failed: ${saveResult.error}`));
            tui.requestRender();
            return;
          }
          done({ kind: "saved", config: normalizeConfig(draft), path: saveResult.path });
        } else if (id === "cancel") {
          done({ kind: "cancelled" });
        }
      },
      () => done({ kind: "cancelled" }),
    );
    container.addChild(settings);

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        settings.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return result ?? { kind: "cancelled" };
}
