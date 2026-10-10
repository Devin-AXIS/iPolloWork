import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";
import { createDefaultProjectWorkspaceConfig } from "@ipollowork/types/project-workspace";
import {
  WORK_ITEM_TITLE_MAX_LENGTH,
  type ProjectSessionExecution,
  projectExecutionSystemContext,
} from "@ipollowork/types/work-items";

import { readiPolloWorkWorkspaceConfig, writeiPolloWorkWorkspaceConfig } from "./ipollowork-workspace-config-store.js";
import type { ServerConfig } from "./types.js";
import { startServer } from "./server.js";
import {
  WorkItemConflictError,
  createWorkItem,
  createWorkItems,
  deleteWorkItem,
  deleteWorkspaceWorkState,
  disposeWorkItemStore,
  finishProjectSessionExecution,
  listWorkItems,
  readWorkBoardConfig,
  runDueWorkItemAutomationsOnce,
  workItemAutomationPrompt,
  startProjectSessionExecution,
  updateWorkItem,
  writeWorkBoardConfig,
  bindConversationSession,
  bindProjectSessionExecution,
  writeConversationWorkflow,
  saveWorkTemplate,
  listWorkTemplates,
  readProjectSessionWorkItem,
  resolveSessionWorkspace,
  listConversationSessionBindings,
  nativeWorkTemplateAgents,
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
  test("conversation work owns its method and engine while project supplies shared context", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const project = createDefaultProjectWorkspaceConfig({ engineId: DEFAULT_ENGINE_ID, agentName: "Project editor" });
    project.goal = "Shared brand context";
    project.agents[0].runtime.model = { providerId: "openai", modelId: "project-only-model" };
    await writeiPolloWorkWorkspaceConfig(config, workspace.id, (stored) => ({ ...stored, project }));
    try {
      const ready = await bindConversationSession(config, workspace, "video_session", { title: "Product launch", engineId: DEEPSEEK_HARNESS_ENGINE_ID });
      expect(ready).toMatchObject({ status: "ready", runStartedAt: null, execution: {
        projectGoal: "Shared brand context", agent: { name: "工作助手" },
        workflow: { templateId: "general", source: "auto", stages: [] },
        runtime: { engineId: DEEPSEEK_HARNESS_ENGINE_ID, model: null },
      } });
      if (!ready.execution) throw new Error("Execution binding required");
      const video = await writeConversationWorkflow(config, workspace, "video_session", {
        expectedVersion: ready.version, runtime: ready.execution.runtime, templateId: "video", goal: "Deliver a 30 second product video",
      });
      expect(video).toMatchObject({ status: "ready", runStartedAt: null, execution: {
        workflow: { templateId: "video", templateVersion: 6, workKind: "video", source: "manual" },
      } });
      if (!video.execution?.workflow) throw new Error("Workflow required");
      const team = video.execution.workflow.config;
      const entry = team.agents[0];
      team.agents.push({ ...entry, id: "researcher", name: "Researcher", role: "Find source material", prompt: "Verify original sources before handing off.",
        runtime: { engineId: "codex-harness", model: { providerId: "openai", modelId: "ignored-role-model" }, mode: "plan", modelVariant: "high" },
      });
      team.orchestration.relations = [{ sourceAgentId: "researcher", targetAgentId: entry.id, type: "dependency", label: "Material handoff" }];
      const shaped = await writeConversationWorkflow(config, workspace, "video_session", {
        expectedVersion: video.version, runtime: video.execution.runtime, source: "manual", config: team,
        progress: { summary: "Brief confirmed", decisions: ["Use the existing brand palette"], outputs: ["video/video_session/STORYBOARD.md"], blockers: [] },
      });
      if (!shaped.execution) throw new Error("Execution required");
      const context = projectExecutionSystemContext(shaped.execution);
      expect(shaped.execution.workflow?.source).toBe("custom");
      expect(shaped.execution.workflow?.config.agents.every((agent) => agent.runtime.engineId === null && agent.runtime.model === null && agent.runtime.mode === "auto" && agent.runtime.modelVariant === null)).toBe(true);
      expect(context).toContain("Verify original sources before handing off.");
      expect(context).toContain("[project-agent:researcher]");
      expect(context).toContain("not registered agent types");
      expect(context).not.toContain("ipw-video.plan");
      expect(context).not.toContain("researcher dependency project-lead: Material handoff");
      expect(context).not.toContain("Brief confirmed");
      expect(context).toContain("actual paths, evidence and unfinished work");
      expect(context).toContain("native plan, tools, subagents and result collection");
      expect(context).not.toContain("Use ipollowork_conversation_read");
      expect(projectExecutionSystemContext({ ...shaped.execution, runtime: { ...shaped.execution.runtime, engineId: DEFAULT_ENGINE_ID } })).toEqual(context);

      await disposeWorkItemStore(config);
      expect(await readProjectSessionWorkItem(config, workspace.id, "video_session")).toEqual(shaped);
      expect(await resolveSessionWorkspace(config, { ...workspace, engineId: "codex-harness" }, "video_session")).toMatchObject({ engineId: DEEPSEEK_HARNESS_ENGINE_ID });
      expect(await listConversationSessionBindings(config, workspace.id)).toMatchObject([{ sessionId: "video_session", status: "ready", engineId: DEEPSEEK_HARNESS_ENGINE_ID }]);
      const forked = await bindConversationSession(config, workspace, "video_fork", { title: "Video alternative", engineId: DEEPSEEK_HARNESS_ENGINE_ID, parentSessionId: "video_session" });
      expect(forked.execution?.workflow).toEqual(shaped.execution.workflow);
      expect(forked.status).toBe("ready");
      const longTitle = await bindConversationSession(config, workspace, "long_title", { title: "a".repeat(500), engineId: DEFAULT_ENGINE_ID });
      expect(longTitle.title).toHaveLength(WORK_ITEM_TITLE_MAX_LENGTH);

    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("video template follows the installed production skills and keeps one delivery owner", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    const runtime = { engineId: DEFAULT_ENGINE_ID, model: null, mode: null, modelVariant: null };
    try {
      const templates = await listWorkTemplates(config, workspace);
      const video = templates.templates.find((template) => template.id === "video");
      if (!video) throw new Error("Video template required");
      expect(video.version).toBe(6);
      expect(video.config.agents.map((agent) => agent.id)).toEqual(["project-lead", "plan", "produce", "verify"]);
      const manifest = await Bun.file(new URL("../../../examples/plugin-packages/video-agent/ipollowork.plugin.json", import.meta.url)).json();
      const resources = manifest.resources.filter((resource: { type: string }) => resource.type === "skill");
      for (const agent of video.config.agents) {
        expect(agent.prompt.trim().length).toBeGreaterThan(0);
        expect(agent.pluginIds).toEqual([manifest.id]);
        for (const identity of agent.skillIds) {
          const resource = resources.find((resource: { id: string }) => identity === `${manifest.id}:${resource.id}`);
          expect(resource).toBeDefined();
          expect(await Bun.file(new URL(`../../../examples/plugin-packages/video-agent/${resource.path}`, import.meta.url)).exists()).toBe(true);
        }
      }
      expect(video.config.agents.find((agent) => agent.id === "plan")?.skillIds).toEqual(["video-agent:ipollowork-video-storyboard"]);
      expect(video.config.agents.find((agent) => agent.id === "produce")?.skillIds).toEqual([
        "video-agent:ipollowork-video-compose", "video-agent:ipollowork-video-voiceover", "video-agent:ipollowork-video-soundtrack",
      ]);
      expect(video.config.agents.find((agent) => agent.id === "verify")?.prompt).toContain("用现有工具获取证据");
      const original = JSON.stringify(video);
      const nativeRoles = nativeWorkTemplateAgents().filter((agent) => agent.name.startsWith("ipw-video."));
      expect(nativeRoles.map((agent) => agent.name)).toEqual(["ipw-video.plan", "ipw-video.produce", "ipw-video.verify"]);
      for (const native of nativeRoles) {
        const role = video.config.agents.find((agent) => native.name.endsWith(`.${agent.id}`));
        if (!role) throw new Error("Existing template role required");
        expect(native.prompt).toContain(role.prompt);
        expect(native.prompt).toContain(`[project-agent:${role.id}]`);
        for (const skill of role.skillIds) expect(native.prompt).toContain(skill.split(":").at(-1)!);
      }
      expect(JSON.stringify((await listWorkTemplates(config, workspace)).templates.find((template) => template.id === "video"))).toBe(original);
      expect(video.config.orchestration.relations).toMatchObject([
        { sourceAgentId: "plan", targetAgentId: "produce", type: "dependency" },
        { sourceAgentId: "produce", targetAgentId: "verify", type: "dependency" },
      ]);
      const selected = await writeConversationWorkflow(config, workspace, "video_native_workers", { runtime, templateId: video.id });
      if (!selected.execution) throw new Error("Execution required");
      const context = projectExecutionSystemContext(selected.execution);
      expect(context.split(selected.execution.agent.prompt)).toHaveLength(2);
      expect(context).toContain("Available preset roles (optional)");
      expect(context).toContain("ipw-video.produce");
      expect(context).not.toContain(video.config.agents.find((agent) => agent.id === "produce")!.prompt);
      expect(context).toContain("native plan, tools, subagents");
      expect(context).toContain("actual paths, evidence and unfinished work");
      expect(context).not.toContain("ipollowork_conversation_apply");
      expect(context).not.toContain("Read the version before applying");
      expect(context).not.toContain("Work relationships:");
      expect(context.length).toBeLessThan(2500);
      expect(context).toContain("Parallelize independent tasks");
      expect(context).toContain("Proactively use native subagents");
      expect(context).toContain("sequence dependent steps after their required inputs are available");
      expect(context).toContain("Keep simple tasks on the main agent");
      const development = templates.templates.find((template) => template.id === "development");
      expect(development?.config.agents.map((agent) => agent.id)).toEqual(["project-lead", "inspect", "verify"]);
      expect(development?.stages.every((stage) => development.config.agents.some((agent) => agent.id === stage.agentId))).toBe(true);
      expect(projectExecutionSystemContext({ ...selected.execution, runtime: { ...runtime, engineId: "codex-harness" } })).toEqual(context);
    } finally { await disposeWorkItemStore(config); }
  });

  test("first dispatch initializes the goal and automatic method, while continuation keeps its snapshot", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const runtime = { engineId: DEFAULT_ENGINE_ID, model: null, mode: null, modelVariant: null };
    try {
      await bindConversationSession(config, workspace, "first_video", { title: "Make video", engineId: DEFAULT_ENGINE_ID });
      const running = await bindProjectSessionExecution(config, workspace, "first_video", { title: "Make video", runtime, goal: "Create a thirty second product video", workKind: "video" });
      expect(running.execution?.workflow).toMatchObject({ templateId: "video", source: "auto", goal: "Create a thirty second product video" });
      expect(running.execution?.agent.id).toBe(running.execution?.workflow?.config.orchestration.entryAgentId);
      if (!running.execution) throw new Error("Automatic execution required");
      const automaticContext = projectExecutionSystemContext(running.execution);
      expect(automaticContext).toContain("native plan, tools, subagents");
      expect(automaticContext).not.toContain("Available preset roles");
      expect(automaticContext).not.toContain("ipw-video.plan");
      expect(automaticContext).not.toContain("Suggested steps:");
      expect(automaticContext).toContain("Create a thirty second product video");
      await finishProjectSessionExecution(config, workspace.id, "first_video", { status: "done" });
      const resumed = await bindProjectSessionExecution(config, workspace, "first_video", { title: "Refine video", runtime, goal: "Make a website instead", workKind: "development" });
      expect(resumed.execution?.workflow).toEqual(running.execution?.workflow);
      const manual = await writeConversationWorkflow(config, workspace, "manual_method", { runtime, templateId: "research" });
      expect(manual.runStartedAt).toBeNull();
      const manualRun = await bindProjectSessionExecution(config, workspace, "manual_method", { title: "Research", runtime, goal: "Compare options", workKind: "video" });
      expect(manualRun.execution?.workflow).toMatchObject({ templateId: "research", source: "manual", goal: "Compare options" });
      const explicit = await writeConversationWorkflow(config, workspace, "explicit_goal", { runtime, templateId: "general", goal: "User edited this goal" });
      const explicitRun = await bindProjectSessionExecution(config, workspace, "explicit_goal", { title: "Run", runtime, goal: "Incoming prompt", workKind: "video" });
      expect(explicitRun.execution?.workflow?.goal).toBe(explicit.execution?.workflow?.goal);
      await disposeWorkItemStore(config);
      expect((await readProjectSessionWorkItem(config, workspace.id, "first_video"))?.execution?.workflow).toEqual(running.execution?.workflow);
    } finally { await disposeWorkItemStore(config); }
  });

  test("first execution captures its goal and conservative kind hint without overriding chosen methods", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const runtime = { engineId: DEEPSEEK_HARNESS_ENGINE_ID, model: { providerId: "openai", modelId: "selected-model" }, mode: null, modelVariant: null };
    try {
      const ready = await bindConversationSession(config, workspace, "auto_video", { title: "New video", engineId: runtime.engineId });
      const first = await bindProjectSessionExecution(config, workspace, "auto_video", { title: "New video", runtime, goal: "制作30秒中文宣传片", workKind: "video" });
      expect(first).toMatchObject({ id: ready.id, status: "running", execution: { runtime, workflow: { templateId: "video", source: "auto", goal: "制作30秒中文宣传片", workKind: "video" } } });
      expect(first.execution?.workflow?.config.agents.length).toBeGreaterThan(1);
      expect(first.execution?.agent).toEqual(first.execution?.workflow?.config.agents.find((agent) => agent.id === first.execution?.workflow?.config.orchestration.entryAgentId));
      await finishProjectSessionExecution(config, workspace.id, "auto_video", { status: "done" });
      const continued = await bindProjectSessionExecution(config, workspace, "auto_video", { title: "Continue video", runtime, goal: "Follow-up message", workKind: "document" });
      expect(continued.execution?.workflow).toEqual(first.execution?.workflow);

      const discussion = await bindProjectSessionExecution(config, workspace, "discussion", { title: "Discuss implementation", runtime, goal: "讨论计数器的交互方式" });
      expect(discussion.execution?.workflow).toMatchObject({ templateId: "general", source: "auto", goal: "讨论计数器的交互方式" });
      const manual = await writeConversationWorkflow(config, workspace, "manual_video", { runtime, templateId: "video", goal: "Keep the chosen video goal" });
      const manualStarted = await bindProjectSessionExecution(config, workspace, "manual_video", { title: "Manual video", runtime, goal: "Different message", workKind: "development" });
      expect(manualStarted.execution?.workflow).toEqual(manual.execution?.workflow);
      const custom = await writeConversationWorkflow(config, workspace, "custom_method", { runtime, source: "custom", goal: "Keep existing goal" });
      const customStarted = await bindProjectSessionExecution(config, workspace, "custom_method", { title: "Custom", runtime, goal: "New request", workKind: "design" });
      expect(customStarted.execution?.workflow).toEqual(custom.execution?.workflow);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("partial progress updates preserve existing context and allow explicit clearing", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const runtime = { engineId: DEEPSEEK_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null };
    try {
      const running = await bindProjectSessionExecution(config, workspace, "partial_progress", { title: "Develop counter", runtime });
      const apply = (expectedVersion: number, progress: Parameters<typeof writeConversationWorkflow>[3]["progress"]) =>
        writeConversationWorkflow(config, workspace, "partial_progress", { runtime, expectedVersion, source: "auto", progress }, { allowRunning: true });
      const first = await apply(running.version, { summary: "Plan confirmed", decisions: ["Use a single HTML file"] });
      expect(first.execution?.workflow?.progress).toEqual({ summary: "Plan confirmed", decisions: ["Use a single HTML file"], outputs: [], blockers: [] });
      expect(first).toMatchObject({ id: running.id, status: "running", runStartedAt: running.runStartedAt, runCompletedAt: null });
      const recorded = await apply(first.version, { outputs: ["counter.html"], blockers: ["Playback needs verification"] });
      expect(recorded.execution?.workflow?.progress).toEqual({ summary: "Plan confirmed", decisions: ["Use a single HTML file"], outputs: ["counter.html"], blockers: ["Playback needs verification"] });
      const updated = await apply(recorded.version, { summary: "Implementation ready" });
      expect(updated.execution?.workflow?.progress).toEqual({ summary: "Implementation ready", decisions: ["Use a single HTML file"], outputs: ["counter.html"], blockers: ["Playback needs verification"] });
      const cleared = await apply(updated.version, { decisions: [], outputs: [], blockers: [] });
      expect(cleared.execution?.workflow?.progress).toEqual({ summary: "Implementation ready", decisions: [], outputs: [], blockers: [] });
      expect(cleared.version).toBe(updated.version + 1);
      expect(cleared.execution?.runtime).toEqual(running.execution?.runtime);
      expect(cleared.customFields.reviewedAt).toBeUndefined();
      await expect(apply(first.version, { summary: "Stale update" })).rejects.toBeInstanceOf(WorkItemConflictError);
      await disposeWorkItemStore(config);
      expect((await readProjectSessionWorkItem(config, workspace.id, "partial_progress"))?.execution?.workflow?.progress).toEqual(cleared.execution?.workflow?.progress);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("saved template versions remain independent of existing conversation snapshots", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const runtime = { engineId: DEFAULT_ENGINE_ID, model: null, mode: null, modelVariant: null };
    try {
      const original = await writeConversationWorkflow(config, workspace, "template_source", {
        runtime, templateId: "video", goal: "First video", progress: { summary: "Prepared first draft", decisions: [], outputs: [], blockers: [] },
      });
      const saved = await saveWorkTemplate(config, workspace, { sessionId: "template_source", name: "Product video", expectedVersion: 0 });
      const first = await writeConversationWorkflow(config, workspace, "first_video", { runtime, templateId: saved.id });
      expect(first.execution?.workflow?.templateVersion).toBe(1);
      expect(first.execution?.workflow?.progress).toBeUndefined();
      expect(first.execution?.workflow?.source).toBe("custom");
      if (!first.execution) throw new Error("Saved template execution required");
      expect(projectExecutionSystemContext(first.execution)).toContain(saved.config.agents[1].prompt);
      expect(projectExecutionSystemContext(first.execution)).not.toContain(`ipw-${saved.id}.plan`);
      expect(nativeWorkTemplateAgents().some((agent) => agent.name.startsWith(`ipw-${saved.id}.`))).toBe(false);
      await writeConversationWorkflow(config, workspace, "template_source", { runtime, expectedVersion: original.version, acceptance: ["Actual MP4 playback verified"] });
      const updated = await saveWorkTemplate(config, workspace, { sessionId: "template_source", templateId: saved.id, name: "Product video", expectedVersion: 1 });
      expect(updated).toMatchObject({ id: saved.id, version: 2, acceptance: ["Actual MP4 playback verified"] });
      expect((await readProjectSessionWorkItem(config, workspace.id, "first_video"))?.execution?.workflow).toEqual(first.execution?.workflow);
      const next = await writeConversationWorkflow(config, workspace, "second_video", { runtime, templateId: saved.id });
      expect(next.execution?.workflow).toMatchObject({ templateVersion: 2, acceptance: ["Actual MP4 playback verified"] });
      await expect(saveWorkTemplate(config, workspace, { sessionId: "template_source", templateId: saved.id, name: "Stale overwrite", expectedVersion: 1 })).rejects.toBeInstanceOf(WorkItemConflictError);
      const beforeRun = await listWorkTemplates(config, workspace);
      expect(beforeRun.stats.byTemplate).toEqual([]);
      const running = await bindProjectSessionExecution(config, workspace, "first_video", { title: "First video", runtime });
      await expect(writeConversationWorkflow(config, workspace, "first_video", { runtime, expectedVersion: running.version, source: "auto", templateId: "research" }, { allowRunning: true })).rejects.toBeInstanceOf(WorkItemConflictError);
      const refinedManual = await writeConversationWorkflow(config, workspace, "first_video", {
        runtime, expectedVersion: running.version, source: "auto", progress: { summary: "Producing video", decisions: [], outputs: [], blockers: [] },
      }, { allowRunning: true });
      expect(refinedManual.execution?.workflow).toMatchObject({ templateId: saved.id, source: "custom" });
      await expect(writeConversationWorkflow(config, workspace, "first_video", { runtime: { ...runtime, model: { providerId: "openai", modelId: "different" } }, expectedVersion: refinedManual.version }, { allowRunning: true })).rejects.toBeInstanceOf(WorkItemConflictError);
      const reviewed = await finishProjectSessionExecution(config, workspace.id, "first_video", { status: "done" });
      expect(reviewed?.status).toBe("review");
      expect((await listWorkTemplates(config, workspace)).stats.byTemplate).toEqual([{ templateId: saved.id, runs: 1, reviewedCompletions: 0 }]);
      if (!reviewed) throw new Error("Review task required");
      await updateWorkItem(config, workspace.id, reviewed.id, { expectedVersion: reviewed.version, status: "done" });
      expect((await listWorkTemplates(config, workspace)).stats).toMatchObject({
        byTemplate: [{ templateId: saved.id, runs: 1, reviewedCompletions: 1 }],
        byWorkKind: [{ workKind: "video", runs: 1, reviewedCompletions: 1 }],
      });
      const secondProject = { ...workspace, id: "project_two", name: "Another project" };
      config.workspaces.push(secondProject);
      expect((await readiPolloWorkWorkspaceConfig(config, workspace.id)).workTemplates).toBeUndefined();
      expect((await listWorkTemplates(config, secondProject)).templates).toContainEqual(updated);
      const reused = await writeConversationWorkflow(config, secondProject, "cross_project_video", { runtime, templateId: saved.id });
      expect(reused.execution?.workflow).toMatchObject({ templateId: saved.id, templateVersion: 2 });
      expect(reused.execution?.workflow?.progress).toBeUndefined();
      await bindProjectSessionExecution(config, secondProject, "cross_project_video", { title: "New project video", runtime });
      const secondReview = await finishProjectSessionExecution(config, secondProject.id, "cross_project_video", { status: "done" });
      if (!secondReview) throw new Error("Second project review required");
      await updateWorkItem(config, secondProject.id, secondReview.id, { expectedVersion: secondReview.version, status: "done" });
      for (const project of [workspace, secondProject]) {
        expect((await listWorkTemplates(config, project)).stats.byTemplate).toEqual([{ templateId: saved.id, runs: 2, reviewedCompletions: 2 }]);
      }
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("runtime refinement is versioned and preserves run state; tasks stay scoped", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    const runtime = { engineId: DEEPSEEK_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null };
    try {
      const running = await bindProjectSessionExecution(config, workspace, "scoped_session", { title: "Research", runtime });
      await expect(writeConversationWorkflow(config, workspace, "scoped_session", { runtime, templateId: "research" })).rejects.toBeInstanceOf(WorkItemConflictError);
      await expect(writeConversationWorkflow(config, workspace, "scoped_session", { runtime, templateId: "research" }, { allowRunning: true })).rejects.toBeInstanceOf(WorkItemConflictError);
      const refined = await writeConversationWorkflow(config, workspace, "scoped_session", {
        expectedVersion: running.version, runtime, templateId: "research", source: "auto", goal: "Compare products from primary evidence",
      }, { allowRunning: true });
      expect(refined).toMatchObject({ status: "running", runStartedAt: running.runStartedAt, runCompletedAt: null });
      expect(refined.id).toBe(running.id);
      await expect(writeConversationWorkflow(config, workspace, "scoped_session", { expectedVersion: running.version, runtime }, { allowRunning: true })).rejects.toBeInstanceOf(WorkItemConflictError);
      await expect(bindProjectSessionExecution(config, workspace, "scoped_session", { title: "Wrong engine", runtime: { ...runtime, engineId: DEFAULT_ENGINE_ID } })).rejects.toMatchObject({ code: "project_session_engine_changed" });
      const child = await createWorkItem(config, workspace.id, { title: "Verify sources", customFields: { conversationId: "scoped_session" } });
      await createWorkItem(config, workspace.id, { title: "Unrelated task" });
      await bindConversationSession(config, workspace, "other_session", { title: "Other conversation", engineId: DEFAULT_ENGINE_ID });
      expect((await listWorkItems(config, { workspaceIds: [workspace.id], sessionId: "scoped_session" })).items.map((item) => item.id).sort()).toEqual([running.id, child.id].sort());
      const resumed = await bindProjectSessionExecution(config, { ...workspace, engineId: DEFAULT_ENGINE_ID }, "scoped_session", { title: "Continue", runtime });
      expect(resumed.execution?.workflow).toEqual(refined.execution?.workflow);
      expect(resumed.execution?.runtime.engineId).toBe(DEEPSEEK_HARNESS_ENGINE_ID);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

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
      const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
      const unbound = await fetch(`${baseUrl}/workspace/project_one/sessions/session_video/workflow`, { headers });
      expect(await unbound.json()).toEqual({ item: null });
      const templates = await fetch(`${baseUrl}/workspace/project_one/work-templates`, { headers });
      expect(await templates.json()).toMatchObject({ templates: [
        { id: "general" }, { id: "video" }, { id: "design" }, { id: "development" }, { id: "research" }, { id: "document" },
      ], stats: { byTemplate: [], byWorkKind: [] } });
      const selected = await fetch(`${baseUrl}/workspace/project_one/sessions/session_video/workflow`, {
        method: "PUT", headers, body: JSON.stringify({ expectedVersion: 0, title: "Video work", templateId: "video", runtime: { engineId: DEEPSEEK_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null } }),
      });
      expect(selected.status).toBe(200);
      expect(await selected.json()).toMatchObject({ status: "ready", runStartedAt: null, execution: { workflow: { templateId: "video", config: { agents: [
        { id: "project-lead" }, { id: "plan" }, { id: "produce" }, { id: "verify" },
      ] } } } });
      const savedTemplate = await fetch(`${baseUrl}/workspace/project_one/work-templates`, {
        method: "POST", headers, body: JSON.stringify({ sessionId: "session_video", name: "Reusable product video", expectedVersion: 0 }),
      });
      expect(savedTemplate.status).toBe(201);
      expect(await savedTemplate.json()).toMatchObject({ version: 1, name: "Reusable product video", origin: "saved", workKind: "video" });

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
      expect(await listed.json()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ title: "Publish weekly report" })]) });
      const scoped = await fetch(`${baseUrl}/work-items?workspaceId=project_one&sessionId=session_video`, { headers });
      expect(await scoped.json()).toMatchObject({ items: [{ title: "Video work" }] });

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
      const runningUpdate = await fetch(`${baseUrl}/workspace/project_one/sessions/session_one/workflow`, {
        method: "PUT", headers, body: JSON.stringify({ templateId: "research", runtime: { engineId: DEFAULT_ENGINE_ID, model: null, mode: null, modelVariant: null } }),
      });
      expect(runningUpdate.status).toBe(409);

      const finished = await fetch(`${baseUrl}/workspace/project_one/project-sessions/session_one/execution`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "done", title: "Project conversation" }),
      });
      expect(finished.status).toBe(200);
      expect(await finished.json()).toMatchObject({ status: "review", runCompletedAt: expect.any(Number) });

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

  test("validates a work item batch before writing any of it", async () => {
    const { config } = await testContext();
    try {
      const startAt = new Date("2026-08-26T09:00:00.000Z").getTime();
      await expect(createWorkItems(config, "project_one", [
        { title: "Valid first task", startAt, dueAt: startAt + 60 * 60 * 1_000 },
        { title: "Invalid second task", startAt, dueAt: startAt - 1 },
      ])).rejects.toThrow("Due time cannot be earlier than start time");
      expect((await listWorkItems(config, { workspaceIds: ["project_one"] })).items).toEqual([]);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("dispatches due automatic work once and advances recurring schedules", async () => {
    const { config } = await testContext();
    try {
      const scheduledAt = new Date("2026-08-20T09:00:00.000Z").getTime();
      const dueAt = scheduledAt + 60 * 60 * 1_000;
      const now = scheduledAt + 5 * 60 * 1_000;
      const created = await createWorkItem(config, "project_one", {
        title: "Publish daily report",
        startAt: scheduledAt,
        dueAt,
        automation: {
          enabled: true,
          recurrence: "daily",
          model: { providerId: "openai", modelId: "gpt-test" },
        },
      });
      expect(created.status).toBe("ready");
      const dispatched: Array<{ id: string; model: { providerId: string; modelId: string } | null }> = [];
      const execution: ProjectSessionExecution = {
        sessionId: "session_scheduled",
        projectRevision: 1,
        projectGoal: "Publish reports",
        agent: {
          id: "project-lead",
          name: "Project lead",
          avatarSeed: "project-lead",
          role: "Own the report",
          prompt: "Complete the scheduled report.",
          skillIds: [],
          pluginIds: [],
          runtime: {
            engineId: DEFAULT_ENGINE_ID,
            model: { providerId: "openai", modelId: "gpt-test" },
            mode: "auto",
            modelVariant: null,
          },
        },
        runtime: {
          engineId: DEFAULT_ENGINE_ID,
          model: { providerId: "openai", modelId: "gpt-test" },
          mode: null,
          modelVariant: null,
        },
        boundAt: now,
      };

      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async (item) => {
          expect(item.status).toBe("running");
          const prompt = workItemAutomationPrompt(item);
          expect(prompt).toContain(`runKey: project_one:${created.id}:${scheduledAt}`);
          expect(prompt).toContain("stable operationKey");
          expect(workItemAutomationPrompt({ ...item, startAt: scheduledAt + 86_400_000 })).not.toBe(prompt);
          dispatched.push({ id: item.id, model: item.automation?.model ?? null });
          await startProjectSessionExecution(config, "project_one", item.title, execution);
          return execution.sessionId;
        },
      })).toBe(1);
      expect(dispatched).toEqual([{
        id: created.id,
        model: { providerId: "openai", modelId: "gpt-test" },
      }]);

      const updated = (await listWorkItems(config, { workspaceIds: ["project_one"] })).items
        .find((item) => item.id === created.id);
      expect(updated).toMatchObject({
        id: created.id,
        status: "running",
        automation: {
          enabled: true,
          recurrence: "daily",
          model: { providerId: "openai", modelId: "gpt-test" },
        },
        automationLastRunAt: now,
        automationLastSessionId: "session_scheduled",
        automationLastError: null,
        startAt: scheduledAt + 24 * 60 * 60 * 1_000,
        dueAt: dueAt + 24 * 60 * 60 * 1_000,
      });
      await finishProjectSessionExecution(config, "project_one", execution.sessionId, { status: "done" });
      const finished = (await listWorkItems(config, { workspaceIds: ["project_one"] })).items;
      expect(finished.find((item) => item.id === created.id)).toMatchObject({ status: "review" });
      expect(finished.find((item) => item.execution?.sessionId === execution.sessionId)).toMatchObject({ status: "review" });
      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async () => {
          throw new Error("must not run twice");
        },
      })).toBe(0);

      const queuedFailure = await createWorkItem(config, "project_one", {
        title: "Record a queued execution failure",
        startAt: scheduledAt,
        automation: { enabled: true, recurrence: "once" },
      });
      const failedExecution = { ...execution, sessionId: "session_queued_failure" };
      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async (item) => {
          await startProjectSessionExecution(config, "project_one", item.title, failedExecution);
          await finishProjectSessionExecution(config, "project_one", failedExecution.sessionId, {
            status: "failed",
            error: "Authentication expired",
          });
          return failedExecution.sessionId;
        },
      })).toBe(1);
      expect((await listWorkItems(config, { workspaceIds: ["project_one"] })).items
        .find((item) => item.id === queuedFailure.id)).toMatchObject({
        status: "failed",
        automationLastSessionId: failedExecution.sessionId,
        automationLastError: "Authentication expired",
      });
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("disables one-time automation after dispatch and backs off after failures", async () => {
    const { config } = await testContext();
    try {
      const scheduledAt = new Date("2026-08-20T09:00:00.000Z").getTime();
      const now = scheduledAt + 1_000;
      const oneTime = await createWorkItem(config, "project_one", {
        title: "Publish once",
        startAt: scheduledAt,
        automation: { enabled: true, recurrence: "once" },
      });
      expect(oneTime.status).toBe("ready");

      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async () => "session_once",
      })).toBe(1);
      expect((await listWorkItems(config, { workspaceIds: ["project_one"] })).items[0]).toMatchObject({
        id: oneTime.id,
        status: "running",
        startAt: scheduledAt,
        automation: { enabled: false, recurrence: "once" },
        automationLastRunAt: now,
        automationLastSessionId: "session_once",
      });

      const failing = await createWorkItem(config, "project_one", {
        title: "Retry later",
        startAt: scheduledAt,
        automation: { enabled: true, recurrence: "once" },
      });
      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        retryMs: 5_000,
        dispatch: async () => {
          throw new Error("Engine unavailable");
        },
      })).toBe(1);
      const failed = (await listWorkItems(config, { workspaceIds: ["project_one"] })).items
        .find((item) => item.id === failing.id);
      expect(failed).toMatchObject({
        status: "failed",
        automation: { enabled: true, recurrence: "once" },
        automationLastRunAt: null,
        automationLastSessionId: null,
        automationLastError: "Engine unavailable",
      });
      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async () => "too_soon",
      })).toBe(0);
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("preserves a user's automation change while a claimed task starts", async () => {
    const { config } = await testContext();
    try {
      const scheduledAt = new Date("2026-08-20T09:00:00.000Z").getTime();
      const now = scheduledAt + 1_000;
      const created = await createWorkItem(config, "project_one", {
        title: "Disable while starting",
        startAt: scheduledAt,
        automation: { enabled: true, recurrence: "daily" },
      });

      expect(await runDueWorkItemAutomationsOnce({
        config,
        now,
        dispatch: async (claimed) => {
          await updateWorkItem(config, "project_one", claimed.id, {
            expectedVersion: claimed.version,
            automation: { enabled: false, recurrence: "daily" },
          });
          return "session_in_flight";
        },
      })).toBe(1);
      const updated = (await listWorkItems(config, { workspaceIds: ["project_one"] })).items[0];
      expect(updated).toMatchObject({
        id: created.id,
        startAt: scheduledAt,
        automation: { enabled: false, recurrence: "daily" },
        automationLastRunAt: now,
        automationLastSessionId: "session_in_flight",
      });
    } finally {
      await disposeWorkItemStore(config);
    }
  });

  test("rejects task titles longer than the shared limit", async () => {
    const { config } = await testContext();
    try {
      await expect(createWorkItem(config, "project_one", {
        title: "x".repeat(WORK_ITEM_TITLE_MAX_LENGTH + 1),
      })).rejects.toThrow();
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

  test("transfers one work binding and its automation atomically while preserving fields and guarding old completion", async () => {
    const { config } = await testContext();
    const workspace = config.workspaces[0];
    if (!workspace) throw new Error("Workspace required");
    try {
      const original = await bindConversationSession(config, workspace, "original", { title: "Preserved work", engineId: DEFAULT_ENGINE_ID });
      const decorated = await updateWorkItem(config, workspace.id, original.id, { expectedVersion: original.version, priority: "urgent", customFields: { owner: "User" } });
      if (!decorated?.execution) throw new Error("Binding required");
      const scheduledAt = Date.now() - 1_000;
      const automation = await createWorkItem(config, workspace.id, { title: "Scheduled work", startAt: scheduledAt, automation: { enabled: true, recurrence: "once" } });
      expect(await runDueWorkItemAutomationsOnce({ config, now: scheduledAt + 1, dispatch: async () => "original" })).toBe(1);
      const occupied = await bindConversationSession(config, workspace, "occupied", { title: "Separate work", engineId: DEFAULT_ENGINE_ID });
      await expect(startProjectSessionExecution(config, workspace.id, decorated.title, { ...decorated.execution, sessionId: "occupied" }, { previousSessionId: "original" })).rejects.toThrow();
      expect(await readProjectSessionWorkItem(config, workspace.id, "original")).toEqual(decorated);
      expect(await readProjectSessionWorkItem(config, workspace.id, "occupied")).toEqual(occupied);
      expect((await listWorkItems(config, { workspaceIds: [workspace.id] })).items.find(item => item.id === automation.id)?.automationLastSessionId).toBe("original");
      const startedAt = Date.now() - 100;
      const transferred = await startProjectSessionExecution(config, workspace.id, decorated.title, { ...decorated.execution, sessionId: "replacement" }, { previousSessionId: "original", startedAt });
      expect(transferred).toMatchObject({ id: decorated.id, createdAt: decorated.createdAt, priority: "urgent", customFields: { owner: "User" }, status: "running", runStartedAt: startedAt, execution: { sessionId: "replacement", workflow: decorated.execution.workflow } });
      expect(await readProjectSessionWorkItem(config, workspace.id, "original")).toBeNull();
      expect((await listWorkItems(config, { workspaceIds: [workspace.id] })).items.find(item => item.id === automation.id)).toMatchObject({ status: "running", automationLastSessionId: "replacement" });
      expect(await finishProjectSessionExecution(config, workspace.id, "original", { status: "done" })).toBeNull();
      expect(await finishProjectSessionExecution(config, workspace.id, "replacement", { status: "done" }, { expectedRunStartedAt: startedAt - 1 })).toMatchObject({ status: "running" });
      expect(await finishProjectSessionExecution(config, workspace.id, "replacement", { status: "done" }, { expectedRunStartedAt: startedAt })).toMatchObject({ status: "review" });
      expect((await listWorkItems(config, { workspaceIds: [workspace.id] })).items.find(item => item.id === automation.id)?.status).toBe("review");
    } finally { await disposeWorkItemStore(config); }
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
      expect(completed).toMatchObject({ status: "review", lastError: null });

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

      const staleCompletion = await finishProjectSessionExecution(config, "project_one", baseExecution.sessionId, {
        status: "done",
      }, { expectedRunStartedAt: (restarted.runStartedAt ?? 0) - 1 });
      expect(staleCompletion).toMatchObject({ status: "running", version: restarted.version });

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
