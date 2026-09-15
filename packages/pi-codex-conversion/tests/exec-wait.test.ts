import assert from "node:assert/strict";
import test from "node:test";
import { createExecSessionManager } from "../src/tools/exec/session-manager.ts";
import { waitForExitOrInactivity, type WaitableSession } from "../src/tools/exec/wait.ts";

function emitOutput(session: WaitableSession): void {
  session.outputVersion += 1;
  for (const listener of session.listeners) listener();
}

function runningSession(): WaitableSession {
  return { exitCode: undefined, outputVersion: 0, listeners: new Set() };
}

test("exec waits through activity and the session manager waits for exit", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const silent = runningSession();
  const silentWait = waitForExitOrInactivity(silent, 10, 30);
  t.mock.timers.tick(10);
  assert.equal(await silentWait, 10);

  const active = runningSession();
  const activeWait = waitForExitOrInactivity(active, 10, 30);
  for (let elapsed = 9; elapsed <= 27; elapsed += 9) {
    t.mock.timers.tick(9);
    emitOutput(active);
  }
  t.mock.timers.tick(3);
  assert.equal(await activeWait, 30);

  const sessions = createExecSessionManager({ minNonInteractiveExecYieldTimeMs: 250 });
  try {
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setTimeout(() => {}, 300)")}`;
    const result = await sessions.exec({ cmd: command, yield_time_ms: 250, max_yield_time_ms: 250, wait_until_exit: true, login: false }, process.cwd());
    assert.equal(result.exit_code, 0);
  } finally {
    await sessions.shutdown();
  }
});
