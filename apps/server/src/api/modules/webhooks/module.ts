import { randomBytes } from "node:crypto";

import { ApiError } from "../../../errors.js";
import type { RequestContext } from "../../../routes/registry.js";
import type { ApiModule, ApiModuleContext, ApiOperation, JsonSchema } from "../../module.js";
import {
  deliverWebhook,
  validateWebhookUrl,
  webhookPrivateNetworkAllowed,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_URL_MAX_LENGTH,
  type WebhookDeliveryOptions,
  type WebhookDeliveryResult,
} from "./delivery.js";
import {
  isKnownWebhookEvent,
  toPublicWebhook,
  WebhookStore,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_PER_WORKSPACE,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_WILDCARD,
  type CreateWebhookInput,
  type WebhookStoreLike,
} from "./store.js";

/**
 * The `webhooks` module: outbound event subscriptions for a workspace.
 *
 * This is the one API surface where the server makes an outbound request to an address
 * the caller chose, so admission control (`validateWebhookUrl`) and authentication of the
 * delivery (`signWebhookPayload`) live in `delivery.ts` as pure functions and are exercised
 * directly by tests. The module here is deliberately thin: validate, store, hand off.
 */

/** Minimum length for a caller-supplied signing secret. */
export const WEBHOOK_SECRET_MIN_LENGTH = 16;
export const WEBHOOK_SECRET_MAX_LENGTH = 256;
/** Bytes of entropy in a server-generated secret. */
const GENERATED_SECRET_BYTES = 32;
/** A test ping is a single shot: a caller waiting on the response must not wait out a retry ladder. */
const TEST_DELIVERY_TIMEOUT_MS = 5_000;

export interface ParsedCreateWebhookInput {
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  /** True when the server minted the secret, which is the only case it is echoed back. */
  generatedSecret: boolean;
}

/**
 * Validates a `createWebhook` body.
 *
 * Exported and pure so the admission rules can be tested without a request. Every
 * rejection carries a distinct code plus a machine-readable `details`, because a caller
 * that submitted a blocked URL needs to know it was blocked as an address rather than
 * malformed — those two lead to very different fixes.
 */
export function parseCreateWebhookInput(
  body: Record<string, unknown>,
  opts: { allowPrivate?: boolean } = {},
): ParsedCreateWebhookInput {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    throw new ApiError(400, "webhook_url_invalid", "A webhook url is required", { reason: "missing_url" });
  }

  const verdict = validateWebhookUrl(url, { allowPrivate: opts.allowPrivate === true });
  if (!verdict.ok) {
    throw new ApiError(400, "webhook_url_invalid", `Webhook url is not allowed: ${verdict.reason}`, {
      reason: verdict.reason,
      ...(verdict.reason === "private_address" || verdict.reason === "blocked_hostname"
        ? { hint: "Set IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE=1 to permit private destinations." }
        : {}),
    });
  }

  const rawEvents = body.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw new ApiError(400, "webhook_events_invalid", "At least one event type is required", {
      available: [WEBHOOK_WILDCARD, ...WEBHOOK_EVENT_TYPES],
    });
  }
  const events: string[] = [];
  for (const entry of rawEvents) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ApiError(400, "webhook_events_invalid", "Event types must be non-empty strings");
    }
    const value = entry.trim();
    if (!isKnownWebhookEvent(value)) {
      throw new ApiError(400, "webhook_events_invalid", `Unknown event type: ${value}`, {
        event: value,
        available: [WEBHOOK_WILDCARD, ...WEBHOOK_EVENT_TYPES],
      });
    }
    if (!events.includes(value)) events.push(value);
  }

  let secret: string | undefined;
  let generatedSecret = false;
  if (body.secret === undefined || body.secret === null) {
    // Unsigned deliveries give a subscriber no way to tell iPolloWork from anyone who
    // learned the URL, so a secret is always present — minted here when none was given.
    secret = randomBytes(GENERATED_SECRET_BYTES).toString("hex");
    generatedSecret = true;
  } else if (typeof body.secret !== "string") {
    throw new ApiError(400, "webhook_secret_invalid", "Webhook secret must be a string");
  } else if (
    body.secret.length < WEBHOOK_SECRET_MIN_LENGTH ||
    body.secret.length > WEBHOOK_SECRET_MAX_LENGTH
  ) {
    throw new ApiError(
      400,
      "webhook_secret_invalid",
      `Webhook secret must be between ${WEBHOOK_SECRET_MIN_LENGTH} and ${WEBHOOK_SECRET_MAX_LENGTH} characters`,
      { minLength: WEBHOOK_SECRET_MIN_LENGTH, maxLength: WEBHOOK_SECRET_MAX_LENGTH },
    );
  } else {
    secret = body.secret;
  }

  if (body.active !== undefined && typeof body.active !== "boolean") {
    throw new ApiError(400, "webhook_active_invalid", "Webhook active must be a boolean");
  }

  return {
    url,
    events,
    active: body.active !== false,
    generatedSecret,
    ...(secret ? { secret } : {}),
  };
}

/**
 * Fans one event out to every matching subscription in a workspace.
 *
 * Exported for the modules that produce events (sessions, tasks) so they do not each
 * reimplement matching and delivery. The URL is re-validated at send time: a record may
 * predate a tightening of the rules, or have been edited into the JSON store by hand, and
 * a stored URL is not evidence that the URL is still allowed.
 */
export async function dispatchWebhookEvent(
  store: WebhookStoreLike,
  event: { workspaceId: string; type: string; data: unknown },
  opts: WebhookDeliveryOptions & { allowPrivate?: boolean } = {},
): Promise<WebhookDeliveryResult[]> {
  const { allowPrivate, ...deliveryOptions } = opts;
  const subscriptions = await store.listForEvent(event.workspaceId, event.type);
  const allowed = subscriptions.filter(
    (subscription) => validateWebhookUrl(subscription.url, { allowPrivate: allowPrivate === true }).ok,
  );
  return Promise.all(
    allowed.map((subscription) =>
      deliverWebhook(
        {
          url: subscription.url,
          id: subscription.id,
          ...(subscription.secret ? { secret: subscription.secret } : {}),
        },
        { type: event.type, data: event.data, workspaceId: event.workspaceId },
        deliveryOptions,
      ),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const publicWebhookSchema: JsonSchema = {
  type: "object",
  required: ["id", "workspaceId", "url", "events", "active", "createdAt", "hasSecret"],
  properties: {
    id: { type: "string" },
    workspaceId: { type: "string" },
    url: { type: "string", format: "uri" },
    events: { type: "array", items: { type: "string" } },
    active: { type: "boolean" },
    createdAt: { type: "integer" },
    hasSecret: {
      type: "boolean",
      description: "Whether a signing secret is configured. The secret is never returned.",
    },
  },
};

const deliveryResultSchema: JsonSchema = {
  type: "object",
  required: ["deliveryId", "event", "ok", "attempts"],
  properties: {
    deliveryId: { type: "string" },
    event: { type: "string" },
    ok: { type: "boolean" },
    status: { type: "integer" },
    error: { type: "string" },
    attempts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          attempt: { type: "integer" },
          status: { type: "integer" },
          error: { type: "string" },
          retryDelayMs: { type: "integer" },
        },
      },
    },
  },
};

const createWebhookBodySchema: JsonSchema = {
  type: "object",
  required: ["url", "events"],
  additionalProperties: false,
  properties: {
    url: {
      type: "string",
      format: "uri",
      maxLength: WEBHOOK_URL_MAX_LENGTH,
      description:
        "http(s) endpoint. Loopback, link-local and private addresses are rejected unless "
        + "IPOLLOWORK_WEBHOOK_ALLOW_PRIVATE=1 is set on the server.",
    },
    events: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: [WEBHOOK_WILDCARD, ...WEBHOOK_EVENT_TYPES] },
      description:
        `Event types to receive. "${WEBHOOK_WILDCARD}" subscribes to all of them. `
        + "Only task events are deliverable today; session-level engine events reach clients "
        + "over SSE and are rejected here rather than accepted into a subscription that "
        + "could never fire.",
    },
    secret: {
      type: "string",
      minLength: WEBHOOK_SECRET_MIN_LENGTH,
      maxLength: WEBHOOK_SECRET_MAX_LENGTH,
      description: "Signing key. Generated server-side when omitted, and returned once at creation.",
    },
    active: { type: "boolean", default: true },
  },
};

const workspacePathParams: JsonSchema = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string" } },
};

const webhookPathParams: JsonSchema = {
  type: "object",
  required: ["workspaceId", "webhookId"],
  properties: { workspaceId: { type: "string" }, webhookId: { type: "string" } },
};

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

function resolveStore(context: ApiModuleContext): WebhookStoreLike {
  const injected = context.services.webhookStore;
  if (injected && typeof injected === "object") return injected as WebhookStoreLike;
  return new WebhookStore(context.config);
}

function resolveFetch(context: ApiModuleContext): typeof fetch | undefined {
  const injected = context.services.webhookFetch;
  return typeof injected === "function" ? (injected as typeof fetch) : undefined;
}

async function resolveWorkspaceId(context: ApiModuleContext, ctx: RequestContext): Promise<string> {
  const param = ctx.params.workspaceId ?? "";
  const workspace = (await context.resolveWorkspace(context.config, param)) as { id?: unknown } | null;
  const resolved = workspace && typeof workspace.id === "string" ? workspace.id : "";
  return resolved || param;
}

export const webhooksModule: ApiModule = {
  id: "webhooks",
  title: "Webhooks",
  description:
    "Outbound event subscriptions for a workspace, with HMAC-signed deliveries and bounded retries.",
  version: "1.0.0",
  stability: "preview",

  register(context: ApiModuleContext): ApiOperation[] {
    // Resolved once per registration; the file-backed store keeps an in-process cache, so
    // building a new one per request would re-read the JSON file on every call.
    let store: WebhookStoreLike | undefined;
    const getStore = (): WebhookStoreLike => (store ??= resolveStore(context));

    // Read at request time rather than at registration: a test (and an operator reloading
    // config) can flip the opt-in without rebuilding the route table.
    const allowPrivate = (): boolean => webhookPrivateNetworkAllowed();

    const requireWebhook = async (ctx: RequestContext) => {
      const workspaceId = await resolveWorkspaceId(context, ctx);
      const webhookId = ctx.params.webhookId ?? "";
      const record = await getStore().get(workspaceId, webhookId);
      if (!record) {
        throw new ApiError(404, "webhook_not_found", "Webhook not found", { webhookId });
      }
      return { workspaceId, record };
    };

    return [
      {
        operationId: "createWebhook",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/webhooks",
        summary: "Create a webhook subscription",
        description:
          "Registers an endpoint to receive workspace events. The signing secret is returned only "
          + "when the server generated it, and is never readable afterwards.",
        effect: "write",
        pathParams: workspacePathParams,
        requestBody: createWebhookBodySchema,
        responses: {
          201: {
            description: "The created subscription.",
            schema: {
              type: "object",
              required: ["webhook"],
              properties: {
                webhook: publicWebhookSchema,
                secret: {
                  type: "string",
                  description: "Present only when generated by the server. Shown once; store it now.",
                },
              },
            },
          },
          400: { description: "The url, events or secret failed validation." },
          409: { description: `The workspace already has ${WEBHOOK_MAX_PER_WORKSPACE} webhooks.` },
        },
        handler: async (ctx) => {
          const workspaceId = await resolveWorkspaceId(context, ctx);
          const body = await context.readJsonBody(ctx.request);
          const input = parseCreateWebhookInput(body, { allowPrivate: allowPrivate() });
          const createInput: CreateWebhookInput = {
            workspaceId,
            url: input.url,
            events: input.events,
            active: input.active,
            ...(input.secret ? { secret: input.secret } : {}),
          };
          const record = await getStore().create(createInput);
          return context.jsonResponse(
            {
              webhook: toPublicWebhook(record),
              ...(input.generatedSecret && input.secret ? { secret: input.secret } : {}),
            },
            201,
          );
        },
      },
      {
        operationId: "listWebhooks",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/webhooks",
        summary: "List webhook subscriptions",
        effect: "read",
        pathParams: workspacePathParams,
        responses: {
          200: {
            description: "Subscriptions for the workspace, without their secrets.",
            schema: {
              type: "object",
              required: ["webhooks"],
              properties: { webhooks: { type: "array", items: publicWebhookSchema } },
            },
          },
        },
        handler: async (ctx) => {
          const workspaceId = await resolveWorkspaceId(context, ctx);
          const records = await getStore().list(workspaceId);
          return context.jsonResponse({ webhooks: records.map((record) => toPublicWebhook(record)) });
        },
      },
      {
        operationId: "getWebhook",
        method: "GET",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId",
        summary: "Get a webhook subscription",
        effect: "read",
        pathParams: webhookPathParams,
        responses: {
          200: {
            description: "The subscription, without its secret.",
            schema: { type: "object", required: ["webhook"], properties: { webhook: publicWebhookSchema } },
          },
          404: { description: "No such webhook in this workspace." },
        },
        handler: async (ctx) => {
          const { record } = await requireWebhook(ctx);
          return context.jsonResponse({ webhook: toPublicWebhook(record) });
        },
      },
      {
        operationId: "deleteWebhook",
        method: "DELETE",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId",
        summary: "Delete a webhook subscription",
        effect: "destructive",
        pathParams: webhookPathParams,
        responses: {
          200: {
            description: "The subscription was removed.",
            schema: {
              type: "object",
              required: ["deleted", "id"],
              properties: { deleted: { type: "boolean" }, id: { type: "string" } },
            },
          },
          404: { description: "No such webhook in this workspace." },
        },
        handler: async (ctx) => {
          const { workspaceId, record } = await requireWebhook(ctx);
          const deleted = await getStore().delete(workspaceId, record.id);
          return context.jsonResponse({ deleted, id: record.id });
        },
      },
      {
        operationId: "testWebhook",
        method: "POST",
        path: "/api/v1/workspaces/:workspaceId/webhooks/:webhookId/test",
        summary: "Send a test delivery to a webhook",
        description:
          `Sends a single signed ${WEBHOOK_TEST_EVENT} delivery, bypassing the event filter. `
          + "One attempt only — this is an interactive check, not a queued delivery, so it does not "
          + `run the ${WEBHOOK_MAX_ATTEMPTS}-attempt retry ladder.`,
        effect: "write",
        pathParams: webhookPathParams,
        responses: {
          200: {
            description: "The delivery outcome. A non-2xx from the subscriber is reported here, not raised.",
            schema: { type: "object", required: ["delivery"], properties: { delivery: deliveryResultSchema } },
          },
          400: { description: "The stored url is no longer allowed by the current SSRF policy." },
          404: { description: "No such webhook in this workspace." },
        },
        handler: async (ctx) => {
          const { workspaceId, record } = await requireWebhook(ctx);

          const verdict = validateWebhookUrl(record.url, { allowPrivate: allowPrivate() });
          if (!verdict.ok) {
            throw new ApiError(400, "webhook_url_invalid", `Webhook url is not allowed: ${verdict.reason}`, {
              reason: verdict.reason,
            });
          }

          const fetchImpl = resolveFetch(context);
          const delivery = await deliverWebhook(
            {
              url: record.url,
              id: record.id,
              ...(record.secret ? { secret: record.secret } : {}),
            },
            {
              type: WEBHOOK_TEST_EVENT,
              workspaceId,
              data: {
                webhookId: record.id,
                events: record.events,
                message: "Test delivery from iPolloWork.",
              },
            },
            {
              maxAttempts: 1,
              timeoutMs: TEST_DELIVERY_TIMEOUT_MS,
              ...(fetchImpl ? { fetchImpl } : {}),
            },
          );

          return context.jsonResponse({ delivery });
        },
      },
    ];
  },
};

export default webhooksModule;
