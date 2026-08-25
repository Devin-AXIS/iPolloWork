export const ENGINE_HOST_TOOL_NAMES = {
  extensionListActions: "ipollowork_extension_list_actions",
  extensionCall: "ipollowork_extension_call",
  projectRead: "ipollowork_project_read",
  projectApply: "ipollowork_project_apply",
  schedulePreview: "ipollowork_schedule_preview",
  scheduleApply: "ipollowork_schedule_apply",
  workspaceAppListTools: "ipollowork_workspace_app_list_tools",
  workspaceAppCallTool: "ipollowork_workspace_app_call_tool",
  browserOpenUrl: "ipollowork_browser_open_url",
  browserSnapshot: "ipollowork_browser_snapshot",
  browserAct: "ipollowork_browser_act",
  browserSetProxy: "ipollowork_browser_set_proxy",
} as const;

export type EngineHostToolName = (typeof ENGINE_HOST_TOOL_NAMES)[keyof typeof ENGINE_HOST_TOOL_NAMES];

export type EngineHostToolDescriptor = {
  name: EngineHostToolName;
  description: string;
  parameters: Record<string, unknown>;
};

const objectParameters = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const ENGINE_BROWSER_INSTRUCTION = `## Built-in Browser
Use the iPolloWork browser tools only for external websites, never to control the iPolloWork app itself.
Open a page with ipollowork_browser_open_url, read it with ipollowork_browser_snapshot, then act only through stable refs from that latest snapshot with ipollowork_browser_act.
Never invent or reuse stale refs. Take a new snapshot after navigation, when snapshotRequired is true, or when a target changed.
Prefer one bounded action batch when steps are independent. Use hover, select, check, scroll, or structured wait actions instead of guessing pointer coordinates or timing.
Activating publish, send, submit, pay, buy, confirm, delete, or similar consequential controls by click, key, or check requires user approval and must not be retried after denial.`;

export const IPOLLOWORK_SCHEDULE_OFFER_PROMPT = "是否需要生成计划并加入 iPolloWork 日程？";

const CONSEQUENTIAL_BROWSER_CONTROL = /(?:发布|发送|提交|付款|支付|购买|下单|确认|删除|移除|清空数据|授权)|(?:\b(?:publish|send|submit|pay|purchase|buy|checkout|confirm|delete|remove|authorize)\b)|(?:^post(?: now)?$)/i;

export function consequentialBrowserControlNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((action): action is Record<string, unknown> => (
      typeof action === "object" && action !== null && !Array.isArray(action)
    ))
    .filter((action) => (
      ["check", "click", "press"].includes(String(action.type))
      && typeof action.expectedName === "string"
    ))
    .map((action) => String(action.expectedName).trim())
    .filter((name) => name && CONSEQUENTIAL_BROWSER_CONTROL.test(name));
}

const browserActionSchema = {
  oneOf: [
    objectParameters({
      type: { const: "click" },
      ref: { type: "string", description: "Stable ref from the latest browser snapshot." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible control name shown in the snapshot." },
    }, ["type", "ref", "expectedName"]),
    objectParameters({
      type: { const: "fill" },
      ref: { type: "string", description: "Stable writable-field ref from the latest browser snapshot." },
      value: { type: "string", maxLength: 50_000, description: "Complete replacement text." },
    }, ["type", "ref", "value"]),
    objectParameters({
      type: { const: "press" },
      key: {
        type: "string",
        enum: ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Escape", "Home", "PageDown", "PageUp", "Tab"],
      },
    }, ["type", "key"]),
    objectParameters({
      type: { const: "press" },
      key: { type: "string", enum: ["Enter", "Space"] },
      ref: { type: "string", description: "Stable activatable-control ref from the latest browser snapshot." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible control name shown in the snapshot." },
    }, ["type", "key", "ref", "expectedName"]),
    objectParameters({
      type: { const: "hover" },
      ref: { type: "string", description: "Stable ref from the latest browser snapshot." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible target name shown in the snapshot." },
    }, ["type", "ref", "expectedName"]),
    objectParameters({
      type: { const: "select" },
      ref: { type: "string", description: "Stable native-select ref from the latest browser snapshot." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible select name shown in the snapshot." },
      option: { type: "string", maxLength: 500, description: "Exact visible option label or option value." },
    }, ["type", "ref", "expectedName", "option"]),
    objectParameters({
      type: { const: "check" },
      ref: { type: "string", description: "Stable checkbox, radio, or switch ref from the latest browser snapshot." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible control name shown in the snapshot." },
      checked: { type: "boolean", description: "Requested checked state. Radio controls accept true only." },
    }, ["type", "ref", "expectedName", "checked"]),
    objectParameters({
      type: { const: "scroll" },
      direction: { type: "string", enum: ["down", "left", "right", "up"] },
      amount: { type: "string", enum: ["small", "page"] },
    }, ["type", "direction", "amount"]),
    objectParameters({
      type: { const: "upload" },
      ref: { type: "string", description: "File-input ref from the latest browser snapshot." },
      filePaths: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string" },
        description: "Absolute paths inside the active workspace or the named plugin's private data.",
      },
      extensionId: { type: "string", description: "Plugin ID when uploading from that plugin's private data." },
    }, ["type", "ref", "filePaths"]),
    objectParameters({
      type: { const: "wait" },
      durationMs: { type: "integer", minimum: 0, maximum: 2_000 },
    }, ["type", "durationMs"]),
    objectParameters({
      type: { const: "waitFor" },
      condition: { const: "url" },
      value: { type: "string", minLength: 1, maxLength: 2_048 },
      match: { type: "string", enum: ["equals", "contains"] },
      timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
    }, ["type", "condition", "value", "match"]),
    objectParameters({
      type: { const: "waitFor" },
      condition: { const: "text" },
      value: { type: "string", minLength: 1, maxLength: 500 },
      timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
    }, ["type", "condition", "value"]),
    objectParameters({
      type: { const: "waitFor" },
      condition: { const: "ref" },
      ref: { type: "string", description: "Stable ref from the latest browser snapshot." },
      state: { type: "string", enum: ["attached", "visible"] },
      timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
    }, ["type", "condition", "ref", "state"]),
    objectParameters({
      type: { const: "waitFor" },
      condition: { const: "load" },
      state: { type: "string", enum: ["interactive", "complete"] },
      timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
    }, ["type", "condition", "state"]),
  ],
};

export const ENGINE_HOST_TOOLS: readonly EngineHostToolDescriptor[] = [
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionListActions,
    description: "List the actions currently exposed by installed and enabled iPolloWork extensions.",
    parameters: objectParameters({
      extensionId: {
        type: "string",
        description: "Optional extension ID used to filter the action catalog.",
      },
    }),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionCall,
    description: "Call an iPolloWork extension action after inspecting it with ipollowork_extension_list_actions.",
    parameters: objectParameters({
      extensionId: { type: "string", description: "Extension ID returned by the action catalog." },
      action: { type: "string", description: "Action ID returned by the action catalog." },
      args: { type: "object", additionalProperties: true, description: "Action arguments." },
    }, ["extensionId", "action"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectRead,
    description: "Read the schema-validated iPolloWork project configuration for the current workspace. Use only in an explicitly opened Project Builder conversation.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectApply,
    description: "Apply one complete schema-validated iPolloWork project configuration after the user explicitly confirms the proposal in Project Builder.",
    parameters: objectParameters({
      config: {
        type: "object",
        additionalProperties: true,
        description: "Complete ProjectWorkspaceConfig document returned from a confirmed Project Builder proposal.",
      },
      summary: {
        type: "string",
        description: "Short human-readable summary of the confirmed project change.",
      },
    }, ["config", "summary"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.schedulePreview,
    description: `Prepare a read-only preview of planned tasks for the current iPolloWork Schedule. Whenever a completed answer presents a plan that could become scheduled tasks, end that answer by proactively asking the user exactly “${IPOLLOWORK_SCHEDULE_OFFER_PROMPT}”, even when the plan does not yet include concrete dates or times. Do not ask for scheduling details before making this offer. Call this tool only after the user agrees; then ask only for any missing start date, time, duration, or recurrence needed to build the preview. Use explicit ISO 8601 time-zone offsets and 15-minute boundaries. Present the returned preview and ask for final confirmation before calling ipollowork_schedule_apply.`,
    parameters: objectParameters({
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: objectParameters({
          title: { type: "string", minLength: 1, maxLength: 80 },
          description: { type: "string", maxLength: 4_000 },
          startAt: {
            type: "string",
            maxLength: 40,
            pattern: "(?:Z|[+-]\\d{2}:\\d{2})$",
            description: "ISO 8601 date-time with an explicit Z or ±HH:mm time zone, aligned to 15 minutes.",
          },
          dueAt: {
            type: "string",
            maxLength: 40,
            pattern: "(?:Z|[+-]\\d{2}:\\d{2})$",
            description: "ISO 8601 date-time with an explicit Z or ±HH:mm time zone, aligned to 15 minutes.",
          },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        }, ["title", "startAt", "dueAt"]),
      },
    }, ["tasks"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.scheduleApply,
    description: "Add every task from one iPolloWork Schedule preview after the user has reviewed that preview and explicitly confirmed it. Never call this tool with an unconfirmed preview or retry it after denial.",
    parameters: objectParameters({
      previewId: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "One-time preview ID returned by ipollowork_schedule_preview.",
      },
    }, ["previewId"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.workspaceAppListTools,
    description: "List the tools exposed by the Workspace App currently open in the iPolloWork right pane.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.workspaceAppCallTool,
    description: "Call a tool exposed by the Workspace App currently open in the iPolloWork right pane.",
    parameters: objectParameters({
      name: { type: "string", description: "Workspace App tool name returned by ipollowork_workspace_app_list_tools." },
      arguments: { type: "object", additionalProperties: true, description: "Workspace App tool arguments." },
    }, ["name"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserOpenUrl,
    description: `Open an external website in a new iPolloWork built-in browser tab. Returns tabId for ipollowork_browser_snapshot. ${ENGINE_BROWSER_INSTRUCTION}`,
    parameters: objectParameters({
      url: { type: "string", description: "HTTP or HTTPS website URL." },
    }, ["url"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserSnapshot,
    description: "Read a bounded semantic accessibility tree from the built-in browser. Interactive controls receive stable refs; values of protected fields are never returned.",
    parameters: objectParameters({
      tabId: { type: "string", description: "Tab ID returned by ipollowork_browser_open_url." },
    }, ["tabId"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserAct,
    description: "Execute one bounded semantic action batch against the latest snapshot: click, fill, scoped key activation, hover, select, check, scroll, upload, or bounded waits. Validates names, state, visibility, obstruction, and stale refs.",
    parameters: objectParameters({
      tabId: { type: "string", description: "Built-in browser tab ID." },
      snapshotId: { type: "string", description: "Latest snapshot ID returned for this tab." },
      actions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: browserActionSchema,
      },
    }, ["tabId", "snapshotId", "actions"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserSetProxy,
    description: "Set the shared built-in browser HTTP/SOCKS proxy. Pass env:NAME to resolve a local secret or an empty string to restore system networking.",
    parameters: objectParameters({
      proxy: { type: "string", description: "Proxy URL, env:NAME, or empty string to clear." },
    }, ["proxy"]),
  },
] as const;

export function engineHostTool(name: string): EngineHostToolDescriptor | undefined {
  return ENGINE_HOST_TOOLS.find((tool) => tool.name === name);
}
