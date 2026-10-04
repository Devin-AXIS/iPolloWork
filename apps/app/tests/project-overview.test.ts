import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOMParser } from "@xmldom/xmldom";
import { projectWorkspaceConfigSchema } from "@ipollowork/types/project-workspace";
import { DEFAULT_WORK_BOARD_CONFIG, projectExecutionSystemContext, type WorkItem } from "@ipollowork/types/work-items";
import { createiPolloWorkServerClient, type iPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";
import { t } from "../src/i18n";
import { loadProjectRuntimeMetrics } from "../src/react-app/domains/work/project-runtime-metrics";
import { ProjectBoard } from "../src/react-app/domains/work/project-board";
import { ProjectOrchestrationGraph } from "../src/react-app/domains/work/project-orchestration-graph";
import { ProjectDashboard } from "../src/react-app/domains/work/project-dashboard";
import { ProjectRuntimeData } from "../src/react-app/domains/work/project-runtime-data";
import type { ProjectRuntimeMetrics } from "../src/react-app/domains/work/project-runtime-metrics";
import { scopeProjectBuilderDraft } from "../src/react-app/domains/work/project-builder-session";
import { listEndpointWorkItems } from "../src/react-app/domains/work/work-endpoints";
import {
  formatWorkCalendarTime,
  formatWorkCalendarRange,
  searchWorkCalendarItems,
  snapWorkCalendarSlot,
  type WorkCalendarItem,
  workCalendarScheduleRange,
} from "../src/react-app/domains/work/work-calendar";

const runtimeMetricsSource = readFileSync(
  new URL("../src/react-app/domains/work/project-runtime-metrics.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const workCenterSource = readFileSync(
  new URL("../src/react-app/domains/work/work-center.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const projectBoardSource = readFileSync(
  new URL("../src/react-app/domains/work/project-board.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const appStylesSource = readFileSync(
  new URL("../src/app/index.css", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const workItemSheetSource = readFileSync(
  new URL("../src/react-app/domains/work/work-item-sheet.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const workCalendarSource = readFileSync(
  new URL("../src/react-app/domains/work/work-calendar.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const modelBehaviorMenuSource = readFileSync(
  new URL("../src/components/model-behavior-menu.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const pluginAuthorizationDialogSource = readFileSync(
  new URL("../src/components/plugin-authorization-dialog.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const pluginPackagesPanelSource = readFileSync(
  new URL("../src/react-app/domains/settings/plugin-packages-panel.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

describe("conversation work, runtime metrics and tasks", () => {
  test("keeps the portable project manifest free of plugin credentials", () => {
    const parsed = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      goal: "Publish the weekly briefing",
      agents: [{
        id: "editor",
        name: "Editor",
        avatarSeed: "editor",
        role: "Review copy",
        prompt: "Keep the article concise.",
        knowledgeSources: ["docs/style-guide.md"],
        skillIds: ["writing:review"],
        pluginIds: ["notion"],
        apiKey: "must-not-survive",
      }],
      orchestration: { entryAgentId: "editor" },
    });

    expect(parsed.agents[0]).not.toHaveProperty("apiKey");
    expect(parsed.agents[0]).not.toHaveProperty("knowledgeSources");
    expect(parsed.agents[0]?.pluginIds).toEqual(["notion"]);
    expect(parsed.dashboard.taskHealth.metrics).toEqual(["total", "waiting", "completed", "failureRate"]);
    expect(parsed.dashboard.usage.metrics).toEqual(["totalTokens", "conversations", "averageTokens", "agentUsage"]);
  });

  test("keeps dashboard metrics and task status meaning template-configurable", () => {
    const parsed = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [{ id: "editor", name: "Editor", avatarSeed: "editor" }],
      orchestration: { entryAgentId: "editor" },
      dashboard: {
        sections: ["health", "usage"],
        taskHealth: {
          metrics: ["completed", "total", "failureRate"],
          statusGroups: {
            waiting: ["queued"],
            active: ["writing", "reviewing"],
            completed: ["published"],
            failed: ["blocked"],
          },
        },
        usage: { metrics: ["conversations", "totalTokens"] },
      },
    });
    const duplicateStatus = projectWorkspaceConfigSchema.safeParse({
      ...parsed,
      dashboard: {
        ...parsed.dashboard,
        taskHealth: {
          ...parsed.dashboard.taskHealth,
          statusGroups: {
            ...parsed.dashboard.taskHealth.statusGroups,
            failed: ["published"],
          },
        },
      },
    });

    expect(parsed.dashboard.taskHealth.metrics).toEqual(["completed", "total", "failureRate"]);
    expect(parsed.dashboard.usage.metrics).toEqual(["conversations", "totalTokens"]);
    expect(parsed.dashboard.taskHealth.statusGroups.completed).toEqual(["published"]);
    expect(duplicateStatus.success).toBe(false);
  });

  test("stores a model-native reasoning variant instead of a fixed effort enum", () => {
    const parsed = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [{
        id: "editor",
        name: "Editor",
        avatarSeed: "editor",
        runtime: {
          engineId: null,
          model: { providerId: "openai", modelId: "gpt-5.6" },
          mode: "auto",
          modelVariant: "xhigh",
        },
      }],
      orchestration: { entryAgentId: "editor" },
    });

    expect(parsed.agents[0]?.runtime.modelVariant).toBe("xhigh");
    expect(parsed.agents[0]?.runtime).not.toHaveProperty("reasoningEffort");
  });

  test("rejects an entry Agent that is not part of the project", () => {
    const result = projectWorkspaceConfigSchema.safeParse({
      schemaVersion: 1,
      agents: [{ id: "editor", name: "Editor", avatarSeed: "editor" }],
      orchestration: { entryAgentId: "publisher" },
    });

    expect(result.success).toBe(false);
  });

  test("keeps orchestration relations typed and rejects invented Agent references", () => {
    const parsed = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [
        { id: "editor", name: "Editor", avatarSeed: "editor" },
        { id: "publisher", name: "Publisher", avatarSeed: "publisher" },
      ],
      orchestration: {
        entryAgentId: "editor",
        relations: [{ sourceAgentId: "editor", targetAgentId: "publisher", type: "dependency" }],
      },
    });
    const invalid = projectWorkspaceConfigSchema.safeParse({
      ...parsed,
      orchestration: {
        ...parsed.orchestration,
        relations: [{ sourceAgentId: "editor", targetAgentId: "missing", type: "parallel" }],
      },
    });

    expect(parsed.orchestration.relations).toEqual([{
      sourceAgentId: "editor",
      targetAgentId: "publisher",
      type: "dependency",
      label: "",
    }]);
    expect(invalid.success).toBe(false);
  });

  test("attributes real conversation tokens through immutable project execution bindings", async () => {
    const client = {
      listSessions: async () => ({ items: [
        { id: "one", agent: "editor", title: "Edit the report", time: { created: 1, updated: 1 }, tokens: { input: 80, output: 20, reasoning: 0 } },
        { id: "child-data", parentID: "one", agent: "general", title: "Generic child session", time: { created: 2, updated: 2 }, tokens: { input: 150, output: 50, reasoning: 0 } },
        { id: "two", agent: "native-build", title: "Unrelated", time: { created: 3, updated: 3 }, tokens: { input: 30, output: 10, reasoning: 10 } },
      ] }),
      getSessionMessages: async (_workspaceId: string, sessionId: string) => ({ items: sessionId === "one" ? [{
        parts: [{
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "阶段二：指标与趋势分析",
              prompt: "你是新媒体分析工作台的数据分析专员。",
            },
            output: '<task id="child-data" state="completed">',
          },
        }],
      }] : [] }),
    } as unknown as iPolloWorkServerClient;

    const config = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [
        { id: "editor", name: "Editor", avatarSeed: "editor" },
        { id: "data-analyst", name: "数据分析师", avatarSeed: "data-analyst" },
      ],
      orchestration: { entryAgentId: "editor" },
    });
    const agent = config.agents[0];
    if (!agent) throw new Error("Editor Agent fixture is missing");
    const metrics = await loadProjectRuntimeMetrics({
      client,
      workspaceId: "workspace",
      agents: config.agents,
      items: [{
        id: "work_one",
        workspaceId: "workspace",
        title: "Edit the report",
        description: null,
        status: "done",
        assignee: "editor",
        priority: "normal",
        startAt: null,
        dueAt: null,
        position: 1,
        customFields: {},
        execution: {
          sessionId: "one",
          projectRevision: 1,
          projectGoal: "Publish the report",
          agent,
          runtime: { engineId: "opencode", model: null, mode: "build", modelVariant: null },
          boundAt: 1,
        },
        lastError: null,
        runStartedAt: 1,
        runCompletedAt: 2,
        version: 2,
        createdAt: 1,
        updatedAt: 2,
      }],
    });

    expect(metrics.conversationCount).toBe(2);
    expect(metrics.totalTokens).toBe(300);
    expect(metrics.averageTokensPerConversation).toBe(150);
    expect(metrics.sessionUsage).toEqual([
      { sessionId: "one", title: "Edit the report", tokens: 100, isMain: true },
      { sessionId: "child-data", title: "阶段二：指标与趋势分析", tokens: 200, isMain: false },
    ]);
    expect(metrics.agents[0]).toMatchObject({ tokens: 100, conversationCount: 1, attributed: true });
    expect(metrics.agents[1]).toMatchObject({
      tokens: 200,
      conversationCount: 1,
      attributed: true,
      executions: { running: 0, completed: 1, failed: 0 },
      recentConversation: {
        sessionId: "child-data",
        title: "阶段二：指标与趋势分析",
        status: "completed",
      },
    });
    expect(metrics.unattributedTokens).toBe(0);
    expect(metrics.status).toBe("complete");
    expect(metrics.executionRecords).toEqual([expect.objectContaining({
      sessionId: "child-data",
      rootSessionId: "one",
      rootTaskId: "work_one",
      agentId: "data-analyst",
      title: "阶段二：指标与趋势分析",
      status: "completed",
      tokens: 200,
    })]);
  });

  test("discovers native collaboration children from real spawn history and preserves their actual outcomes", async () => {
    const config = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [
        { id: "editor", name: "Editor", avatarSeed: "editor" },
        { id: "researcher", name: "Researcher", avatarSeed: "researcher" },
      ],
      orchestration: { entryAgentId: "editor" },
    });
    const session = (id: string, updated: number) => ({
      id, title: id, engineId: "codex-harness", time: { created: 1, updated },
    });
    const nativePart = (id: string, tool: string, status: string, prompt: string | null = null, parentSessionId = "root") => ({
      type: "tool", tool: "task",
      state: {
        status: "completed",
        input: { prompt },
        output: `<task id="${id}">`,
        metadata: {
          sessionId: id, nativeTool: tool, delegationStatus: status,
          ...(tool === "spawnAgent" ? { parentSessionId } : {}),
        },
      },
    });
    const requested: string[] = [];
    const client = {
      listSessions: async () => ({ items: [
        session("root", 1), session("nested", 2), session("complete", 3), session("failed", 4), session("running", 5), session("unrelated", 6),
      ] }),
      getSessionMessages: async (_workspaceId: string, sessionId: string) => {
        requested.push(sessionId);
        return { items: sessionId === "root" ? [{ parts: [
          nativePart("complete", "spawnAgent", "running", "[project-agent:researcher] Verify sources."),
          nativePart("failed", "spawnAgent", "running", "[project-agent:researcher] Verify numbers."),
          nativePart("running", "spawnAgent", "running", "[project-agent:researcher] Keep researching."),
          nativePart("complete", "wait", "completed"),
          nativePart("failed", "wait", "failed"),
          nativePart("complete", "closeAgent", "unknown"),
          nativePart("unrelated", "sendMessage", "completed", "[project-agent:researcher] Another root owns this agent."),
          nativePart("not-listed", "spawnAgent", "completed", "[project-agent:researcher] No session metadata exists."),
        ] }] : sessionId === "running" ? [{ parts: [
          nativePart("nested", "spawnAgent", "completed", "[project-agent:researcher] Check a supporting source.", "running"),
        ] }] : [] };
      },
    } as unknown as iPolloWorkServerClient;
    const metrics = await loadProjectRuntimeMetrics({
      client, workspaceId: "workspace", agents: config.agents,
      items: [{
        id: "bound-root", title: "Verified report",
        execution: {
          sessionId: "root", projectRevision: 1, projectGoal: "Report", agent: config.agents[0],
          runtime: { engineId: "codex-harness", model: null, mode: null, modelVariant: null }, boundAt: 1,
        },
      }] as Parameters<typeof loadProjectRuntimeMetrics>[0]["items"],
    });
    expect(metrics.conversationCount).toBe(5);
    expect(metrics.agents[1]?.executions).toEqual({ running: 1, completed: 2, failed: 1 });
    expect(metrics.executionRecords).toEqual([
      expect.objectContaining({ sessionId: "running", rootSessionId: "root", agentId: "researcher", status: "running" }),
      expect.objectContaining({ sessionId: "failed", rootTaskId: "bound-root", status: "failed" }),
      expect.objectContaining({ sessionId: "complete", status: "completed" }),
      expect.objectContaining({ sessionId: "nested", rootSessionId: "root", status: "completed" }),
    ]);
    expect(requested.sort()).toEqual(["complete", "failed", "nested", "root", "running"]);
    expect(metrics.totalTokens).toBeNull();
    expect(metrics.sessionUsage).toHaveLength(5);
    expect(metrics.sessionUsage.every(usage => usage.tokens === null)).toBe(true);
  });

  test("retains native activity without role markers and leaves its usage unattributed", async () => {
    const config = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      agents: [
        { id: "editor", name: "Editor", avatarSeed: "editor" },
        { id: "implementation", name: "Implementation", avatarSeed: "implementation" },
        { id: "acceptance", name: "Acceptance", avatarSeed: "acceptance" },
      ],
      orchestration: {
        entryAgentId: "editor",
        relations: [
          { sourceAgentId: "editor", targetAgentId: "implementation", type: "dependency" },
          { sourceAgentId: "implementation", targetAgentId: "acceptance", type: "dependency" },
        ],
      },
    });
    const editor = config.agents[0];
    if (!editor) throw new Error("Editor agent fixture is missing");
    const session = (id: string, title: string, tokens: number, parentID?: string) => ({
      id, title, engineId: "codex-harness", directory: "/project", parentID,
      time: { created: 1, updated: 2 }, totalTokens: tokens,
    });
    // These are the canonical parts produced by real SubAgentActivity events:
    // their input contains a native path, with no prompt or project-role marker.
    const nativePart = (id: string, path: string, kind: string) => ({
      type: "tool", tool: "task",
      state: {
        status: kind === "completed" ? "completed" : "running",
        input: { description: path, task_id: id },
        output: `<task id="${id}" state="${kind === "completed" ? "completed" : "running"}"></task>`,
        metadata: { sessionId: id, parentSessionId: "root", nativeTool: "subAgentActivity", nativeKind: kind, delegationStatus: kind === "completed" ? "completed" : "running" },
      },
    });
    const originalFetch = globalThis.fetch;
    let namedWorkers = false;
    let markedWorkers = false;
    const fetchMock: typeof fetch = async (input) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/sessions")) return Response.json({ items: [
        // A native total takes precedence over overlapping input/cache/reasoning counters.
        { ...session("root", "Work", 100), tokens: { input: 80, output: 20, reasoning: 10, cache: { read: 70, write: 0 } } },
        { ...session("advice", "Implementation", 50, "root"), codex: { status: "idle", subagent: true, agentRole: "worker" } },
        session("check", "Acceptance", 30),
        session("check", "Acceptance", 30),
        session("unproven", "Unrelated", 70),
        { ...session("user-fork", "A user-created fork", 90, "root"), codex: { status: "idle", subagent: false } },
      ] });
      return Response.json({ items: pathname.endsWith("/root/messages") ? [{ parts: [
        nativePart("advice", namedWorkers ? "/root/ipw-development.implementation__scene_02" : "/root/implementation_advice", "started"),
        nativePart("check", namedWorkers ? "/root/ipw-development.implementation/scene_04" : "/root/independent_acceptance", "started"),
        nativePart("advice", namedWorkers ? "/root/ipw-development.implementation__scene_02" : "/root/implementation_advice", "completed"),
        nativePart("check", namedWorkers ? "/root/ipw-development.implementation/scene_04" : "/root/independent_acceptance", "completed"),
        nativePart("unproven", "/root/unrelated", "interacted"),
      ] }] : markedWorkers && pathname.endsWith("/advice/messages") ? [{
        info: { role: "assistant" }, parts: [{ type: "text", text: "[project-agent:implementation] Current preset review result." }],
      }] : [] });
    };
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
    try {
      const items: WorkItem[] = [{
          id: "bound-root", workspaceId: "workspace", title: "Native work", description: null,
          status: "review", assignee: "editor", priority: "normal", startAt: null, dueAt: null,
          automation: null, automationLastRunAt: null, automationLastSessionId: null, automationLastError: null,
          position: 1, customFields: {}, lastError: null, runStartedAt: 1, runCompletedAt: 2,
          version: 1, createdAt: 1, updatedAt: 2,
          execution: { sessionId: "root", projectRevision: 1, projectGoal: "Verify native work", agent: editor, runtime: { engineId: "codex-harness", model: null, mode: null, modelVariant: null }, boundAt: 1 },
        }];
      const metrics = await loadProjectRuntimeMetrics({
        client: createiPolloWorkServerClient({ baseUrl: "https://ipollowork.test" }),
        workspaceId: "workspace", agents: config.agents,
        items,
      });
      expect(metrics.executionRecords).toEqual([
        expect.objectContaining({ sessionId: "advice", rootSessionId: "root", agentId: null, agentName: null, title: "/root/implementation_advice", status: "completed", tokens: 50 }),
        expect.objectContaining({ sessionId: "check", rootSessionId: "root", agentId: null, agentName: null, title: "/root/independent_acceptance", status: "completed", tokens: 30 }),
      ]);
      expect(metrics.conversationCount).toBe(3);
      expect(metrics.totalTokens).toBe(180);
      expect(metrics.attributedTokens).toBe(100);
      expect(metrics.unattributedTokens).toBe(80);
      expect(metrics.status).toBe("complete");
      expect(metrics.sessionUsage).toEqual([
        { sessionId: "root", title: "Work", tokens: 100, isMain: true },
        { sessionId: "advice", title: "/root/implementation_advice", tokens: 50, isMain: false },
        { sessionId: "check", title: "/root/independent_acceptance", tokens: 30, isMain: false },
      ]);
      expect(metrics.agents.slice(1).every((agent) => agent.conversationCount === 0 && agent.tokens === 0)).toBe(true);
      namedWorkers = true;
      const attributed = await loadProjectRuntimeMetrics({
        client: createiPolloWorkServerClient({ baseUrl: "https://ipollowork.test" }),
        workspaceId: "workspace", agents: config.agents, items,
      });
      expect(attributed.agents.find((agent) => agent.agentId === "implementation"))
        .toMatchObject({ conversationCount: 2, tokens: 80, executions: { running: 0, completed: 2, failed: 0 } });
      namedWorkers = false;
      markedWorkers = true;
      const customized = await loadProjectRuntimeMetrics({
        client: createiPolloWorkServerClient({ baseUrl: "https://ipollowork.test" }),
        workspaceId: "workspace", agents: config.agents, items,
      });
      expect(customized.executionRecords).toEqual([
        expect.objectContaining({ sessionId: "advice", agentId: "implementation", status: "completed" }),
        expect.objectContaining({ sessionId: "check", agentId: null, status: "completed" }),
      ]);
      const graphHtml = renderToStaticMarkup(createElement(ProjectOrchestrationGraph, {
        config, items, runtimeMetrics: metrics,
      }));
      const graphDocument = new DOMParser().parseFromString(graphHtml, "text/html");
      const nodes = Array.from(graphDocument.getElementsByTagName("button"))
        .filter((node) => node.getAttribute("data-testid") === "project-orchestration-agent");
      expect(nodes).toHaveLength(3);
      const editorNode = nodes.find((node) => node.getAttribute("data-agent-id") === "editor");
      expect(editorNode?.textContent).toContain("Editor");
      expect(editorNode?.textContent).toContain("1");
      const specialistNodes = nodes.filter((node) => node.getAttribute("data-agent-id") !== "editor");
      expect(specialistNodes.every((node) => node.textContent?.includes("0"))).toBe(true);
      expect(nodes.every((node) => node.getElementsByTagName("svg").length > 0)).toBe(true);
      const edges = Array.from(graphDocument.getElementsByTagName("path"))
        .filter((edge) => edge.hasAttribute("data-edge-source"));
      expect(edges.map((edge) => [edge.getAttribute("data-edge-source"), edge.getAttribute("data-edge-target")]))
        .toEqual([["editor", "implementation"], ["implementation", "acceptance"]]);
      expect(nodes.every((node) => node.hasAttribute("disabled"))).toBe(true);
      expect(graphHtml).not.toContain("/root/implementation_advice");
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });

  test("restored dashboard uses distinct native sessions for health, activity and role summaries", () => {
    const config = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1, goal: "Ship the current conversation result",
      agents: [
        { id: "lead", name: "Coordinator", avatarSeed: "lead", role: "Coordinate the result" },
        { id: "worker", name: "Worker", avatarSeed: "worker", role: "Implement the result", pluginIds: [], skillIds: ["verify"] },
      ],
      orchestration: { entryAgentId: "lead" },
    });
    const [lead, worker] = config.agents;
    if (!lead || !worker) throw new Error("Missing conversation team");
    const item = (id: string, status: string, agent: typeof lead): WorkItem => ({
      id, workspaceId: "workspace", title: id, description: null, status, assignee: agent.id,
      priority: "normal", startAt: null, dueAt: null, automation: null,
      automationLastRunAt: null, automationLastSessionId: null, automationLastError: null,
      position: 1, customFields: {}, lastError: null, runStartedAt: 1, runCompletedAt: 2,
      version: 1, createdAt: 1, updatedAt: 2,
      execution: { sessionId: id, projectRevision: 1, projectGoal: config.goal, agent, runtime: { engineId: "codex-harness", model: null, mode: null, modelVariant: null }, boundAt: 1 },
    });
    const child = { sessionId: "Bound child", rootSessionId: "Root", rootTaskId: "Root", rootTaskTitle: "Root", agentId: "worker", agentName: "Worker", title: "Bound child", status: "completed", tokens: 100, startedAt: 1, updatedAt: 2 } satisfies ProjectRuntimeMetrics["executionRecords"][number];
    const metrics: ProjectRuntimeMetrics = {
      conversationCount: 4, meteredConversationCount: 4, totalTokens: 400,
      averageTokensPerConversation: 100, attributedTokens: 300, unattributedTokens: 100,
      status: "partial", unmeteredConversationCount: 0,
      agents: [
        { agentId: "lead", conversationCount: 1, tokens: 100, attributed: true, executions: { running: 0, completed: 0, failed: 0 }, recentConversation: null },
        { agentId: "worker", conversationCount: 2, tokens: 200, attributed: true, executions: { running: 1, completed: 1, failed: 0 }, recentConversation: { sessionId: "Native live", title: "Native live", updatedAt: 3, status: "running" } },
      ],
      sessionUsage: [
        { sessionId: "Root", title: "Root", tokens: 100, isMain: true },
        { sessionId: "Bound child", title: "Bound child", tokens: 100, isMain: false },
        { sessionId: "Native finished", title: "Native finished", tokens: 100, isMain: false },
        { sessionId: "Native live", title: "Native live", tokens: 100, isMain: false },
      ],
      executionRecords: [
        child, child,
        { ...child, sessionId: "Native finished", agentId: null, agentName: null, title: "Native finished", updatedAt: 4 },
        { ...child, sessionId: "Native live", title: "Native live", status: "running", updatedAt: 3 },
      ],
    };
    const dashboardProps = {
      projectName: "Conversation result", config, showPresets: true,
      items: [item("Root", "review", lead), item("Bound child", "done", worker)],
      board: { workspaceId: "workspace", columns: DEFAULT_WORK_BOARD_CONFIG.columns.map((column) => ({ ...column, label: t(`work.status.${column.id}`) })), fields: DEFAULT_WORK_BOARD_CONFIG.fields, version: 0, updatedAt: null },
      plugins: [], authorizations: {}, runtimeMetrics: metrics, runtimeMetricsLoading: false,
      runtimeMetricsError: false, onOpenTasks: () => {}, onOpenAgent: () => {}, onAddAgent: () => {},
      executionHref: (record) => `#/workspace/workspace/session/${record.sessionId}`,
      headerControls: createElement("button", {}, "Work method"),
      healthContent: createElement("p", {}, "Current progress summary"),
      footerContent: createElement("details", {}, "Acceptance conditions"),
    } satisfies Parameters<typeof ProjectDashboard>[0];
    const html = renderToStaticMarkup(createElement(ProjectDashboard, dashboardProps));
    const document = new DOMParser().parseFromString(html, "text/html");
    const health = Array.from(document.getElementsByTagName("section"))
      .find((section) => section.getAttribute("data-testid") === "project-task-health");
    if (!health) throw new Error("Missing restored task health card");
    const valueFor = (label: string) => Array.from(health.getElementsByTagName("div"))
      .find((element) => element.textContent === label)?.parentNode?.firstChild?.textContent;
    expect(valueFor(t("project_overview.total_tasks"))).toBe("4");
    expect(valueFor(t("project_overview.completed_tasks"))).toBe("2");
    expect(health.textContent).toContain("50%");
    expect(health.textContent).toContain("Current progress summary");
    const nativeRows = Array.from(document.getElementsByTagName("div"))
      .filter((row) => row.getAttribute("data-testid") === "conversation-delegation");
    expect(nativeRows).toHaveLength(2);
    const finished = nativeRows.find((row) => row.textContent?.includes("Native finished"));
    expect(finished?.textContent).toContain(t("work.status.done"));
    expect(finished?.textContent).toContain(t("conversation_work.engine_created_agent"));
    const nativeAgents = Array.from(document.getElementsByTagName("a"))
      .filter((row) => row.getAttribute("data-testid") === "project-native-agent");
    expect(nativeAgents).toHaveLength(1);
    expect(nativeAgents[0]?.getAttribute("href")).toBe("#/workspace/workspace/session/Native finished");
    expect(nativeAgents[0]?.textContent).toContain("Native finished");
    expect(nativeAgents[0]?.textContent).toContain(t("work.status.done"));
    expect(nativeAgents[0]?.textContent).toContain(t("conversation_work.engine_created_agent"));
    expect(config.agents.map((agent) => agent.id)).toEqual(["lead", "worker"]);
    const workerRow = Array.from(document.getElementsByTagName("button"))
      .find((button) => button.getAttribute("data-testid") === "project-agent-tab" && button.textContent?.includes("Worker"));
    if (!workerRow) throw new Error("Missing worker activity panel");
    const taskSummary = Array.from(workerRow.getElementsByTagName("span"))
      .find((span) => span.getAttribute("data-testid") === "project-agent-task-summary");
    if (!taskSummary) throw new Error("Missing worker task distribution");
    const countFor = (label: string) => Array.from(taskSummary.getElementsByTagName("span"))
      .find((span) => span.getAttribute("title") === label)?.lastChild?.textContent;
    expect(countFor(t("project_overview.active_tasks"))).toBe("1");
    expect(countFor(t("project_overview.completed_tasks"))).toBe("1");
    expect(workerRow.textContent).toContain("Native live");
    expect(workerRow.hasAttribute("disabled")).toBe(false);
    expect(html).toContain("Work method");
    expect(html).toContain("Acceptance conditions");
    const actualOnly = renderToStaticMarkup(createElement(ProjectDashboard, {
      ...dashboardProps,
      config: { ...config, agents: [...config.agents, { ...worker, id: "unused", name: "Unused preset", pluginIds: ["missing-plugin"] }] },
      showPresets: undefined, mainSessionId: "Root", mainEngineName: "Codex",
    }));
    const actualDocument = new DOMParser().parseFromString(actualOnly, "text/html");
    const actualRows = Array.from(actualDocument.getElementsByTagName("a"))
      .filter((row) => row.getAttribute("data-testid") === "project-native-agent");
    expect(actualRows.map((row) => row.getAttribute("data-session-id"))).toEqual(["Bound child", "Native finished", "Native live"]);
    expect(actualRows.every((row) => row.getAttribute("href")?.endsWith(row.getAttribute("data-session-id")))).toBe(true);
    expect(actualRows.every((row) => Array.from(row.getElementsByTagName("span")).some((span) => span.getAttribute("data-avatar-seed") === row.getAttribute("data-session-id")))).toBe(true);
    expect(actualOnly).toContain('data-testid="project-primary-agent"');
    expect(actualOnly).toContain("Codex");
    expect(actualOnly).not.toContain("Unused preset");
    expect(actualOnly).not.toContain('data-testid="project-agent-tab"');
    expect(actualOnly).not.toContain('data-testid="project-orchestration-graph"');
    expect(actualOnly).not.toContain(t("project_overview.add_agent"));
    expect(actualOnly).not.toContain(t("project_overview.health_setup"));
  });

  test("runtime data meters actual main and temporary children without collapsing unknown roles", () => {
    const metrics: ProjectRuntimeMetrics = {
      conversationCount: 3, meteredConversationCount: 3, totalTokens: 300,
      averageTokensPerConversation: 100, attributedTokens: 200, unattributedTokens: 100,
      status: "complete", unmeteredConversationCount: 0, agents: [], executionRecords: [],
      sessionUsage: [
        { sessionId: "main", title: "Make the film", tokens: 100, isMain: true },
        { sessionId: "named", title: "Content review", tokens: 100, isMain: false },
        { sessionId: "temporary", title: "Independent timing review", tokens: 100, isMain: false },
      ],
    };
    const render = (usage: ProjectRuntimeMetrics) => renderToStaticMarkup(createElement(ProjectRuntimeData, {
      displayMetrics: ["totalTokens", "conversations", "agentUsage"],
      metrics: usage, loading: false, error: false,
    }));
    const html = render(metrics);
    const document = new DOMParser().parseFromString(html, "text/html");
    const rows = Array.from(document.getElementsByTagName("div")).filter(row => row.getAttribute("data-testid") === "project-agent-usage-row");
    expect(rows).toHaveLength(3);
    for (const usage of metrics.sessionUsage) {
      const row = rows.find(row => row.getAttribute("data-session-id") === usage.sessionId);
      expect(row?.getAttribute("data-token-count")).toBe("100");
      expect(row?.textContent).toContain("33%");
      expect(row?.getElementsByTagName("span")[1]?.getAttribute("data-avatar-seed")).toBe(usage.sessionId);
    }
    expect(html).toContain(t("conversation_work.runtime_scope"));
    expect(html).toContain("Independent timing review");
    expect(html).not.toContain(t("project_overview.not_attributed"));
    const unmetered = render({ ...metrics, totalTokens: 200, meteredConversationCount: 2, unmeteredConversationCount: 1, status: "partial",
      sessionUsage: metrics.sessionUsage.map(usage => usage.sessionId === "temporary" ? { ...usage, tokens: null } : usage),
    });
    const unmeteredDocument = new DOMParser().parseFromString(unmetered, "text/html");
    const missing = Array.from(unmeteredDocument.getElementsByTagName("div")).find(row => row.getAttribute("data-session-id") === "temporary");
    expect(unmetered).toContain(t("project_overview.runtime_data_partial", { count: 1 }));
    expect(missing?.getAttribute("data-metered")).toBe("false");
    expect(missing?.hasAttribute("data-token-count")).toBe(false);
    expect(missing?.textContent).toContain(t("project_overview.token_unmetered"));
    expect(missing?.textContent).not.toContain("0%");
  });

  test("renders native task cards as openable and resolves only known owner IDs", () => {
    const item = (id: string, assignee: string): WorkItem => ({
      id, workspaceId: "workspace", title: id, description: null, status: "done", assignee,
      priority: "normal", startAt: null, dueAt: null, automation: null,
      automationLastRunAt: null, automationLastSessionId: null, automationLastError: null,
      position: 1, customFields: {}, execution: null, lastError: null,
      runStartedAt: 1, runCompletedAt: 2, version: 1, createdAt: 1, updatedAt: 2,
    });
    const coordinator = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1, agents: [{ id: "project-lead", name: "Native coordinator", avatarSeed: "preset-avatar" }],
      orchestration: { entryAgentId: "project-lead" },
    }).agents[0];
    if (!coordinator) throw new Error("Missing task executor fixture");
    const html = renderToStaticMarkup(createElement(ProjectBoard, {
      items: [
        { key: "root", projectName: "Project", item: item("Root", "project-lead") },
        { key: "unknown", projectName: "Project", item: item("External", "custom-owner") },
        { key: "bound-main", projectName: "Project", item: { ...item("Bound main task", "project-lead"), execution: {
          sessionId: "actual-main-session", projectRevision: 1, projectGoal: "Film", agent: coordinator,
          runtime: { engineId: "codex-harness", model: null, mode: null, modelVariant: null }, boundAt: 1,
        } } },
        { key: "child", projectName: "Project", item: item("Native child", "Role not linked"), executionRecord: {
          sessionId: "child", rootSessionId: "root", rootTaskId: "Root", rootTaskTitle: "Root",
          agentId: null, agentName: null, title: "Native child", status: "completed",
          tokens: null, startedAt: 1, updatedAt: 2,
        } },
      ],
      board: { workspaceId: "workspace", columns: DEFAULT_WORK_BOARD_CONFIG.columns, fields: DEFAULT_WORK_BOARD_CONFIG.fields, version: 0, updatedAt: null },
      agents: [{ id: "project-lead", name: "Development" }],
      panEnabled: false, moving: false, onMove: () => {}, onOpen: () => {}, onCreate: () => {},
    }));
    const document = new DOMParser().parseFromString(html, "text/html");
    const card = Array.from(document.getElementsByTagName("article")).find((entry) => entry.getAttribute("data-testid") === "project-runtime-task");
    expect(card?.getElementsByTagName("button")[0]?.hasAttribute("disabled")).toBe(false);
    expect(card?.textContent).toContain("Native child");
    expect(card?.textContent).not.toContain("Role not linked");
    const avatar = Array.from(card?.getElementsByTagName("span") ?? []).find(span => span.hasAttribute("data-avatar-seed"));
    expect(avatar?.getAttribute("data-avatar-seed")).toBe("child");
    expect(avatar?.getAttribute("class")).toContain("size-9");
    const unboundCard = Array.from(document.getElementsByTagName("article")).find(entry => entry.textContent?.includes("External"));
    expect(Array.from(unboundCard?.getElementsByTagName("span") ?? []).some(span => span.hasAttribute("data-avatar-seed"))).toBe(false);
    const mainCard = Array.from(document.getElementsByTagName("article")).find(entry => entry.textContent?.includes("Bound main task"));
    expect(Array.from(mainCard?.getElementsByTagName("span") ?? []).find(span => span.hasAttribute("data-avatar-seed"))?.getAttribute("data-avatar-seed")).toBe("actual-main-session");
    expect(mainCard?.textContent).toContain("Native coordinator");
    expect(html).not.toContain("preset-avatar");
    expect(html).toContain("Development");
    expect(html).not.toContain("project-lead");
    expect(html).toContain("custom-owner");
  });

  test("keeps Project Builder capability scoped while preserving another selected capability", () => {
    const scoped = scopeProjectBuilderDraft({
      mode: "prompt",
      parts: [],
      attachments: [],
      text: "Improve the editor",
      capability: { id: "another-capability", instruction: "Keep this instruction." },
    }, "Media Desk", "session_media_builder");

    expect(scoped.capability?.id).toBe("another-capability+project-builder");
    expect(scoped.capability?.instruction).toContain("Keep this instruction.");
    expect(scoped.capability?.instruction).toContain("ipollowork_project_read");
    expect(scoped.capability?.instruction).toContain('Pass sessionId "session_media_builder"');
    expect(scoped.capability?.instruction).toContain("only after the user clearly confirms");
  });

  test("injects the bound project Agent identity and resources into normal task execution", () => {
    const agent = projectWorkspaceConfigSchema.parse({
      schemaVersion: 1,
      goal: "Publish a verified report",
      agents: [{
        id: "editor",
        name: "Editor",
        avatarSeed: "editor",
        role: "Review every claim",
        prompt: "Reject unsupported claims.",
        skillIds: ["writing:review"],
        pluginIds: ["notion"],
      }],
      orchestration: { entryAgentId: "editor" },
    }).agents[0];
    if (!agent) throw new Error("Editor Agent fixture is missing");
    const context = projectExecutionSystemContext({
      sessionId: "session_one",
      projectRevision: 2,
      projectGoal: "Publish a verified report",
      agent,
      runtime: { engineId: "opencode", model: null, mode: "build", modelVariant: null },
      boundAt: 1,
    });

    expect(context).toContain("You are Editor");
    expect(context).toContain("Publish a verified report");
    expect(context).toContain("Reject unsupported claims.");
    expect(context).toContain("Assigned plugins: notion");
    expect(context).toContain("Assigned skills: writing:review");
  });

  test("reuses the existing task board, schedule controls and shared Sheet", () => {
    expect(runtimeMetricsSource).toContain("client.listSessions");
    expect(runtimeMetricsSource).toContain("getSessionMessages");
    expect(runtimeMetricsSource).toContain("session.parentID");
    expect(runtimeMetricsSource).toContain("unattributedTokens");
    expect(workCenterSource).toContain('"project-task-runtime"');
    expect(workCenterSource).toContain("metrics.executionRecords");
    expect(workCenterSource).toContain('data-testid="global-work-summary"');
    expect(workCenterSource).toContain("bg-dls-surface");
    expect(workCenterSource).not.toContain('t("work.global.summary_description")');
    expect(workCenterSource).not.toContain("<CalendarRange");
    expect(workCenterSource).toContain('"global-project-task-runtime"');
    expect(workCenterSource).toContain("const boardItems = [...items, ...runtimeItems]");
    expect(projectBoardSource).toContain('data-testid={entry.executionRecord ? "project-runtime-task" : undefined}');
    expect(projectBoardSource).toContain('data-testid="project-board"');
    expect(projectBoardSource).toContain("runtimeStatus.label");
    expect(workItemSheetSource).toContain('data-testid="work-item-sheet"');
    expect(workItemSheetSource).toContain("!props.item?.execution && props.agents.length > 0");
    expect(workItemSheetSource).toContain("<Collapsible");
    expect(workItemSheetSource).toContain("maxLength={WORK_ITEM_TITLE_MAX_LENGTH}");
    expect(workItemSheetSource).toContain("scheduleRequired = props.scheduleMode");
    expect(workItemSheetSource).not.toContain("props.scheduleMode && props.item === null");
    expect(workItemSheetSource).toContain("shouldInitiallyOpenTimePanel(props.item, props.scheduleMode)");
    expect(workItemSheetSource).toContain("return item === null");
    expect(workItemSheetSource).toContain("showCloseButton");
    expect(workItemSheetSource).toContain('w-[min(396px,100vw)]');
    expect(workItemSheetSource).toContain('<SelectTrigger id="work-item-status"');
    expect(workItemSheetSource).toContain("open={timeOpen}");
    expect(workItemSheetSource).toContain("onOpenChange={setTimeOpen}");
    expect(workItemSheetSource).not.toContain("open={scheduleRequired || timeOpen}");
    expect(workItemSheetSource).toContain("required={scheduleRequired}");
    expect(workItemSheetSource).toContain('placeholder={t("work.field.title_placeholder")}');
    expect(workItemSheetSource).toContain('placeholder={t("work.field.description_placeholder")}');
    expect(workItemSheetSource).toContain('filledValueClassName = "font-medium text-dls-accent dark:text-dls-text"');
    expect(workItemSheetSource).toContain('placeholderClassName = "placeholder:font-normal placeholder:text-dls-secondary/60"');
    expect(workItemSheetSource).toContain("initialSchedule: WorkItemScheduleDraft | null");
    expect(workCalendarSource).toContain('data-testid="work-calendar-slot-preview"');
    expect(workCalendarSource).toContain("flex flex-col items-start justify-start overflow-hidden rounded-[4px]");
    expect(workCalendarSource).toContain("style={{ top, height, left: 5, right: 5 }}");
    expect(workCalendarSource).toContain("duration / 60 * HOUR_HEIGHT - 2");
    expect(workCalendarSource).toContain("<ContextMenu>");
    expect(workCalendarSource).toContain("onCreateSchedule(workCalendarScheduleRange");
    expect(zh["work.calendar.today"]).toBe("今天");
    expect(zh["work.calendar.back_to_today"]).toBe("回到今天");
    expect(en["work.calendar.today"]).toBe("Today");
    expect(en["work.calendar.back_to_today"]).toBe("Back to today");
    expect(workCalendarSource).toContain('t(isToday ? "work.calendar.today" : "work.calendar.back_to_today")');
    expect(workCenterSource).toContain("onCreateSchedule={requestCreate}");
    expect(workItemSheetSource).toContain("<ConfirmModal");
    expect(workItemSheetSource).toContain("editorValuesEqual(value, initialValueRef.current)");
    expect(workCenterSource).toContain('scheduleMode={props.mode === "global" || projectView === "schedule"}');
    expect(modelBehaviorMenuSource).toContain("<ModelListContent");
  });

  test("snaps empty calendar positions to 30-minute one-hour schedules", () => {
    const gridHeight = 1_088;
    const eighteenThirtyOffset = gridHeight * 390 / 1_020;
    expect(snapWorkCalendarSlot(eighteenThirtyOffset, gridHeight)).toBe(390);
    expect(snapWorkCalendarSlot(gridHeight, gridHeight)).toBe(960);

    const schedule = workCalendarScheduleRange(new Date(2026, 7, 26), 750);
    expect(new Date(schedule.startAt).getHours()).toBe(18);
    expect(new Date(schedule.startAt).getMinutes()).toBe(30);
    expect(schedule.dueAt - schedule.startAt).toBe(60 * 60_000);
  });

  test("formats calendar events with a zero-padded 24-hour clock", () => {
    expect(formatWorkCalendarTime(new Date(2026, 7, 25, 0, 5).getTime())).toBe("00:05");
    expect(formatWorkCalendarTime(new Date(2026, 7, 25, 9, 0).getTime())).toBe("09:00");
    expect(formatWorkCalendarTime(new Date(2026, 7, 25, 23, 45).getTime())).toBe("23:45");
  });

  test("formats Chinese calendar ranges in year-month-day order", () => {
    expect(formatWorkCalendarRange(new Date(2026, 7, 25), "week", "zh-CN")).toBe("2026年8月24日 - 2026年8月30日");
    expect(formatWorkCalendarRange(new Date(2026, 7, 25), "month", "zh-CN")).toBe("2026年8月");
  });

  test("keeps the weekly event title ahead of project and time details", () => {
    const titleIndex = workCalendarSource.indexOf('data-testid="work-calendar-event-title"');
    const projectIndex = workCalendarSource.indexOf('data-testid="work-calendar-event-project"');
    const timeIndex = workCalendarSource.indexOf('data-testid="work-calendar-event-time"');

    expect(titleIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(titleIndex);
    expect(timeIndex).toBeGreaterThan(projectIndex);
    expect(workCalendarSource).toContain("duration >= 45");
    expect(workCalendarSource).toContain("duration >= 60");
    expect(workCalendarSource).toContain("style={{ top: index === 0 ? 8 : index * HOUR_HEIGHT }}");
  });

  test("assigns calendar colors consistently by task title", () => {
    expect(workCalendarSource).toContain("const TASK_TONES = [");
    expect(workCalendarSource).toContain("const tone = taskTone(entry.item.title)");
    expect(workCalendarSource).toContain("taskTone(entry.item.title).compact");
    expect(workCalendarSource).toContain("taskTone(entry.item.title).marker");
    expect(workCalendarSource).not.toContain("projectTone(entry.projectName)");
    expect(workCalendarSource).toContain("bg-cyan-4/80 text-cyan-12");
    expect(workCalendarSource).toContain("bg-sky-4/80 text-sky-12");
    expect(workCalendarSource).toContain("bg-violet-4/80 text-violet-12");
    expect(workCalendarSource).toContain("bg-rose-4/80 text-rose-12");
    expect(workCalendarSource).toContain("bg-amber-4/80 text-amber-12");
    expect(workCalendarSource).toContain("bg-grass-4/80 text-grass-12");
    expect(workCalendarSource).not.toMatch(/#[\dA-F]{3,8}/i);
  });

  test("finds scheduled calendar tasks by title or project", () => {
    const calendarItem = (key: string, title: string, projectName: string): WorkCalendarItem => ({
      key,
      projectName,
      item: {
        id: key,
        workspaceId: "workspace",
        title,
        description: null,
        status: "planned",
        assignee: null,
        priority: "normal",
        startAt: new Date(2026, 7, 25, 9).getTime(),
        dueAt: new Date(2026, 7, 25, 10).getTime(),
        automation: null,
        automationLastRunAt: null,
        automationLastSessionId: null,
        automationLastError: null,
        position: 0,
        customFields: {},
        execution: null,
        lastError: null,
        runStartedAt: null,
        runCompletedAt: null,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    const release = calendarItem("release", "Release review", "Website");
    const research = calendarItem("research", "整理访谈", "用户研究");
    const items = [release, research];

    expect(searchWorkCalendarItems(items, "release")).toEqual([release]);
    expect(searchWorkCalendarItems(items, "用户研究")).toEqual([research]);
    expect(searchWorkCalendarItems(items, "  ")).toBe(items);
  });

  test("uses the same semantic typography hierarchy across overview and tasks", () => {
    expect(workCenterSource).toContain('text-[24px] font-semibold leading-8 tracking-[-0.35px] text-dls-text');
    expect(workCenterSource).not.toContain('<LayoutDashboard className="size-4 text-dls-secondary" />');
    expect(appStylesSource).toContain('html:lang(zh) [data-testid="work-center"] :where(');
    expect(appStylesSource).toContain('[class~="text-dls-text/45"]');
    expect(workCenterSource).toContain('text-[13px] leading-5 text-dls-secondary');
    expect(projectBoardSource).toContain('text-[14px] font-semibold leading-5');
    expect(projectBoardSource).toContain('text-[11px] leading-[15px] text-dls-text/45');
    expect(projectBoardSource).toContain('border border-dls-border/70 bg-white');
    expect(projectBoardSource).not.toContain('hover:shadow-');
  });

  test("restores the main sidebar from the global schedule header", () => {
    expect(workCenterSource).toContain('data-testid="work-center-sidebar-restore"');
    expect(workCenterSource).toContain('sidebarState === "collapsed"');
    expect(workCenterSource).toContain('aria-label={t("sidebar.expand")}');
  });

  test("opens the same plugin authorization dialog in place instead of navigating to settings", () => {
    expect(pluginPackagesPanelSource).toContain("<PluginAuthorizationDialog");
    expect(pluginAuthorizationDialogSource).toContain("<AuthorizationFormDialog");
    expect(pluginAuthorizationDialogSource).toContain("client.savePluginAuthorization");
    expect(pluginAuthorizationDialogSource).toContain("client.startPluginAuthorization");
    expect(pluginAuthorizationDialogSource).toContain("client.pollPluginDeviceAuthorization");
    expect(pluginAuthorizationDialogSource).toContain("client.getPluginAuthorization");
  });

  test("supports opt-in mouse panning without replacing task drag and drop", () => {
    expect(workCenterSource).toContain("const [boardPanEnabled, setBoardPanEnabled] = React.useState(false);");
    expect(workCenterSource).toContain("aria-pressed={boardPanEnabled}");
    expect(workCenterSource).toContain("panEnabled={boardPanEnabled}");
    expect(projectBoardSource).toContain("event.currentTarget.setPointerCapture(event.pointerId);");
    expect(projectBoardSource).toContain("event.currentTarget.scrollLeft = start.scrollLeft - (event.clientX - start.clientX);");
    expect(projectBoardSource).toContain('panEnabled && "select-none [&>*]:pointer-events-none"');
    expect(projectBoardSource).toContain('panEnabled && (panning ? "cursor-grabbing" : "cursor-grab")');
    expect(projectBoardSource).toContain("draggable={!executionBound}");
  });

  test("closes the task deletion confirmation after a successful delete", () => {
    const deleteMutationSource = workCenterSource.slice(
      workCenterSource.indexOf("const deleteMutation = useMutation"),
      workCenterSource.indexOf("const boardMutation = useMutation"),
    );

    expect(deleteMutationSource).toContain("onSuccess: async () => {\n      setPendingDelete(null);");
    expect(deleteMutationSource).toContain('onError: (error) => toast.error(t("work.delete_failed")');
  });

  test("uses a native date picker and a 15-minute 24-hour time menu for task scheduling", () => {
    expect(workItemSheetSource).toContain("function DateTimePickerField");
    expect(workItemSheetSource).toContain("function TimePicker24Hour");
    expect(workItemSheetSource).toContain('data-testid="work-item-time-pickers"');
    expect(workItemSheetSource).toContain('type="date"');
    expect(workItemSheetSource).not.toContain('type="time"');
    expect(workItemSheetSource).toContain("const TIME_PICKER_INTERVAL_MINUTES = 15;");
    expect(workItemSheetSource).toContain("TIME_OPTIONS_15_MINUTES");
    expect(workItemSheetSource).toContain("timePickerOptions(time).map");
    expect(workItemSheetSource).toContain('id={`${props.id}-time`}');
    expect(workItemSheetSource).toContain("option < props.minimumTime");
    expect(workItemSheetSource).toContain('side="bottom"');
    expect(workItemSheetSource).toContain('collisionAvoidance={{ side: "none", align: "shift", fallbackAxisSide: "none" }}');
    expect(workItemSheetSource).toContain('className="max-h-64 w-(--anchor-width) min-w-(--anchor-width) p-1"');
    expect(workItemSheetSource).toContain('className="grid grid-cols-2 gap-2"');
    expect(workItemSheetSource).toContain("<CalendarDays");
    expect(workItemSheetSource).toContain("strokeWidth={1}");
    expect(workItemSheetSource).toContain('rounded-[8px] border-[#EBEBEB] pe-4 leading-[18px]');
    expect(workItemSheetSource).toContain('[&_svg]:text-[#858A94] [&_svg]:[stroke-width:1.333]');
    expect(workItemSheetSource).toContain("updateDatePart(props.timestamp");
    expect(workItemSheetSource).toContain("updateTimePart(props.timestamp");
    expect(workItemSheetSource).toContain("event.currentTarget.showPicker();");
    expect(workItemSheetSource.match(/onClick=\{openNativePicker\}/g)).toHaveLength(1);
    expect(workItemSheetSource).not.toContain('type="datetime-local"');
  });

  test("configures automatic execution from the shared task schedule sheet", () => {
    expect(workItemSheetSource).toContain('data-testid="work-item-automation"');
    expect(workItemSheetSource).toContain('checked={value.automation?.enabled === true}');
    expect(workItemSheetSource).toContain('t("work.automation.recurrence")');
    expect(workItemSheetSource).toContain('current.automation?.recurrence ?? "once"');
    expect(workItemSheetSource).toContain('SelectTrigger id="work-item-automation-recurrence"');
    expect(workItemSheetSource).toContain('SelectTrigger id="work-item-automation-model"');
    expect(workItemSheetSource).toContain('<SelectItem value={FOLLOW_PROJECT_MODEL_VALUE}>');
    expect(workItemSheetSource).toContain('<SelectGroup key={provider.id}>');
    expect(workItemSheetSource).toContain('<SelectLabel>{provider.name || provider.id}</SelectLabel>');
    expect(workItemSheetSource).toContain('t("work.automation.follow_project_model")');
    expect(workItemSheetSource).toContain("automationModelFromValue");
    expect(workCenterSource).toContain("connectedProviderIds={props.connectedProviderIds}");
    expect(workItemSheetSource).toContain("invalidAutomation");
    expect(workItemSheetSource).not.toContain("work.automation.description");
    expect(workItemSheetSource).toContain("work.automation.runtime_notice");
  });

  test("retains the optional owner control without loading preset configuration by default", () => {
    expect(workCenterSource).not.toContain("work-item-project-agents");
    expect(workItemSheetSource).toContain('SelectTrigger id="work-item-assignee"');
    expect(workItemSheetSource).toContain('<SelectItem value={UNASSIGNED_ASSIGNEE_VALUE}>');
    expect(workItemSheetSource).toContain("props.agents.map((agent)");
    expect(workItemSheetSource).toContain('<SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>');
    expect(workItemSheetSource).not.toContain("nativeSelectClassName");
    expect(workItemSheetSource).not.toContain("<select");
    expect(workItemSheetSource).not.toContain("<SelectValue />");
    expect(workItemSheetSource).not.toContain('placeholder={t("work.field.assignee_placeholder")}');
  });

  test("keeps conversation and project filters on every task-list page", async () => {
    const originalFetch = globalThis.fetch;
    const queries: URLSearchParams[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const query = new URL(String(input)).searchParams;
      queries.push(query);
      return Response.json(query.has("cursor")
        ? { items: [{ id: "second-task" }], nextCursor: null }
        : { items: [{ id: "first-task" }], nextCursor: "page-two" });
    };
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
    try {
      const client = createiPolloWorkServerClient({ baseUrl: "https://ipollowork.test" });
      const items = await listEndpointWorkItems(client, { workspaceIds: ["workspace one"], sessionId: "conversation/one" });
      expect(items.map((item) => item.id)).toEqual(["first-task", "second-task"]);
      expect(queries).toHaveLength(2);
      expect(queries.every((query) => query.get("sessionId") === "conversation/one")).toBe(true);
      expect(queries.every((query) => query.getAll("workspaceId").join() === "workspace one")).toBe(true);
      expect(queries[1]?.get("cursor")).toBe("page-two");
    } finally {
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    }
  });
});
