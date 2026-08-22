export const ENGINE_HOST_TOOL_NAMES = {
  extensionListActions: "ipollowork_extension_list_actions",
  extensionCall: "ipollowork_extension_call",
  projectRead: "ipollowork_project_read",
  projectApply: "ipollowork_project_apply",
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
Prefer one bounded action batch when steps are independent. Clicking publish, send, submit, pay, buy, confirm, delete, or similar consequential controls requires user approval and must not be retried after denial.`;

const CONSEQUENTIAL_BROWSER_CONTROL = /(?:发布|发送|提交|付款|支付|购买|下单|确认|删除|移除|清空数据|授权)|(?:\b(?:publish|send|submit|pay|purchase|buy|checkout|confirm|delete|remove|authorize)\b)|(?:^post(?: now)?$)/i;

export function consequentialBrowserControlNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((action): action is Record<string, unknown> => (
      typeof action === "object" && action !== null && !Array.isArray(action)
    ))
    .filter((action) => action.type === "click" && typeof action.expectedName === "string")
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
    description: "Execute one bounded action batch against refs from the latest semantic snapshot. Uses real pointer/keyboard input, validates current name/visibility/obstruction, and rejects stale refs.",
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
