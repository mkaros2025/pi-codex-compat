import type { CodexToolsConfig } from "./config.ts";

export interface ModelLike {
  id?: string | undefined;
}

export function shouldActivate(
  model: ModelLike | undefined,
  config: CodexToolsConfig,
): boolean {
  switch (config.mode) {
    case "on":
      return true;
    case "off":
      return false;
    case "auto": {
      const id = model?.id?.toLowerCase();
      return id !== undefined && config.modelPrefixes.some((prefix) => id.startsWith(prefix.toLowerCase()));
    }
  }
}
