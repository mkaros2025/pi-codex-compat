import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkPatchPermissions,
  createPermissionBridge,
  type PermissionBridge,
  type PermissionModule,
  type PermissionModuleLoader,
} from "../src/permissions.ts";
import { createApplyPatchTool } from "../src/tools/apply-patch/tool.ts";
import { createExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";
import { createViewImageTool } from "../src/tools/view-image/tool.ts";

type Check = { state: "allow" | "ask" | "deny"; matchedPattern?: string; reason?: string };
type Service = { checkPermission: (surface: string, value?: string) => Check };

function bridgeFor(service: Service | undefined, ready = false): PermissionBridge {
  return {
    getService: async () => service,
    isReady: () => ready,
    dispose() {},
  };
}

function context(cwd: string, sessionId: string, trusted = true): never {
  return {
    cwd,
    hasUI: false,
    ui: { confirm: async () => false },
    isProjectTrusted: () => trusted,
    sessionManager: { getSessionId: () => sessionId },
  } as never;
}

function eventBus() {
  let handler: ((data: unknown) => void) | undefined;
  return {
    api: {
      events: {
        on(_channel: string, next: (data: unknown) => void) {
          handler = next;
          return () => { handler = undefined; };
        },
      },
    } as never,
    emit(data: unknown) {
      handler?.(data);
    },
  };
}

const allowAll: Service = {
  checkPermission: () => ({ state: "allow", matchedPattern: "*" }),
};

async function execute(cwd: string, sessionId: string, input: string, service: Service) {
  return createApplyPatchTool({ permissionBridge: bridgeFor(service) }).execute(
    "permission-test",
    { input },
    undefined,
    undefined,
    context(cwd, sessionId),
  );
}

test("an implicit path deny is not treated as an allow", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  try {
    await assert.rejects(
      checkPatchPermissions(
        "*** Begin Patch\n*** Add File: blocked.txt\n+blocked\n*** End Patch",
        context(cwd, "implicit-deny"),
        bridgeFor({ checkPermission: () => ({ state: "deny" }) }),
      ),
      /permission denied|apply_patch denied/i,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an ask without UI fails closed before mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const target = join(cwd, "asked.txt");
  await writeFile(target, "unchanged\n");
  try {
    await assert.rejects(
      execute(
        cwd,
        "ask-without-ui",
        "*** Begin Patch\n*** Update File: asked.txt\n@@\n-unchanged\n+changed\n*** End Patch",
        { checkPermission: () => ({ state: "ask", matchedPattern: "asked.txt" }) },
      ),
      /permission denied/i,
    );
    assert.equal(await readFile(target, "utf8"), "unchanged\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an invalid permission response fails closed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  try {
    await assert.rejects(
      checkPatchPermissions(
        "*** Begin Patch\n*** Add File: blocked.txt\n+blocked\n*** End Patch",
        context(cwd, "invalid-response"),
        bridgeFor({ checkPermission: () => ({ state: "unknown" } as never) }),
      ),
      /invalid response/i,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("denying one file blocks a multi-file patch without mutating either file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const first = join(cwd, "first.txt");
  const second = join(cwd, "second.txt");
  await writeFile(first, "first\n");
  await writeFile(second, "second\n");
  const service: Service = {
    checkPermission: (surface, value) =>
      surface === "path_write" && value?.endsWith("second.txt")
        ? { state: "deny", matchedPattern: "second.txt", reason: "test denial" }
        : allowAll.checkPermission(surface, value),
  };
  const patch = `*** Begin Patch
*** Update File: first.txt
@@
-first
+changed first
*** Update File: second.txt
@@
-second
+changed second
*** End Patch`;
  try {
    await assert.rejects(execute(cwd, "deny-second-file", patch, service), /second\.txt/);
    assert.equal(await readFile(first, "utf8"), "first\n");
    assert.equal(await readFile(second, "utf8"), "second\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("denying a move destination blocks the patch without changing the source", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const source = join(cwd, "source.txt");
  const destination = join(cwd, "moved.txt");
  await writeFile(source, "source\n");
  const service: Service = {
    checkPermission: (surface, value) =>
      surface === "path_write" && value?.endsWith("moved.txt")
        ? { state: "deny", matchedPattern: "moved.txt", reason: "destination denied" }
        : allowAll.checkPermission(surface, value),
  };
  const patch = `*** Begin Patch
*** Update File: source.txt
*** Move to: moved.txt
@@
 source
*** End Patch`;
  try {
    await assert.rejects(execute(cwd, "deny-move-destination", patch, service), /moved\.txt/);
    assert.equal(await readFile(source, "utf8"), "source\n");
    await assert.rejects(readFile(destination, "utf8"), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a symlinked ancestor is checked as an external destination", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-permissions-outside-"));
  await symlink(outside, join(cwd, "linked"), "dir");
  try {
    await assert.rejects(
      execute(
        cwd,
        "symlinked-destination",
        "*** Begin Patch\n*** Add File: linked/new.txt\n+blocked\n*** End Patch",
        {
          checkPermission: (surface) =>
            surface === "external_directory_write"
              ? { state: "deny", matchedPattern: "outside/*" }
              : allowAll.checkPermission(surface),
        },
      ),
      /permission denied|denied|external/i,
    );
    await assert.rejects(readFile(join(outside, "new.txt")), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("malformed patches fail before touching files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const target = join(cwd, "target.txt");
  await writeFile(target, "target\n");
  try {
    await assert.rejects(
      execute(cwd, "malformed-patch", "*** Begin Patch\n*** Update File: target.txt\n@@\n-target\n+changed\n", allowAll),
      /patch/i,
    );
    assert.equal(await readFile(target, "utf8"), "target\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("tool argument aliases are normalized before execution", () => {
  const sessions = createExecSessionManager();
  const exec = createExecCommandTool(sessions);
  const image = createViewImageTool();
  const patch = createApplyPatchTool();
  assert.equal((exec.prepareArguments?.({ command: "printf ok", cwd: "/tmp" }) as { cmd: string }).cmd, "printf ok");
  assert.equal((exec.prepareArguments?.({ command: "printf ok", cwd: "/tmp" }) as { workdir: string }).workdir, "/tmp");
  assert.equal((image.prepareArguments?.({ file_path: "@image.png" }) as { path: string }).path, "image.png");
  assert.equal((patch.prepareArguments?.({ patchText: "patch" }) as { input: string }).input, "patch");
  void sessions.shutdown();
});

test("permission readiness is keyed, repeatable, and isolated per bridge", () => {
  const firstBus = eventBus();
  const secondBus = eventBus();
  const first = createPermissionBridge(firstBus.api, async () => undefined);
  const second = createPermissionBridge(secondBus.api, async () => undefined);
  firstBus.emit({ sessionId: "first", adjudicatesLocally: true });
  firstBus.emit({ sessionId: "first", adjudicatesLocally: true });
  firstBus.emit({ sessionId: null, adjudicatesLocally: true });
  secondBus.emit({ sessionId: "second", adjudicatesLocally: true });
  assert.equal(first.isReady("first"), true);
  assert.equal(first.isReady("second"), false);
  assert.equal(first.isReady("unrelated"), false);
  assert.equal(second.isReady("second"), true);
  first.dispose();
  assert.equal(first.isReady("first"), false);
  assert.equal(second.isReady("second"), true);
  second.dispose();
});

test("a service that disappears after a successful lookup fails closed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const bus = eventBus();
  let service: Service | undefined = allowAll;
  const loader: PermissionModuleLoader = async () => ({ getPermissionsService: () => service });
  const bridge = createPermissionBridge(bus.api, loader);
  const patch = "*** Begin Patch\n*** Add File: checked.txt\n+checked\n*** End Patch";
  try {
    await checkPatchPermissions(patch, context(cwd, "disappearing-service"), bridge);
    service = undefined;
    await assert.rejects(
      checkPatchPermissions(patch, context(cwd, "disappearing-service"), bridge),
      /permission check unavailable.*disappearing-service/i,
    );
  } finally {
    bridge.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("broken permission exports and transitive load failures fail closed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  const patch = "*** Begin Patch\n*** Add File: checked.txt\n+checked\n*** End Patch";
  try {
    const broken = createPermissionBridge(
      eventBus().api,
      async () => ({} as PermissionModule),
    );
    await assert.rejects(
      checkPatchPermissions(patch, context(cwd, "broken-export"), broken),
      /permission check unavailable.*getPermissionsService/i,
    );
    broken.dispose();

    const missingDependency = Object.assign(
      new Error("Cannot find package 'missing-permission-dependency' imported from permission-system"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const failed = createPermissionBridge(eventBus().api, async () => { throw missingDependency; });
    await assert.rejects(
      checkPatchPermissions(patch, context(cwd, "missing-transitive"), failed),
      /missing-permission-dependency/i,
    );
    failed.dispose();

    const absent = createPermissionBridge(eventBus().api, async () => undefined);
    await checkPatchPermissions(patch, context(cwd, "optional-absent"), absent);
    absent.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an announced but unavailable permission service fails closed", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-permission-ready-"));
  const bus = eventBus();
  const bridge = createPermissionBridge(bus.api, async () => undefined);
  bus.emit({ sessionId: "announced-without-service", adjudicatesLocally: true });
  try {
    await assert.rejects(
      checkPatchPermissions(
        "*** Begin Patch\n*** End Patch",
        context(cwd, "announced-without-service", false),
        bridge,
      ),
      /permission check unavailable.*announced-without-service/i,
    );
  } finally {
    bridge.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
