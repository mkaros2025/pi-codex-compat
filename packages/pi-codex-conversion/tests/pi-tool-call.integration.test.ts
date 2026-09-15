import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(testDir, "..");
const repoDir = resolve(packageDir, "../..");
const piBin = process.env["PI_CODING_AGENT_BIN"] ?? "pi";
const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
const permissionPackageDir = join(agentDir, "npm", "node_modules", "@gotgenes", "pi-permission-system");
const aiPath = join(
  repoDir,
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.js",
);
const canRun = spawnSync(piBin, ["--version"], { stdio: "ignore" }).status === 0 &&
  existsSync(join(permissionPackageDir, "src", "index.ts")) &&
  existsSync(aiPath);

const firstPatch = `*** Begin Patch
*** Add File: first.txt
+must-not-appear
*** Add File: second.txt
+blocked
*** End Patch`;
const movePatch = `*** Begin Patch
*** Update File: source.txt
*** Move to: moved.txt
@@
 source
*** End Patch`;

const driver = String.raw`import { writeFileSync } from "node:fs";

const workdir = process.env.PI_TEST_WORKDIR;
const resultPath = process.env.PI_TEST_RESULT;
const aiPath = process.env.PI_TEST_AI_PATH;
const firstPatch = ${JSON.stringify(firstPatch)};
const movePatch = ${JSON.stringify(movePatch)};

export default async function (pi) {
  const { createAssistantMessageEventStream } = await import(aiPath);
  const calls = [];
  const results = [];
  let request = 0;

  pi.registerProvider("pi-test", {
    baseUrl: "http://127.0.0.1:1/v1",
    api: "openai-completions",
    apiKey: "test",
    models: [{
      id: "gpt-test",
      name: "Pi integration test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 1000,
    }],
    streamSimple(_model, _context, _options) {
      const stream = createAssistantMessageEventStream();
      const callNumber = request++;
      queueMicrotask(() => {
        const output = {
          role: "assistant",
          content: [],
          api: "openai-completions",
          provider: "pi-test",
          model: "gpt-test",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "pending",
          timestamp: Date.now(),
        };
        stream.push({ type: "start", partial: output });
        if (callNumber === 0) {
          output.content.push({ type: "toolCall", id: "call-exec", name: "exec_command", arguments: { command: "node --version", cwd: workdir } });
        } else if (callNumber === 1) {
          output.content.push({ type: "toolCall", id: "call-patch", name: "apply_patch", arguments: { patchText: firstPatch } });
        } else if (callNumber === 2) {
          output.content.push({ type: "toolCall", id: "call-move", name: "apply_patch", arguments: { input: movePatch } });
        } else {
          output.content.push({ type: "text", text: "integration complete" });
        }
        if (output.content[0]?.type === "toolCall") {
          stream.push({ type: "toolcall_start", contentIndex: 0, partial: output });
          stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: output.content[0], partial: output });
          output.stopReason = "toolUse";
        } else {
          stream.push({ type: "text_start", contentIndex: 0, partial: output });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "integration complete", partial: output });
          stream.push({ type: "text_end", contentIndex: 0, content: "integration complete", partial: output });
          output.stopReason = "stop";
        }
        stream.push({ type: "done", reason: output.stopReason, message: output });
        stream.end();
      });
      return stream;
    },
  });

  pi.on("tool_call", (event) => {
    if (["exec_command", "apply_patch"].includes(event.toolName)) {
      calls.push({ toolName: event.toolName, input: event.input });
    }
  });
  pi.on("tool_result", (event) => {
    if (["exec_command", "apply_patch"].includes(event.toolName)) {
      results.push({ toolName: event.toolName, isError: event.isError, content: event.content });
    }
  });
  pi.on("agent_settled", (_event, ctx) => {
    writeFileSync(resultPath, JSON.stringify({ calls, results }, null, 2));
    ctx.shutdown();
  });
}
`;

test(
  "real Pi tool calls normalize aliases and enforce patch permissions",
  { skip: canRun ? false : "requires pi, Pi AI, and the optional permission package" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-codex-pi-test-"));
    const isolatedAgent = join(root, "agent");
    const project = join(root, "project");
    const resultPath = join(root, "result.json");
    const driverPath = join(root, "driver.mjs");
    const sourcePath = join(project, "source.txt");
    const secondPath = join(project, "second.txt");
    const firstPath = join(project, "first.txt");
    const movedPath = join(project, "moved.txt");

    try {
      await mkdir(join(isolatedAgent, "npm"), { recursive: true });
      await mkdir(join(isolatedAgent, "extensions", "pi-permission-system"), { recursive: true });
      await mkdir(project, { recursive: true });
      await writeFile(join(isolatedAgent, "npm", "package.json"), '{"name":"pi-test-agent","private":true}\n');
      await writeFile(
        join(isolatedAgent, "extensions", "pi-permission-system", "config.json"),
        JSON.stringify({
          debugLog: false,
          permissionReviewLog: false,
          yoloMode: false,
          shellTools: { exec_command: { commandArgument: "cmd", workdirArgument: "workdir" } },
          permission: {
            "*": "allow",
            bash: { "*": "allow" },
            path_write: { "*": "allow", [secondPath]: "deny", [movedPath]: "deny" },
          },
        }),
      );
      await writeFile(sourcePath, "source\n");
      await writeFile(driverPath, driver);
      await symlink(
        join(agentDir, "npm", "node_modules"),
        join(isolatedAgent, "npm", "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const child = spawn(
        piBin,
        [
          "--mode", "rpc",
          "--no-session",
          "--no-context-files",
          "--no-extensions",
          "--approve",
          "--no-builtin-tools",
          "--provider", "pi-test",
          "--model", "pi-test/gpt-test",
          "--api-key", "test",
          "-e", join(permissionPackageDir, "src/index.ts"),
          "-e", join(packageDir, "src/index.ts"),
          "-e", driverPath,
        ],
        {
          cwd: project,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: isolatedAgent,
            PI_TEST_AI_PATH: aiPath,
            PI_TEST_RESULT: resultPath,
            PI_TEST_WORKDIR: project,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stdout.resume();
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`Pi integration timed out\n${stderr}`));
        }, 30_000);
        child.once("error", reject);
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          resolveExit({ code, signal });
        });
        child.stdin.write(JSON.stringify({ type: "prompt", message: "run integration" }) + "\n");
      });

      assert.equal(exit.code, 0, stderr);
      const result = JSON.parse(await readFile(resultPath, "utf8")) as {
        calls: Array<{ toolName: string; input: Record<string, unknown> }>;
        results: Array<{ toolName: string; isError: boolean; content: Array<{ text?: string }> }>;
      };
      assert.deepEqual(result.calls.map(({ toolName }) => toolName), ["exec_command", "apply_patch", "apply_patch"]);
      assert.equal(result.calls[0]?.input["cmd"], "node --version");
      assert.equal(result.calls[0]?.input["workdir"], project);
      assert.equal(result.calls[1]?.input["input"], firstPatch);
      assert.equal(result.calls[2]?.input["input"], movePatch);
      assert.deepEqual(result.results.map(({ toolName, isError }) => ({ toolName, isError })), [
        { toolName: "exec_command", isError: false },
        { toolName: "apply_patch", isError: true },
        { toolName: "apply_patch", isError: true },
      ]);
      assert.match(result.results[1]?.content[0]?.text ?? "", /second\.txt/);
      assert.match(result.results[2]?.content[0]?.text ?? "", /moved\.txt/);
      await assert.rejects(access(firstPath), /ENOENT/);
      await assert.rejects(access(secondPath), /ENOENT/);
      assert.equal(await readFile(sourcePath, "utf8"), "source\n");
      await assert.rejects(access(movedPath), /ENOENT/);
      child.stdin.end();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
