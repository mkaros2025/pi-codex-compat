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
  save: (config: CodexCompatConfig) => SaveResult;
  apply: (config: CodexCompatConfig) => void;
}

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
): string {
  const modelId = model?.id ?? "(none)";
  const activation = shouldActivate(model, config) ? "enabled" : "disabled";
  return [
    theme.fg("accent", theme.bold("Pi Codex Compat")),
    `Model: ${modelId}`,
    `Activation: ${activation}`,
    `Mode: ${config.mode} · Prefixes: ${formatPrefixes(config.modelPrefixes) || "(none)"}`,
  ].join("\n");
}

function prefixEditor(
  tui: { requestRender: () => void },
  theme: Pick<Theme, "fg">,
  currentValue: string,
  done: (selectedValue?: string) => void,
  exit: () => void,
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
  input.onEscape = exit;

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
): Promise<void> {
  if (!ctx.hasUI) return Promise.resolve();
  return (async () => {
    const mode = await ctx.ui.select("Codex Compat · Activation mode", [...MODE_VALUES]);
    if (mode === undefined) return;
    const draft = normalizeConfig({ ...options.config, mode });
    const modeResult = options.save(draft);
    if (!modeResult.ok) {
      ctx.ui.notify(modeResult.error, "error");
      return;
    }
    options.apply(draft);

    const prefixes = await ctx.ui.input(
      "Codex Compat · Model prefixes",
      formatPrefixes(draft.modelPrefixes),
    );
    if (prefixes === undefined) return;

    const config = normalizeConfig({ ...draft, modelPrefixes: parsePrefixes(prefixes) });
    const prefixResult = options.save(config);
    if (!prefixResult.ok) {
      ctx.ui.notify(prefixResult.error, "error");
      return;
    }
    options.apply(config);
  })();
}

export async function openSettingsPanel(
  ctx: ExtensionContext,
  options: SettingsPanelOptions,
): Promise<void> {
  if (ctx.mode !== "tui") {
    await openDialogPanel(ctx, options);
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const draft = normalizeConfig(options.config);
    const status = new Text(statusText(theme, options.model, draft));
    const errorText = new Text();
    const updateStatus = () => {
      status.setText(statusText(theme, options.model, draft));
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
        submenu: (currentValue, close) => prefixEditor(tui, theme, currentValue, close, () => done()),
      },
    ];

    const container = new Container();
    container.addChild(status);
    container.addChild(new Text(""));
    container.addChild(errorText);

    let settings: SettingsList | undefined;
    settings = new SettingsList(
      items,
      items.length,
      settingsListTheme(theme),
      (id, newValue) => {
        const previous = normalizeConfig(draft);
        const next = id === "mode"
          ? { mode: newValue as CodexCompatConfig["mode"], modelPrefixes: [...draft.modelPrefixes] }
          : { mode: draft.mode, modelPrefixes: parsePrefixes(newValue) };
        const saveResult = options.save(next);
        if (!saveResult.ok) {
          settings?.updateValue(id, id === "mode" ? previous.mode : formatPrefixes(previous.modelPrefixes));
          draft.mode = previous.mode;
          draft.modelPrefixes = previous.modelPrefixes;
          errorText.setText(theme.fg("error", `Change failed: ${saveResult.error}`));
          updateStatus();
          return;
        }
        draft.mode = next.mode;
        draft.modelPrefixes = next.modelPrefixes;
        options.apply(next);
        errorText.setText("");
        updateStatus();
      },
      () => done(),
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
}
