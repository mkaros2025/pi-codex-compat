import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createViewImageTool } from "../src/tools/view-image/tool.ts";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("view_image returns native image content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-view-image-"));
  const path = join(cwd, "one.png");
  await writeFile(path, Buffer.from(ONE_PIXEL_PNG, "base64"));
  try {
    const tool = createViewImageTool();
    const result = await tool.execute(
      "image",
      { path: "one.png" },
      undefined,
      undefined,
      { cwd, model: { input: ["text", "image"] } } as never,
    );
    const image = result.content[0] as { type: string; mimeType?: string; data?: string };
    assert.equal(image.type, "image");
    assert.equal(image.mimeType, "image/png");
    assert.ok(image.data);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
