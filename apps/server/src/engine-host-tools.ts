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
  browserRead: "ipollowork_browser_read",
  browserScreenshot: "ipollowork_browser_screenshot",
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
Open a page with ipollowork_browser_open_url. Prefer ipollowork_browser_read for page content, and use ipollowork_browser_snapshot for actionable controls and stable refs. Act only through refs from the latest snapshot with ipollowork_browser_act.
For local file uploads, use the upload action with the generated file path and the file-input ref or an upload-button ref plus its exact expectedName. Do not click an upload button first: the host intercepts file choosers and will not ask the user to select a generated file.
Never invent or reuse stale refs. Take a new snapshot after navigation, when snapshotRequired is true, or when a target changed.
Prefer one bounded action batch and request its observe result when you need to verify the outcome. Use hover, select, check, scroll, or structured wait actions instead of guessing pointer coordinates or timing.
Use ipollowork_browser_screenshot only when semantics are insufficient. Prefer a referenced element or bounded region; request annotations to map pixels back to semantic refs and ifChanged to avoid resending an unchanged image.
Activating publish, send, submit, pay, buy, confirm, delete, or similar consequential controls by click, key, or check requires user approval and must not be retried after denial.`;

export const IPOLLOWORK_SCHEDULE_OFFER_PROMPT = "是否需要生成计划并加入 iPolloWork 日程？";

export const ENGINE_MEDIA_MODEL_SELECTION_INSTRUCTION = "Call status first and check authorization, capabilities and supported parameters. Preserve a model explicitly selected for this task or captured workbench request. An ordinary requested image or a supporting asset inside an authorized Design, PPT or Video task is an approved automatic-selection flow: use a suitable authorized saved preference when present; otherwise use the suitable authorized defaultModel, or the first suitable authorized model in returned product order when defaultModel cannot perform the operation. Do not ask or leave the asset pending solely because multiple suitable models are authorized. Ask once only when the user requested a choice, an explicit model is unavailable and substitution materially changes provider, cost or capability, or no automatic candidate satisfies the task scope and allowed cost settings. Reuse the resolved task selection for compatible assets and disclose the model used after generation. defaultModel is a computed automatic candidate, not a saved preference; never persist it without an explicit request. Missing authorization or an unqueryable capability must not block file generation: report the asset state and continue with reusable assets or a coherent editable fallback; do not open settings or wait for authorization, and never request keys in chat. Do not invent preferences or budgets. Pass the chosen stable model ID explicitly. Never submit variants outside scope; query or recover uncertain jobs before resubmitting.";

export const ENGINE_VIDEO_GENERATION_INSTRUCTION = `## Video deliverable routing
- For MP4 export or social publication, call ipollowork_extension_call with extensionId=media, action=video_render_start, args={sourcePath:"video/<exact-project-id>/index.html",operationKey:"<stable-export-key>"}. Then video_render_status with the same args until complete/failed. The host starts bundled Studio; no CLI install, guessed HyperFrames version, shell endpoint discovery, delegated exploration agent, or manual Export step is needed. These actions are visible in media action discovery even outside a video-typed chat. On complete use outputPath for the requested publisher. Preparing/rendering is not task completion; report progress and keep polling at the returned interval. No schedule/calendar is required for an immediate publication. On failure report the exact returned error, not an invented missing capability.
- When a publisher returns browserTask, continue automatically in the same task: claim the browser job, use the persistent account profile, and upload the exact mediaPath with the returned extensionId through the host browser upload action. Missing API application settings or scopes are a browser fallback, not a reason to ask the user to upload the generated MP4. Pause only for login, QR code, SMS/captcha verification, denied approval, or a real platform error; after submission, verify and save the receipt before claiming success.
- A general request to generate/make a video (生成视频、做视频、宣传片、短视频) means an editable HyperFrames HTML composition supported by Video Studio. Follow the prepared video task/template context and deliver its HTML entry. Do not ask the user to choose between HTML and a video model for this default request.
- Before reporting an editable video complete, run its supplied HyperFrames check and inspect the structured result. Treat any validation error, ok=false, zero/incorrect duration, empty samples, invalid composition variables, undecodable media, or unintended blank midpoint/transition frame as a failed delivery that must be repaired. A timeline, waveform, successful command launch, or source nodes alone do not prove rendered content.
- MP4 export, duration, aspect ratio, realism, an attached image, or an already-open media workbench alone do not switch the deliverable to model-generated footage. Export/render requests on an existing composition keep its editable source.
- Use video-generation or another video plugin for explicit plugin/model or standalone footage requests, or for a scoped supporting clip identified while authoring an authorized PPT, website or editable video. Supporting footage must improve the content and obey asset permissions and costs; do not add it to a pure-text or narrow-edit request. Plugin availability and a model name mentioned as the subject of a video are not such a request. Respect negation and the latest explicit correction.
- If the user requests footage as an intermediate step and then a complete/editable video, use the plugin only for those assets and finish the Video Studio composition. A raw clip alone does not complete that task. Editing an existing HTML composition retains its project; a new standalone footage request must not inherit an HTML editing contract just because Studio is open.
- On the footage/plugin path, inspect the requested plugin's actions (video-generation: status). ${ENGINE_MEDIA_MODEL_SELECTION_INSTRUCTION} If the requested plugin is unavailable, report it and ask for an alternative; do not silently substitute a provider or HTML.
- Script/outline/advice-only requests do not create a video or submit a generation job. Ask a short clarification only when explicit deliverables conflict and the conversation cannot resolve them.`;

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
      ref: { type: "string", description: "File-input or visible upload-button ref from the latest browser snapshot. Never click the upload button first." },
      expectedName: { type: "string", maxLength: 200, description: "Exact accessible name when ref is an upload button; omit for a file input." },
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
      durationMs: { type: "integer", minimum: 0, maximum: 10_000 },
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

const browserObservationSchema = objectParameters({
  mode: { type: "string", enum: ["content", "interactive", "mixed"] },
  scopeRef: { type: "string", description: "Optional ref whose subtree should be observed." },
  delta: { type: "boolean", description: "Return only a compact change when smaller than the full tree." },
  settleMs: { type: "integer", minimum: 0, maximum: 2_000 },
  waitForLoad: { type: "string", enum: ["interactive", "complete"] },
  timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
});

export const ENGINE_HOST_TOOLS: readonly EngineHostToolDescriptor[] = [
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionListActions,
    description: `List the actions currently exposed by installed and enabled iPolloWork extensions. For image generation or editing, use extensionId=openai-image-generation. For initial or redesigned Design/PPT/Video artifacts, first discover media/artifact_media_review: phase=plan records visual needs before layout and queries capabilities; phase=check verifies actual files and placement before delivery. For final website/PPT visual acceptance, call media/artifact_preview_review once; it is the only supported client preview and batch-review entry. Do not start temporary servers, create helper preview pages, use generic browser screenshots, or capture slides one by one. Scene/story/product/people/cover imagery needs proactive consideration; an extra request for pictures is not required. Follow the shared guidelines for exemptions and model choice. ${ENGINE_MEDIA_MODEL_SELECTION_INSTRUCTION} Then call image_generate or image_edit through ipollowork_extension_call with that model ID. These server actions work with Image Studio closed or open; do not operate Workspace App UI tools for a normal image request. Return the saved path as a Markdown image link in the final answer. ${ENGINE_VIDEO_GENERATION_INSTRUCTION}`,
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
    description: `Prepare a read-only preview of planned tasks for the current iPolloWork Schedule. Whenever a completed answer presents a plan that could become scheduled tasks, end that answer by proactively asking the user exactly “${IPOLLOWORK_SCHEDULE_OFFER_PROMPT}”, even when the plan does not yet include concrete dates or times. Do not ask for scheduling details before making this offer. When the user directly asks to create, add, import, or arrange a plan or tasks in the iPolloWork Schedule—including requests such as “创建日程”, “加入日程”, or “安排到日程” in the iPolloWork context—treat that request as agreement to schedule and do not repeat the offer. If the conversation already contains the required scheduling details, call this tool immediately; otherwise ask only for the missing start date, time, duration, or recurrence needed to build the preview. When the user explicitly asks the task to run automatically, include automation with enabled=true and use recurrence=once for a one-time run; omit automation for ordinary reminders or planned tasks. Use explicit ISO 8601 time-zone offsets and 15-minute boundaries. Present the returned preview, including whether automatic execution is enabled, and ask for final confirmation before calling ipollowork_schedule_apply.`,
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
          automation: {
            ...objectParameters({
              enabled: { const: true },
              recurrence: { type: "string", enum: ["once", "daily", "weekly"] },
            }, ["enabled", "recurrence"]),
            description: "Include only when the user explicitly requests automatic execution. Use once for a one-time run; the project model is used automatically.",
          },
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
      profileId: { type: "string", pattern: "^[a-zA-Z0-9:_-]{1,200}$", description: "Persistent browser profile returned by an account plugin. Omit for the default browser session." },
    }, ["url"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserSnapshot,
    description: "Read a bounded semantic accessibility tree from the built-in browser. Choose mixed, interactive-only, or content-only output; optionally scope to a previous ref and request a compact line delta. Interactive controls receive stable refs; protected values are never returned.",
    parameters: objectParameters({
      tabId: { type: "string", description: "Tab ID returned by ipollowork_browser_open_url." },
      mode: { type: "string", enum: ["content", "interactive", "mixed"] },
      scopeRef: { type: "string", description: "Optional ref from the previous snapshot whose subtree should be read." },
      delta: { type: "boolean", description: "Return unchanged or a compact line delta when it saves context." },
    }, ["tabId"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserRead,
    description: "Read compact page content without the full accessibility tree. Returns headings, paragraphs, links, tables, or forms with bounded text and timing metrics. Use this before screenshots for ordinary research and extraction.",
    parameters: objectParameters({
      tabId: { type: "string", description: "Built-in browser tab ID." },
      mode: { type: "string", enum: ["article", "forms", "links", "page", "tables"] },
      maxChars: { type: "integer", minimum: 1_000, maximum: 24_000 },
    }, ["tabId"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserScreenshot,
    description: "Capture a PNG only when semantic reading is insufficient. Supports the viewport, one viewport-relative region, or one stable ref. annotated/auto mode overlays semantic refs; ifChanged suppresses duplicate image bytes. MCP clients receive the image directly; other engines receive imagePath for their image-reading tool.",
    parameters: objectParameters({
      tabId: { type: "string", description: "Built-in browser tab ID." },
      snapshotId: { type: "string", description: "Latest snapshot ID; required for ref or annotated capture." },
      target: { type: "string", enum: ["ref", "region", "viewport"] },
      ref: { type: "string", description: "Stable ref when target is ref." },
      region: objectParameters({
        x: { type: "number", minimum: 0 },
        y: { type: "number", minimum: 0 },
        width: { type: "number", exclusiveMinimum: 0, maximum: 8_192 },
        height: { type: "number", exclusiveMinimum: 0, maximum: 8_192 },
      }, ["x", "y", "width", "height"]),
      mode: { type: "string", enum: ["annotated", "auto", "plain"] },
      ifChanged: { type: "boolean", description: "Return changed=false without resending image bytes when pixels match the previous capture." },
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
      observe: browserObservationSchema,
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
