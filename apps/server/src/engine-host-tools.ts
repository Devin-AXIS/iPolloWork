import { z } from "zod";

export const ENGINE_HOST_TOOL_NAMES = {
  extensionListActions: "ipollowork_extension_list_actions",
  extensionCall: "ipollowork_extension_call",
  projectRead: "ipollowork_project_read",
  projectApply: "ipollowork_project_apply",
  listMotionPresets: "list_motion_presets",
  mutateMotion: "mutate_motion",
  conversationRead: "ipollowork_conversation_read",
  conversationApply: "ipollowork_conversation_apply",
  workTemplateSave: "ipollowork_work_template_save",
  schedulePreview: "ipollowork_schedule_preview",
  scheduleApply: "ipollowork_schedule_apply",
  workspaceAppListTools: "ipollowork_workspace_app_list_tools",
  workspaceAppCallTool: "ipollowork_workspace_app_call_tool",
  browserListTabs: "ipollowork_browser_list_tabs",
  browserDecide: "ipollowork_browser_decide",
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

const engineToolSessionParameter = {
  type: "string",
  description: "Current iPolloWork conversation ID when the engine does not forward session context automatically.",
};

export const engineHostSessionIdSchema = z.string().trim().min(1).max(200).optional().describe(
  "Current iPolloWork conversation ID when required by the active engine.",
);

export const listMotionPresetsArgsSchema = z.object({
  sessionId: engineHostSessionIdSchema,
  targetKind: z.enum(["text", "element"]).default("text"),
  phase: z.enum(["enter", "emphasis", "exit"]).optional().describe("Optional phase filter."),
  intent: z.string().trim().min(1).optional().describe("Optional semantic intent, such as title reveal or warning."),
  tone: z.string().trim().min(1).optional().describe("Optional tone, such as modern, restrained, playful, or technology."),
}).strict();

export const mutateMotionArgsSchema = z.object({
  sessionId: engineHostSessionIdSchema,
  targetKind: z.enum(["text", "element"]).default("text"),
  operation: z.enum(["upsert", "remove"]).describe("Add/replace one phase, or remove it."),
  targetSelector: z.string().trim().min(1).describe("Stable CSS selector for exactly one element in the current video."),
  phase: z.enum(["enter", "emphasis", "exit"]),
  presetId: z.string().trim().min(1).optional().describe("Stable preset id returned by list_motion_presets. Required for upsert."),
  start: z.number().finite().nonnegative().optional().describe("Timeline start in seconds. Omit to use the phase-aware default."),
  end: z.number().finite().positive().optional().describe("Explicit end in seconds, within the target clip."),
  duration: z.number().finite().positive().optional().describe("Finite duration in seconds."),
  parameters: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()])).optional().describe("Only parameters declared by the selected preset."),
}).strict().superRefine((value, context) => {
  if (value.operation === "upsert" && !value.presetId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["presetId"], message: "presetId is required for upsert" });
  }
});

export const ENGINE_BROWSER_INSTRUCTION = `## Built-in Browser
External websites only; never control iPolloWork itself. Open with ipollowork_browser_open_url, read content with ipollowork_browser_read, and obtain actionable refs with ipollowork_browser_snapshot.
Pages open in the background. Use ipollowork_browser_list_tabs to find this task's pages and control/decision state. When the user has control, stop input until they return control, then take a fresh snapshot. JEV is optional: if selected, call ipollowork_browser_decide with bounded candidate actions before acting; disabled or unavailable means use your normal reasoning. Never require JEV for browsing.
Use ipollowork_browser_act only with latest snapshot refs; never invent refs. A unique exact role/name target is re-observed before each step so a bounded batch can continue across page changes. Use expect (text or URL) for business-result verification; executed alone does not prove success. Refresh after navigation, target changes or snapshotRequired. Prefer a bounded semantic action batch with observe; use structured waits instead of guessed coordinates or timing.
Upload generated local files through the upload action with a file-input ref, or an upload-button ref plus exact expectedName. Never click the upload button first: the host handles the chooser without asking the user to select generated files.
Use screenshots only when semantics are insufficient; bound them to a ref/region, annotate refs and use ifChanged to suppress duplicates.
Publish/send/submit/pay/buy/confirm/delete or similar consequential controls require user approval for click, key or check; never retry after denial.`;

export const IPOLLOWORK_SCHEDULE_OFFER_PROMPT = "是否需要生成计划并加入 iPolloWork 日程？";

export const ENGINE_MEDIA_MODEL_SELECTION_INSTRUCTION = "Call status first and check authorization, capabilities and supported parameters. Preserve a model explicitly selected for this task or captured workbench request. An ordinary requested image or a supporting asset inside an authorized Design, PPT or Video task is an approved automatic-selection flow: use a suitable authorized saved preference when present; otherwise use the suitable authorized defaultModel, or the first suitable authorized model in returned product order when defaultModel cannot perform the operation. Do not ask or leave the asset pending solely because multiple suitable models are authorized. Ask once only when the user requested a choice, an explicit model is unavailable and substitution materially changes provider, cost or capability, or no automatic candidate satisfies the task scope and allowed cost settings. Reuse the resolved task selection for compatible assets and disclose the model used after generation. defaultModel is a computed automatic candidate, not a saved preference; never persist it without an explicit request. Missing authorization or an unqueryable capability must not block file generation: report the asset state and continue with reusable assets or a coherent editable fallback; do not open settings or wait for authorization, and never request keys in chat. Do not invent preferences or budgets. Pass the chosen stable model ID explicitly. Never submit variants outside scope; query or recover uncertain jobs before resubmitting.";

export const ENGINE_VIDEO_GENERATION_INSTRUCTION = `## Video deliverable routing
Use the prepared editable Video Studio project. Read ipollowork-video-studio once for routing; load only the current specialist/reference. Script-only uses storyboard; music-only uses soundtrack, without TTS. Delegates receive scoped inputs and guidance, not all Skills/history.
Explicit footage/provider requests use that plugin's actions; never silently substitute a provider. Script/advice-only requests submit no job. Stay in the active session project, preserve approval gates and disclose unavailable media or unverified playback. Host MCP actions own rendering and authenticated publication; the prepared task contract owns final validation. Reuse the existing player, renderer, server and validation loop.`;

const CONSEQUENTIAL_BROWSER_CONTROL = /(?:发布|发送|提交|付款|支付|购买|下单|确认|删除|移除|清空数据|授权)|(?:\b(?:publish|send|submit|pay|purchase|buy|checkout|confirm|delete|remove|authorize)\b)|(?:^post(?: now)?$)/i;

export function consequentialBrowserControlNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((action): action is Record<string, unknown> => (
      typeof action === "object" && action !== null && !Array.isArray(action)
    ))
    .filter((action) => (
      ["check", "click", "press"].includes(String(action.type))
    ))
    .flatMap(action => {
      const target = action.target;
      const name = typeof target === "object" && target !== null ? Reflect.get(target, "name") : undefined;
      return [action.expectedName, name].filter((value): value is string => typeof value === "string");
    })
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

const browserTargetSchema = objectParameters({
  role: { type: "string", maxLength: 40 }, name: { type: "string", minLength: 1, maxLength: 200 },
}, ["role", "name"]);
// Re-observe named targets between steps; preserve the existing ref contract for precise single-page work.
for (const action of [...browserActionSchema.oneOf]) {
  const properties = action.properties;
  const required = action.required;
  if (typeof properties !== "object" || properties === null || !Reflect.has(properties, "ref") || !Array.isArray(required)) continue;
  const targetedProperties = Object.fromEntries(Object.entries(properties).filter(([field]) => field !== "ref" && field !== "expectedName"));
  browserActionSchema.oneOf.push(objectParameters({
    ...targetedProperties, target: browserTargetSchema,
  }, [...required.filter(field => field !== "ref" && field !== "expectedName"), "target"]));
}

const browserExpectationSchema = objectParameters({
  condition: { type: "string", enum: ["text", "url"] },
  value: { type: "string", minLength: 1, maxLength: 500 },
  match: { type: "string", enum: ["equals", "contains"] },
  timeoutMs: { type: "integer", minimum: 100, maximum: 10_000 },
}, ["condition", "value"]);

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
    description: `Discover actions from installed, enabled extensions; follow their returned schemas and model-selection instructions. For images use extensionId=openai-image-generation, query status, then image_generate/image_edit via ipollowork_extension_call with an explicit authorized model ID. Normal image requests use actions without Workspace App UI, even with Image Studio closed. Return the saved Markdown image link.
For initial/redesigned Design/PPT/Video artifacts, discover media/artifact_media_review: plan visual needs/capabilities before layout, check actual files and placement before delivery. Consider suitable supporting imagery proactively. Website/PPT final acceptance uses media/artifact_preview_review once, the supported client batch preview/review; do not create preview servers/pages, use generic browser screenshots or capture slides individually.
${ENGINE_VIDEO_GENERATION_INSTRUCTION}`,
    parameters: objectParameters({
      extensionId: {
        type: "string",
        description: "Optional extension ID used to filter the action catalog.",
      },
    }),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.extensionCall,
    description: "Call an iPolloWork extension action after inspecting it with ipollowork_extension_list_actions. Preserve the declared JSON types: booleans and numbers are not strings, and arrays remain arrays. Never stringify nested action arguments.",
    parameters: objectParameters({
      extensionId: { type: "string", description: "Extension ID returned by the action catalog." },
      action: { type: "string", description: "Action ID returned by the action catalog." },
      args: { type: "object", additionalProperties: true, description: "Action arguments." },
    }, ["extensionId", "action"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.conversationRead,
    description: "Read this conversation's saved work template and version when the user asks to inspect or edit that method. Ordinary tasks use the engine's native plan and execution; this read is optional. Do not change project defaults.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.conversationApply,
    description: "Edit this conversation's example template after reading its version, when the user requests a method change. Preserve user-selected methods. Goals, suggested steps and reference roles are guidance; native agent tools own plans, delegation and results. Optional notes must reflect verified work. This tool cannot change the execution engine or claim accepted completion.",
    parameters: objectParameters({
      expectedVersion: { type: "integer", minimum: 0 },
      templateId: { type: "string" },
      source: { type: "string", enum: ["auto", "custom"] },
      goal: { type: "string" },
      workKind: { type: "string", enum: ["general", "video", "design", "development", "research", "document"] },
      config: { type: "object", description: "Complete team configuration; preserve fields from conversation_read when editing." },
      stages: { type: "array", items: { type: "object" } },
      acceptance: { type: "array", items: { type: "string" } },
      progress: { type: "object", properties: {
        summary: { type: "string" }, decisions: { type: "array", items: { type: "string" } },
        outputs: { type: "array", items: { type: "string" } }, blockers: { type: "array", items: { type: "string" } },
      }, additionalProperties: false },
    }, ["expectedVersion"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.workTemplateSave,
    description: "Save this conversation's reusable work method as a named template when the user asks to save or reuse it. Excludes instance progress and output records. Updates require the saved template version; existing conversations retain their snapshots.",
    parameters: objectParameters({ name: { type: "string" }, description: { type: "string" }, templateId: { type: "string" }, expectedVersion: { type: "integer", minimum: 0 } }, ["name"]),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectRead,
    description: "Read the schema-validated iPolloWork project configuration for the current workspace. Use only in an explicitly opened Project Builder conversation.",
    parameters: objectParameters({ sessionId: engineToolSessionParameter }),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.projectApply,
    description: "Apply one complete schema-validated iPolloWork project configuration after the user explicitly confirms the proposal in Project Builder.",
    parameters: objectParameters({
      sessionId: engineToolSessionParameter,
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
    name: ENGINE_HOST_TOOL_NAMES.listMotionPresets,
    description: "List the product-owned semantic motion presets for a text or element target in the current Video Studio session. Filter by phase, intent, or tone, then use the returned preset id with mutate_motion.",
    parameters: objectParameters({
      sessionId: engineToolSessionParameter,
      targetKind: { type: "string", enum: ["text", "element"], description: "Use text for leaf text; element for wrapper/camera targets. Defaults to text." },
      phase: { type: "string", enum: ["enter", "emphasis", "exit"] },
      intent: { type: "string", minLength: 1 },
      tone: { type: "string", minLength: 1 },
    }),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.mutateMotion,
    description: "Add, replace, update, or remove one semantic motion phase on exactly one text or element target in the current Video Studio session. This is the canonical path for UI, typed chat, and voice-transcribed animation requests.",
    parameters: objectParameters({
      sessionId: engineToolSessionParameter,
      targetKind: { type: "string", enum: ["text", "element"], description: "Use text for leaf text; element for wrapper/camera targets. Defaults to text." },
      operation: { type: "string", enum: ["upsert", "remove"] },
      targetSelector: { type: "string", minLength: 1 },
      phase: { type: "string", enum: ["enter", "emphasis", "exit"] },
      presetId: { type: "string", minLength: 1 },
      start: { type: "number", minimum: 0 },
      end: { type: "number", exclusiveMinimum: 0 },
      duration: { type: "number", exclusiveMinimum: 0 },
      parameters: {
        type: "object",
        additionalProperties: { type: ["string", "number", "boolean"] },
      },
    }, ["operation", "targetSelector", "phase"]),
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
    name: ENGINE_HOST_TOOL_NAMES.browserListTabs,
    description: "List this task's browser pages, user/agent control and optional JEV availability. Does not select a page or change focus.",
    parameters: objectParameters({}),
  },
  {
    name: ENGINE_HOST_TOOL_NAMES.browserDecide,
    description: "When the user selected JEV, choose among 2–32 proposed semantic actions using the connected JEV extension. Sends a fresh bounded page snapshot. Returns a recommendation for browser_act, never executes it. Disabled/unavailable falls back to normal agent reasoning without blocking browsing.",
    parameters: objectParameters({
      tabId: { type: "string" }, goal: { type: "string", minLength: 1, maxLength: 2_000 },
      candidates: { type: "array", minItems: 2, maxItems: 32, items: browserActionSchema },
    }, ["tabId", "goal", "candidates"]),
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
      expect: browserExpectationSchema,
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
