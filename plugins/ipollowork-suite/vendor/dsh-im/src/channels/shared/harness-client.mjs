import { groupHistoryAccess } from './group-history-access.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';

import { adoptRegisteredWorkspaceSession } from './harness-session-binding.mjs';
import { sameWorkspacePath } from './default-workspace.mjs';
import {
  appendInboundFilesToPrompt,
  InboundFileError,
} from './inbound-file.mjs';
import {
  IMAGE_FILE_FALLBACK_PROMPT,
  contentWithoutImages,
  imageFileSourcesFromContent,
  isModelImageRejection,
} from './image-prompt.mjs';
import { imageInputLimits } from './image-input-policy.mjs';
import { inboundImagesAsFiles, imageContentFromStaged, isImageAdmissionRejection, IMAGE_HOST_LIMIT_FALLBACK_PROMPT } from './image-input.mjs';
import { imSourceGuidance } from './im-source-guidance.mjs';
import { outboundArtifactRegistry } from './semantic/artifact.mjs';
import { t } from './i18n.mjs';
import { watchHarnessMux } from './harness-mux.mjs';
import { extractConnectionEvidence, messageDiagnosticError } from './connection-error.mjs';
import { PromptFailureTracker } from './prompt-failure-tracker.mjs';
import { isSessionLogCorrupt, isSessionNotFound } from './session-error.mjs';

// Every channel plugin runs in the same Host process. Sharing ownership by
// Host identity (or an explicitly configured HTTP origin) prevents clients
// bound to one Session
// from claiming or cancelling each other's interactions.
const interactionRegistries = new Map();
const hostInteractionRegistries = new WeakMap();
const modelCatalogCaches = new WeakMap();
const MODEL_CATALOG_TTL_MS = 30_000;
const MAX_ERROR_CLASSIFICATION_BYTES = 64;
const IM_INPUT_ORIGIN_TTL_MS = 30 * 60 * 1000;
const MAX_IM_INPUT_ORIGINS = 4096;

function invalidateModelCatalog(entry) {
  if (!entry) return;
  entry.value = null;
  entry.expiresAt = 0;
  // Old readers may finish, but must not repopulate the cache after a fresh read.
  entry.pending = null;
}

export function clearModelCatalogCache(apiProxy) {
  const entry = modelCatalogCaches.get(apiProxy);
  if (!entry) return;
  modelCatalogCaches.delete(apiProxy);
  invalidateModelCatalog(entry);
  entry.controller.abort(new DOMException('Harness model catalog disposed', 'AbortError'));
}

function clientTimeZoneFields() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === 'string' && timeZone.trim()
      ? { clientTimeZone: timeZone }
      : {};
  } catch {
    // Time-zone metadata is optional; unresolved values are not JSON-safe.
    return {};
  }
}

async function smallResponseText(response) {
  const stream = response?.body;
  if (!stream || typeof stream.getReader !== 'function') return null;

  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)
        || length + value.byteLength > MAX_ERROR_CLASSIFICATION_BYTES) return null;
      chunks.push(value);
      length += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The response body is diagnostic-only; cancellation failures do not
      // replace the HTTP status that caused the transport error.
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isLoopbackHarnessHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

async function harnessHttpErrorCode(response, hostname) {
  if (response.status === 401) return 'harness-auth-required';
  if (response.status === 407) return 'harness-proxy-auth-required';
  if (response.status === 403) {
    const body = await smallResponseText(response);
    if (body?.trim() !== 'forbidden') return 'harness-request-forbidden';
    return isLoopbackHarnessHostname(hostname)
      ? 'harness-loopback-forbidden'
      : 'harness-host-untrusted';
  }
  if (response.status === 404) return 'harness-api-not-found';
  return 'harness-http-failed';
}

function interactionRegistry(scope) {
  const registries = typeof scope === 'string' ? interactionRegistries : hostInteractionRegistries;
  let registry = registries.get(scope);
  if (!registry) {
    registry = {
      ownerships: new Map(),
      claims: new Map(),
      controls: new WeakMap(),
      imInputOrigins: new Map(),
      nextOrder: 0,
    };
    registries.set(scope, registry);
  }
  return registry;
}

function pruneImInputOrigins(origins, now = Date.now()) {
  for (const [rpcId, expiresAt] of origins) {
    if (expiresAt > now) continue;
    origins.delete(rpcId);
  }
  while (origins.size > MAX_IM_INPUT_ORIGINS) {
    origins.delete(origins.keys().next().value);
  }
}

function registerImInputOrigin(registry, rpcId) {
  const origins = registry.imInputOrigins;
  pruneImInputOrigins(origins);
  origins.delete(rpcId);
  origins.set(rpcId, Date.now() + IM_INPUT_ORIGIN_TTL_MS);
  pruneImInputOrigins(origins);
  return () => origins.delete(rpcId);
}

/** Consume a dsh-im prompt id while handling its durable user/message event. */
export function consumeDshImInputOrigin(scope, rpcId) {
  if (!scope || !['object', 'function', 'string'].includes(typeof scope)
    || typeof rpcId !== 'string' || !rpcId) return false;
  const origins = interactionRegistry(scope).imInputOrigins;
  pruneImInputOrigins(origins);
  return origins.delete(rpcId);
}

/**
 * Whether a dsh-im prompt id is registered, without claiming it.
 *
 * An observer such as the Session sync coordinator must be able to ask "did a
 * messenger start this turn?" without taking the id away from the channel that
 * still owns it. The entry lives until its TTL or the size cap evicts it, so a
 * repeated question keeps answering the same way, while the one-shot
 * `consumeDshImInputOrigin` stays the only way to claim it.
 */
export function isDshImInputOrigin(scope, rpcId) {
  if (!scope || !['object', 'function', 'string'].includes(typeof scope)
    || typeof rpcId !== 'string' || !rpcId) return false;
  const origins = interactionRegistry(scope).imInputOrigins;
  pruneImInputOrigins(origins);
  return origins.has(rpcId);
}

// A Host RPC may not accept cancellation itself. Bound the caller's wait
// without retrying an operation that the Host may already have accepted.
function callWithSignal(call, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return call();
    }).then((value) => {
      cleanup();
      resolve(value);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}

function normalizeControl(control) {
  const ownerType = typeof control?.owner;
  if ((ownerType !== 'object' && ownerType !== 'function')
    || control.owner === null
    || typeof control.key !== 'string'
    || !control.key) return null;
  return { owner: control.owner, key: control.key };
}

function validModelSelection(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.provider === 'string'
    && Boolean(value.provider)
    && typeof value.model === 'string'
    && Boolean(value.model)
    && (value.reasoningEffort === undefined
      || (typeof value.reasoningEffort === 'string' && Boolean(value.reasoningEffort)));
}

function validModelReasoning(value) {
  return value !== null
    && typeof value === 'object'
    && Array.isArray(value.efforts)
    && value.efforts.length > 0
    && value.efforts.every((effort) => (
      effort !== null
      && typeof effort === 'object'
      && typeof effort.id === 'string'
      && Boolean(effort.id)
      && typeof effort.name === 'string'
      && Boolean(effort.name)
      && (effort.description === undefined || typeof effort.description === 'string')
    ))
    && (value.defaultEffort === undefined
      || (typeof value.defaultEffort === 'string' && Boolean(value.defaultEffort)));
}

function validateModelCatalog(value, method, { session = false } = {}) {
  if (!value || typeof value !== 'object'
    || !Array.isArray(value.groups)
    || !Array.isArray(value.failures)) {
    throw new Error(`Harness returned an invalid response for ${method}`);
  }
  for (const group of value.groups) {
    if (!group || typeof group !== 'object'
      || typeof group.id !== 'string' || !group.id
      || typeof group.name !== 'string' || !group.name
      || !Array.isArray(group.models)) {
      throw new Error(`Harness returned an invalid response for ${method}`);
    }
    for (const model of group.models) {
      if (!model || typeof model !== 'object'
        || typeof model.id !== 'string' || !model.id
        || typeof model.name !== 'string' || !model.name
        || (model.description !== undefined && typeof model.description !== 'string')
        || (model.reasoning !== undefined && !validModelReasoning(model.reasoning))) {
        throw new Error(`Harness returned an invalid response for ${method}`);
      }
    }
  }
  for (const failure of value.failures) {
    if (!failure || typeof failure !== 'object'
      || typeof failure.id !== 'string' || !failure.id
      || typeof failure.name !== 'string' || !failure.name
      || (failure.message !== undefined && typeof failure.message !== 'string')) {
      throw new Error(`Harness returned an invalid response for ${method}`);
    }
  }
  if (session && (!validModelSelection(value.current) || typeof value.routable !== 'boolean')) {
    throw new Error(`Harness returned an invalid response for ${method}`);
  }
  return value;
}

function turnStoppedError() {
  const error = new Error('Harness turn was stopped before producing a text reply');
  error.code = 'turn-stopped';
  return error;
}

function workspaceEntries(value) {
  if (!Array.isArray(value?.items)) return [];
  return value.items.flatMap((item) => (
    typeof item?.path === 'string' && isAbsolute(item.path)
      ? [{ path: item.path, title: typeof item.title === 'string' ? item.title : '' }]
      : []
  ));
}

function workspaceFromList(workspacePath, workspaceList) {
  if (!Array.isArray(workspaceList?.items)
    || !Array.isArray(workspaceList?.archivedSessionIds)) {
    throw new Error('Harness returned an invalid response for workspace.list');
  }

  const workspace = workspaceList.items.find((item) => item?.path === workspacePath);
  if (!workspace) return null;
  if (!Array.isArray(workspace.sessionIds)
    || workspace.sessionIds.some((sessionId) => typeof sessionId !== 'string')) {
    throw new Error('Harness returned invalid session IDs for workspace.list');
  }
  return workspace;
}

function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function sessionTimeMs(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const candidates = [
    summary?.header?.lastActivityAt,
    summary?.header?.updatedAt,
    summary?.header?.createdAt,
    summary?.projections?.values?.lastActivityAt,
    summary?.projections?.values?.updatedAt,
    summary?.projections?.values?.createdAt,
    summary?.lastActivityAt,
    summary?.updatedAt,
    summary?.createdAt,
  ];
  for (const value of candidates) {
    const ms = toEpochMs(value);
    if (ms !== null) return ms;
  }
  return null;
}

function workspaceSessions(workspace, archivedSessionIds, sessionList) {
  if (!Array.isArray(sessionList?.items)) {
    throw new Error('Harness returned an invalid response for session.list');
  }

  const archived = new Set(archivedSessionIds);
  const summaries = new Map(sessionList.items.flatMap((item) => (
    typeof item?.sessionId === 'string' ? [[item.sessionId, item]] : []
  )));
  return {
    workspace: workspace.path,
    sessions: workspace.sessionIds.map((sessionId) => {
      const summary = summaries.get(sessionId);
      const title = summary?.projections?.values?.title;
      const session = {
        sessionId,
        title: typeof title === 'string' ? title : null,
        archived: archived.has(sessionId),
        blank: summary?.blank === true,
        origin: summary?.origin === 'subagent' ? 'subagent' : null,
        summaryAvailable: summary !== undefined,
      };
      const lastSeq = summary?.projections?.asOfSeq;
      // This is the projection's durable lower bound, not necessarily the live
      // log tail for a cold session. Harness uses -1 as the legitimate bound
      // for a session with no projected events yet.
      if (Number.isSafeInteger(lastSeq) && lastSeq >= -1) session.lastSeq = lastSeq;
      const time = sessionTimeMs(summary);
      if (time !== null) session.time = time;
      return session;
    }),
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Join only visible text blocks from one Harness message payload. */
export function textFromHarnessContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/** Join only reasoning blocks from one Harness message payload. */
export function reasoningFromHarnessContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((part) => part?.type === 'reasoning' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function assistantMessageText(event) {
  return textFromHarnessContent(event?.data?.message?.content);
}

function assistantReasoningText(event) {
  return reasoningFromHarnessContent(event?.data?.message?.content);
}

/** Aggregate assistant text in stable step/index order for one Harness Turn. */
export class AssistantTextAccumulator {
  #steps = new Map();
  #legacyText = '';

  clear() {
    this.#steps.clear();
    this.#legacyText = '';
  }

  appendDelta(step, index, text) {
    if (typeof text !== 'string' || !text) return;
    const stepNumber = Number.isSafeInteger(step) ? step : 0;
    const partIndex = Number.isSafeInteger(index) ? index : 0;
    this.#legacyText = '';
    const parts = this.#steps.get(stepNumber) ?? new Map();
    parts.set(partIndex, (parts.get(partIndex) ?? '') + text);
    this.#steps.set(stepNumber, parts);
  }

  setCanonical(step, text) {
    if (typeof text !== 'string' || !text.trim()) return;
    if (!Number.isSafeInteger(step)) {
      this.#steps.clear();
      this.#legacyText = text.trim();
      return;
    }
    this.#legacyText = '';
    this.#steps.set(step, new Map([[0, text.trim()]]));
  }

  get text() {
    if (this.#steps.size === 0) return this.#legacyText;
    return [...this.#steps.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, parts]) => [...parts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text)
        .join('\n')
        .trim())
      .filter(Boolean)
      .join('\n\n');
  }
}

/** Keep answer text after the last tool boundary, shared by live and recovered replies. */
export function accumulateFinalAssistantText(accumulator, event) {
  if (event.type === 'tool/call') {
    accumulator.clear();
  } else if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
    accumulator.appendDelta(event.data.step, event.data.chunk.index, event.data.chunk.text);
  } else if (event.type === 'assistant/message') {
    const content = event.data?.message?.content;
    const text = textFromHarnessContent(content);
    // Canonical tool messages can arrive before or after the separate call.
    // An explicitly empty final message must not revive an earlier preamble.
    if (!text || content.some((part) => part?.type === 'tool-call')) accumulator.clear();
    else accumulator.setCanonical(event.data.step, text);
  }
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Flatten a tool/result error payload into a displayable one-line reason. */
function toolResultErrorText(error) {
  if (!error || typeof error !== 'object') return null;
  const message = nonEmptyText(error.message);
  if (message) return message;
  const name = nonEmptyText(error.name);
  const code = nonEmptyText(error.code);
  if (name || code) return [name ?? 'Error', code].filter(Boolean).join(': ');
  return null;
}

/** Join the visible text carried by a Harness tool result. */
function toolResultText(data) {
  const blocks = Array.isArray(data?.message?.content) ? data.message.content : [];
  const nested = blocks.flatMap((block) => (
    Array.isArray(block?.content) ? block.content : [block]
  ));
  const text = nested
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  return text || nonEmptyText(data?.text) || toolResultErrorText(data?.error) || '';
}

function toolResultCallId(data) {
  const blocks = Array.isArray(data?.message?.content) ? data.message.content : [];
  return blocks
    .map((block) => nonEmptyText(block?.toolCallId))
    .find(Boolean)
    ?? nonEmptyText(data?.message?.source?.callId)
    ?? nonEmptyText(data?.callId)
    ?? nonEmptyText(data?.subCallId);
}

function consumeInteractionOwnership(ownership, entries) {
  const ordered = [...entries]
    .map((entry) => entry?.event ?? entry)
    .filter(Boolean)
    .sort((left, right) => (left.seq ?? -1) - (right.seq ?? -1));

  for (const event of ordered) {
    const seq = event.seq ?? -1;
    if (seq <= ownership.lastSeq) continue;
    ownership.lastSeq = seq;

    if (event.type === 'turn/start') {
      const turn = event.data?.turn ?? null;
      if (ownership.active && turn !== ownership.turn) ownership.active = false;
      if (ownership.turn !== null && turn !== ownership.turn) ownership.completed = true;
      ownership.openTurn = turn;
      continue;
    }
    if (event.type === 'user/message' && event.data?.source?.rpcId === ownership.promptRpcId) {
      ownership.active = true;
      ownership.started = true;
      ownership.completed = false;
      ownership.turn = event.data?.turn ?? ownership.openTurn;
      continue;
    }
    if (event.type === 'turn/end' && event.data?.turn === ownership.turn) {
      ownership.active = false;
      ownership.completed = true;
      continue;
    }
    const toolCall = ownership.active
      && (event.type !== 'tool/call' || event.data?.turn === ownership.turn)
      ? harnessToolCallFromEvent(event) : null;
    if (toolCall) ownership.toolCalls.set(toolCall.callId, Object.freeze(toolCall));
  }
}

/**
 * Decide whether the current Host has a live dsh-im interaction watcher for
 * this Session.  The modern Harness adapter uses the same ownership registry
 * as HarnessClient so it never steals a browser-owned question or approval.
 */
export function activeHarnessInteractionOwner(scope, sessionId, entries = []) {
  if (!scope || !['object', 'function', 'string'].includes(typeof scope)
    || typeof sessionId !== 'string' || !sessionId) return null;
  const owners = interactionRegistry(scope).ownerships.get(sessionId);
  if (!owners || owners.size === 0) return null;
  for (const ownership of owners) consumeInteractionOwnership(ownership, entries);
  return [...owners].filter((ownership) => (
    ownership.active
    && !ownership.completed
    && typeof ownership.reconnect === 'function'
  )).sort((left, right) => left.order - right.order)[0] ?? null;
}

/** Whether a live IM consumer owns this turn. */
export function hasActiveHarnessInteractionOwner(scope, sessionId, entries = []) {
  return activeHarnessInteractionOwner(scope, sessionId, entries) !== null;
}

/** Read the operation attached to a normal or PTC tool-call event. */
export function harnessToolCallFromEvent(event) {
  const data = event?.data;
  if (event?.type === 'tool/call' && typeof data?.callId === 'string') {
    return { callId: data.callId, name: data.name, arguments: data.arguments };
  }
  if (event?.type === 'tool/code-dispatch-start' && typeof data?.subCallId === 'string') {
    let argumentsText;
    try { argumentsText = JSON.stringify(data.arguments); } catch { /* Unserializable details cannot be approved. */ }
    return { callId: data.subCallId, name: data.name, arguments: argumentsText };
  }
  return null;
}

export class HarnessReplyTracker {
  #promptRpcId;
  #promptFailure;
  #lastSeq;
  #openTurn = null;
  #targetTurn = null;
  #assistantText = new AssistantTextAccumulator();
  #finalAssistantText = null;
  #latestText = '';
  #finished = false;
  #reason = null;
  #toolNames = new Map();
  #lastToolName = null;
  #transientSeqs = new Set();
  #pendingReasoning = new Map();
  #pendingReasoningChars = 0;
  #reasoning = false;

  constructor({ promptRpcId, afterSeq = -1, reasoning = false, finalAnswerOnly = false }) {
    this.#promptRpcId = promptRpcId;
    this.#promptFailure = new PromptFailureTracker(promptRpcId, afterSeq);
    this.#lastSeq = afterSeq;
    // Reasoning updates are opt-in per consumer: only channels that surface
    // thinking traces (Telegram thinking mode) subscribe; every other channel
    // keeps its pre-thinking-traces update stream untouched.
    this.#reasoning = reasoning === true;
    if (finalAnswerOnly === true) this.#finalAssistantText = new AssistantTextAccumulator();
  }

  get finished() {
    return this.#finished;
  }

  /** The highest event seq consumed so far; advances as the turn produces events. */
  get lastSeq() {
    return this.#lastSeq;
  }

  get answer() {
    return this.#latestText.trim();
  }

  get finalAnswer() {
    return this.#finalAssistantText ? this.#finalAssistantText.text : this.answer;
  }

  get reason() {
    return this.#reason;
  }

  get tracking() {
    return this.#targetTurn !== null && !this.#finished;
  }

  get turn() {
    return this.#targetTurn;
  }

  #commitText(text, pushUpdate) {
    if (!text || text === this.#latestText) return;
    this.#latestText = text;
    pushUpdate({ type: 'text', text });
  }

  #bufferReasoning(event) {
    const text = event.data?.chunk?.text;
    if (typeof text !== 'string' || !text || text.length > 65536
      || this.#pendingReasoning.has(event.seq)) return;
    this.#pendingReasoning.set(event.seq, event);
    this.#pendingReasoningChars += text.length;
    while (this.#pendingReasoning.size > 256 || this.#pendingReasoningChars > 65536) {
      const [seq, oldest] = this.#pendingReasoning.entries().next().value;
      this.#pendingReasoning.delete(seq);
      this.#pendingReasoningChars -= oldest.data.chunk.text.length;
    }
  }

  #takePendingReasoning() {
    const events = [...this.#pendingReasoning.values()];
    this.#pendingReasoning.clear();
    this.#pendingReasoningChars = 0;
    return events;
  }

  #emitReasoning(event, pushUpdate) {
    const text = event.data?.chunk?.text;
    if (event.data?.turn !== this.#targetTurn || this.#transientSeqs.has(event.seq)
      || typeof text !== 'string' || !text) return;
    this.#transientSeqs.add(event.seq);
    pushUpdate({ type: 'reasoning', turn: this.#targetTurn, text });
  }

  consumeAll(entries, { live = false, fromMux = false } = {}) {
    const updates = [];
    // 同一批轮询内的 text 帧只保留最新累积，其余事件逐帧透出，
    // 让消费方能按顺序看到每个工具调用与结果。
    const pushUpdate = (update) => {
      if (update.type === 'text' && updates.length > 0) {
        const last = updates[updates.length - 1];
        if (last.type === 'text') {
          updates[updates.length - 1] = update;
          return;
        }
      }
      updates.push(update);
    };
    const ordered = [...(fromMux ? [] : this.#takePendingReasoning()), ...entries]
      .map((entry) => entry?.event ?? entry)
      .filter(Boolean)
      .sort((left, right) => (left.seq ?? -1) - (right.seq ?? -1));

    for (const event of ordered) {
      if (this.#finished) break;
      const seq = event.seq ?? -1;
      const isReasoning = event.type === 'assistant/chunk'
        && event.data?.chunk?.type === 'reasoning-delta';
      // The mux is lossy across reconnects. Only history may advance the
      // durable cursor or finish the reply; the mux supplements reasoning.
      if (fromMux && !isReasoning) continue;
      const failedTurn = fromMux ? null : this.#promptFailure.consume(event);
      if (isReasoning) {
        if (!live || !Number.isFinite(seq)) continue;
        if (this.#targetTurn === null) this.#bufferReasoning(event);
        else this.#emitReasoning(event, pushUpdate);
        continue;
      }
      if (this.#targetTurn === null) {
        if (seq <= this.#lastSeq) continue;
        if (event.type === 'turn/start') {
          this.#openTurn = event.data?.turn ?? null;
          continue;
        }
        if (event.type === 'user/message' && event.data?.source?.rpcId === this.#promptRpcId) {
          this.#lastSeq = seq;
          this.#targetTurn = event.data?.turn ?? this.#openTurn;
          if (live && this.#targetTurn !== null) {
            pushUpdate({ type: 'turn-start', turn: this.#targetTurn });
            // Only earlier fragments flush here. Later steps remain in the
            // sorted batch, interleaved with their tool calls and results.
            for (const pending of this.#takePendingReasoning()) {
              this.#emitReasoning(pending, pushUpdate);
            }
          }
          continue;
        }
        // Model resolution or pre-step hooks can fail after the inbox claim
        // but before user/message. Only a proved claim may close this wait.
        if (event.type !== 'turn/end' || failedTurn === null || failedTurn !== event.data?.turn) continue;
        this.#targetTurn = failedTurn;
      }
      if (seq <= this.#lastSeq) continue;
      this.#lastSeq = seq;

      if (event.type === 'turn/start') this.#openTurn = event.data?.turn ?? null;

      if (event.type === 'user/message' && event.data?.source?.rpcId === this.#promptRpcId) {
        this.#targetTurn = event.data?.turn ?? this.#openTurn;
        if (live) pushUpdate({ type: 'turn-start', turn: this.#targetTurn });
        continue;
      }
      if (this.#targetTurn === null) continue;

      if (event.type === 'turn/end') {
        if (event.data?.turn !== this.#targetTurn) continue;
        this.#finished = true;
        this.#reason = event.data?.reason ?? null;
        this.#openTurn = null;
        if (live) {
          pushUpdate({
            type: 'turn-end',
            turn: this.#targetTurn,
            reason: this.#reason,
          });
        }
        continue;
      }
      if (event.data?.turn !== this.#targetTurn) continue;

      if (this.#finalAssistantText) accumulateFinalAssistantText(this.#finalAssistantText, event);

      if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
        const step = event.data?.step ?? 0;
        const index = event.data.chunk.index ?? 0;
        this.#assistantText.appendDelta(step, index, event.data.chunk.text);
        this.#commitText(this.#assistantText.text, pushUpdate);
        continue;
      }

      if (event.type === 'assistant/message') {
        const text = assistantMessageText(event);
        const step = Number.isSafeInteger(event.data?.step) ? event.data.step : null;
        this.#assistantText.setCanonical(step, text);
        // canonical 定稿且非空时按 step 透出，供分步推送消费方使用；
        // 先于 commitText 透出，保持 text 更新作为批次末尾的既有语义。
        if (text) {
          pushUpdate({
            type: 'assistant-message',
            step,
            text,
            ...(live ? { turn: this.#targetTurn } : {}),
          });
        }
        // Thinking-trace channels consume this as the 💭 line that precedes the
        // tool call it explains; only consumers that explicitly subscribed
        // (reasoning: true) see these updates, so default-mode channels keep
        // their pre-thinking-traces progress stream.
        if (this.#reasoning) {
          const reasoning = assistantReasoningText(event);
          if (reasoning) pushUpdate({ type: 'reasoning', step, text: reasoning });
        }
        this.#commitText(this.#assistantText.text, pushUpdate);
        continue;
      }

      if (event.type === 'tool/call') {
        const name = nonEmptyText(event.data?.name) ?? t('工具');
        const callId = nonEmptyText(event.data?.callId)
          ?? nonEmptyText(event.data?.subCallId);
        if (callId) this.#toolNames.set(callId, name);
        this.#lastToolName = name;
        let argsText = null;
        if (event.data?.arguments !== undefined && event.data?.arguments !== null) {
          if (typeof event.data.arguments === 'string') {
            argsText = event.data.arguments;
          } else {
            try {
              argsText = JSON.stringify(event.data.arguments);
            } catch {
              argsText = undefined;
            }
          }
        }
        pushUpdate({
          type: 'tool',
          name,
          ...(argsText ? { arguments: argsText } : {}),
          ...(callId ? { callId } : {}),
          ...(live ? { turn: this.#targetTurn } : {}),
        });
      } else if (event.type === 'tool/result') {
        const callId = toolResultCallId(event.data);
        const toolName = (callId ? this.#toolNames.get(callId) : null)
          ?? this.#lastToolName;
        const error = toolResultErrorText(event.data?.error);
        if (live) {
          const providerErrorCode = event.data?.error?.code;
          pushUpdate({
            type: 'tool-result',
            turn: this.#targetTurn,
            ...(callId ? { callId } : {}),
            ...(toolName ? { toolName } : {}),
            text: toolResultText(event.data),
            ...(providerErrorCode !== undefined && providerErrorCode !== null
              ? { errorCode: String(providerErrorCode) }
              : {}),
          });
        } else {
          pushUpdate({
            type: 'status',
            text: t('正在整理结果…'),
            ...(toolName ? { toolName } : {}),
            ...(error ? { error } : {}),
          });
        }
      }
    }
    return updates;
  }

  consume(entries) {
    return this.consumeAll(entries).at(-1) ?? null;
  }
}

/**
 * Progress updates an ask() consumer actually receives. latest 模式只投递一条
 * 最新进展；assistant-message 是分步推送专用更新，且 canonical 去重后可能成为
 * 批次唯一变化，绝不能冒充进度投给全部渠道。reasoning 同为思考留痕渠道专用，
 * 默认模式下不得冒充进度（钉钉、企微等会展示其 text）。
 */
export function visibleProgressUpdates(updates, progressMode) {
  if (progressMode === 'all') return updates;
  return updates
    .filter((update) => update.type !== 'assistant-message' && update.type !== 'reasoning')
    .slice(-1);
}

export class HarnessRpcError extends Error {
  constructor(method, error) {
    super(`${method}: ${error?.message ?? 'unknown Harness RPC error'}`);
    this.name = 'HarnessRpcError';
    this.method = method;
    this.code = error?.code ?? 'internal';
    this.details = error?.details ?? {};
  }
}

export class HarnessTransportError extends Error {
  constructor(code, method, { cause, status } = {}) {
    const statusDetail = Number.isInteger(status) ? `, HTTP ${status}` : '';
    super(`Harness ${method} transport failed (${code}${statusDetail})`, { cause });
    this.name = 'HarnessTransportError';
    this.code = code;
    this.method = method;
    if (Number.isInteger(status)) this.status = status;
  }
}

/**
 * session.prompt 提交超时（30 秒窗口到期）只说明应答迟到，不代表提交失败：
 * 单进程 Host 忙碌时 prompt 往往已入队。这类错误需要先回查持久账本再定性。
 */
function isPromptSubmitTimeout(error) {
  return error instanceof HarnessTransportError
    && error.code === 'harness-timeout'
    && error.method === 'session.prompt';
}

export class HarnessHealthError extends Error {
  constructor(cause) {
    super('Harness health RPC was rejected', { cause });
    this.name = 'HarnessHealthError';
    this.code = 'harness-rpc-rejected';
    this.method = 'host.describe';
  }
}

export class HarnessInteractionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessInteractionError';
    this.code = code;
  }
}

export class HarnessTurnError extends Error {
  constructor(code, { reason, providerCode } = {}) {
    super(`Harness turn failed (${code})`);
    this.name = 'HarnessTurnError';
    this.code = code;
    this.promptAccepted = true;
    if (reason && typeof reason === 'object') this.reason = reason;
    if (typeof providerCode === 'string' && providerCode) this.providerCode = providerCode;
  }
}

function harnessTurnError(reason) {
  const kind = nonEmptyText(reason?.kind) ?? nonEmptyText(reason);
  if (kind === 'error') {
    const failure = reason?.error ?? reason?.failure;
    return new HarnessTurnError('harness-turn-failed', {
      reason,
      providerCode: nonEmptyText(failure?.code) ?? undefined,
    });
  }
  if (kind === 'max-tokens') return new HarnessTurnError('model-max-tokens', { reason });
  if (kind === 'blocked') return new HarnessTurnError('turn-blocked', { reason });
  if (['interrupted', 'stopped', 'cancelled', 'canceled'].includes(kind)) {
    return new HarnessTurnError('turn-interrupted', { reason });
  }
  if (kind === 'aborted') return new HarnessTurnError('turn-aborted', { reason });
  return new HarnessTurnError('harness-turn-failed', { reason });
}

function harnessTurnSucceeded(reason) {
  if (reason === null || reason === undefined) return true;
  return (nonEmptyText(reason?.kind) ?? nonEmptyText(reason)) === 'completed';
}

function sessionArchivedError(sessionId, cause) {
  const error = new Error('The Session is archived and cannot process this message.', { cause });
  error.code = 'session-archived';
  error.promptAccepted = false;
  error.details = { sessionId };
  return error;
}

export class HarnessClient {
  #baseUrl;
  #apiProxy;
  #workspace;
  #ungroupedWorkspace;
  #agentPreset;
  #autostart;
  #dshBin;
  #fetch;
  #createWebSocket;
  #interactionReconnectDelayMs;
  #rpcIdPrefix;
  #logPrefix;
  #commandExecutor;
  #controlExecutor;
  #sessionMaintenanceExecutor;
  #fileIngressExecutor;
  #completionExecutor;
  #imageInputPolicy;
  #managedProcess = null;
  #interactionRegistry;
  #interactionOwnerships;
  #competitiveApprovals;
  #interactionClaims;
  #controlOwnerships;

  constructor({
    baseUrl,
    apiProxy,
    interactionScope = apiProxy,
    competitiveApprovals = false,
    workspace,
    ungroupedWorkspace,
    agentPreset,
    autostart = false,
    dshBin = 'dsh',
    fetchImpl = fetch,
    createWebSocket = (url) => new WebSocket(url),
    interactionReconnectDelayMs = 500,
    rpcIdPrefix = 'im',
    logPrefix = 'dsh-im',
    commandExecutor,
    controlExecutor,
    sessionMaintenanceExecutor,
    fileIngressExecutor,
    completionExecutor,
    imageInputPolicy = () => undefined,
  }) {
    if (typeof createWebSocket !== 'function') {
      throw new TypeError('createWebSocket must be a function');
    }
    if (!Number.isFinite(interactionReconnectDelayMs) || interactionReconnectDelayMs < 0) {
      throw new TypeError('interactionReconnectDelayMs must be a non-negative number');
    }
    if (typeof rpcIdPrefix !== 'string' || !rpcIdPrefix.trim()) {
      throw new TypeError('rpcIdPrefix must be a non-empty string');
    }
    if (typeof logPrefix !== 'string' || !logPrefix.trim()) {
      throw new TypeError('logPrefix must be a non-empty string');
    }
    if (commandExecutor !== undefined && typeof commandExecutor !== 'function') {
      throw new TypeError('commandExecutor must be a function');
    }
    if (controlExecutor !== undefined && typeof controlExecutor !== 'function') {
      throw new TypeError('controlExecutor must be a function');
    }
    if (completionExecutor !== undefined && typeof completionExecutor !== 'function') {
      throw new TypeError('completionExecutor must be a function');
    }
    if (sessionMaintenanceExecutor !== undefined
      && typeof sessionMaintenanceExecutor !== 'function') {
      throw new TypeError('sessionMaintenanceExecutor must be a function');
    }
    if (fileIngressExecutor !== undefined && typeof fileIngressExecutor !== 'function') {
      throw new TypeError('fileIngressExecutor must be a function');
    }
    this.#baseUrl = baseUrl === undefined ? null : new URL(baseUrl);
    this.#apiProxy = this.#baseUrl ? null : apiProxy;
    if (!this.#baseUrl && (!this.#apiProxy || typeof this.#apiProxy !== 'object')) {
      throw new TypeError('HarnessClient requires the current Host apiProxy or an explicit baseUrl');
    }
    if (this.#apiProxy && (!interactionScope
      || !['object', 'function'].includes(typeof interactionScope))) {
      throw new TypeError('interactionScope must identify the current Host');
    }
    this.#competitiveApprovals = competitiveApprovals === true;
    this.#workspace = workspace;
    // Only the reserved IM directory bypasses grouping, even after /ws switches.
    this.#ungroupedWorkspace = ungroupedWorkspace;
    // Keep an omitted preset absent so session.create resolves the Host's current default.
    this.#agentPreset = agentPreset ?? undefined;
    this.#autostart = Boolean(this.#baseUrl && autostart);
    this.#dshBin = dshBin;
    this.#fetch = fetchImpl;
    this.#createWebSocket = createWebSocket;
    this.#interactionReconnectDelayMs = interactionReconnectDelayMs;
    this.#rpcIdPrefix = rpcIdPrefix.trim();
    this.#logPrefix = logPrefix.trim();
    this.#commandExecutor = commandExecutor;
    this.#controlExecutor = controlExecutor;
    this.#sessionMaintenanceExecutor = sessionMaintenanceExecutor;
    this.#fileIngressExecutor = fileIngressExecutor;
    this.#completionExecutor = completionExecutor;
    this.#imageInputPolicy = imageInputPolicy;
    this.#interactionRegistry = interactionRegistry(this.#baseUrl?.origin ?? interactionScope);
    this.#interactionOwnerships = this.#interactionRegistry.ownerships;
    this.#interactionClaims = this.#interactionRegistry.claims;
    this.#controlOwnerships = this.#interactionRegistry.controls;
  }

  async rpc(method, payload = {}, timeoutMs = 30_000, options = {}) {
    const startedAt = performance.now();
    const withDiagnostics = error => Object.assign(error, {
      durationMs: Math.round(performance.now() - startedAt),
      timeoutMs,
      transport: this.#apiProxy ? 'host-api' : 'http',
    });
    const rpcId = options.rpcId ?? `${this.#rpcIdPrefix}-${randomUUID()}`;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let body;
    try {
      if (this.#apiProxy) {
        const [domain, action, extra] = method.split('.');
        const namespace = { host: 'host', workspace: 'workspace', session: 'sessions', llm: 'llm' }[domain];
        const api = namespace && this.#apiProxy[namespace];
        if (extra !== undefined || !Object.hasOwn(api ?? {}, action)
          || typeof api[action] !== 'function') {
          throw new HarnessTransportError('harness-api-not-found', method);
        }
        const response = await callWithSignal(() => api[action]({ rpcId, payload }, signal), signal);
        body = { type: 'server-response', ...response };
      } else {
        const response = await this.#fetch(new URL(`/api/${method}`, this.#baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
          signal,
        });
        if (!response.ok) {
          const code = await harnessHttpErrorCode(response, this.#baseUrl.hostname);
          throw new HarnessTransportError(code, method, { status: response.status });
        }
        try {
          body = await response.json();
        } catch (error) {
          throw new HarnessTransportError('harness-response-invalid', method, { cause: error });
        }
      }
    } catch (error) {
      // Preserve an explicit caller cancellation; it is control flow, not a
      // Harness availability diagnosis.
      if (options.signal?.aborted) throw error;
      if (error instanceof HarnessTransportError) throw withDiagnostics(error);
      throw withDiagnostics(new HarnessTransportError(
        timeoutSignal.aborted ? 'harness-timeout' : 'harness-connect-failed',
        method,
        { cause: error },
      ));
    }
    if (body?.type !== 'server-response' || body?.rpcId !== rpcId) {
      throw withDiagnostics(new HarnessTransportError('harness-response-invalid', method, {
        cause: new Error(`Harness returned an invalid response for ${method}`),
      }));
    }
    if (!body.result || typeof body.result !== 'object' || typeof body.result.ok !== 'boolean') {
      throw withDiagnostics(new HarnessTransportError('harness-response-invalid', method, {
        cause: new Error(`Harness returned an invalid result for ${method}`),
      }));
    }
    if (!body.result?.ok) throw withDiagnostics(new HarnessRpcError(method, body.result?.error));
    return body.result.value;
  }

  async health(options = {}) {
    try {
      await this.rpc('host.describe', {}, 5_000, options);
      return true;
    } catch (error) {
      if (error instanceof HarnessRpcError) throw new HarnessHealthError(error);
      throw error;
    }
  }

  async ensureRunning(options = {}) {
    try {
      return await this.health(options);
    } catch (firstError) {
      if (!this.#autostart) throw firstError;
    }

    if (!this.#managedProcess || this.#managedProcess.exitCode !== null) {
      const port = this.#baseUrl.port || (this.#baseUrl.protocol === 'https:' ? '443' : '80');
      this.#managedProcess = spawn(this.#dshBin, [
        'web', '--host', this.#baseUrl.hostname, '--port', port,
      ], {
        cwd: this.#workspace,
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      this.#managedProcess.on('error', (error) => {
        console.error('[dsh-im] failed to start Harness:', this.#logPrefix, error.message);
      });
    }

    const deadline = Date.now() + 60_000;
    let lastError;
    while (Date.now() < deadline) {
      await sleep(1_000, options.signal);
      try {
        return await this.health(options);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw new HarnessTransportError('harness-timeout', 'host.describe');
  }

  async listWorkspaces(options = {}) {
    return (await this.listWorkspaceEntries(options)).map((item) => item.path);
  }

  async listWorkspaceEntries(options = {}) {
    await this.ensureRunning(options);
    return workspaceEntries(await this.rpc('workspace.list', {}, 30_000, options));
  }

  /**
   * Hide one known Session from the Workspace grouping surfaces. Archiving is a
   * Harness capability: this only carries the request, so an older Host that
   * does not expose it fails loudly instead of silently doing nothing.
   *
   * @param {string} sessionId - Session to archive.
   * @param {object} [options] - `stopActivity` lets the Host stop running work.
   */
  async archiveWorkspaceSession(sessionId, options = {}) {
    const { stopActivity = false, ...rpcOptions } = options;
    await this.ensureRunning(rpcOptions);
    const value = await this.rpc('workspace.archiveSession', {
      sessionId,
      ...(stopActivity === true ? { stopActivity: true } : {}),
    }, 30_000, rpcOptions);
    if (value === null || typeof value !== 'object') {
      throw new Error('Harness returned an invalid response for workspace.archiveSession');
    }
    const archivedSessionIds = value.archivedSessionIds;
    if (archivedSessionIds !== undefined
      && (!Array.isArray(archivedSessionIds)
        || archivedSessionIds.some((id) => typeof id !== 'string' || !id))) {
      throw new Error('Harness returned invalid archived ids for workspace.archiveSession');
    }
    return { archivedSessionIds: archivedSessionIds ?? null };
  }

  async listWorkspaceSessions(workspacePath, options = {}) {
    await this.ensureRunning(options);
    const workspaceList = await this.rpc('workspace.list', {}, 30_000, options);
    const workspace = workspaceFromList(workspacePath, workspaceList);
    if (await this.isUngroupedWorkspace(workspacePath)) {
      const sessionList = await this.rpc('session.list', {}, 30_000, options);
      if (!Array.isArray(sessionList?.items)) {
        throw new Error('Harness returned an invalid response for session.list');
      }
      const registered = new Set();
      const selected = new Set();
      for (const item of workspaceList.items) {
        if (!Array.isArray(item?.sessionIds)
          || item.sessionIds.some((id) => typeof id !== 'string' || !id)) {
          throw new Error('Harness returned invalid session IDs for workspace.list');
        }
        for (const id of item.sessionIds) registered.add(id);
        if (await sameWorkspacePath(item.path, workspacePath)) {
          for (const id of item.sessionIds) selected.add(id);
        }
      }
      for (const item of sessionList.items) {
        if (typeof item?.sessionId !== 'string' || !item.sessionId) {
          throw new Error('Harness returned an invalid response for session.list');
        }
        // A matching cwd never overrides an explicit group assignment.
        if (!registered.has(item.sessionId) && await this.isUngroupedWorkspace(item.cwd)) {
          selected.add(item.sessionId);
        }
      }
      return workspaceSessions(
        { path: workspacePath, sessionIds: [...selected] },
        workspaceList.archivedSessionIds,
        sessionList,
      );
    }
    if (!workspace) return { workspace: workspacePath, sessions: [] };
    const sessionList = await this.rpc('session.list', {}, 30_000, options);
    return workspaceSessions(workspace, workspaceList.archivedSessionIds, sessionList);
  }

  async listModels(options = {}) {
    options.signal?.throwIfAborted();
    await this.ensureRunning(options);
    options.signal?.throwIfAborted();
    if (!this.#apiProxy || options.fresh === true) {
      try {
        const value = await this.rpc('llm.models', {}, 30_000, options);
        return validateModelCatalog(value, 'llm.models');
      } finally {
        if (this.#apiProxy) invalidateModelCatalog(modelCatalogCaches.get(this.#apiProxy));
      }
    }

    let entry = modelCatalogCaches.get(this.#apiProxy);
    if (!entry) {
      entry = { value: null, expiresAt: 0, pending: null, controller: new AbortController() };
      modelCatalogCaches.set(this.#apiProxy, entry);
    }
    if (entry.value && Date.now() < entry.expiresAt) return structuredClone(entry.value);
    if (!entry.pending) {
      // The Host owns this read; one caller cancelling must not cancel its peers.
      const pending = this.rpc('llm.models', {}, 30_000, {
        ...options, signal: entry.controller.signal,
      }).then((value) => {
        const catalog = structuredClone(validateModelCatalog(value, 'llm.models'));
        if (modelCatalogCaches.get(this.#apiProxy) === entry && entry.pending === pending) {
          entry.value = catalog;
          entry.expiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
        }
        return catalog;
      }).finally(() => {
        if (entry.pending === pending) entry.pending = null;
      });
      entry.pending = pending;
    }
    const pending = entry.pending;
    const value = await callWithSignal(
      () => pending,
      options.signal ?? entry.controller.signal,
    );
    return structuredClone(value);
  }

  async getSessionModels(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    await this.ensureRunning(options);
    const value = await this.rpc('session.models', { sessionId }, 30_000, options);
    return validateModelCatalog(value, 'session.models', { session: true });
  }

  async getSessionPermissions(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    await this.ensureRunning(options);
    return this.rpc('session.permissions', { sessionId }, 30_000, options);
  }

  async selectSessionModel(sessionId, selection, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (!validModelSelection(selection)) {
      throw new TypeError('A provider and model are required');
    }
    await this.ensureRunning(options);
    const operation = (maintenanceSignal) => {
      const signal = maintenanceSignal && options.signal
        ? AbortSignal.any([maintenanceSignal, options.signal])
        : (maintenanceSignal ?? options.signal);
      return this.rpc('session.selectModel', {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selection.reasoningEffort }),
      }, 30_000, signal ? { ...options, signal } : options);
    };
    try {
      const value = this.#sessionMaintenanceExecutor
        ? await this.#sessionMaintenanceExecutor({ sessionId, operation })
        : await operation();
      if (!value || typeof value !== 'object' || !validModelSelection(value.selected)) {
        throw new HarnessTransportError('harness-response-invalid', 'session.selectModel');
      }
      return value;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw messageDiagnosticError(error, { stage: 'session.prepare', sessionId });
    }
  }

  async isSessionRunning(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    await this.ensureRunning(options);
    const value = await this.rpc('session.list', {}, 30_000, options);
    if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
      throw new Error('Harness returned an invalid response for session.list');
    }
    for (const item of value.items) {
      if (!item || typeof item !== 'object'
        || typeof item.sessionId !== 'string' || !item.sessionId
        || typeof item.running !== 'boolean') {
        throw new Error('Harness returned an invalid response for session.list');
      }
    }
    return value.items.find((item) => item.sessionId === sessionId)?.running ?? false;
  }

  async adoptWorkspaceSession(value, options = {}) {
    // Modern Hosts separate observing an existing Session from creating one.
    // Keep the legacy transport contract for Hosts without this adapter seam.
    const method = typeof this.#apiProxy?.sessions?.adopt === 'function' ? 'session.adopt' : 'session.create';
    return adoptRegisteredWorkspaceSession(this, value, options, 30_000, method);
  }

  async isUngroupedWorkspace(workspace) {
    return sameWorkspacePath(workspace, this.#ungroupedWorkspace);
  }

  async workspaceId(options = {}) {
    const { workspace = this.#workspace, ...rpcOptions } = options;
    const { items } = await this.rpc('workspace.list', {}, 30_000, rpcOptions);
    const existing = items.find((item) => item.path === workspace);
    if (existing) return existing.workspaceId;
    const created = await this.rpc('workspace.create', { path: workspace }, 30_000, rpcOptions);
    return created.workspace.workspaceId;
  }

  /**
   * This client can name a Session up front (`session.create` accepts `sessionId`),
   * which lets a caller bind a conversation before prompt assembly runs.
   */
  get canChooseSessionId() {
    return true;
  }

  async createSession(options = {}) {
    const { agentPreset: requestedPreset, ...rpcOptions } = options;
    const workspace = rpcOptions.workspace ?? this.#workspace;
    const ungrouped = await this.isUngroupedWorkspace(workspace);
    if (ungrouped) await mkdir(workspace, { recursive: true });
    await this.ensureRunning(rpcOptions);
    const payload = ungrouped
      ? { cwd: workspace }
      : { workspaceId: await this.workspaceId(rpcOptions) };
    const agentPreset = requestedPreset !== undefined ? requestedPreset : this.#agentPreset;
    if (agentPreset != null) payload.agentPreset = agentPreset;
    // The caller may name the Session: it then knows the identity before the
    // Session exists, which is the only way prompt assembly can see it.
    if (typeof options.sessionId === 'string' && options.sessionId !== '') {
      payload.sessionId = options.sessionId;
    }
    const created = await this.rpc('session.create', payload, 30_000, rpcOptions);
    if (typeof created?.sessionId !== 'string' || !created.sessionId) {
      throw new HarnessTransportError('harness-response-invalid', 'session.create');
    }
    return created.sessionId;
  }

  async renameSession(sessionId, title, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('session title is required');
    return this.rpc('session.rename', { sessionId, title }, 30_000, options);
  }

  /**
   * Branch a Session at the latest completed turn (or atSeq when given). The
   * Host answers with the child session id; a Session with no completed turn is
   * reported as fork-unavailable. Throws harness-api-not-found when the Host
   * has no session.fork primitive.
   */
  async forkSession(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    const { atSeq, timeoutMs = 30_000, ...rpcOptions } = options;
    return this.rpc('session.fork', {
      sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
    }, timeoutMs, rpcOptions);
  }

  /**
   * Whether the connected Host can fork sessions. With the host-api transport
   * this is the facade's sessions.fork member; the http transport reaches the
   * Host endpoint directly, so a missing member here is not observable.
   */
  supportsSessionFork() {
    if (this.#apiProxy) return typeof this.#apiProxy?.sessions?.fork === 'function';
    return true;
  }

  async executeCommand(sessionId, line, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (typeof line !== 'string' || !line) throw new TypeError('command line is required');
    if (!this.#commandExecutor) {
      const error = new Error('Harness command execution is unavailable');
      error.code = 'commands-unavailable';
      throw error;
    }
    try {
      return await this.#commandExecutor(sessionId, line, options);
    } catch (error) {
      if (error?.failure && typeof error.failure === 'object') {
        throw new HarnessRpcError('commands.execute', error.failure);
      }
      throw error;
    }
  }

  async readSessionHistory(sessionId, { maxMessages = 50, beforeSeq, timeoutMs = 10_000, ...options } = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 1
      || (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0))) {
      throw new TypeError('Invalid history pagination');
    }
    return this.rpc('session.history', {
      sessionId,
      maxMessages,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    }, timeoutMs, options);
  }

  async #isSessionArchived(sessionId, options = {}) {
    const value = await this.rpc('workspace.list', {}, 30_000, options);
    if (!Array.isArray(value?.archivedSessionIds)
      || value.archivedSessionIds.some((id) => typeof id !== 'string' || !id)) {
      throw new HarnessTransportError('harness-response-invalid', 'workspace.list');
    }
    return value.archivedSessionIds.includes(sessionId);
  }

  // A diagnostic recheck must not hide the original failure or cancellation.
  async #confirmedSessionError(sessionId, options, cause) {
    try {
      if (await this.#isSessionArchived(sessionId, options)) return sessionArchivedError(sessionId, cause);
      if (isSessionLogCorrupt(cause)) {
        return Object.assign(new Error('Stored Session log is unreadable', { cause }), {
          code: 'session-unreadable', method: cause.method,
          details: { reason: 'session-log-corrupt' },
        });
      }
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason ?? error;
    }
    return null;
  }

  async #sessionRpc(method, payload, timeoutMs, options) {
    try {
      return await this.rpc(method, payload, timeoutMs, options);
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason ?? error;
      if (error instanceof HarnessRpcError
        && (['internal', 'gateway/internal'].includes(error.code) || isSessionNotFound(error.code))) {
        throw await this.#confirmedSessionError(payload.sessionId, { signal: options?.signal }, error) ?? error;
      }
      throw error;
    }
  }

  /**
   * 提交超时后的入库确认：session.history 是持久账本，按 promptRpcId 找回我们的
   * 持久化痕迹（已执行的 user/message，或已入队待执行的 agent/inbox/spliced
   * 回执）即视为提交已成功，让 ask() 继续等回复而不是误报失败。
   * 确认探测自身的失败一律吞掉——它们不能掩盖或改变原始提交超时的定性；
   * 唯独取消例外：取消原因必须优先于超时透出。
   */
  async #confirmPromptSubmit(sessionId, promptRpcId, { signal } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (signal?.aborted) return false;
      try {
        const history = await this.#sessionRpc('session.history', {
          sessionId,
          maxMessages: 50,
        }, 30_000, { signal });
        const confirmed = (history?.events ?? []).some((entry) => {
          const event = entry?.event ?? entry;
          if (event?.type === 'user/message') {
            return event?.data?.source?.rpcId === promptRpcId;
          }
          // queue 模式下消息可能已持久入队但尚未产生 user/message：
          // agent/inbox/spliced 的 inserted[].source.rpcId 就是入队回执。
          if (event?.type === 'agent/inbox/spliced') {
            return (event?.data?.inserted ?? [])
              .some((message) => message?.source?.rpcId === promptRpcId);
          }
          return false;
        });
        if (confirmed) return true;
      } catch (probeError) {
        // 取消优先于超时定性：最后一次探测期间被取消时，循环后面没有
        // sleep 再检查 abort，必须在这里把取消原因抛出，不能被超时覆盖。
        if (signal?.aborted) throw signal.reason ?? probeError;
        // 其余账本探测失败不改变定性：本轮未确认，继续轮询或最终按原超时上报。
      }
      if (attempt < 4) await sleep(2_000, signal);
    }
    return false;
  }

  async isSessionArchived(sessionId, options = {}) {
    return this.#isSessionArchived(sessionId, options);
  }

  async sessionExists(sessionId, options = {}) {
    // Archived Sessions still exist. Returning false here would silently bind
    // the conversation to a new Session; reading their active log can also fail.
    if (await this.#isSessionArchived(sessionId, options)) return true;
    try {
      await this.#sessionRpc('session.history', { sessionId, maxMessages: 1 }, 30_000, options);
      return true;
    } catch (error) {
      if (error.code === 'session-archived') return true;
      if (error instanceof HarnessRpcError && isSessionNotFound(error.code)) return false;
      throw error;
    }
  }

  async respondInteraction(rpcId, result, options = {}) {
    if (typeof rpcId !== 'string' || !rpcId) throw new TypeError('rpcId is required');
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new TypeError('A Harness RPC result is required');
    }
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const envelope = { type: 'client-response', rpcId, result };
    let receipt;
    if (this.#apiProxy) {
      receipt = await callWithSignal(() => this.#apiProxy.respond(envelope), signal);
    } else {
      const response = await this.#fetch(new URL('/api/respond', this.#baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Harness transport respond failed: HTTP ${response.status}`);
      }
      receipt = await response.json();
    }
    if (receipt?.accepted === true) return receipt;
    if (receipt?.accepted !== false
      || (receipt.reason !== 'bad-response' && receipt.reason !== 'not-pending')) {
      throw new Error('Harness returned an invalid interaction response receipt');
    }
    const reason = receipt.reason;
    throw new HarnessInteractionError(
      `interaction-${reason}`,
      `Harness interaction response was rejected (${reason})`,
    );
  }

  async watchInteractions(sessionId, {
    signal,
    onInteraction,
    onResolved,
    onSessionEvent,
    onOpen,
    ownership,
    onDiagnostic,
  } = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (!signal || typeof signal.addEventListener !== 'function') {
      throw new TypeError('watchInteractions requires an AbortSignal');
    }
    if (onInteraction !== undefined && typeof onInteraction !== 'function') {
      throw new TypeError('onInteraction must be a function');
    }
    if (onResolved !== undefined && typeof onResolved !== 'function') {
      throw new TypeError('onResolved must be a function');
    }
    if (onSessionEvent !== undefined && typeof onSessionEvent !== 'function') {
      throw new TypeError('onSessionEvent must be a function');
    }
    if (onOpen !== undefined && typeof onOpen !== 'function') {
      throw new TypeError('onOpen must be a function');
    }
    let attempts = 0;
    let lastFailureReason;
    const report = () => {
      try {
        Promise.resolve(onDiagnostic?.({ attempts, ...(lastFailureReason ? { lastFailureReason } : {}) }))
          .catch(() => undefined);
      } catch { /* Diagnostics cannot change stream/reconnect behavior. */ }
    };
    while (!signal.aborted) {
      attempts += 1;
      report();
      try {
        await this.#watchInteractionStream(sessionId, {
          signal,
          onInteraction,
          onResolved,
          onSessionEvent,
          onOpen,
          ownership,
        });
      } catch (error) {
        if (signal.aborted) return;
        lastFailureReason = extractConnectionEvidence(error).details.reason;
        report();
        console.warn('[dsh-im] Harness interaction stream disconnected:', this.#logPrefix, error.message);
      }
      if (signal.aborted) return;
      try {
        await sleep(this.#interactionReconnectDelayMs, signal);
      } catch {
        if (signal.aborted) return;
        throw new Error('Harness interaction reconnect wait failed');
      }
    }
  }

  #registerInteractionOwnership(sessionId, ownership) {
    const owners = this.#interactionOwnerships.get(sessionId) ?? new Set();
    ownership.order = this.#interactionRegistry.nextOrder;
    this.#interactionRegistry.nextOrder += 1;
    owners.add(ownership);
    this.#interactionOwnerships.set(sessionId, owners);
  }

  #unregisterInteractionOwnership(sessionId, ownership) {
    const owners = this.#interactionOwnerships.get(sessionId);
    owners?.delete(ownership);
    if (owners?.size === 0) this.#interactionOwnerships.delete(sessionId);
    for (const [key, claim] of this.#interactionClaims) {
      if (claim.ownership === ownership) this.#interactionClaims.delete(key);
    }
  }

  #registerControlOwnership(ownership) {
    if (!ownership.control) return;
    let routes = this.#controlOwnerships.get(ownership.control.owner);
    if (!routes) {
      routes = new Map();
      this.#controlOwnerships.set(ownership.control.owner, routes);
    }
    const owners = routes.get(ownership.control.key) ?? new Set();
    owners.add(ownership);
    routes.set(ownership.control.key, owners);
  }

  #unregisterControlOwnership(ownership) {
    if (!ownership.control) return;
    const routes = this.#controlOwnerships.get(ownership.control.owner);
    const owners = routes?.get(ownership.control.key);
    owners?.delete(ownership);
    if (owners?.size === 0) routes.delete(ownership.control.key);
    if (routes?.size === 0) this.#controlOwnerships.delete(ownership.control.owner);
  }

  #controlCandidates(sessionId, control) {
    const normalized = normalizeControl(control);
    if (!normalized) return [];
    const owners = this.#controlOwnerships.get(normalized.owner)?.get(normalized.key);
    return [...(owners ?? [])]
      .filter((ownership) => ownership.sessionId === sessionId)
      .sort((left, right) => left.order - right.order);
  }

  #activeControlOwnership(sessionId, control) {
    return this.#controlCandidates(sessionId, control).find((ownership) => (
      ownership.started
      && ownership.active
      && !ownership.completed
      && ownership.turn !== null
    )) ?? null;
  }

  async #refreshControlOwnership(sessionId, control, options) {
    const candidates = this.#controlCandidates(sessionId, control);
    // An exact local owner is mandatory before even observing the Session.
    // This prevents an unrelated chat bound to the same Session from using
    // run state as authority to cancel or steer somebody else's turn.
    if (candidates.length === 0) return null;
    try {
      const history = await this.rpc(
        'session.history',
        { sessionId, maxMessages: 50 },
        30_000,
        options,
      );
      this.#consumeInteractionOwnerships(sessionId, history.events ?? []);
    } catch (error) {
      if (!(error instanceof HarnessRpcError) || !isSessionNotFound(error.code)) throw error;
      for (const ownership of candidates) {
        ownership.active = false;
        ownership.completed = true;
      }
      return null;
    }
    return this.#activeControlOwnership(sessionId, control);
  }

  async hasActiveTurn(sessionId, control, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    return Boolean(await this.#refreshControlOwnership(sessionId, control, options));
  }

  /** Cancel only the persisted prompt's exact live turn, in the host's JS tick.
   * HTTP session.cancel cannot express this precondition, so never fall back to it.
   */
  stopDeferredTurn(sessionId, { turn, promptRpcId } = {}, { signal, isCurrent } = {}) {
    signal?.throwIfAborted();
    if (typeof sessionId !== 'string' || !sessionId
      || !Number.isSafeInteger(turn) || turn < 0
      || typeof promptRpcId !== 'string' || !promptRpcId
      || typeof this.#controlExecutor !== 'function') return false;
    if (isCurrent && !isCurrent()) return false;
    const accepted = this.#controlExecutor({ sessionId, expectedTurn: turn, promptRpcId, action: 'stop' });
    if (accepted && typeof accepted.then === 'function') {
      throw new TypeError('controlExecutor must return synchronously');
    }
    return accepted === true;
  }

  async stopActiveTurn(sessionId, control, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    const ownership = await this.#refreshControlOwnership(sessionId, control, options);
    if (!ownership) return false;
    if (ownership.stopRequested) return true;
    // Re-check after the refresh await. The owning ask may have completed and
    // unregistered while session.history was in flight.
    if (this.#activeControlOwnership(sessionId, control) !== ownership) return false;
    ownership.stopRequested = true;
    try {
      if (this.#controlExecutor) {
        const accepted = this.#controlExecutor({
          sessionId,
          expectedTurn: ownership.turn,
          promptRpcId: ownership.promptRpcId,
          action: 'stop',
        });
        if (accepted && typeof accepted.then === 'function') {
          throw new TypeError('controlExecutor must return synchronously');
        }
        if (accepted !== undefined) {
          if (typeof accepted !== 'boolean') {
            throw new TypeError('controlExecutor must return a boolean or undefined');
          }
          if (!accepted) ownership.stopRequested = false;
          return accepted;
        }
      }
      await this.rpc(
        'session.cancel',
        { sessionId, keepInbox: true },
        30_000,
        options,
      );
      return true;
    } catch (error) {
      if (this.#activeControlOwnership(sessionId, control) === ownership) {
        ownership.stopRequested = false;
      }
      if (error instanceof HarnessRpcError && isSessionNotFound(error.code)) return false;
      throw error;
    }
  }

  async steerActiveTurn(sessionId, text, control, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (typeof text !== 'string' || !text.trim()) {
      throw new TypeError('Steering text is required');
    }
    const ownership = await this.#refreshControlOwnership(sessionId, control, options);
    if (!ownership || ownership.stopRequested) return false;
    if (this.#activeControlOwnership(sessionId, control) !== ownership) return false;
    const inputRpcId = `${this.#rpcIdPrefix}-steer-${randomUUID()}`;
    const releaseInputOrigin = registerImInputOrigin(this.#interactionRegistry, inputRpcId);
    try {
      if (this.#controlExecutor) {
        const accepted = this.#controlExecutor({
          sessionId,
          expectedTurn: ownership.turn,
          promptRpcId: ownership.promptRpcId,
          inputRpcId,
          action: 'steer',
          text,
        });
        if (accepted && typeof accepted.then === 'function') {
          throw new TypeError('controlExecutor must return synchronously');
        }
        if (accepted !== undefined) {
          if (typeof accepted !== 'boolean') {
            throw new TypeError('controlExecutor must return a boolean or undefined');
          }
          if (!accepted) releaseInputOrigin();
          return accepted;
        }
      }
      await this.rpc('session.prompt', {
        sessionId,
        mode: 'steer',
        content: [{ type: 'text', text }],
        ...clientTimeZoneFields(),
      }, 30_000, { ...options, rpcId: inputRpcId });
      return true;
    } catch (error) {
      releaseInputOrigin();
      throw error;
    }
  }

  #consumeInteractionOwnerships(sessionId, entries) {
    for (const ownership of this.#interactionOwnerships.get(sessionId) ?? []) {
      consumeInteractionOwnership(ownership, entries);
    }
  }

  async #refreshInteractionOwnerships(sessionId, signal) {
    const history = await this.rpc(
      'session.history',
      { sessionId, maxMessages: 50 },
      30_000,
      { signal },
    );
    this.#consumeInteractionOwnerships(sessionId, history.events ?? []);
  }

  #interactionOwner(sessionId, claimKey, kind) {
    const claim = this.#interactionClaims.get(claimKey);
    if (claim && this.#interactionOwnerships.get(sessionId)?.has(claim.ownership)) return claim;

    const owners = [...(this.#interactionOwnerships.get(sessionId) ?? [])];
    const active = owners
      .filter((ownership) => ownership.active)
      .sort((left, right) => left.order - right.order);
    if (active.length > 0) return { ownership: active[0], recovered: false };

    // A newly attached IM conversation may encounter a question left by
    // an earlier runtime before its queued prompt starts. Let the oldest such
    // ask adopt that replay so the Session can recover instead of deadlocking.
    // Approval adopters receive recovered=true and must reject it without ever
    // presenting it as approvable; the original actor/route cannot be proven
    // after a runtime restart.
    const ownership = owners
      .filter((ownership) => !ownership.started && !ownership.completed)
      .sort((left, right) => left.order - right.order)[0] ?? null;
    return ownership ? { ownership, recovered: true } : null;
  }

  /** Stage inbound file sources into the Session workspace via the Host executor. */
  async #stageWorkspaceFiles(sessionId, files, signal) {
    if (!this.#fileIngressExecutor) {
      throw new InboundFileError(
        'inbound-file-ingress-unavailable',
        'Harness file ingress is unavailable in this Host process.',
      );
    }
    const sessionList = await this.rpc(
      'session.list',
      {},
      30_000,
      { signal },
    );
    const sessionWorkspace = sessionList?.items?.find(
      (item) => item?.sessionId === sessionId,
    )?.cwd;
    return this.#fileIngressExecutor({
      sessionId,
      workspace: sessionWorkspace,
      files,
      signal,
    });
  }

  async getImageInputLimits() {
    return imageInputLimits(await this.#imageInputPolicy());
  }

  async ask(sessionId, prompt, options = {}) {
    if (typeof options === 'number') options = { timeoutMs: options };
    const diagnostic = { stage: 'prompt.prepare', submissionState: 'not-submitted', sessionId };
    try {
      return await this.#ask(sessionId, prompt, options, diagnostic);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw messageDiagnosticError(error, diagnostic);
    }
  }

  /** Follow a prompt DS Bot carried to another Session, without submitting it again. */
  async waitForTransferredReply(sessionId, { promptRpcId, ...options } = {}) {
    if (typeof promptRpcId !== 'string' || !promptRpcId) {
      throw new TypeError('Transferred prompt identity is required');
    }
    const diagnostic = { stage: 'reply.wait', submissionState: 'accepted', sessionId, promptRpcId };
    try {
      return await this.#ask(sessionId, null, options, diagnostic, promptRpcId);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      // Preflight failures must retain the accepted input's identity too. A
      // fresh part may itself have rolled over before its watcher was opened.
      error.promptAccepted = true;
      error.details = { sessionId, promptRpcId, baselineSeq: -1, ...error.details };
      throw messageDiagnosticError(error, diagnostic);
    }
  }

  async #replyHistory(sessionId, afterSeq, transferred, signal) {
    const events = [];
    let beforeSeq;
    for (let page = 0; page < 20; page += 1) {
      signal?.throwIfAborted();
      const history = await this.#sessionRpc('session.history', {
        sessionId, maxMessages: 50,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      }, 30_000, { signal });
      signal?.throwIfAborted();
      events.push(...(history.events ?? []));
      const oldest = Math.min(...(history.events ?? []).map((entry) => (entry.event ?? entry).seq));
      if (!transferred || !history.hasMore || oldest <= afterSeq + 1) return { events };
      if (!Number.isSafeInteger(oldest) || oldest === beforeSeq) break;
      beforeSeq = oldest;
    }
    // Do not attribute or complete a turn from an incomplete replay window.
    return { events: [] };
  }

  async #ask(sessionId, prompt, options, diagnostic, transferredPromptRpcId = null) {
    const timeoutMs = options.timeoutMs ?? 600_000;
    const signal = options.signal;
    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
    const progressMode = options.progressMode === 'live'
      ? 'live'
      : options.progressMode === 'all' ? 'all' : 'latest';
    // Reasoning updates only exist for consumers that opt in (thinking-trace
    // mode); default ask() consumers keep the pre-thinking-traces stream.
    const reasoning = options.reasoning === true;
    const onArtifact = typeof options.onArtifact === 'function' ? options.onArtifact : null;
    const onInteraction = typeof options.onInteraction === 'function'
      ? options.onInteraction
      : undefined;
    const onInteractionResolved = typeof options.onInteractionResolved === 'function'
      ? options.onInteractionResolved
      : undefined;
    const control = normalizeControl(options.control);
    const inboundFiles = !transferredPromptRpcId && Array.isArray(options.files) ? options.files.filter(Boolean) : [];
    const inboundImages = !transferredPromptRpcId && Array.isArray(options.images) ? options.images.filter(Boolean) : [];
    await this.ensureRunning({ signal });
    if (await this.#isSessionArchived(sessionId, { signal })) throw sessionArchivedError(sessionId);
    const before = transferredPromptRpcId ? { events: [] } : await this.#sessionRpc(
      'session.history',
      { sessionId, maxMessages: 1 },
      30_000,
      { signal },
    );
    const baselineSeq = Math.max(-1, ...(before.events ?? []).map(({ event }) => event.seq ?? -1));
    const promptRpcId = transferredPromptRpcId ?? `${this.#rpcIdPrefix}-${randomUUID()}`;
    diagnostic.promptRpcId = promptRpcId;
    const releasePromptInputOrigin = registerImInputOrigin(this.#interactionRegistry, promptRpcId);
    const tracker = new HarnessReplyTracker({
      promptRpcId, afterSeq: baselineSeq, reasoning, finalAnswerOnly: options.finalAnswerOnly,
    });
    let checkedBlockedSeq = baselineSeq;
    let lastProgressAt = Date.now();
    let lastPollSeq = tracker.lastSeq;
    let progressTail = Promise.resolve();
    const consumeProgress = (entries, { fromMux = false } = {}) => {
      const updates = tracker.consumeAll(entries, {
        live: progressMode === 'live',
        fromMux,
      });
      const seqAdvanced = tracker.lastSeq > lastPollSeq;
      lastPollSeq = tracker.lastSeq;
      if (seqAdvanced) lastProgressAt = Date.now();
      if (!onUpdate) return progressTail;
      const visibleUpdates = progressMode === 'all' || progressMode === 'live'
        ? updates
        : updates
            .filter((update) => update.type !== 'assistant-message' && update.type !== 'reasoning')
            .slice(-1);
      for (const update of visibleUpdates) {
        progressTail = progressTail
          .then(() => onUpdate(update))
          .catch((error) => {
            // The WeCom SDK rejects with the raw ack frame (no .message), so
            // surface errcode/errmsg explicitly instead of printing undefined.
            const detail = error instanceof Error
              ? error.message
              : `${error?.errmsg ?? error?.body?.errmsg ?? '(no message)'} (errcode=${error?.errcode ?? error?.body?.errcode ?? 'unknown'})`;
            console.warn(
              '[dsh-im] ignored a progress update failure:',
              this.#logPrefix,
              detail,
            );
          });
      }
      return progressTail;
    };
    const interactionController = onInteraction || onInteractionResolved
      || (progressMode === 'live' && onUpdate)
      ? new AbortController()
      : null;
    const interactionSignal = interactionController
      ? (signal
          ? AbortSignal.any([signal, interactionController.signal])
          : interactionController.signal)
      : null;
    // The mux is host-global. A prompt RPC becomes the owner only when its
    // durable user/message starts a turn, so two chats bound to one Session
    // cannot answer each other's questions or approvals.
    const ownership = interactionController || control
      ? {
          sessionId,
          promptRpcId,
          active: false,
          started: false,
          completed: false,
          stopRequested: false,
          turn: null,
          openTurn: null,
          lastSeq: baselineSeq,
          reconnect: null,
          order: -1,
          competitiveApprovals: this.#competitiveApprovals,
          toolCalls: new Map(),
          control,
        }
      : null;
    let interactionTask = null;
    let artifactsDelivered = false;
    let deliveredArtifactCount = 0;
    let artifactHandoffError = null;
    const stagedBatches = options.handoffResources?.stagedBatches ?? [];
    let promptAccepted = Boolean(transferredPromptRpcId);
    let turnFinished = false;
    let handedOff = false;

    const deliverArtifacts = async () => {
      if (!onArtifact || artifactsDelivered || tracker.turn === null) {
        return deliveredArtifactCount;
      }
      artifactsDelivered = true;
      const artifacts = outboundArtifactRegistry.take(sessionId, tracker.turn, { signal });
      for (const artifact of artifacts) {
        try {
          await onArtifact(artifact);
          deliveredArtifactCount += 1;
        } catch (error) {
          artifactHandoffError ??= error;
          outboundArtifactRegistry.release(artifact);
          console.warn('[dsh-im] ignored an artifact handoff failure:', this.#logPrefix, error.message);
        }
      }
      return deliveredArtifactCount;
    };

    if (ownership) {
      this.#registerInteractionOwnership(sessionId, ownership);
      this.#registerControlOwnership(ownership);
    }
    // Advertise delivery only when this request can actually claim its files.
    const closeGroupHistoryAccess = groupHistoryAccess.open(sessionId, promptRpcId, options.groupHistory);
    const closeArtifactConsumer = typeof onArtifact === 'function'
      ? outboundArtifactRegistry.openConsumer(sessionId, promptRpcId)
      : null;

    try {
      const basePrompt = prompt;
      if (inboundFiles.length > 0) {
        const staged = await this.#stageWorkspaceFiles(sessionId, inboundFiles, signal);
        stagedBatches.push(staged);
        prompt = appendInboundFilesToPrompt(prompt, staged);
      }
      if (inboundImages.length > 0) {
        const limits = await this.getImageInputLimits();
        const sources = inboundImagesAsFiles(inboundImages, limits);
        let staged;
        try {
          staged = await this.#stageWorkspaceFiles(sessionId, sources, signal);
        } catch (error) {
          // Ingress wraps loader errors; retain the original image diagnostic.
          if (signal?.aborted) throw signal.reason ?? error;
          if (error?.cause?.name === 'ImagePromptError') throw error.cause;
          throw error;
        }
        stagedBatches.push(staged);
        const images = await imageContentFromStaged(staged, limits, { signal });
        const originalContent = typeof basePrompt === 'string'
          ? [{ type: 'text', text: basePrompt }] : basePrompt;
        prompt = appendInboundFilesToPrompt([...originalContent, ...images], {
          files: stagedBatches.flatMap((batch) => batch.files),
        });
      }
      if (interactionSignal) {
        diagnostic.stage = 'interaction.open';
        const startedAt = performance.now();
        let streamDiagnostic = { attempts: 0 };
        let markOpen;
        const opened = new Promise((resolve) => { markOpen = resolve; });
        interactionTask = this.watchInteractions(sessionId, {
          signal: interactionSignal,
          onInteraction,
          onResolved: onInteractionResolved,
          onSessionEvent: progressMode === 'live'
            ? (event) => { consumeProgress([event], { fromMux: true }); }
            : undefined,
          onOpen: markOpen,
          ownership,
          onDiagnostic: (value) => { streamDiagnostic = value; },
        });
        void interactionTask.catch(() => undefined);
        await Promise.race([
          opened,
          sleep(30_000, interactionSignal).then(() => {
            throw Object.assign(new HarnessInteractionError(
              'harness-interaction-timeout',
              'Harness interaction stream did not open within 30 seconds',
            ), {
              transport: this.#apiProxy ? 'host-api' : 'websocket',
              durationMs: Math.round(performance.now() - startedAt),
              timeoutMs: 30_000,
              ...streamDiagnostic,
            });
          }),
        ]);
      }
      // Restore the channel's trusted guidance in a fresh part too; never
      // derive it from the forwarded message's content.
      imSourceGuidance.publish(sessionId, options.sourceGuidance);
      if (!transferredPromptRpcId) {
        diagnostic.stage = 'prompt.prepare';
        const content = typeof prompt === 'string'
          ? [{ type: 'text', text: prompt }]
          : prompt;
        if (!Array.isArray(content) || content.length === 0) {
          throw new TypeError('Harness prompt content is required');
        }
        const timeZoneFields = clientTimeZoneFields();
        const sendPrompt = (promptContent) => {
          diagnostic.stage = 'prompt.submit';
          diagnostic.submissionState = 'unknown';
          return this.#sessionRpc('session.prompt', {
            sessionId,
            mode: 'queue',
            content: promptContent,
            ...timeZoneFields,
          }, 30_000, { rpcId: promptRpcId, signal });
        };
        // 30 秒提交窗口到期只说明 Host 忙到没来得及应答，prompt 可能早已入队。
        // 先按 promptRpcId 回查持久账本，确认入库就继续等回复；确认不到才把
        // 原始超时错误向上抛，由文案层标注「提交请求超时、是否送达未知」。
        const submitPrompt = async (promptContent) => {
          try {
            await sendPrompt(promptContent);
          } catch (error) {
            if (!isPromptSubmitTimeout(error) || signal?.aborted) throw error;
            let confirmed = false;
            try {
              confirmed = await this.#confirmPromptSubmit(sessionId, promptRpcId, { signal });
            } catch (confirmError) {
              // 确认途中被取消时恢复调用方的取消语义（与图片暂存路径一致）。
              if (signal?.aborted) throw signal.reason ?? confirmError;
              throw error;
            }
            if (!confirmed) throw error;
            diagnostic.submissionState = 'accepted';
          }
        };
        try {
          await submitPrompt(content);
        } catch (error) {
          // The Host refuses image blocks for a non-vision model before any
          // durable user message exists. Re-deliver the same bytes the way
          // ordinary uploads (zip, documents) already travel — staged into the
          // Session workspace and named in a text manifest — then retry once
          // with a text-only prompt. The retry reuses promptRpcId so reply
          // tracking, control and interaction ownership stay bound to this ask.
          const originalsStaged = inboundImages.length > 0 && isImageAdmissionRejection(error)
            && content.some((part) => part.type === 'image');
          const imageSources = !originalsStaged && isModelImageRejection(error)
            ? imageFileSourcesFromContent(content) : [];
          if (!originalsStaged && imageSources.length === 0) throw error;
          if (!originalsStaged) {
            let stagedImages;
            try {
              stagedImages = await this.#stageWorkspaceFiles(sessionId, imageSources, signal);
            } catch (stagingError) {
              if (signal?.aborted) throw signal.reason ?? stagingError;
              console.warn(
                '[dsh-im] unable to restage rejected images as workspace files:',
                this.#logPrefix,
                stagingError?.message ?? String(stagingError),
              );
              throw error;
            }
            stagedBatches.push(stagedImages);
          }
          const baseContent = typeof basePrompt === 'string'
            ? [{ type: 'text', text: basePrompt }]
            : basePrompt;
          const fallbackPrompt = appendInboundFilesToPrompt([
            ...contentWithoutImages(baseContent),
            { type: 'text', text: t(isModelImageRejection(error) ? IMAGE_FILE_FALLBACK_PROMPT : IMAGE_HOST_LIMIT_FALLBACK_PROMPT) },
          ], { files: stagedBatches.flatMap((batch) => batch?.files ?? []) });
          await submitPrompt(fallbackPrompt);
        }
      }
      promptAccepted = true;
      diagnostic.submissionState = 'accepted';
      diagnostic.stage = 'reply.wait';

      try {
        // Treat timeoutMs as a stall window rather than a hard runtime limit.
        // Durable events are direct progress. Once a full quiet window elapses,
        // confirm the Session is still running before renewing the wait.
        // Interaction ownership is intentionally not a liveness signal: it stays
        // active until turn/end and can therefore outlive a stalled turn.
        while (true) {
          await sleep(300, signal);
          options.assertCurrent?.();
          const history = await this.#replyHistory(sessionId, tracker.lastSeq, Boolean(transferredPromptRpcId), signal);
          options.assertCurrent?.();
          const wasActive = ownership?.active === true;
          if (ownership) {
            this.#consumeInteractionOwnerships(sessionId, history.events ?? []);
            if (!wasActive && ownership.active) ownership.reconnect?.();
          }
          await consumeProgress(history.events ?? []);
          if (tracker.finished) {
            turnFinished = true;
            const completion = !ownership?.stopRequested && harnessTurnSucceeded(tracker.reason)
              ? await this.#completionExecutor?.({ sessionId, afterSeq: tracker.lastSeq, signal }) : undefined;
            options.assertCurrent?.();
            const reason = completion?.reason ?? tracker.reason;
            if (!ownership?.stopRequested && !harnessTurnSucceeded(reason)) {
              const failure = harnessTurnError(reason);
              if (failure.code === 'turn-blocked') {
                throw await this.#confirmedSessionError(sessionId, { signal }, failure) ?? failure;
              }
              throw failure;
            }
            // An accepted /stop revokes attachment delivery even when Harness
            // preserved a useful partial text answer for the existing UX.
            const artifactCount = ownership?.stopRequested
              ? 0
              : await deliverArtifacts();
            const answer = ownership?.stopRequested ? tracker.answer : completion?.answer ?? tracker.finalAnswer;
            if (answer) return answer;
            if (artifactCount > 0) return '';
            if (ownership?.stopRequested) throw turnStoppedError();
            if (artifactHandoffError) throw artifactHandoffError;
            // A completed turn can do all its work through tools without text.
            // Missing end reasons retain the existing empty-reply failure.
            if (tracker.reason != null && harnessTurnSucceeded(tracker.reason)) {
              return t('本轮处理已结束，没有文本回复。');
            }
            throw harnessTurnError(tracker.reason);
          }

          if (tracker.turn === null && !ownership?.stopRequested) {
            // An admission gate can block before user/message supplies rpcId.
            // This event only prompts a Session-level archive check; it never
            // grants ownership of another caller's turn, artifacts or approvals.
            const blockedSeq = Math.max(checkedBlockedSeq, ...(history.events ?? [])
              .map((entry) => entry?.event ?? entry)
              .filter((event) => event?.type === 'turn/end'
                && (event.data?.reason?.kind ?? event.data?.reason) === 'blocked'
                && Number.isSafeInteger(event.seq))
              .map((event) => event.seq));
            if (blockedSeq > checkedBlockedSeq) {
              checkedBlockedSeq = blockedSeq;
              const archived = await this.#confirmedSessionError(sessionId, { signal });
              if (archived) throw archived;
            }
          }

          if (Date.now() - lastProgressAt < timeoutMs) continue;

          if (!ownership?.stopRequested) {
            const archived = await this.#confirmedSessionError(sessionId, { signal });
            if (archived) throw archived;
          }

          let running = false;
          try {
            running = await this.isSessionRunning(sessionId, { signal });
          } catch (error) {
            if (signal?.aborted) throw signal.reason ?? error;
            // A failed liveness probe is not evidence of progress.
          }
          if (running) {
            lastProgressAt = Date.now();
            continue;
          }
          const timeoutError = new HarnessTurnError('harness-reply-timeout');
          timeoutError.durationMs = Date.now() - lastProgressAt;
          timeoutError.timeoutMs = timeoutMs;
          // Data-only context for deferred delivery; timeout semantics unchanged.
          timeoutError.details = { sessionId, promptRpcId, baselineSeq, turn: tracker.turn, lastSeq: tracker.lastSeq };
          throw timeoutError;
        }
      } catch (error) {
        handedOff = Boolean(options.handoffResources)
          && ['turn-blocked', 'session-archived'].includes(error.code);
        if (error.code === 'session-archived') {
          error.promptAccepted = promptAccepted;
          error.details = { ...error.details, promptRpcId, baselineSeq, turn: tracker.turn, lastSeq: tracker.lastSeq };
        }
        if (error instanceof HarnessTurnError) {
          error.details ??= {
            sessionId, promptRpcId, baselineSeq, turn: tracker.turn, lastSeq: tracker.lastSeq,
          };
        }
        // Once cancellation was accepted, transport/poll failures and timeouts
        // describe the convergence of that stop, not an unrelated ask failure.
        if (!ownership?.stopRequested) throw error;
        if (tracker.answer) {
          return tracker.answer;
        }
        if (error?.code === 'turn-stopped') throw error;
        throw turnStoppedError();
      }
    } finally {
      releasePromptInputOrigin();
      if (!promptAccepted || (turnFinished && !handedOff)) {
        for (const staged of stagedBatches) {
          try {
            await staged?.cleanup?.();
          } catch (error) {
            console.warn('[dsh-im] unable to clean inbound files:', this.#logPrefix, error.message);
          }
        }
      }
      closeArtifactConsumer?.();
      closeGroupHistoryAccess();
      if (ownership) {
        this.#unregisterControlOwnership(ownership);
        this.#unregisterInteractionOwnership(sessionId, ownership);
      }
      if (tracker.turn !== null) outboundArtifactRegistry.discard(sessionId, tracker.turn);
      interactionController?.abort(new DOMException('Harness turn finished', 'AbortError'));
      if (interactionTask) await interactionTask.catch(() => undefined);
    }
  }

  async #watchInteractionStream(sessionId, {
    signal,
    onInteraction,
    onResolved,
    onSessionEvent,
    onOpen,
    ownership,
  }) {
    let settled = false;
    let callbackFailure = null;
    let callbackTail = Promise.resolve();
    let ownershipReady = ownership === undefined || ownership === null;
    const bufferedEnvelopes = [];
    let close = () => {};
    const handleOpen = (closeStream) => {
      close = closeStream;
      if (ownership) ownership.reconnect = close;
      try {
        onOpen?.();
      } catch (error) {
        console.warn('[dsh-im] ignored an interaction open callback failure:', this.#logPrefix, error.message);
      }
      if (ownership) {
        void this.#refreshInteractionOwnerships(sessionId, signal).then(() => {
          if (settled) return;
          ownershipReady = true;
          for (const envelope of bufferedEnvelopes.splice(0)) processEnvelope(envelope);
        }).catch((error) => {
          callbackFailure ??= error;
          close();
        });
      }
    };
    const dispatch = (callback, value) => {
      if (!callback) return;
      callbackTail = callbackTail
        .then(() => callback(value))
        .catch((error) => {
          callbackFailure ??= error;
          close();
        });
    };
    const processEnvelope = (envelope) => {
      const payload = envelope.payload;
      if (payload.type === 'session/event') {
        if (ownership) this.#consumeInteractionOwnerships(sessionId, [payload.event]);
        dispatch(onSessionEvent, payload.event);
        return;
      }
      if (payload.type === 'question/requested' || payload.type === 'approval/requested') {
        const kind = payload.type === 'question/requested' ? 'question' : 'approval';
        const interactionId = kind === 'question' ? envelope.rpcId : payload.approvalId;
        const claimKey = `${kind}:${interactionId}`;
        if (ownership) {
          const claim = this.#interactionOwner(sessionId, claimKey, kind);
          if (claim?.ownership !== ownership) return;
          this.#interactionClaims.set(claimKey, claim);
        }
        const toolCall = kind === 'approval' && ownership && typeof payload.callId === 'string'
          ? this.#interactionClaims.get(claimKey)?.ownership.toolCalls.get(payload.callId)
          : undefined;
        dispatch(onInteraction, Object.freeze({
          kind,
          interactionId,
          rpcId: envelope.rpcId,
          sessionId,
          payload,
          recovered: ownership
            ? this.#interactionClaims.get(claimKey)?.recovered === true
            : false,
          ...(toolCall ? { toolCall } : {}),
          ...(kind === 'approval' && payload.competitive === true ? {
            withdraw: () => this.respondInteraction(envelope.rpcId, {
              ok: false, error: { code: 'unavailable', message: 'IM cannot answer this approval', details: {} },
            }, { signal: AbortSignal.timeout(5_000) }),
          } : {}),
          reconnect: close,
          respond: (result, options = {}) => this.respondInteraction(
            envelope.rpcId,
            result,
            { ...options, signal: options.signal ?? signal },
          ),
        }));
        return;
      }
      if (payload.type === 'question/resolved' || payload.type === 'approval/resolved') {
        const kind = payload.type === 'question/resolved' ? 'question' : 'approval';
        const interactionId = kind === 'question'
          ? payload.questionRpcId
          : payload.approvalId;
        const claimKey = `${kind}:${interactionId}`;
        if (ownership) {
          const claim = this.#interactionClaims.get(claimKey);
          if (claim?.ownership !== ownership) return;
          this.#interactionClaims.delete(claimKey);
        }
        dispatch(onResolved, Object.freeze({
          kind,
          interactionId,
          sessionId,
          outcome: payload.outcome,
          payload,
        }));
      }
    };
    const handleEnvelope = (envelope) => {
      try {
        const payload = envelope?.payload;
        if (envelope?.type !== 'server-request'
          || typeof envelope.rpcId !== 'string'
          || !payload || typeof payload !== 'object'
          || envelope.method !== payload.type) {
          throw new Error('invalid server-request envelope');
        }
        if (payload.sessionId !== sessionId) return;
        if (!ownershipReady) bufferedEnvelopes.push(envelope);
        else processEnvelope(envelope);
      } catch (error) {
        console.warn('[dsh-im] ignored a malformed Harness interaction frame:', this.#logPrefix, error.message);
      }
    };
    try {
      await this.#watchMux({ signal, onOpen: handleOpen, onEnvelope: handleEnvelope });
    } finally {
      settled = true;
      if (ownership?.reconnect === close) ownership.reconnect = null;
      if (!signal.aborted) await callbackTail;
    }
    if (!signal.aborted && callbackFailure) throw callbackFailure;
  }

  /**
   * Watch the global Harness event mux (all sessions) until `signal`
   * aborts, reconnecting on drop. Both transports deliver the same envelopes;
   * only session/event payloads are forwarded. onReconnect fires after every
   * (re)connection so callers can compensate for events missed while offline.
   */
  async watchHarnessEvents({ signal, onSessionEvent, onReconnect } = {}) {
    if (typeof onSessionEvent !== 'function') {
      throw new TypeError('watchHarnessEvents requires onSessionEvent');
    }
    if (!signal || typeof signal.addEventListener !== 'function') {
      throw new TypeError('watchHarnessEvents requires an AbortSignal');
    }
    if (onReconnect !== undefined && typeof onReconnect !== 'function') {
      throw new TypeError('onReconnect must be a function');
    }
    while (!signal.aborted) {
      try {
        await this.#watchMux({
          signal,
          onOpen: () => {
            try {
              onReconnect?.();
            } catch (error) {
              console.warn('[dsh-im] mux reconnect hook failed:', this.#logPrefix, error.message);
            }
          },
          onEnvelope: (envelope) => {
            try {
              const payload = envelope?.payload;
              if (envelope?.type !== 'server-request'
                || !payload
                || typeof payload !== 'object'
                || envelope.method !== payload.type
                || payload.type !== 'session/event'
                || typeof payload.sessionId !== 'string'
                || !payload.event
                || typeof payload.event !== 'object') return;
              onSessionEvent({ sessionId: payload.sessionId, event: payload.event });
            } catch (error) {
              console.warn('[dsh-im] ignored a malformed global mux frame:', this.#logPrefix, error.message);
            }
          },
        });
      } catch (error) {
        if (signal.aborted) return;
        console.warn('[dsh-im] Harness event mux disconnected:', this.#logPrefix, error.message);
      }
      if (signal.aborted) return;
      try {
        await sleep(this.#interactionReconnectDelayMs, signal);
      } catch {
        if (signal.aborted) return;
        throw new Error('Harness event mux reconnect wait failed');
      }
    }
  }

  #watchMux(options) {
    return watchHarnessMux({
      apiProxy: this.#apiProxy,
      baseUrl: this.#baseUrl,
      createWebSocket: this.#createWebSocket,
      rpcId: `${this.#rpcIdPrefix}-${randomUUID()}`,
      ...options,
      onMalformed: (error) => {
        console.warn('[dsh-im] ignored a malformed Harness mux frame:', this.#logPrefix, error.message);
      },
    });
  }

  stopManagedProcess() {
    if (this.#managedProcess?.exitCode === null) this.#managedProcess.kill('SIGTERM');
  }
}
