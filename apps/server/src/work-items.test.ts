import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { createDefaultProjectWorkspaceConfig } from "@ipollowork/types/project-workspace";
import type { ProjectSessionExecution } from "@ipollowork/types/work-items";

import { writeiPolloWorkWorkspaceConfig } from "./ipollowork-workspace-config-store.js";
import type { ServerConfig } from "./types.js";
import { startServer } from "./server.js";
import {
  WorkItemConflictError,
  createWorkItem,
  deleteWorkItem,
  deleteWorkspaceWorkState,
  disposeWorkItemStore,
  finishProjectSessionExecution,
  listWorkItems,
  readWorkBoardConfig,
  startProjectSessionExecution,
  updateWorkItem,
  writeWorkBoardConfig,
} from "./work-items.js";

const temporaryRoots: string[] = [];

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{
      id: "project_one",
      name: "Project one",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function testContext(): Promise<{ root: string; config: ServerConfig }> {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-work-items-"));
  temporaryRoots.push(root);
  return { root, config: serverConfig(root) };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("work item store", () => {
  test("exposes authenticated engine-neutral work routes", async () => {
    const { config } = await testContext();
    const project = createDefaultProjectWorkspaceConfig({ engineId: DEFAULT_ENGINE_ID });
    const projectAgent = project.agents[0];
    if (!projectAgent) throw new Error("Default project Agent is required");
    projectAgent.runtime.model = { providerId: "openai", modelId: "gpt-agent-default" };
    projectAgent.runtime.modelVariant = "high";
    await writeiPolloWorkWorkspaceConfig(config, "project_one", (current) => ({ ...current, project }));
    const server = await startServer(config);
    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const unauthorized = await fetch(`${baseUrl}/work-items?workspaceId=project_one`);
      expect(unauthorized.status).toBe(401);

      const created = await fetch(`${baseUrl}/workspace/project_one/work-items`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Publish weekly report", startAt: Date.now() }),
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json();
      expect(createdBody).toMatchObject({ workspaceId: "project_one", status: "planned", version: 1 });

      const listed = await fetch(`${baseUrl}/work-items?workspaceId=project_one`, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ items: [{ title: "Publish weekly report" }] });

      const started = await fetch(`${baseUrl}/workspace/project_one/project-sessions/session_one/execution`, {
        method: "PUT",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Project conversation",
          runtime: {
            engineId: DEFAULT_ENGINE_ID,
            model: { providerId: "deepseek-official", modelId: "deepseek-v4" },
            mode: "build",
            modelVariant: "low",
          },
        }),
      });
      expect(started.status).toBe(200);
      expect(await started.json()).toMatchObject({
        status: "running",
        execution: {
          sessionId: "session_one",
          agent: { id: "project-lead" },
          runtime: {
            engineId: DEFAULT_ENGINE_ID,
            model: { providerId: "deepseek-official", modelId: "deepseek-v4" },
            modelVariant: "low",
          },
        },
      });

      const finished = await fetch(`${baseUrl}/workspace/project_one/project-sessions/session_one/execution`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "done", title: "Project conversation" }),
      });
      expect(finished.status).toBe(200);
      expect(await finished.json()).toMatchObject({ status: "done", runCompletedAt: expect.any(Number) });

      const resumed = await fetch(`${baseUrl}/workspace/project_one/project-sessions/session_one/execution`, {
        method: "PUT",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Project conversation again",
          runtime: {
            engineId: DEFAULT_ENGINE_ID,
            model: { providerId: "openai", modelId: "gpt-6" },
            mode: "plan",
            modelVariant: "low",
          },
        }),
      });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toMatchObject({
        status: "running",
        execution: {
          projectRevision: 0,
          runtime: { engineId: DEFAULT_ENGINE_ID, model: { modelId: "gpt-6" }, mode: "plan", modelVariant: "low" },
        },
      });

      const switchedEngine = await fetch(`${baseUrl}/workspace/project_one/project-sessions/session_one/execution`, {
        method: "PUT",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          title: "Project conversation",
          runtime: {
            engineId: DEEPSEEK_HARNESS_ENGINE_ID,
            model: null,
            mode: null,
            modelVariant: null,
          },
        }),
      });
      expect(switchedEngine.status).toBe(409);
      expect(await switchedEngine.json()).toMatchObject({ code: "project_session_engine_changed" });

      const capabilities = await fetch(`${baseUrl}/capabilities`, {
        headers: { authorization: `Bearer ${config.token}` },
      });
      expect(await capabilities.json()).toMatchObject({
        work: { read: true, write: true, board: true, schedule: true },
      });
    } finally {
      await server.stop();
    }
  });

  test("persists, schedules, updates, and deletes project work", async () => {
    const { config } = await testContext();
    try {
      const startAt = new Date("2026-08-20T09:00:00.000Z").getTime();
      const dueAt = new Date("2026-08-20T10:00:00.000Z").getTime();
      const created = await createWorkItem(config, "project_one", {
        title: "Review campaign draft",
        description: "Check the final copy",
        status: "ready",
        assignee: "Editor Agent",
        priority: "high",
        startAt,
        dueAt,
        customFields: { channel: "Video", approved: false },
      });

      expect(created).toMatchObject({
        workspaceId: "project_one",
        status: "ready",
        version: 1,
        customFields: { channel: "Video", approved: false },
      });
      expect((await listWorkItems(config, {
        workspaceIds: ["project_one"],
        from: startAt - 1,
        to: dueAt + 1,
      })).items.map((item) => item.id)).toEqual([created.id]);
      expect((await listWorkItems(config, {
        workspaceIds: ["project_one"],
        from: dueAt + 1,
      })).items).toEqual([]);

      const updated = await updateWorkItem(config, "project_one", created.id, {
        expectedVersion: created.version,
        status: "running",
        priority: "urgent",
      });
      expect(updated).toMatchObject({ status: "running", priority: "urgent", version: 2 });
      await expect(updateWorkItem(config, "project_one", created.id, {
        expectedVersion: created.version,
        title: "Stale title",
      })).rejects.toBeInstanceOf(WorkItemConflictError);

      expect(await deleteWorkItem(config, "project_one", created.id, 2)).toBe(true);
      expect((await listWorkItems(config, { workspaceIds: ["project_one"] })).items).toEqual([]);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("versions project board configuration and cleans up with the project", async () => {
    const { config } = await testContext();
    try {
      const initial = await readWorkBoardConfig(config, "project_one");
      expect(initial.version).toBe(0);
      expect(initial.columns.map((column) => column.id)).toContain("running");

      const saved = await writeWorkBoardConfig(config, "project_one", {
        columns: initial.columns.map((column) => (
          column.id === "review" ? { ...column, label: "主编审核" } : column
        )),
        fields: [{ id: "channel", label: "渠道", type: "select", options: ["视频", "图文"], showOnCard: true }],
      }, initial.version);
      expect(saved.version).toBe(1);
      expect(saved.fields[0]?.label).toBe("渠道");

      await expect(writeWorkBoardConfig(config, "project_one", {
        columns: initial.columns,
        fields: [],
      }, initial.version)).rejects.toBeInstanceOf(WorkItemConflictError);

      await createWorkItem(config, "project_one", { title: "Temporary item" });
      await deleteWorkspaceWorkState(config, "project_one");
      expect((await listWorkItems(config, { workspaceIds: ["project_one"] })).items).toEqual([]);
      expect((await readWorkBoardConfig(config, "project_one")).version).toBe(0);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("updates the execution binding while task state follows repeated runs", async () => {
    const { config } = await testContext();
    try {
      const baseExecution: ProjectSessionExecution = {
        sessionId: "session_immutable",
        projectRevision: 3,
        projectGoal: "Publish a verified report",
        agent: {
          id: "editor",
          name: "Editor",
          avatarSeed: "editor",
          role: "Review copy",
          prompt: "Check every claim.",
          skillIds: ["writing:review"],
          pluginIds: ["writing"],
          runtime: {
            engineId: DEFAULT_ENGINE_ID,
            model: { providerId: "openai", modelId: "gpt-5" },
            mode: "execute",
            modelVariant: "high",
          },
        },
        runtime: {
          engineId: DEFAULT_ENGINE_ID,
          model: { providerId: "openai", modelId: "gpt-5" },
          mode: "build",
          modelVariant: "high",
        },
        boundAt: Date.now(),
      };
      const started = await startProjectSessionExecution(config, "project_one", "Review copy", baseExecution);
      expect(started).toMatchObject({ status: "running", execution: baseExecution });
      await expect(updateWorkItem(config, "project_one", started.id, {
        expectedVersion: started.version,
        status: "done",
      })).rejects.toBeInstanceOf(WorkItemConflictError);

      const completed = await finishProjectSessionExecution(config, "project_one", baseExecution.sessionId, {
        status: "done",
      });
      expect(completed).toMatchObject({ status: "done", lastError: null });

      const restarted = await startProjectSessionExecution(config, "project_one", "Review copy again", {
        ...baseExecution,
        projectRevision: 4,
        runtime: { ...baseExecution.runtime, model: { providerId: "openai", modelId: "gpt-6" } },
      });
      expect(restarted).toMatchObject({
        status: "running",
        title: "Review copy again",
        execution: { projectRevision: 4, runtime: { model: { modelId: "gpt-6" } } },
      });

      const failed = await finishProjectSessionExecution(config, "project_one", baseExecution.sessionId, {
        status: "failed",
        error: "Engine stopped",
      });
      expect(failed).toMatchObject({ status: "failed", lastError: "Engine stopped" });
    } finally {
      await disposeWorkItemStore(config);
    }
  });
});
