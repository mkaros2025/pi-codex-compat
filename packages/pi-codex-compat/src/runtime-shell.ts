import {
  getAgentDir,
  getShellConfig,
  SettingsManager,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const FALLBACK_SHELL = "/bin/bash";

function shellName(shell: string): string {
  return shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? shell.toLowerCase();
}

function isFishShell(shell: string | undefined): boolean {
  return shellName(shell ?? "") === "fish";
}

export function getRuntimeShell(shell: string | undefined): string {
  if (!shell || !isFishShell(shell)) return shell ?? FALLBACK_SHELL;
  return process.platform === "win32" ? getShellConfig().shell : FALLBACK_SHELL;
}

export function getDefaultRuntimeShell(configuredShellPath?: string): string {
  if (configuredShellPath) return getRuntimeShell(getShellConfig(configuredShellPath).shell);
  if (process.platform === "win32") return getShellConfig().shell;
  return getRuntimeShell(process.env["SHELL"]);
}

export function getShellArgs(shell: string, command: string, login: boolean): string[] {
  const name = shellName(shell);
  if (name === "cmd" || name === "cmd.exe") return ["/d", "/s", "/c", command];
  if (name === "powershell" || name === "powershell.exe" || name === "pwsh" || name === "pwsh.exe") {
    return ["-NoLogo", "-NoProfile", "-Command", command];
  }
  return login ? ["-lc", command] : ["-c", command];
}

export function getConfiguredShellPath(
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  agentDir = getAgentDir(),
): string | undefined {
  return SettingsManager.create(ctx.cwd, agentDir, {
    projectTrusted: ctx.isProjectTrusted(),
  }).getShellPath();
}
