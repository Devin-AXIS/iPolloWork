import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEEPSEEK_HARNESS_ENGINE_ID,
  DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX,
} from "@ipollowork/types/workspace";

import { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import { installPluginPackage } from "./plugin-package-lifecycle.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function serverConfig(workspaceRoot: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    configPath: join(workspaceRoot, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{
      id: "ws_dsh",
      name: "DeepSeek Harness",
      path: workspaceRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function writePromptPackage(packageRoot: string): Promise<void> {
  await mkdir(join(packageRoot, "commands"), { recursive: true });
  await mkdir(join(packageRoot, "agents"), { recursive: true });
  await writeFile(
    join(packageRoot, "commands", "review-labels.md"),
    "Check every annotation against the project labels.",
    "utf8",
  );
  await writeFile(
    join(packageRoot, "agents", "annotation-reviewer.md"),
    "Act as a careful annotation quality reviewer.",
    "utf8",
  );
  await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 2,
    id: "school-tools",
    name: "School tools",
    description: "Annotation training helpers.",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: { version: "1.0.0", updateId: "school/tools" },
    resources: [
      {
        type: "command",
        id: "review-command",
        path: "commands/review-labels.md",
        label: "Review annotations",
      },
      {
        type: "agent",
        id: "review-agent",
        path: "agents/annotation-reviewer.md",
        description: "Annotation reviewer",
      },
    ],
  }, null, 2), "utf8");
}

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("DeepSeek Harness plugin prompt routes", () => {
  test("keeps plugin instructions on the server and blocks raw prompt RPC bypass", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-dsh-prompt-workspace-");
    const packageRoot = await temporaryRoot("ipollowork-dsh-prompt-package-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writePromptPackage(packageRoot);
    const config = serverConfig(workspaceRoot);
    await installPluginPackage({
      serverConfig: config,
      packageRoot,
    });
    const calls: Array<{ method: string; payload: unknown }> = [];
    const call = spyOn(DeepSeekHarnessRuntime.prototype, "call").mockImplementation(
      async <T>(method: string, payload: unknown): Promise<T> => {
        calls.push({ method, payload });
        return {} as T;
      },
    );
    const server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}/workspace/ws_dsh/engine/deepseek-harness`;
    const headers = {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    };

    try {
      const capabilities = await fetch(`${base}/plugin-capabilities`, { headers });
      expect(capabilities.status).toBe(200);
      const capabilityPayload = await capabilities.json();
      expect(capabilityPayload.items).toEqual([
        expect.objectContaining({ type: "agent", name: "annotation-reviewer" }),
        expect.objectContaining({ type: "command", name: "review-labels" }),
      ]);
      expect(JSON.stringify(capabilityPayload)).not.toContain("Check every annotation");
      expect(JSON.stringify(capabilityPayload)).not.toContain("Act as a careful annotation quality reviewer");

      const bypass = await fetch(`${base}/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({ method: "session.prompt", payload: { sessionId: "session-1" } }),
      });
      expect(bypass.status).toBe(400);

      const prompt = await fetch(`${base}/prompt`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          payload: {
            sessionId: "session-1",
            mode: "queue",
            content: [{ type: "text", text: "Review the current batch" }],
          },
          plugins: {
            command: { name: "review-labels", arguments: "project 12" },
            agents: ["annotation-reviewer"],
          },
        }),
      });
      expect(prompt.status).toBe(200);
      expect(calls).toEqual([{
        method: "session.prompt",
        payload: {
          sessionId: "session-1",
          mode: "queue",
          content: [
            {
              type: "text",
              text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}Execute the installed plugin command /review-labels. Follow its instructions:\n\nCheck every annotation against the project labels.\n</system>`,
            },
            {
              type: "text",
              text: `${DEEPSEEK_HARNESS_INTERNAL_SYSTEM_PREFIX}The user selected the plugin agent \"annotation-reviewer\". Follow these agent instructions:\n\nAct as a careful annotation quality reviewer.\n</system>`,
            },
            { type: "text", text: "Review the current batch" },
            { type: "text", text: "Run /review-labels with these arguments: project 12" },
          ],
        },
      }]);
    } finally {
      await server.stop();
      call.mockRestore();
    }
  });
});
