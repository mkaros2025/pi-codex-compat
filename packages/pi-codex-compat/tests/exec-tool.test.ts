import assert from "node:assert/strict";
import test from "node:test";
import { createExecCommandTool } from "../src/tools/exec/command-tool.ts";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";
import { createWriteStdinTool } from "../src/tools/exec/write-stdin-tool.ts";

test("exec and write_stdin preserve a live session and abort cleanly", async () => {
  const sessions = createExecSessionManager();
  const exec = createExecCommandTool(sessions);
  const write = createWriteStdinTool(sessions);
  const ctx = { cwd: process.cwd() } as never;
  try {
    const first = await exec.execute(
      "exec",
      { cmd: "read x; printf 'GOT:%s' \"$x\"", shell: "/bin/bash", tty: true, login: false, yield_time_ms: 250 },
      undefined,
      undefined,
      ctx,
    );
    const firstDetails = first.details as { session_id?: number };
    assert.equal(typeof firstDetails.session_id, "number");

    const second = await write.execute(
      "write",
      { session_id: firstDetails.session_id, chars: "hello\n", yield_time_ms: 1_000 },
      undefined,
      undefined,
      ctx,
    );
    assert.match((second.details as { output: string }).output, /GOT:.*hello/);
    assert.equal((second.details as { exit_code?: number }).exit_code, 0);

    const controller = new AbortController();
    const pending = exec.execute(
      "abort",
      { cmd: "sleep 60", shell: "/bin/bash", tty: true, login: false },
      controller.signal,
      undefined,
      ctx,
    );
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      await assert.rejects(pending, /aborted/i);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await sessions.shutdown();
  }
});
