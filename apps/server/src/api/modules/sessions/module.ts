/**
 * Sessions API module.
 *
 * The one place the public API talks to a conversation engine. Every operation resolves
 * the workspace, looks the engine adapter up by `workspace.engineId`, and then speaks only
 * the `EngineConnection` contract from `../../engine/types.js` — so OpenCode and DeepSeek
 * Harness are reachable through a single set of URLs, and adding a third engine adds no
 * routes here.
 *
 * Two rules shape the handlers. Scope and writability are enforced by
 * `registerApiModules` from the operation declaration, so a handler never re-checks them.
 * And a capability an engine does not have is reported as `501 engine_capability_unsupported`
 * naming the engine and the capability, rather than as a confusing upstream failure.
 */

import { z } from "zod";

import { ApiError } from "../../../errors.js";
import type { RequestContext } from "../../../routes/registry.js";
import {
  ENGINE_EVENT_TYPES,
  ENGINE_PROMPT_OPTIONS,
  type EngineAdapterRegistry,
  type EngineCapabilities,
  type EngineConnection,
  type EngineEvent,
  type EnginePromptPart,
} from "../../engine/types.js";
import type { ApiModule, ApiModuleContext, ApiOperation, JsonSchema } from "../../module.js";
import { createSseResponse, formatSseFrame, type SseFrame } from "../../sse.js";

/* -------------------------------------------------------------------------- */
/* Request schemas                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Exported so the OpenAPI module can derive request documentation from the same
 * definitions the handlers validate against, instead of a hand-kept copy.
 */
export const engineModelRefSchema = z.strictObject({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
});

export const createSessionBodySchema = z.strictObject({
  title: z.string().min(1).max(500).optional(),
  agent: z.string().min(1).optional(),
  model: engineModelRefSchema.optional(),
});

export const updateSessionBodySchema = z.strictObject({
  title: z.string().min(1).max(500),
});

export const promptPartSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().min(1) }),
  z.strictObject({
    type: z.literal("file"),
    mime: z.string().min(1),
    url: z.string().min(1),
    filename: z.string().min(1).optional(),
  }),
  z.strictObject({ type: z.literal("agent"), name: z.string().min(1) }),
]);

export const promptSessionBodySchema = z
  .strictObject({
    text: z.string().min(1).optional(),
    parts: z.array(promptPartSchema).optional(),
    model: engineModelRefSchema.optional(),
    agent: z.string().min(1).optional(),
    system: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
    variant: z.string().min(1).optional(),
    delivery: z.enum(["steer", "queue"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.text === undefined && (value.parts === undefined || value.parts.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Provide `text`, or a non-empty `parts` array",
        path: ["text"],
      });
    }
  });

export const replyPermissionBodySchema = z.strictObject({
  reply: z.enum(["once", "always", "reject"]),
});

export const replyQuestionBodySchema = z.strictObject({
  answers: z.array(z.array(z.string())).min(1),
});

export const streamSessionEventsQuerySchema = z.strictObject({
  after: z.string().min(1).optional(),
});

/* -------------------------------------------------------------------------- */
/* Response schemas (OpenAPI)                                                  */
/* -------------------------------------------------------------------------- */

const errorSchema: JsonSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", description: "Stable machine-readable error code." },
    message: { type: "string" },
    details: { description: "Optional structured context; shape depends on `code`." },
  },
};

const sessionSchema: JsonSchema = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    parentId: { type: ["string", "null"], description: "Parent session for a fork." },
    directory: { type: ["string", "null"] },
    createdAt: { type: ["number", "null"], description: "Epoch milliseconds." },
    updatedAt: { type: ["number", "null"], description: "Epoch milliseconds." },
    archivedAt: { type: ["number", "null"], description: "Epoch milliseconds." },
  },
};

const capabilitiesSchema: JsonSchema = {
  type: "object",
  description: "What the workspace engine supports. Unsupported operations answer 501.",
  required: ["streaming", "resumableStreaming", "permissions", "questions", "interrupt", "wait", "promptOptions"],
  properties: {
    streaming: { type: "boolean" },
    resumableStreaming: { type: "boolean", description: "`?after=` resumption is honoured." },
    permissions: { type: "boolean" },
    questions: { type: "boolean" },
    interrupt: { type: "boolean" },
    wait: { type: "boolean" },
    promptOptions: {
      type: "object",
      description:
        "Optional `prompt` fields this engine applies. A field reported `false` is rejected "
        + "with 501 rather than accepted and silently ignored.",
      required: ["system", "reasoningEffort", "variant"],
      properties: {
        system: { type: "boolean" },
        reasoningEffort: { type: "boolean" },
        variant: { type: "boolean" },
      },
    },
  },
};

const sessionEnvelopeSchema: JsonSchema = {
  type: "object",
  required: ["session", "engine", "capabilities"],
  properties: {
    session: sessionSchema,
    engine: { type: "string", description: "Engine id that owns the session." },
    capabilities: capabilitiesSchema,
  },
};

const permissionSchema: JsonSchema = {
  type: "object",
  required: ["id", "sessionId", "kind", "resources", "remember", "metadata", "receivedAt"],
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    kind: { type: "string", description: "Engine-specific permission kind, e.g. a tool name." },
    resources: { type: "array", items: { type: "string" } },
    remember: {
      type: "array",
      items: { type: "string" },
      description: "Scopes an answer may be persisted for.",
    },
    metadata: { type: "object", additionalProperties: true },
    receivedAt: { type: "number", description: "Epoch milliseconds." },
  },
};

const questionSchema: JsonSchema = {
  type: "object",
  required: ["id", "sessionId", "questions", "receivedAt"],
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        required: ["question", "options"],
        properties: {
          header: { type: "string" },
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              required: ["label"],
              properties: { label: { type: "string" }, description: { type: "string" } },
            },
          },
          multiple: { type: "boolean" },
          custom: { type: "boolean", description: "A free-form answer is accepted." },
        },
      },
    },
    receivedAt: { type: "number", description: "Epoch milliseconds." },
  },
};

const engineEventSchema: JsonSchema = {
  type: "object",
  description: "One normalized engine event, delivered as the `data` of an SSE frame.",
  required: ["type"],
  properties: {
    type: { type: "string", enum: [...ENGINE_EVENT_TYPES] },
    sessionId: { type: "string" },
  },
  additionalProperties: true,
};

const workspacePathParams: JsonSchema = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", description: "Workspace id." } },
};

const sessionPathParams: JsonSchema = {
  type: "object",
  required: ["workspaceId", "sessionId"],
  properties: {
    workspaceId: { type: "string", description: "Workspace id." },
    sessionId: { type: "string", description: "Session id." },
  },
};

function pathParamsWith(name: string, description: string): JsonSchema {
  return {
    type: "object",
    required: ["workspaceId", "sessionId", name],
    properties: {
      workspaceId: { type: "string", description: "Workspace id." },
      sessionId: { type: "string", description: "Session id." },
      [name]: { type: "string", description },
    },
  };
}

const badRequest = { description: "The request body or query failed validation.", schema: errorSchema };
const notFound = { description: "Unknown workspace or session.", schema: errorSchema };
const engineNotRegistered = {
  description: "The workspace names an engine that is not registered on this server.",
  schema: errorSchema,
};
const capabilityUnsupported = {
  description: "The workspace engine does not support this operation.",
  schema: errorSchema,
};
const engineFailed = { description: "The engine rejected or failed the request.", schema: errorSchema };

/* -------------------------------------------------------------------------- */
/* SSE framing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turns one engine event into an SSE frame.
 *
 * `seq` becomes the `id:` line rather than staying in the payload: that is exactly what a
 * client echoes back as `?after=` (or `Last-Event-ID`) to resume, so keeping it in one
 * place stops the two copies from disagreeing.
 */
export function sessionEventToSseFrame(event: EngineEvent): SseFrame {
  const { seq, ...rest } = event as EngineEvent & { seq?: string };
  const frame: SseFrame = { event: event.type, data: rest };
  if (typeof seq === "string" && seq !== "") frame.id = seq;
  return frame;
}

/** Convenience wrapper: the exact bytes written to the stream for one event. */
export function formatSessionEventFrame(event: EngineEvent): string {
  return formatSseFrame(sessionEventToSseFrame(event));
}

/* -------------------------------------------------------------------------- */
/* Handler helpers                                                             */
/* -------------------------------------------------------------------------- */

interface WorkspaceLike {
  id?: string;
  engineId?: string;
}

function requireParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name]?.trim();
  if (!value) {
    throw new ApiError(400, "invalid_request", `Missing path parameter: ${name}`, { param: name });
  }
  return value;
}

/**
 * Structural rather than `instanceof` check: the registry can be constructed in a
 * different Bun module context than this file, which is the same hazard `isApiError`
 * exists for in `../../../errors.ts`.
 */
function engineRegistry(context: ApiModuleContext): EngineAdapterRegistry {
  const engines = context.services.engines as EngineAdapterRegistry | undefined;
  if (!engines || typeof engines.get !== "function") {
    throw new ApiError(
      500,
      "engine_registry_unavailable",
      "Engine adapter registry is not configured for the sessions module",
    );
  }
  return engines;
}

async function connectEngine(context: ApiModuleContext, ctx: RequestContext): Promise<EngineConnection> {
  const workspaceId = requireParam(ctx, "workspaceId");
  const workspace = (await context.resolveWorkspace(ctx.config, workspaceId)) as WorkspaceLike | undefined;
  const adapter = engineRegistry(context).get(workspace?.engineId);
  return adapter.connect(workspace);
}

/** Capability flags that are a plain yes/no, as opposed to the `promptOptions` group. */
type BooleanCapability = {
  [K in keyof EngineCapabilities]: EngineCapabilities[K] extends boolean ? K : never;
}[keyof EngineCapabilities];

function requireCapability(
  connection: EngineConnection,
  capability: BooleanCapability,
  operationId: string,
): void {
  if (connection.capabilities[capability]) return;
  throw new ApiError(
    501,
    "engine_capability_unsupported",
    `Engine ${connection.engineId} does not support ${capability}`,
    { engine: connection.engineId, capability, operationId },
  );
}

/**
 * Rejects prompt options the selected engine would not actually apply.
 *
 * The engines differ: OpenCode's v2 prompt endpoint has no field for `system` or
 * `reasoningEffort`, while DeepSeek Harness applies both. Passing them through anyway
 * would return a normal 202 while the option vanished inside the adapter, so the caller
 * would have no way to tell a working system prompt from an ignored one. Failing here
 * makes the difference visible at the moment it matters.
 */
function requireSupportedPromptOptions(
  connection: EngineConnection,
  body: { system?: string; reasoningEffort?: string; variant?: string },
): void {
  const unsupported = ENGINE_PROMPT_OPTIONS.filter(
    (option) => body[option] !== undefined && !connection.capabilities.promptOptions[option],
  );
  if (unsupported.length === 0) return;
  throw new ApiError(
    501,
    "engine_prompt_option_unsupported",
    `Engine ${connection.engineId} does not apply: ${unsupported.join(", ")}`,
    { engine: connection.engineId, unsupported, operationId: "promptSession" },
  );
}

/** Turns a zod failure into the API's `400 invalid_payload`, keeping every issue. */
export function parsePayload<T>(schema: z.ZodType<T>, value: unknown, what = "Request body"): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError(400, "invalid_payload", `${what} failed validation`, {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join("."),
      code: issue.code,
      message: issue.message,
    })),
  });
}

type PromptBody = z.infer<typeof promptSessionBodySchema>;

/** `text` is sugar for a leading text part; both may be supplied together. */
export function buildPromptParts(body: PromptBody): EnginePromptPart[] {
  const parts: EnginePromptPart[] = [];
  if (body.text !== undefined) parts.push({ type: "text", text: body.text });
  for (const part of body.parts ?? []) parts.push(part);
  return parts;
}

function describeEngine(connection: EngineConnection): { engine: string; capabilities: EngineCapabilities } {
  return { engine: connection.engineId, capabilities: connection.capabilities };
}

/* -------------------------------------------------------------------------- */
/* Module                                                                      */
/* -------------------------------------------------------------------------- */

export const SESSIONS_OPERATION_IDS = [
  "createSession",
  "getSession",
  "deleteSession",
  "updateSession",
  "promptSession",
  "interruptSession",
  "streamSessionEvents",
  "listSessionPermissions",
  "replySessionPermission",
  "listSessionQuestions",
  "replySessionQuestion",
] as const;

const BASE = "/api/v1/workspaces/:workspaceId/sessions";

export const sessionsModule: ApiModule = {
  id: "sessions",
  title: "Sessions",
  description:
    "Engine-agnostic conversation sessions: create, inspect, prompt, interrupt, stream events, and answer permission and question requests.",
  version: "1.0.0",
  stability: "stable",

  register(context: ApiModuleContext): ApiOperation[] {
    const { jsonResponse, readJsonBody } = context;

    return [
      {
        operationId: "createSession",
        method: "POST",
        path: BASE,
        summary: "Create a session in a workspace",
        description:
          "Creates a session on the workspace's engine. `agent` and `model` are applied at creation when the engine supports them.",
        effect: "write",
        pathParams: workspacePathParams,
        requestBody: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500, description: "Initial session title." },
            agent: { type: "string", minLength: 1, description: "Agent / preset id to start the session with." },
            model: {
              type: "object",
              required: ["providerID", "modelID"],
              properties: { providerID: { type: "string" }, modelID: { type: "string" } },
            },
          },
          additionalProperties: false,
        },
        responses: {
          201: { description: "The created session.", schema: sessionEnvelopeSchema },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const body = parsePayload(createSessionBodySchema, await readJsonBody(ctx.request));
          const session = await connection.createSession(body);
          return jsonResponse({ session, ...describeEngine(connection) }, 201);
        },
      },

      {
        operationId: "getSession",
        method: "GET",
        path: `${BASE}/:sessionId`,
        summary: "Get one session",
        description: "Returns the session as the engine reports it, together with the engine's capabilities.",
        effect: "read",
        pathParams: sessionPathParams,
        responses: {
          200: { description: "The session.", schema: sessionEnvelopeSchema },
          404: notFound,
          409: engineNotRegistered,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const session = await connection.getSession(requireParam(ctx, "sessionId"));
          return jsonResponse({ session, ...describeEngine(connection) });
        },
      },

      {
        operationId: "deleteSession",
        method: "DELETE",
        path: `${BASE}/:sessionId`,
        summary: "Delete a session",
        description: "Permanently removes the session from the engine. Not reversible.",
        effect: "destructive",
        pathParams: sessionPathParams,
        responses: {
          200: {
            description: "The session was deleted.",
            schema: {
              type: "object",
              required: ["deleted", "sessionId"],
              properties: { deleted: { type: "boolean", enum: [true] }, sessionId: { type: "string" } },
            },
          },
          404: notFound,
          409: engineNotRegistered,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          await connection.deleteSession(sessionId);
          return jsonResponse({ deleted: true, sessionId });
        },
      },

      {
        operationId: "updateSession",
        method: "PATCH",
        path: `${BASE}/:sessionId`,
        summary: "Update a session title",
        description: "Renames the session. The refreshed session is returned.",
        effect: "write",
        pathParams: sessionPathParams,
        requestBody: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 500 } },
          additionalProperties: false,
        },
        responses: {
          200: { description: "The updated session.", schema: sessionEnvelopeSchema },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          const body = parsePayload(updateSessionBodySchema, await readJsonBody(ctx.request));
          await connection.renameSession(sessionId, body.title);
          const session = await connection.getSession(sessionId);
          return jsonResponse({ session, ...describeEngine(connection) });
        },
      },

      {
        operationId: "promptSession",
        method: "POST",
        path: `${BASE}/:sessionId/prompt`,
        summary: "Send a prompt to a session",
        description:
          "Queues a user turn. Returns as soon as the engine accepts it — follow `GET .../events` for the assistant response. Supply `text`, `parts`, or both; `parts` are appended after `text`.",
        effect: "write",
        pathParams: sessionPathParams,
        requestBody: {
          type: "object",
          description: "At least one of `text` or a non-empty `parts` is required.",
          properties: {
            text: { type: "string", minLength: 1, description: "Shorthand for a single leading text part." },
            parts: {
              type: "array",
              minItems: 1,
              items: {
                oneOf: [
                  {
                    type: "object",
                    required: ["type", "text"],
                    properties: { type: { const: "text" }, text: { type: "string", minLength: 1 } },
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    required: ["type", "mime", "url"],
                    properties: {
                      type: { const: "file" },
                      mime: { type: "string" },
                      url: { type: "string", description: "Absolute URL or data: URI of the attachment." },
                      filename: { type: "string" },
                    },
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    required: ["type", "name"],
                    properties: { type: { const: "agent" }, name: { type: "string" } },
                    additionalProperties: false,
                  },
                ],
              },
            },
            model: {
              type: "object",
              required: ["providerID", "modelID"],
              properties: { providerID: { type: "string" }, modelID: { type: "string" } },
            },
            agent: { type: "string", description: "Agent / mode to run this turn with." },
            system: {
              type: "string",
              description:
                "Per-turn system prompt override. Engine-dependent: rejected with 501 "
                + "`engine_prompt_option_unsupported` by engines that cannot apply it, rather than "
                + "being accepted and ignored.",
            },
            reasoningEffort: {
              type: "string",
              description:
                "Reasoning-effort hint. Engine-dependent, same 501 contract as `system`.",
            },
            variant: { type: "string", description: "Model variant selector." },
            delivery: {
              type: "string",
              enum: ["steer", "queue"],
              description: "`steer` interrupts the in-flight turn; `queue` runs after it.",
            },
          },
          additionalProperties: false,
        },
        responses: {
          202: {
            description: "The prompt was accepted.",
            schema: {
              type: "object",
              required: ["accepted", "sessionId", "messageId"],
              properties: {
                accepted: { type: "boolean", enum: [true] },
                sessionId: { type: "string" },
                messageId: { type: ["string", "null"], description: "Engine message id, when the engine reports one." },
              },
            },
          },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          501: {
            description:
              "The workspace engine cannot apply one of the supplied prompt options "
              + "(`system`, `reasoningEffort`, `variant`). `details.unsupported` lists them.",
            schema: errorSchema,
          },
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          const body = parsePayload(promptSessionBodySchema, await readJsonBody(ctx.request));
          requireSupportedPromptOptions(connection, body);
          const result = await connection.prompt({
            sessionId,
            parts: buildPromptParts(body),
            ...(body.model ? { model: body.model } : {}),
            ...(body.agent ? { agent: body.agent } : {}),
            ...(body.system ? { system: body.system } : {}),
            ...(body.reasoningEffort ? { reasoningEffort: body.reasoningEffort } : {}),
            ...(body.variant ? { variant: body.variant } : {}),
            ...(body.delivery ? { delivery: body.delivery } : {}),
          });
          return jsonResponse({ accepted: true, sessionId, messageId: result?.messageId ?? null }, 202);
        },
      },

      {
        operationId: "interruptSession",
        method: "POST",
        path: `${BASE}/:sessionId/interrupt`,
        summary: "Interrupt the running turn",
        description: "Aborts whatever the session is currently doing. Requires the `interrupt` engine capability.",
        effect: "write",
        pathParams: sessionPathParams,
        requestBody: { type: "object", properties: {}, additionalProperties: false, description: "No body." },
        responses: {
          200: {
            description: "Interrupt result. `interrupted` is false when nothing was running.",
            schema: {
              type: "object",
              required: ["interrupted", "sessionId"],
              properties: { interrupted: { type: "boolean" }, sessionId: { type: "string" } },
            },
          },
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          requireCapability(connection, "interrupt", "interruptSession");
          const interrupted = await connection.interrupt(sessionId);
          return jsonResponse({ interrupted, sessionId });
        },
      },

      {
        operationId: "streamSessionEvents",
        method: "GET",
        path: `${BASE}/:sessionId/events`,
        summary: "Stream session events (SSE)",
        description:
          "Server-sent events for one session. Each frame carries the event type on the `event:` line and the normalized event as JSON on `data:`. Events with a durable cursor also carry an `id:` line; pass that value back as `?after=` to resume without gaps. Engines whose `resumableStreaming` capability is false reject `?after=` with 501. A `stream.open` frame is sent immediately and `: keepalive` comments keep intermediaries from timing the connection out.",
        effect: "read",
        streaming: "sse",
        pathParams: sessionPathParams,
        query: {
          type: "object",
          properties: {
            after: {
              type: "string",
              minLength: 1,
              description: "Durable cursor from a previous `id:` line. Requires `resumableStreaming`.",
            },
          },
          additionalProperties: false,
        },
        responses: {
          200: {
            description: "An open event stream.",
            contentType: "text/event-stream",
            schema: engineEventSchema,
          },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          requireCapability(connection, "streaming", "streamSessionEvents");

          const raw = ctx.url.searchParams.get("after");
          const query = parsePayload(
            streamSessionEventsQuerySchema,
            raw === null || raw.trim() === "" ? {} : { after: raw.trim() },
            "Query string",
          );
          if (query.after !== undefined) {
            requireCapability(connection, "resumableStreaming", "streamSessionEvents");
          }

          // Resolve the session before opening the stream so an unknown id is a plain
          // 404 instead of a stream that opens and immediately errors.
          await connection.getSession(sessionId);

          return createSseResponse({
            signal: ctx.request.signal,
            hello: {
              event: "stream.open",
              data: {
                sessionId,
                engine: connection.engineId,
                after: query.after ?? null,
                resumable: connection.capabilities.resumableStreaming,
              },
            },
            start: async (emit, signal) => {
              await connection.subscribe({
                sessionId,
                ...(query.after !== undefined ? { after: query.after } : {}),
                signal,
                onEvent: (event) => emit(sessionEventToSseFrame(event)),
              });
            },
          });
        },
      },

      {
        operationId: "listSessionPermissions",
        method: "GET",
        path: `${BASE}/:sessionId/permissions`,
        summary: "List pending permission requests",
        description: "Permission requests the session is currently blocked on. Requires the `permissions` capability.",
        effect: "read",
        pathParams: sessionPathParams,
        responses: {
          200: {
            description: "Pending permission requests, oldest first.",
            schema: {
              type: "object",
              required: ["permissions"],
              properties: { permissions: { type: "array", items: permissionSchema } },
            },
          },
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          requireCapability(connection, "permissions", "listSessionPermissions");
          const permissions = await connection.listPermissions(sessionId);
          return jsonResponse({ permissions });
        },
      },

      {
        operationId: "replySessionPermission",
        method: "POST",
        path: `${BASE}/:sessionId/permissions/:permissionId`,
        summary: "Answer a permission request",
        description:
          "Answers one pending permission request. `once` allows this occurrence, `always` persists the allowance, `reject` denies it.",
        effect: "write",
        pathParams: pathParamsWith("permissionId", "Permission request id."),
        requestBody: {
          type: "object",
          required: ["reply"],
          properties: { reply: { type: "string", enum: ["once", "always", "reject"] } },
          additionalProperties: false,
        },
        responses: {
          200: {
            description: "The reply was delivered.",
            schema: {
              type: "object",
              required: ["ok", "permissionId", "reply"],
              properties: {
                ok: { type: "boolean", enum: [true] },
                permissionId: { type: "string" },
                reply: { type: "string", enum: ["once", "always", "reject"] },
              },
            },
          },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          const permissionId = requireParam(ctx, "permissionId");
          requireCapability(connection, "permissions", "replySessionPermission");
          const body = parsePayload(replyPermissionBodySchema, await readJsonBody(ctx.request));
          await connection.replyPermission({ sessionId, permissionId, reply: body.reply });
          return jsonResponse({ ok: true, permissionId, reply: body.reply });
        },
      },

      {
        operationId: "listSessionQuestions",
        method: "GET",
        path: `${BASE}/:sessionId/questions`,
        summary: "List pending questions",
        description: "Questions the engine is waiting on an answer for. Requires the `questions` capability.",
        effect: "read",
        pathParams: sessionPathParams,
        responses: {
          200: {
            description: "Pending questions, oldest first.",
            schema: {
              type: "object",
              required: ["questions"],
              properties: { questions: { type: "array", items: questionSchema } },
            },
          },
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          requireCapability(connection, "questions", "listSessionQuestions");
          const questions = await connection.listQuestions(sessionId);
          return jsonResponse({ questions });
        },
      },

      {
        operationId: "replySessionQuestion",
        method: "POST",
        path: `${BASE}/:sessionId/questions/:questionId`,
        summary: "Answer a pending question",
        description:
          "Answers one pending question request. `answers` holds one array of selected option labels per question in the request, in order.",
        effect: "write",
        pathParams: pathParamsWith("questionId", "Question request id."),
        requestBody: {
          type: "object",
          required: ["answers"],
          properties: {
            answers: {
              type: "array",
              minItems: 1,
              description: "One entry per question; each entry lists the chosen option labels.",
              items: { type: "array", items: { type: "string" } },
            },
          },
          additionalProperties: false,
        },
        responses: {
          200: {
            description: "The answer was delivered.",
            schema: {
              type: "object",
              required: ["ok", "questionId"],
              properties: { ok: { type: "boolean", enum: [true] }, questionId: { type: "string" } },
            },
          },
          400: badRequest,
          404: notFound,
          409: engineNotRegistered,
          501: capabilityUnsupported,
          502: engineFailed,
        },
        handler: async (ctx) => {
          const connection = await connectEngine(context, ctx);
          const sessionId = requireParam(ctx, "sessionId");
          const questionId = requireParam(ctx, "questionId");
          requireCapability(connection, "questions", "replySessionQuestion");
          const body = parsePayload(replyQuestionBodySchema, await readJsonBody(ctx.request));
          await connection.replyQuestion({ sessionId, questionId, answers: body.answers });
          return jsonResponse({ ok: true, questionId });
        },
      },
    ];
  },
};
