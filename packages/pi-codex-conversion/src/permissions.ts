import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { realpathSync } from "node:fs";
import { createJiti } from "jiti";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { parsePatchActions } from "./patch/parser.ts";
import { resolvePatchPath } from "./patch/paths.ts";

export interface PermissionCheck {
  state: "allow" | "ask" | "deny";
  matchedPattern?: string | undefined;
  reason?: string | undefined;
}

export interface PermissionService {
  checkPermission(surface: string, value?: string, agentName?: string): PermissionCheck;
}

export interface PermissionModule {
  getPermissionsService(sessionId: string): PermissionService | undefined;
}

export type PermissionModuleLoader = (
  cwd: string,
  projectTrusted: boolean,
) => Promise<PermissionModule | undefined>;

export type PatchPermissionContext = Pick<
  ExtensionContext,
  "cwd" | "hasUI" | "ui" | "sessionManager" | "isProjectTrusted"
>;

const PERMISSION_MODULE = "@gotgenes/pi-permission-system";
const PERMISSIONS_READY_CHANNEL = "permissions:ready";

export interface PermissionBridge {
  getService(ctx: PatchPermissionContext, sessionId: string): Promise<PermissionService | undefined>;
  isReady(sessionId: string): boolean;
  dispose(): void;
}

export function createPermissionBridge(
  pi: Pick<ExtensionAPI, "events">,
  loadModule: PermissionModuleLoader = loadPermissionModule,
): PermissionBridge {
  const readySessions = new Set<string>();
  const verifiedSessions = new Set<string>();
  const disposeEvents = pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
    if (!data || typeof data !== "object") return;
    const sessionId = (data as Record<string, unknown>)["sessionId"];
    if (typeof sessionId !== "string" || sessionId.length === 0) return;
    readySessions.add(sessionId);
  });

  return {
    async getService(ctx, sessionId) {
      const module = await loadModule(ctx.cwd, ctx.isProjectTrusted());
      const service = module?.getPermissionsService(sessionId);
      if (service) verifiedSessions.add(sessionId);
      return service;
    },
    isReady(sessionId) {
      return readySessions.has(sessionId) || verifiedSessions.has(sessionId);
    },
    dispose() {
      disposeEvents();
      readySessions.clear();
      verifiedSessions.clear();
    },
  };
}

function isMissingModule(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record["code"] !== "MODULE_NOT_FOUND" && record["code"] !== "ERR_MODULE_NOT_FOUND") return false;
  const message = typeof record["message"] === "string" ? record["message"] : "";
  const match = message.match(/Cannot find (?:package|module) ['\"]([^'\"]+)/);
  return match?.[1] === PERMISSION_MODULE;
}

function resolveOptionalPackage(requireFrom: NodeRequire): string | undefined {
  try {
    return requireFrom.resolve(PERMISSION_MODULE);
  } catch (error) {
    if (isMissingModule(error)) return undefined;
    throw error;
  }
}

function permissionModulePath(cwd: string, projectTrusted: boolean): string | undefined {
  const paths = [createRequire(import.meta.url)];
  if (projectTrusted) paths.push(createRequire(join(cwd, CONFIG_DIR_NAME, "npm", "package.json")));
  paths.push(createRequire(join(getAgentDir(), "npm", "package.json")));
  for (const requireFrom of paths) {
    const path = resolveOptionalPackage(requireFrom);
    if (path) return path;
  }
  return undefined;
}

async function loadPermissionModule(
  cwd: string,
  projectTrusted: boolean,
): Promise<PermissionModule | undefined> {
  const path = permissionModulePath(cwd, projectTrusted);
  if (!path) return undefined;
  return createJiti(import.meta.url, { moduleCache: false }).import<PermissionModule>(path);
}

async function getDefaultService(ctx: PatchPermissionContext, sessionId: string): Promise<PermissionService | undefined> {
  const module = await loadPermissionModule(ctx.cwd, ctx.isProjectTrusted());
  return module?.getPermissionsService(sessionId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function permissionUnavailable(sessionId: string, cause?: unknown): Error {
  const detail = cause === undefined ? "the service was not published" : errorText(cause);
  return new Error(
    `apply_patch permission check unavailable for session ${sessionId}; refusing the patch. ` +
      `Load @gotgenes/pi-permission-system for this session and retry (${detail})`,
  );
}

function isPermissionState(value: unknown): value is PermissionCheck["state"] {
  return value === "allow" || value === "ask" || value === "deny";
}

interface PatchAccess {
  path: string;
  read: boolean;
  write: boolean;
}

function patchAccesses(cwd: string, patchText: string): PatchAccess[] {
  const accesses = new Map<string, PatchAccess>();
  const add = (path: string, read: boolean, write: boolean) => {
    const absolutePath = resolvePatchPath({ cwd, patchPath: path });
    const previous = accesses.get(absolutePath);
    accesses.set(absolutePath, {
      path: absolutePath,
      read: Boolean(previous?.read || read),
      write: Boolean(previous?.write || write),
    });
  };

  for (const action of parsePatchActions({ text: patchText })) {
    const isUpdate = action.type === "update";
    add(action.path, isUpdate, true);
    if (action.movePath) add(action.movePath, false, true);
  }
  return [...accesses.values()];
}

function canonicalPath(path: string): string {
  let current = path;
  const missing: string[] = [];
  for (;;) {
    try {
      return missing.reduceRight((base, part) => join(base, part), realpathSync(current));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) return path;
      missing.push(basename(current));
      current = parent;
    }
  }
}

function isOutside(cwd: string, path: string): boolean {
  const relativePath = relative(canonicalPath(cwd), canonicalPath(path));
  return relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath);
}

function surfacesFor(access: PatchAccess, external: boolean): string[] {
  const surfaces: string[] = [];
  if (access.read) surfaces.push("path_read");
  if (access.write) surfaces.push("path_write");
  if (external) {
    if (access.read) surfaces.push("external_directory_read");
    if (access.write) surfaces.push("external_directory_write");
  }
  return surfaces;
}

export async function checkPatchPermissions(
  patchText: string,
  ctx: PatchPermissionContext,
  bridge?: PermissionBridge,
): Promise<void> {
  const sessionId = ctx.sessionManager.getSessionId();
  let service: PermissionService | undefined;
  try {
    service = await (bridge?.getService(ctx, sessionId) ?? getDefaultService(ctx, sessionId));
  } catch (error) {
    throw permissionUnavailable(sessionId, error);
  }
  if (!service) {
    if (bridge?.isReady(sessionId)) throw permissionUnavailable(sessionId);
    return;
  }
  if (typeof service.checkPermission !== "function") {
    throw permissionUnavailable(sessionId, "the published service has no checkPermission function");
  }

  const asks = new Map<string, string[]>();
  for (const access of patchAccesses(ctx.cwd, patchText)) {
    for (const surface of surfacesFor(access, isOutside(ctx.cwd, access.path))) {
      const check = service.checkPermission(surface, access.path);
      if (!check || typeof check !== "object" || !isPermissionState(check.state)) {
        throw permissionUnavailable(sessionId, `invalid response for ${surface}`);
      }
      const external = surface.startsWith("external_directory_");
      // The built-in path gate's implicit allow needs no prompt; never skip
      // an implicit ask or deny, or a missing rule would become fail-open.
      if (!external && check.matchedPattern === undefined && check.state === "allow") continue;
      if (check.state === "deny") {
        throw new Error(
          `apply_patch denied for ${access.path}${check.reason ? `: ${check.reason}` : ""}`,
        );
      }
      if (check.state !== "ask") continue;
      const descriptions = asks.get(access.path) ?? [];
      descriptions.push(`${surface}: ${check.matchedPattern ?? "default policy"}`);
      asks.set(access.path, descriptions);
    }
  }

  for (const [path, descriptions] of asks) {
    const message = [`apply_patch access: ${path}`, ...descriptions].join("\n");
    const approved = ctx.hasUI && await ctx.ui.confirm("Allow apply_patch?", message);
    if (!approved) throw new Error(`apply_patch permission denied for ${path}`);
  }
}
