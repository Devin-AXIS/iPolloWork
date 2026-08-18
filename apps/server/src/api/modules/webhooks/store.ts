import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { ApiError } from "../../../errors.js";
import type { ServerConfig } from "../../../types.js";
import { ensureDir, exists } from "../../../utils.js";
import { ENGINE_EVENT_TYPES } from "../../engine/types.js";

/**
 * Webhook subscription storage.
 *
 * Backed by a JSON file resolved exactly like the token store (`src/tokens.ts`): an
 * explicit env override wins, otherwise the file sits next to the server config, falling
 * back to `~/.config/ipollowork`. Reusing that convention matters more than the storage
 * engine does — an operator who knows where `tokens.json` lives knows where the webhook
 * secrets live, and can lock the directory down once for both.
 */

/* -------------------------------------------------------------------------- */
/* Event catalogue                                                            */
/* -------------------------------------------------------------------------- */

/** Task lifecycle events, owned by the tasks module but subscribable here. */
export const WEBHOOK_TASK_EVENT_TYPES = [
  "task.created",
  "task.completed",
  "task.failed",
  "task.awaiting_approval",
] as const;

/**
 * Everything a subscription may name.
 *
 * Only the task events are listed, because only the task store is bridged to delivery
 * (`bridgeTaskEventsToWebhooks` in `../../index.ts`). Session-level engine events reach
 * clients over SSE, and nothing forwards them to webhooks yet: publishing them here would
 * accept a subscription to `message.delta` that could never fire, which is worse than not
 * offering it — the caller has no way to tell "no activity" from "wired to nothing".
 *
 * Bridging engine events means holding a per-workspace engine subscription open for the
 * life of the server; that belongs in its own change, and this list is what it should grow.
 */
export const WEBHOOK_EVENT_TYPES: readonly string[] = [...WEBHOOK_TASK_EVENT_TYPES];

/**
 * Engine events that are deliberately not subscribable yet, kept here so the reason is
 * discoverable from the code rather than only from a changelog.
 */
export const WEBHOOK_UNBRIDGED_EVENT_TYPES: readonly string[] = [...ENGINE_EVENT_TYPES];

/** Subscribes to every event, including ones added after the subscription was created. */
export const WEBHOOK_WILDCARD = "*";

/**
 * Sent only by `testWebhook`. Deliberately not in `WEBHOOK_EVENT_TYPES`: it is not a
 * product event, and a test ping is delivered to its target regardless of the filter.
 */
export const WEBHOOK_TEST_EVENT = "webhook.test";

export function isKnownWebhookEvent(value: string): boolean {
  return value === WEBHOOK_WILDCARD || WEBHOOK_EVENT_TYPES.includes(value);
}

/** True when `subscription` should receive `eventType`. */
export function matchesWebhookEvent(events: readonly string[], eventType: string): boolean {
  return events.includes(WEBHOOK_WILDCARD) || events.includes(eventType);
}

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: number;
  /**
   * Signing key. Present only in the on-disk record and in the delivery path — it is
   * never part of an API response. See `toPublicWebhook`.
   */
  secret?: string;
}

export interface PublicWebhook {
  id: string;
  workspaceId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: number;
  /** Whether a signing secret is configured. The secret itself is never returned. */
  hasSecret: boolean;
}

/**
 * The only shape a read endpoint may return.
 *
 * A webhook secret is a bearer credential for impersonating iPolloWork to the subscriber:
 * anyone holding it can forge a signed delivery. It is write-only by construction here —
 * the field is dropped and replaced with a boolean — rather than by each handler
 * remembering to redact, because a handler that forgets is a silent credential leak.
 */
export function toPublicWebhook(record: WebhookSubscription): PublicWebhook {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    url: record.url,
    events: [...record.events],
    active: record.active,
    createdAt: record.createdAt,
    hasSecret: typeof record.secret === "string" && record.secret.length > 0,
  };
}

export interface CreateWebhookInput {
  workspaceId: string;
  url: string;
  events: string[];
  secret?: string;
  active?: boolean;
}

/** What the module needs from storage, so tests can supply an in-memory implementation. */
export interface WebhookStoreLike {
  list(workspaceId: string): Promise<WebhookSubscription[]>;
  get(workspaceId: string, id: string): Promise<WebhookSubscription | null>;
  create(input: CreateWebhookInput): Promise<WebhookSubscription>;
  delete(workspaceId: string, id: string): Promise<boolean>;
  listForEvent(workspaceId: string, eventType: string): Promise<WebhookSubscription[]>;
}

/* -------------------------------------------------------------------------- */
/* File-backed store                                                          */
/* -------------------------------------------------------------------------- */

interface WebhookStoreFile {
  schemaVersion: number;
  updatedAt: number;
  webhooks: WebhookSubscription[];
}

/** Bounds the fan-out of a single event and the size of the store file. */
export const WEBHOOK_MAX_PER_WORKSPACE = 50;

export function resolveWebhookStorePath(config: ServerConfig): string {
  const override = (process.env.IPOLLOWORK_WEBHOOK_STORE ?? "").trim();
  if (override) return resolve(override);

  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, "webhooks.json");
}

function parseRecord(value: unknown): WebhookSubscription | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<WebhookSubscription>;
  const id = typeof record.id === "string" ? record.id : "";
  const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId : "";
  const url = typeof record.url === "string" ? record.url : "";
  if (!id || !workspaceId || !url) return null;
  const events = Array.isArray(record.events)
    ? record.events.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  if (events.length === 0) return null;
  const secret = typeof record.secret === "string" && record.secret ? record.secret : undefined;
  return {
    id,
    workspaceId,
    url,
    events,
    active: record.active !== false,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    ...(secret ? { secret } : {}),
  };
}

async function readWebhookStore(path: string): Promise<WebhookStoreFile> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), webhooks: [] };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<WebhookStoreFile>;
    const webhooks = Array.isArray(parsed.webhooks)
      ? parsed.webhooks
        .map((entry) => parseRecord(entry))
        .filter((entry): entry is WebhookSubscription => Boolean(entry))
      : [];
    return {
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      webhooks,
    };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), webhooks: [] };
  }
}

async function writeWebhookStore(path: string, webhooks: WebhookSubscription[]): Promise<void> {
  await ensureDir(dirname(path));
  const payload: WebhookStoreFile = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    webhooks,
  };
  // 0600: the file holds signing secrets, so it is no more readable than the token store.
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

export class WebhookStore implements WebhookStoreLike {
  private path: string;
  private loaded = false;
  private webhooks: WebhookSubscription[] = [];
  /** Serializes writes so two concurrent creates cannot each overwrite the other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: ServerConfig) {
    this.path = resolveWebhookStorePath(config);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const store = await readWebhookStore(this.path);
    this.webhooks = store.webhooks;
    this.loaded = true;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    await this.ensureLoaded();
    return this.webhooks.filter((webhook) => webhook.workspaceId === workspaceId);
  }

  async get(workspaceId: string, id: string): Promise<WebhookSubscription | null> {
    await this.ensureLoaded();
    return this.webhooks.find((webhook) => webhook.workspaceId === workspaceId && webhook.id === id) ?? null;
  }

  async listForEvent(workspaceId: string, eventType: string): Promise<WebhookSubscription[]> {
    const all = await this.list(workspaceId);
    return all.filter((webhook) => webhook.active && matchesWebhookEvent(webhook.events, eventType));
  }

  create(input: CreateWebhookInput): Promise<WebhookSubscription> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const existing = this.webhooks.filter((webhook) => webhook.workspaceId === input.workspaceId);
      if (existing.length >= WEBHOOK_MAX_PER_WORKSPACE) {
        throw new ApiError(
          409,
          "webhook_limit_reached",
          `Workspace already has ${WEBHOOK_MAX_PER_WORKSPACE} webhooks`,
          { limit: WEBHOOK_MAX_PER_WORKSPACE },
        );
      }
      const record: WebhookSubscription = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        url: input.url,
        events: [...input.events],
        active: input.active !== false,
        createdAt: Date.now(),
        ...(input.secret ? { secret: input.secret } : {}),
      };
      this.webhooks = [record, ...this.webhooks];
      await writeWebhookStore(this.path, this.webhooks);
      return record;
    });
  }

  delete(workspaceId: string, id: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const index = this.webhooks.findIndex(
        (webhook) => webhook.workspaceId === workspaceId && webhook.id === id,
      );
      if (index === -1) return false;
      this.webhooks.splice(index, 1);
      await writeWebhookStore(this.path, this.webhooks);
      return true;
    });
  }
}

/**
 * Non-persistent store, used by tests and by any caller that wants webhook routing
 * without touching the filesystem.
 */
export class MemoryWebhookStore implements WebhookStoreLike {
  private webhooks: WebhookSubscription[] = [];

  async list(workspaceId: string): Promise<WebhookSubscription[]> {
    return this.webhooks.filter((webhook) => webhook.workspaceId === workspaceId);
  }

  async get(workspaceId: string, id: string): Promise<WebhookSubscription | null> {
    return this.webhooks.find((webhook) => webhook.workspaceId === workspaceId && webhook.id === id) ?? null;
  }

  async listForEvent(workspaceId: string, eventType: string): Promise<WebhookSubscription[]> {
    const all = await this.list(workspaceId);
    return all.filter((webhook) => webhook.active && matchesWebhookEvent(webhook.events, eventType));
  }

  async create(input: CreateWebhookInput): Promise<WebhookSubscription> {
    const existing = this.webhooks.filter((webhook) => webhook.workspaceId === input.workspaceId);
    if (existing.length >= WEBHOOK_MAX_PER_WORKSPACE) {
      throw new ApiError(
        409,
        "webhook_limit_reached",
        `Workspace already has ${WEBHOOK_MAX_PER_WORKSPACE} webhooks`,
        { limit: WEBHOOK_MAX_PER_WORKSPACE },
      );
    }
    const record: WebhookSubscription = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      url: input.url,
      events: [...input.events],
      active: input.active !== false,
      createdAt: Date.now(),
      ...(input.secret ? { secret: input.secret } : {}),
    };
    this.webhooks = [record, ...this.webhooks];
    return record;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const index = this.webhooks.findIndex(
      (webhook) => webhook.workspaceId === workspaceId && webhook.id === id,
    );
    if (index === -1) return false;
    this.webhooks.splice(index, 1);
    return true;
  }
}
