import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { projectWorkspaceConfigSchema } from "@ipollowork/types/project-workspace";
import type { iPolloWorkServerClient } from "../src/app/lib/ipollowork-server";
import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";
import { loadProjectRuntimeMetrics } from "../src/react-app/domains/work/project-runtime-metrics";
import { scopeProjectBuilderDraft } from "../src/react-app/domains/work/project-builder-session";
import { projectExecutionSystemContext } from "../src/react-app/domains/work/project-execution";
import {
  snapWorkCalendarSlot,
  workCalendarScheduleRange,
} from "../src/react-app/domains/work/work-calendar";

const overviewSource = readFileSync(
  new URL("../src/react-app/domains/work/project-overview.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const inspectorSource = readFileSync(
  new URL("../src/react-app/domains/work/project-agent-inspector.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const dashboardSource = readFileSync(
  new URL("../src/react-app/domains/work/project-dashboard.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const runtimeDataSource = readFileSync(
  new URL("../src/react-app/domains/work/project-runtime-data.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const runtimeMetricsSource = readFileSync(
  new URL("../src/react-app/domains/work/project-runtime-metrics.ts", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const orchestrationSource = readFileSync(
  new URL("../src/react-app/domains/work/project-orchestration-graph.tsx", import.meta.url),
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
const resourcePickerSource = readFileSync(
  new URL("../src/react-app/domains/work/project-resource-picker.tsx", import.meta.url),
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

describe("project overview", () => {
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

  test("keeps Project Builder capability scoped while preserving another selected capability", () => {
    const scoped = scopeProjectBuilderDraft({
      mode: "prompt",
      parts: [],
      attachments: [],
      text: "Improve the editor",
      capability: { id: "another-capability", instruction: "Keep this instruction." },
    }, "Media Desk");

    expect(scoped.capability?.id).toBe("another-capability+project-builder");
    expect(scoped.capability?.instruction).toContain("Keep this instruction.");
    expect(scoped.capability?.instruction).toContain("ipollowork_project_read");
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

  test("reuses workspace config, work items, plugin authorization, and the shared Sheet", () => {
    expect(overviewSource).toContain("client.getConfig(props.workspaceId)");
    expect(overviewSource).toContain("listEndpointWorkItems(props.client");
    expect(overviewSource).toContain("getPluginAuthorization");
    expect(overviewSource).toContain("response.items.filter((item) => item.enabled)");
    expect(overviewSource).toContain("patchConfig(props.workspaceId, { ipollowork: { project: parsed } })");
    expect(overviewSource).toContain("isNew={Boolean(draftAgent");
    expect(inspectorSource).toContain('data-testid="project-agent-inspector"');
    expect(inspectorSource).toContain("<Sheet open={props.open}");
    expect(inspectorSource).toContain("const [editing, setEditing]");
    expect(inspectorSource).toContain('data-testid="project-agent-edit"');
    expect(inspectorSource).toContain("setEditing(props.isNew)");
    expect(inspectorSource).toContain("{editing ? (");
    expect(inspectorSource).toContain('data-testid="project-agent-inspector-content"');
    expect(inspectorSource).toContain('appearance="field"');
    expect(inspectorSource).toContain("<Select");
    expect(inspectorSource).toContain('data-testid="project-agent-engine-select"');
    expect(inspectorSource).toContain('data-testid="project-agent-mode-select"');
    expect(inspectorSource).toContain("<SelectValue>{engineLabel}</SelectValue>");
    expect(inspectorSource).toContain("<SelectValue>{modeLabel}</SelectValue>");
    expect(inspectorSource).not.toContain("<select");
    expect(resourcePickerSource).toContain('data-testid={testId}');
    expect(inspectorSource).toContain('testId="project-agent-add-plugin"');
    expect(inspectorSource).toContain('testId="project-agent-add-skill"');
    expect(inspectorSource.match(/<ProjectResourcePicker/g)).toHaveLength(2);
    expect(resourcePickerSource).toContain("onAdd: (ids: string[]) => void");
    expect(resourcePickerSource).toContain("onAdd(selectedIds)");
    expect(resourcePickerSource).toContain("aria-selected={selectedIds.includes(item.id)}");
    expect(resourcePickerSource).toContain('t("project_overview.selected_count"');
    expect(resourcePickerSource).not.toContain("onAdd(item.id)");
    expect(inspectorSource).toContain('data-testid="project-agent-plugin-row"');
    expect(inspectorSource).toContain('data-testid="project-agent-skill-row"');
    expect(inspectorSource).toContain("selectedPlugins.map");
    expect(inspectorSource).toContain("selectedSkills.map");
    expect(inspectorSource).not.toContain('id="project-agent-reasoning"');
    expect(inspectorSource).toContain("<Switch");
    expect(inspectorSource).toContain('data-testid="project-agent-avatar"');
    expect(inspectorSource).not.toContain("project-agent-knowledge");
    expect(inspectorSource).not.toContain("<Checkbox");
    expect(dashboardSource).toContain('data-testid="project-agent-list"');
    expect(dashboardSource).toContain('data-testid="project-agent-activity-panel"');
    expect(dashboardSource).toContain('data-testid="project-agent-task-summary"');
    expect(dashboardSource).toContain('grid-cols-3');
    expect(dashboardSource).not.toContain('{ id: "waiting", count: agentMetrics.waiting');
    expect(dashboardSource).toContain("const agentMetrics = taskMetrics(assignedItems, props.config)");
    expect(dashboardSource).toContain("taskSegments.map");
    expect(dashboardSource).toContain("<Package");
    expect(dashboardSource).toContain('data-testid="project-upcoming"');
    expect(dashboardSource.match(/data-testid="project-agent-tab"/g)).toHaveLength(1);
    expect(dashboardSource).toContain("tasksForAgent(agent, props.items)");
    expect(dashboardSource).toContain("recentRuntimeConversation?.title");
    expect(dashboardSource).toContain('t("project_overview.failure_rate")');
    expect(dashboardSource).toContain("<ProjectRuntimeData");
    expect(dashboardSource).toContain("<ProjectOrchestrationGraph");
    expect(dashboardSource).toContain('data-testid="project-task-health"');
    expect(dashboardSource).toContain('sections.has("health")');
    expect(dashboardSource).toContain('sections.has("usage")');
    expect(dashboardSource).toContain("props.config.dashboard.taskHealth.metrics.map");
    expect(dashboardSource).toContain("props.runtimeMetrics?.executionRecords ?? []");
    expect(dashboardSource).toContain("xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]");
    expect(dashboardSource).toContain("xl:sticky xl:top-0 xl:self-start");
    expect(runtimeDataSource).toContain('data-testid="project-runtime-data"');
    expect(runtimeDataSource).toContain('t("project_overview.total_token_usage")');
    expect(runtimeDataSource).toContain('t("project_overview.total_conversations")');
    expect(runtimeDataSource).toContain("props.displayMetrics");
    expect(runtimeDataSource).toContain('data-testid="project-agent-usage-chart"');
    expect(runtimeDataSource).toContain("usagePercentage");
    expect(runtimeDataSource).toContain("metrics.unattributedTokens");
    expect(runtimeDataSource).not.toContain("<AgentAvatar");
    expect(runtimeMetricsSource).toContain("client.listSessions");
    expect(runtimeMetricsSource).toContain("getSessionMessages");
    expect(runtimeMetricsSource).toContain("session.parentID");
    expect(runtimeMetricsSource).toContain("unattributedTokens");
    expect(overviewSource).toContain('data?.config.dashboard.sections.includes("usage")');
    expect(orchestrationSource).toContain('data-testid="project-orchestration-graph"');
    expect(orchestrationSource).toContain("config.orchestration.relations");
    expect(orchestrationSource).toContain('strokeDasharray={parallel ? "4 5" : undefined}');
    expect(orchestrationSource).toContain('data-testid="project-orchestration-port"');
    expect(orchestrationSource).toContain('data-testid="project-orchestration-stage"');
    expect(orchestrationSource).toContain('data-stage-type={stage.parallel ? "parallel" : "sequential"}');
    expect(orchestrationSource).toContain('data-testid="project-orchestration-parallel-group"');
    expect(orchestrationSource).toContain("item.execution.agent.id === agent.id");
    expect(workCenterSource).toContain('"project-task-runtime"');
    expect(workCenterSource).toContain("metrics.executionRecords");
    expect(workCenterSource).toContain('data-testid="global-work-summary"');
    expect(workCenterSource).toContain('"global-project-task-runtime"');
    expect(workCenterSource).toContain("const boardItems = [...items, ...runtimeItems]");
    expect(projectBoardSource).toContain('data-testid={entry.executionRecord ? "project-runtime-task" : undefined}');
    expect(projectBoardSource).toContain('data-testid="project-board"');
    expect(projectBoardSource).toContain("runtimeStatus.label");
    expect(workItemSheetSource).toContain('data-testid="work-item-sheet"');
    expect(workItemSheetSource).toContain("!props.item?.execution ? <div");
    expect(workItemSheetSource).toContain("<Collapsible");
    expect(workItemSheetSource).toContain("maxLength={WORK_ITEM_TITLE_MAX_LENGTH}");
    expect(workItemSheetSource).toContain("scheduleRequired = props.scheduleMode");
    expect(workItemSheetSource).not.toContain("props.scheduleMode && props.item === null");
    expect(workItemSheetSource).toContain("setTimeOpen(props.scheduleMode");
    expect(workItemSheetSource).toContain("showCloseButton");
    expect(workItemSheetSource).toContain('w-[min(396px,100vw)]');
    expect(workItemSheetSource).toContain('<SelectTrigger id="work-item-status"');
    expect(workItemSheetSource).toContain("open={scheduleRequired || timeOpen}");
    expect(workItemSheetSource).toContain("required={scheduleRequired}");
    expect(workItemSheetSource).toContain('placeholder={t("work.field.title_placeholder")}');
    expect(workItemSheetSource).toContain('placeholder={t("work.field.description_placeholder")}');
    expect(workItemSheetSource).toContain('filledValueClassName = "font-medium text-dls-accent dark:text-dls-text"');
    expect(workItemSheetSource).toContain('placeholderClassName = "placeholder:font-normal placeholder:text-dls-secondary/60"');
    expect(workItemSheetSource).toContain("initialSchedule: WorkItemScheduleDraft | null");
    expect(workCalendarSource).toContain('data-testid="work-calendar-slot-preview"');
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
    expect(dashboardSource).not.toContain('t("project_overview.token_usage_unavailable")');
    expect(modelBehaviorMenuSource).toContain("<ModelListContent");
    expect(`${overviewSource}\n${inspectorSource}`).not.toContain("apiKey:");
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

  test("uses the same semantic typography hierarchy across overview and tasks", () => {
    expect(dashboardSource).toContain('text-[24px] font-semibold leading-8 tracking-[-0.45px] text-dls-text');
    expect(workCenterSource).toContain('text-[24px] font-semibold leading-8 tracking-[-0.35px] text-dls-text');
    expect(dashboardSource).toContain('props.config.goal || t("project_overview.default_goal")');
    expect(dashboardSource).toContain('[--primary:#1FBAC0]');
    expect(runtimeDataSource).toContain('case 0: return "bg-primary";');
    expect(dashboardSource).not.toContain('<Sparkles className="size-4 text-dls-secondary" />');
    expect(dashboardSource).toContain('<ListTodo className="size-4 text-dls-secondary" />{t("project_overview.task_activity")}');
    expect(dashboardSource).toContain('group block w-full bg-white');
    expect(dashboardSource).not.toContain('selected ? "bg-dls-hover/52"');
    expect(appStylesSource).toContain('html:lang(zh) [data-testid="project-overview"] :where(');
    expect(appStylesSource).toContain('[class~="text-dls-text/45"]');
    expect(dashboardSource).not.toContain('project_overview.title');
    expect(dashboardSource).not.toContain('project_overview.task_activity_description');
    expect(runtimeDataSource).not.toContain('project_overview.runtime_data_description');
    expect(runtimeDataSource).not.toContain('project_overview.runtime_data_current');
    expect(runtimeDataSource).not.toContain('project_overview.agent_usage_description');
    expect(orchestrationSource).not.toContain('project_overview.orchestration_description');
    expect(dashboardSource).toContain('description: null, tone: "green"');
    expect(overviewSource).toContain('role: ""');
    expect(dashboardSource).toContain('LEGACY_GENERIC_AGENT_ROLES.has(agent.role)');
    expect(dashboardSource).toContain('agentNeedsSetup || showAgentTaskState');
    expect(dashboardSource).toContain('text-[13px] leading-5 text-dls-secondary');
    expect(workCenterSource).toContain('text-[13px] leading-5 text-dls-secondary');
    expect(dashboardSource).toContain('text-[14px] font-semibold leading-5');
    expect(runtimeDataSource).toContain('text-[14px] font-semibold leading-5');
    expect(orchestrationSource).toContain('text-[14px] font-semibold leading-5');
    expect(projectBoardSource).toContain('text-[14px] font-semibold leading-5');
    expect(dashboardSource).toContain('text-[11px] leading-[15px] text-dls-text/45');
    expect(projectBoardSource).toContain('text-[11px] leading-[15px] text-dls-text/45');
    expect(`${dashboardSource}\n${runtimeDataSource}\n${orchestrationSource}\n${projectBoardSource}\n${workCenterSource}`).not.toContain('text-dls-tertiary');
    expect(dashboardSource).toContain('border border-dls-border/70 bg-white');
    expect(runtimeDataSource).toContain('border border-dls-border/70 bg-white');
    expect(orchestrationSource).toContain('border border-dls-border/70 bg-white');
    expect(projectBoardSource).toContain('border border-dls-border/70 bg-white');
    expect(projectBoardSource).not.toContain('hover:shadow-');
    expect(runtimeDataSource).not.toContain('shadow-[');
  });

  test("opens the same plugin authorization dialog in place instead of navigating to settings", () => {
    expect(inspectorSource).toContain("onAuthorizePlugin: (pluginId: string) => void");
    expect(inspectorSource).toContain("props.onAuthorizePlugin(id)");
    expect(inspectorSource).not.toContain("onOpenPluginSettings");
    expect(overviewSource).toContain("<PluginAuthorizationDialog");
    expect(overviewSource).toContain("setAuthorizationPluginId");
    expect(overviewSource).toContain("queryClient.invalidateQueries({ queryKey: pluginQueryKey })");
    expect(overviewSource).not.toContain("/settings/extensions/plugin/");
    expect(pluginPackagesPanelSource).toContain("<PluginAuthorizationDialog");
    expect(`${overviewSource}\n${pluginPackagesPanelSource}`.match(/<PluginAuthorizationDialog/g)).toHaveLength(2);
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

  test("uses separate native date and time pickers for task scheduling", () => {
    expect(workItemSheetSource).toContain("function DateTimePickerField");
    expect(workItemSheetSource).toContain('data-testid="work-item-time-pickers"');
    expect(workItemSheetSource).toContain('type="date"');
    expect(workItemSheetSource).toContain('type="time"');
    expect(workItemSheetSource).toContain("updateDatePart(props.timestamp");
    expect(workItemSheetSource).toContain("updateTimePart(props.timestamp");
    expect(workItemSheetSource).toContain("event.currentTarget.showPicker();");
    expect(workItemSheetSource.match(/onClick=\{openNativePicker\}/g)).toHaveLength(2);
    expect(workItemSheetSource).not.toContain('type="datetime-local"');
  });

  test("configures automatic execution from the shared task schedule sheet", () => {
    expect(workItemSheetSource).toContain('data-testid="work-item-automation"');
    expect(workItemSheetSource).toContain('checked={value.automation?.enabled === true}');
    expect(workItemSheetSource).toContain('t("work.automation.recurrence")');
    expect(workItemSheetSource).toContain('current.automation?.recurrence ?? "once"');
    expect(workItemSheetSource).toContain('id="work-item-automation-model"');
    expect(workItemSheetSource).toContain('t("work.automation.follow_project_model")');
    expect(workItemSheetSource).toContain("automationModelFromValue");
    expect(workCenterSource).toContain("connectedProviderIds={props.connectedProviderIds}");
    expect(workItemSheetSource).toContain("invalidAutomation");
  });

  test("selects task owners from the current project's Agent configuration", () => {
    expect(workCenterSource).toContain('["work-item-project-agents", editorEndpoint?.key, editorEndpoint?.workspaceId]');
    expect(workCenterSource).toContain("readProjectWorkspaceConfig(response.ipollowork, editorEndpoint.workspace.engineId).agents");
    expect(workCenterSource).toContain("agents={editorAgentsQuery.data ?? []}");
    expect(workItemSheetSource).toContain('<select\n              id="work-item-assignee"');
    expect(workItemSheetSource).toContain("props.agents.map((agent)");
    expect(workItemSheetSource).toContain('<option key={agent.id} value={agent.id}>{agent.name}</option>');
    expect(workItemSheetSource).not.toContain('placeholder={t("work.field.assignee_placeholder")}');
  });
});
