import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplyPatchTool, registerApplyPatchResultHook } from "../src/tools/apply-patch/tool.ts";

test("apply_patch rejects duplicate sources and applies multiple hunks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-apply-patch-"));
  const path = join(cwd, "duplicate.txt");
  const original = "top\nmiddle\nbottom\n";
  await writeFile(path, original);
  const tool = createApplyPatchTool();
  const context = {
    cwd,
    hasUI: false,
    ui: { confirm: async () => false },
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "test" },
  } as never;
  try {
    const duplicateAlias = process.platform === "win32" ? "./DUPLICATE.txt" : "./duplicate.txt";
    const duplicatePatch = `*** Begin Patch
*** Update File: duplicate.txt
@@
-top
+first update
*** Update File: ${duplicateAlias}
@@
-top
+second update
*** End Patch`;
    await assert.rejects(
      tool.execute("duplicate", { input: duplicatePatch }, undefined, undefined, context),
      /multiple file sections resolve to .*duplicate\.txt/i,
    );
    assert.equal(await readFile(path, "utf8"), original);

    const multipleHunksPatch = `*** Begin Patch
*** Update File: duplicate.txt
@@
-top
+updated top
@@
-bottom
+updated bottom
*** End Patch`;
    const result = await tool.execute("multiple-hunks", { input: multipleHunksPatch }, undefined, undefined, context);
    assert.equal((result.details as { status: string }).status, "success");
    assert.equal(await readFile(path, "utf8"), "updated top\nmiddle\nupdated bottom\n");

    const secondPath = join(cwd, "second.txt");
    await writeFile(secondPath, "second\n");
    const partialPatch = `*** Begin Patch
*** Update File: duplicate.txt
@@
-updated top
+partially updated
*** Update File: second.txt
@@
-not present
+failed
*** End Patch`;
    const partial = await tool.execute("partial", { input: partialPatch }, undefined, undefined, context);
    const partialResult = partial as unknown as { details: { status: string } };
    assert.equal(partialResult.details.status, "partial_failure");
    assert.equal(await readFile(path, "utf8"), "partially updated\nmiddle\nupdated bottom\n");
    assert.equal(await readFile(secondPath, "utf8"), "second\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("apply_patch marks partial results as errors through Pi's result hook", () => {
  let handler: ((event: never, ctx: never) => unknown) | undefined;
  registerApplyPatchResultHook({
    on(_event: never, next: (event: never, ctx: never) => unknown) { handler = next; },
  } as never);
  assert.deepEqual(
    handler?.({ toolName: "apply_patch", details: { status: "partial_failure" } } as never, undefined as never),
    { isError: true },
  );
  assert.equal(handler?.({ toolName: "apply_patch", details: { status: "success" } } as never, undefined as never), undefined);
  assert.equal(handler?.({ toolName: "other", details: { status: "partial_failure" } } as never, undefined as never), undefined);
});
