import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIRS: Record<string, string> = {
  apply_patch: "apply-patch",
  exec_bridge: "exec",
  view_image: "view-image",
};

function packageRoot(): string {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function getBundledToolBinaryPath(
  toolName: string,
  target: { platform?: NodeJS.Platform; arch?: string } = {},
  customDir?: string,
): string | undefined {
  const toolDir = TOOL_DIRS[toolName] ?? toolName;
  const platform = target.platform ?? process.platform;
  const arch = target.arch ?? process.arch;
  const exe = platform === "win32" ? `${toolName}.exe` : toolName;
  if (customDir?.trim()) {
    const customPath = join(customDir, exe);
    if (existsSync(customPath)) return customPath;
  }
  const path = join(packageRoot(), "src", "tools", toolDir, "bin", `${platform}-${arch}`, exe);
  return existsSync(path) ? path : undefined;
}
