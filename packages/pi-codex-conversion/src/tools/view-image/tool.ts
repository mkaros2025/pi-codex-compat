import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getBundledToolBinaryPath } from "../native/binary.ts";
import { runBundledTool } from "../native/runner.ts";
import { imageContentFromViewImageOutput, type ViewImageContent } from "./output.ts";

const PARAMETERS = Type.Object({
  path: Type.String({ description: "Image path" }),
});

function prepareArguments(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const prepared = { ...(args as Record<string, unknown>) };
  if (!("path" in prepared)) {
    if ("file_path" in prepared) prepared["path"] = prepared["file_path"];
    else if ("image_path" in prepared) prepared["path"] = prepared["image_path"];
  }
  if (typeof prepared["path"] === "string" && prepared["path"].startsWith("@")) {
    prepared["path"] = prepared["path"].slice(1);
  }
  return prepared;
}

function parseArguments(params: unknown): { path: string } {
  if (!params || typeof params !== "object") throw new Error("view_image requires an object parameter");
  const path = (params as Record<string, unknown>)["path"];
  if (typeof path !== "string") throw new Error("view_image requires a string 'path' parameter");
  return { path };
}

async function readImage(
  params: { path: string },
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ViewImageContent> {
  const binary = getBundledToolBinaryPath("view_image");
  if (!binary) throw new Error(`view_image binary is not bundled for ${process.platform}-${process.arch}`);
  const result = await runBundledTool({
    binary,
    args: [JSON.stringify(params)],
    cwd,
    signal,
    label: "view_image",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "view_image failed").trim());
  }
  const image = imageContentFromViewImageOutput(result.stdout);
  if (!image) throw new Error("view_image expected an image file");
  return image;
}

export function createViewImageTool(): Parameters<ExtensionAPI["registerTool"]>[0] {
  return {
    name: "view_image",
    label: "view_image",
    description: "View an image file",
    promptSnippet: "View image",
    parameters: PARAMETERS,
    prepareArguments,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.model?.input?.includes("image")) {
        throw new Error("view_image is not supported by the active model");
      }
      const image = await readImage(parseArguments(params), ctx.cwd, signal);
      return { content: [image], details: { viewImage: true } };
    },
  };
}

export function registerViewImageTool(pi: ExtensionAPI): void {
  pi.registerTool(createViewImageTool());
}
