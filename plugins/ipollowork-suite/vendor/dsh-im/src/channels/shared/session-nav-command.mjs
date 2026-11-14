import { t } from './i18n.mjs';
import { conversationSessionWorkspace, splitWorkspaceCommandMessage } from './workspace-command.mjs';
import { isSessionNotFound } from './session-error.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';
import { safeCodeFence } from './markdown-chunks.mjs';
import { normalizeSessionTitle } from './session-title.mjs';
import {
  navigateSessionRing,
  renameSessionRingEntry,
  sessionRingBackTarget,
  sessionRingEntryByNumber,
  sessionRingEntryBySessionId,
  sessionRingForwardTarget,
  stepSessionRingTo,
} from './session-ring.mjs';

const SESSION_NAV_COMMAND = /^\/(?:ls|list|go|prev|next|drop|title|tail|peek|fork)(?=$|\s)/iu;
const GO_COMMAND = /^\/go\s+(\d+)(?:\s+([\s\S]+))?$/iu;
const PREV_COMMAND = /^\/prev(?:\s+([\s\S]+))?$/iu;
const NEXT_COMMAND = /^\/next(?:\s+([\s\S]+))?$/iu;
const DROP_COMMAND = /^\/drop[ \t]+(\d+|all|\*)$/iu;
const TITLE_COMMAND = /^\/title(?:\s+([\s\S]+))?$/iu;
const TAIL_COMMAND = /^\/(?:tail|peek)(?:\s+([\s\S]+))?$/iu;
const FORK_COMMAND = /^\/fork(?:\s+([\s\S]+))?$/iu;

const DEFAULT_TAIL_COUNT = 5;
const MAX_TAIL_COUNT = 50;
const TAIL_PAGE_SIZE = 50;
const TAIL_READ_TIMEOUT_MS = 10_000;
const TAIL_EXPORT_EVENT_CAP = 5_000;
const TAIL_TOTAL_BUDGET = 4_000;
const RING_LIST_LIMIT = 20;

const INJECTED_CONTEXT_PREFIX = /^(?:<dsh_im_source>[\s\S]*?<\/dsh_im_source>\s*)?(?:<dsh_im_source_guidance>[\s\S]*?<\/dsh_im_source_guidance>\s*)?(?:<dsh_im_reply_to>[\s\S]*?<\/dsh_im_reply_to>\s*)?/u;

export function isSessionNavCommand(text) {
  return typeof text === 'string' && SESSION_NAV_COMMAND.test(text.trim());
}

/** Single source of truth for the /ls marker glyphs (no VS16, fixed width). */
export const SESSION_MARKERS = Object.freeze({
  current: '●',
  ordinary: '·',
  dead: '✕',
  back: '←',
  forward: '→',
  both: '⇄',
});

/** Marker for one ring entry given the computed back/forward targets. */
function sessionMarker(entry, markers, availabilityState) {
  if (availabilityState === 'deleted' || availabilityState === 'archived') return SESSION_MARKERS.dead;
  if (markers?.currentSessionId && entry.sessionId === markers.currentSessionId) return SESSION_MARKERS.current;
  if (markers?.backTarget != null
    && markers.backTarget === markers.forwardTarget
    && entry.n === markers.backTarget) {
    return SESSION_MARKERS.both;
  }
  if (entry.n === markers?.backTarget) return SESSION_MARKERS.back;
  if (entry.n === markers?.forwardTarget) return SESSION_MARKERS.forward;
  return SESSION_MARKERS.ordinary;
}

/** `●4` style number: marker + entry number, so glyphs cannot drift. */
export function renderSessionNumber(entry, markers, availabilityState = 'alive') {
  return `${sessionMarker(entry, markers, availabilityState)}${entry.n}`;
}

function commandResult(message, extra = {}) {
  return {
    handled: true,
    message,
    messages: splitWorkspaceCommandMessage(message),
    document: null,
    hide: false,
    ...extra,
  };
}

function documentResult(document) {
  return { handled: true, message: null, messages: [], document, hide: false };
}

function sortedEvents(events) {
  return [...events.values()].sort((left, right) => left.seq - right.seq);
}

function formatAgeNumber(value) {
  if (value < 10) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }
  return String(Math.round(value));
}

/** Compact age of last activity with one localized unit, e.g. 70 сек / 10 мин / 3.5 ч / 2 д. */
export function formatAge(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  const delta = Math.max(0, now - ms);
  const seconds = delta / 1_000;
  if (seconds < 90) return `${Math.floor(seconds)} ${t('秒')}`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${formatAgeNumber(minutes)} ${t('分')}`;
  const hours = minutes / 60;
  if (hours < 36) return `${formatAgeNumber(hours)} ${t('时')}`;
  return `${formatAgeNumber(hours / 24)} ${t('天')}`;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function stripInjectedPrefix(text) {
  return typeof text === 'string' ? text.replace(INJECTED_CONTEXT_PREFIX, '') : text;
}

/**
 * Reduce a session event stream to user prompts and assistant final answers.
 * Tool calls, tool results, system events, injected plugin context and subagent
 * traffic are all dropped; consecutive fragments of the same role merge.
 */
export function tailMessages(events) {
  const ordered = [];
  const assistants = new Map();
  for (const event of events) {
    const data = event?.data;
    if (event?.type === 'user/message' && event?.surfaceOp === 'append'
      && data?.source?.kind === 'user') {
      ordered.push({ role: 'user', text: stripInjectedPrefix(messageText(data.content)) });
    } else if (event?.type === 'assistant/message' && event?.surfaceOp === 'append'
      && Number.isSafeInteger(data?.turn) && data.turn >= 0) {
      assistants.set(data.turn, event);
    } else if (event?.type === 'turn/end') {
      const assistant = assistants.get(data?.turn);
      assistants.delete(data?.turn);
      if ((data?.reason?.kind ?? data?.reason) !== 'completed'
        || !assistant || assistant.data.interrupted === true) continue;
      ordered.push({ role: 'assistant', text: messageText(assistant.data.message?.content) });
    }
  }
  const merged = [];
  for (const message of ordered) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.text = `${last.text}\n${message.text}`;
    else merged.push(message);
  }
  return merged;
}

/**
 * Page backwards over a session's history, stopping when `stop(events)` turns
 * true or the session is exhausted. Returns the collected events plus why the
 * loop ended, so a preview and an export can interpret the two exits correctly.
 */
async function readTailEvents(session, { signal, stop }) {
  const events = new Map();
  let beforeSeq;
  const deadline = Date.now() + TAIL_READ_TIMEOUT_MS;
  for (;;) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new DOMException('Tail read timed out', 'TimeoutError');
    const page = await session.readHistory({
      maxMessages: TAIL_PAGE_SIZE,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal,
    });
    signal?.throwIfAborted();
    if (!page || !Array.isArray(page.events) || typeof page.hasMore !== 'boolean') {
      throw new TypeError('Invalid history page');
    }
    let oldestSeq = beforeSeq ?? Infinity;
    let advanced = false;
    for (const entry of page.events) {
      const event = entry?.event;
      if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0
        || typeof event.type !== 'string' || !event.type) {
        throw new TypeError('Invalid history event');
      }
      if (beforeSeq !== undefined && event.seq >= beforeSeq) continue;
      if (events.has(event.seq)) continue;
      events.set(event.seq, event);
      advanced = true;
      oldestSeq = Math.min(oldestSeq, event.seq);
    }
    if (stop && stop(events)) return { events, stopped: true, exhausted: false };
    if (!page.hasMore) return { events, stopped: false, exhausted: true };
    if (!advanced || oldestSeq === beforeSeq) throw new TypeError('History cursor did not advance');
    beforeSeq = oldestSeq;
  }
}

function truncateToBudget(text, { maxLines, maxChars }) {
  if (typeof text !== 'string' || !text) return '';
  const lines = text.split('\n');
  let out = '';
  let usedLines = 0;
  for (const line of lines) {
    if (usedLines >= maxLines) break;
    const remaining = maxChars - out.length;
    if (remaining <= 0) break;
    const segment = line.length > remaining ? `${line.slice(0, Math.max(0, remaining - 1))}…` : line;
    out += (usedLines === 0 ? '' : '\n') + segment;
    usedLines += 1;
  }
  return out;
}

function renderTailPreview(messages, { count, n }) {
  const budget = count <= 10
    ? { maxLines: 3, maxChars: 300 }
    : { maxLines: 1, maxChars: 100 };
  const header = n === null
    ? t('当前会话最近 {count} 条（仅显示提问与回答）：', { count: messages.length })
    : t('会话 {n} 最近 {count} 条（仅显示提问与回答）：', { n, count: messages.length });
  const lines = [header];
  let total = header.length;
  let shown = 0;
  for (const message of [...messages].reverse()) {
    const label = message.role === 'user' ? t('用户') : t('助手');
    const block = `${label}\n${truncateToBudget(message.text, budget)}`;
    if (total + block.length + 2 > TAIL_TOTAL_BUDGET) break;
    lines.push(block);
    total += block.length + 2;
    shown += 1;
  }
  const hidden = messages.length - shown;
  if (hidden > 0) lines.push(t('… 还有 {n} 条更早的消息。', { n: hidden }));
  return lines.join('\n\n');
}

function tailErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code)) return t('当前聊天绑定的会话已不存在，请重新绑定会话。');
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found'
    || code === 'session-binding-changed') {
    return t('会话、工作区或机器人状态已发生变化，请重新执行 /tail。');
  }
  if (code === 'harness-api-not-found') return t('当前 Harness 暂不支持读取会话历史。');
  if (error?.name === 'AbortError') return t('读取已取消。');
  if (error?.name === 'TimeoutError' || code === 'harness-timeout') return t('读取超时，请稍后重试。');
  return t('暂时无法读取会话内容，请稍后重试。');
}

/**
 * Best-effort availability: 'alive' = exists and bindable, 'archived' = exists
 * but cannot be bound, 'deleted' = no longer exists, null = unknown.
 */
async function entryAvailability(harness, key, sessionId, signal) {
  try {
    const session = typeof harness?.workspaceSession === 'function'
      ? harness.workspaceSession(sessionId, key)
      : null;
    if (!session || typeof session.sessionExists !== 'function') return null;
    signal?.throwIfAborted();
    if ((await session.sessionExists()) === false) return 'deleted';
    if (typeof harness?.isSessionArchived === 'function') {
      signal?.throwIfAborted();
      if (await harness.isSessionArchived(sessionId, { signal }) === true) return 'archived';
    }
    return 'alive';
  } catch {
    return null;
  }
}

function unknownEntryResult(n) {
  return commandResult(t('没有编号为 {n} 的会话。用 /ls 查看列表。', { n }));
}

/** Best-effort title + last-activity for one Session, read from the Host. */
async function fetchSessionInfoFromHost(harness, key, sessionId, signal) {
  if (typeof harness?.listWorkspaceSessions !== 'function') return null;
  try {
    const workspace = await conversationSessionWorkspace(harness, key, { signal });
    if (!workspace) return null;
    signal?.throwIfAborted();
    const listed = await harness.listWorkspaceSessions(workspace, { signal });
    const session = Array.isArray(listed?.sessions)
      ? listed.sessions.find((candidate) => candidate?.sessionId === sessionId)
      : null;
    if (!session) return null;
    return {
      title: typeof session.title === 'string' && session.title ? session.title : null,
      lastSeenAt: Number.isFinite(session.time) ? session.time : null,
    };
  } catch {
    return null;
  }
}

/** Batch Host titles for a list of Session ids, so /ls can surface them. */
async function hostSessionTitles(harness, key, sessionIds, signal) {
  const titles = new Map();
  if (typeof harness?.listWorkspaceSessions !== 'function' || sessionIds.length === 0) return titles;
  try {
    const workspace = await conversationSessionWorkspace(harness, key, { signal });
    if (!workspace) return titles;
    signal?.throwIfAborted();
    const listed = await harness.listWorkspaceSessions(workspace, { signal });
    for (const session of listed?.sessions ?? []) {
      if (session?.sessionId && typeof session.title === 'string' && session.title) {
        titles.set(session.sessionId, session.title);
      }
    }
  } catch {
    // titles are best-effort
  }
  return titles;
}

/**
 * The currently bound Session must always be in the ring. A chat bound before
 * this feature shipped has a binding but no ring entry, so the first navigation
 * command registers it lazily (number = next free, title and last-activity from
 * the Host).
 */
async function ensureCurrentSessionInRing(state, harness, key, { signal }) {
  const sessionId = state?.sessionFor?.(key);
  if (!sessionId) return null;
  const ring = state?.ringFor?.(key);
  if (ring) {
    const existing = sessionRingEntryBySessionId(ring, sessionId);
    if (existing) return existing;
  }
  const info = await fetchSessionInfoFromHost(harness, key, sessionId, signal);
  const result = await state?.ensureSessionRing?.(key, sessionId, {
    title: info?.title ?? undefined,
    lastSeenAt: info?.lastSeenAt ?? undefined,
  });
  return result?.entry ?? null;
}

/**
 * Enforce the ring invariant before rendering: visits[visitIndex] must be the
 * entry of the Session currently bound. A binding made outside /go//prev//next
 * (eager /new, /session adopt, a reused Session) can leave the visit stack
 * stale, so the current entry is appended as the current position.
 */
async function repairRingCurrent(state, key) {
  const sessionId = state?.sessionFor?.(key);
  if (!sessionId) return;
  const ring = state?.ringFor?.(key);
  if (!ring) return;
  const entry = sessionRingEntryBySessionId(ring, sessionId);
  if (!entry) return;
  const visitCurrent = ring.visitIndex >= 0 ? ring.visits[ring.visitIndex] : null;
  if (visitCurrent !== entry.n) await state?.appendRing?.(key, entry.n);
}

/** Cap a title at ~30 characters for the /ls line, appending an ellipsis. */
function truncateListTitle(title) {
  const text = typeof title === 'string' && title ? title : t('无标题');
  const chars = [...text];
  return chars.length > 30 ? `${chars.slice(0, 29).join('')}…` : text;
}

function goErrorMessage(error, n) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code) || code === 'session-not-registered'
    || code === 'session-archived' || code === 'session-summary-unavailable') {
    return t('编号 {n} 的会话已不存在或已归档。如需从列表移除请发送 /drop {n}。', { n });
  }
  if (code === 'workspace-bot-not-found' || code === WORKSPACE_SESSION_STALE
    || code === 'session-conflict' || code === 'workspace-conflict'
    || code === 'session-binding-changed') {
    return t('工作区或机器人状态已发生变化，请重试 /go {n}。', { n });
  }
  return t('暂时无法切换会话，请稍后重试。');
}

async function runList(state, harness, key, { signal }) {
  await repairRingCurrent(state, key);
  const ring = state?.ringFor?.(key);
  if (!ring || ring.entries.length === 0) {
    return commandResult(t('此聊天或话题还没有会话，发送 /new 创建第一个（列表按聊天隔离，论坛群按话题）。'));
  }
  const markers = await computeRingMarkers(state, harness, key, { signal });
  const currentSessionId = markers.currentSessionId;
  const windowEntries = ring.entries.length > RING_LIST_LIMIT
    ? ring.entries.slice(-RING_LIST_LIMIT)
    : ring.entries;
  const currentEntry = currentSessionId
    ? ring.entries.find((entry) => entry.sessionId === currentSessionId)
    : null;
  const currentInWindow = currentEntry
    ? windowEntries.some((entry) => entry.n === currentEntry.n)
    : true;
  const renderEntries = currentEntry && !currentInWindow
    ? [...windowEntries, currentEntry]
    : windowEntries;
  const availability = new Map();
  await Promise.all(renderEntries.map(async (entry) => {
    availability.set(entry.n, await entryAvailability(harness, key, entry.sessionId, signal));
  }));
  // Surface the Host title (including its first-prompt fallback) for entries the
  // ring has no title for yet.
  const titles = await hostSessionTitles(harness, key, renderEntries.map((entry) => entry.sessionId), signal);
  const parts = [t('会话（/go N）：')];
  if (ring.entries.length > RING_LIST_LIMIT) {
    parts.push(t('会话较多，仅显示最近 {shown} 条（共 {total} 条）。', {
      shown: windowEntries.length,
      total: ring.entries.length,
    }));
  }
  for (const entry of windowEntries) {
    const availabilityState = availability.get(entry.n);
    const marker = sessionMarker(entry, markers, availabilityState);
    const title = entry.title || titles.get(entry.sessionId) || null;
    parts.push(`${marker} ${entry.n}. ${formatAge(entry.lastSeenAt)}, ${truncateListTitle(title)}`);
  }
  // A bound entry older than the tail window must still be visible, once.
  if (currentEntry && !currentInWindow) {
    parts.push('…');
    const availabilityState = availability.get(currentEntry.n);
    const marker = sessionMarker(currentEntry, markers, availabilityState);
    const title = currentEntry.title || titles.get(currentEntry.sessionId) || null;
    parts.push(`${marker} ${currentEntry.n}. ${formatAge(currentEntry.lastSeenAt)}, ${truncateListTitle(title)}`);
  }
  if (currentEntry) {
    const currentState = availability.get(currentEntry.n)
      ?? await entryAvailability(harness, key, currentEntry.sessionId, signal);
    if (currentState === 'deleted' || currentState === 'archived') {
      parts.push(t('✕ 当前会话已失效，发送 /new 可开启新会话。'));
    }
  }
  return commandResult(parts.join('\n\n'));
}

/**
 * Bind the conversation to one Session and verify the binding really changed.
 * A bot-scoped bind can return success while a stale scope refused the actual
 * setSession; reporting that as a switch would strand the user on the old
 * (possibly archived) Session. Throws a classified error on any mismatch.
 */
async function bindToSession(harness, state, key, sessionId) {
  const bound = await harness.bindWorkspaceSession(key, sessionId, { navigation: true });
  if (bound?.archived === true) {
    const error = new Error('The Session is archived and cannot be bound');
    error.code = 'session-archived';
    throw error;
  }
  const current = state?.sessionFor?.(key) ?? null;
  if (current !== sessionId || bound?.sessionId !== sessionId) {
    const error = new Error('The session binding did not change');
    error.code = 'session-binding-changed';
    throw error;
  }
  return bound;
}

/**
 * Pick the next live entry for /prev or /next: the visit-stack target first,
 * then the ring's other entries by last activity (most recent first for back,
 * least recent first for forward). Dead entries are stepped over; null means
 * there is no live entry left in that direction.
 */
async function liveStepTarget(ring, direction, currentSessionId, availabilityOf) {
  const fromStack = direction === 'back' ? sessionRingBackTarget(ring) : sessionRingForwardTarget(ring);
  const others = ring.entries
    .filter((entry) => entry.sessionId !== currentSessionId)
    .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));
  const ordered = direction === 'back' ? others : [...others].reverse();
  const candidates = [];
  if (fromStack !== null) candidates.push({ n: fromStack, fromStack: true });
  for (const entry of ordered) {
    if (!candidates.some((candidate) => candidate.n === entry.n)) {
      candidates.push({ n: entry.n, fromStack: false });
    }
  }
  for (const candidate of candidates) {
    const entry = sessionRingEntryByNumber(ring, candidate.n);
    if (!entry) continue;
    const availability = await availabilityOf(entry.sessionId);
    if (availability === 'deleted' || availability === 'archived') continue;
    return candidate;
  }
  return null;
}

/**
 * Compute the /prev and /next targets with the exact same code the commands
 * use (visit trail first, then fallback by last activity, skipping dead
 * entries). /ls and reply texts both render arrows from this, so an arrow can
 * never claim a move the command would refuse.
 */
async function computeRingMarkers(state, harness, key, { signal }) {
  const ring = state?.ringFor?.(key);
  const currentSessionId = state?.sessionFor?.(key) ?? null;
  if (!ring || !currentSessionId) return { currentSessionId, backTarget: null, forwardTarget: null };
  const availabilityOf = (sessionId) => entryAvailability(harness, key, sessionId, signal);
  const back = await liveStepTarget(ring, 'back', currentSessionId, availabilityOf);
  const forward = await liveStepTarget(ring, 'forward', currentSessionId, availabilityOf);
  return {
    currentSessionId,
    backTarget: back?.n ?? null,
    forwardTarget: forward?.n ?? null,
  };
}

async function runGo(state, harness, key, n, { signal, askText = null }) {
  const ring = state?.ringFor?.(key);
  const entry = ring ? sessionRingEntryByNumber(ring, n) : null;
  if (!entry) return unknownEntryResult(n);
  if (typeof harness?.bindWorkspaceSession !== 'function') {
    return commandResult(t('当前机器人暂不支持绑定已有会话。'));
  }
  try {
    await bindToSession(harness, state, key, entry.sessionId);
    await state?.navigateRing?.(key, n);
    const after = state?.ringFor?.(key);
    const fresh = after ? sessionRingEntryByNumber(after, n) : entry;
    const markers = await computeRingMarkers(state, harness, key, { signal });
    const label = fresh ? renderSessionNumber(fresh, markers) : n;
    return commandResult(t('已切换到会话 {n}（{title}，最后活动 {age}）。', {
      n: label,
      title: fresh?.title || t('无标题'),
      age: formatAge(fresh?.lastSeenAt),
    }), typeof askText === 'string' && askText ? { askText } : {});
  } catch (error) {
    return commandResult(goErrorMessage(error, n));
  }
}

async function runStep(state, harness, key, direction, { signal, askText = null }) {
  const ring = state?.ringFor?.(key);
  if (!ring || ring.entries.length === 0) {
    return commandResult(t('此聊天或话题还没有会话，发送 /new 创建第一个（列表按聊天隔离，论坛群按话题）。'));
  }
  if (typeof harness?.bindWorkspaceSession !== 'function') {
    return commandResult(t('当前机器人暂不支持绑定已有会话。'));
  }
  const currentSessionId = state?.sessionFor?.(key) ?? null;
  const target = await liveStepTarget(ring, direction, currentSessionId, (sessionId) => (
    entryAvailability(harness, key, sessionId, signal)
  ));
  if (target === null) {
    return commandResult(direction === 'back' ? t('此聊天没有更早的会话。') : t('此聊天没有更晚的会话。'));
  }
  const entry = sessionRingEntryByNumber(ring, target.n);
  if (!entry) return commandResult(t('目标会话不存在，请发送 /ls 查看。'));
  try {
    await bindToSession(harness, state, key, entry.sessionId);
    if (target.fromStack) await state?.stepRingTo?.(key, target.n);
    else await state?.appendRing?.(key, target.n);
    const markers = await computeRingMarkers(state, harness, key, { signal });
    const label = renderSessionNumber(entry, markers);
    return commandResult(t('已切换到会话 {n}（{title}）。', { n: label, title: entry.title || t('无标题') }),
      typeof askText === 'string' && askText ? { askText } : {});
  } catch (error) {
    return commandResult(goErrorMessage(error, target.n));
  }
}

async function runDrop(state, harness, key, n, { signal }) {
  const ring = state?.ringFor?.(key);
  const entry = ring ? sessionRingEntryByNumber(ring, n) : null;
  if (!entry) return unknownEntryResult(n);
  const currentSessionId = state?.sessionFor?.(key) ?? null;
  if (entry.sessionId === currentSessionId) {
    return commandResult(t('编号 {n} 是当前会话，不能删除。请先切换到其他会话（/go 数字、/prev 或 /new）再删除。', { n }));
  }
  const availabilityState = await entryAvailability(harness, key, entry.sessionId, signal);
  const removed = await state?.dropSessionRing?.(key, n);
  if (removed === false) return unknownEntryResult(n);
  const label = renderSessionNumber(entry, { currentSessionId, backTarget: null, forwardTarget: null }, availabilityState);
  return commandResult(t('已从会话列表移除编号 {n}。注意：Harness 中的会话本身未被删除或归档，仍可在 DSH 中访问。', { n: label }));
}

/** /drop all: keep only the bound entry; the sessions themselves are untouched. */
async function runDropAll(state, key) {
  const ring = state?.ringFor?.(key);
  const currentSessionId = state?.sessionFor?.(key) ?? null;
  const currentEntry = currentSessionId && ring
    ? sessionRingEntryBySessionId(ring, currentSessionId)
    : null;
  if (!currentEntry) {
    return commandResult(t('当前聊天尚未绑定会话，无法确定保留哪条，未移除任何记录。'));
  }
  const others = ring.entries.filter((entry) => entry.n !== currentEntry.n);
  if (others.length === 0) {
    return commandResult(t('列表里只有当前会话，无需移除。'));
  }
  const removed = await state?.dropSessionRingAllExcept?.(key, currentEntry.n);
  return commandResult(t('已移除 {count} 条记录，保留编号 {n}（当前会话）。注意：Harness 中的会话本身未被删除或归档，仍可在 DSH 中访问。', {
    count: removed,
    n: currentEntry.n,
  }));
}

function parseTitleArgument(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { show: true, n: null };
  const numeric = /^(\d+)$/u.exec(text);
  if (numeric) return { show: true, n: Number(numeric[1]) };
  const withNumber = /^(\d+)\s+([\s\S]+)$/u.exec(text);
  if (withNumber) return { show: false, n: Number(withNumber[1]), title: withNumber[2].trim() };
  return { show: false, n: null, title: text };
}

async function renameSessionTitle(harness, key, sessionId, title) {
  const session = typeof harness?.workspaceSession === 'function'
    ? harness.workspaceSession(sessionId, key)
    : null;
  if (session && typeof session.renameTitle === 'function') {
    await session.renameTitle(title);
    return true;
  }
  if (typeof harness?.renameSession === 'function') {
    await harness.renameSession(sessionId, title);
    return true;
  }
  return false;
}

async function runTitle(state, harness, key, raw, { signal }) {
  const parsed = parseTitleArgument(raw);
  const ring = state?.ringFor?.(key);
  if (parsed.show) {
    if (parsed.n !== null) {
      const entry = ring ? sessionRingEntryByNumber(ring, parsed.n) : null;
      if (!entry) return unknownEntryResult(parsed.n);
      const markers = await computeRingMarkers(state, harness, key, { signal });
      const availabilityState = await entryAvailability(harness, key, entry.sessionId, signal);
      return commandResult(t('会话 {n}：{title}', {
        n: renderSessionNumber(entry, markers, availabilityState),
        title: entry.title || t('无标题'),
      }));
    }
    const currentSessionId = state?.sessionFor?.(key) ?? null;
    if (!currentSessionId) return commandResult(t('当前聊天尚未绑定会话。'));
    const current = ring ? sessionRingEntryBySessionId(ring, currentSessionId) : null;
    let title = current?.title ?? null;
    if (!title) {
      const info = await fetchSessionInfoFromHost(harness, key, currentSessionId, signal);
      title = info?.title ?? null;
      if (title && current) await state?.renameSessionRing?.(key, current.n, title);
    }
    const label = title || t('无标题');
    if (current) {
      const markers = await computeRingMarkers(state, harness, key, { signal });
      return commandResult(t('当前会话编号 {n}：{title}', {
        n: renderSessionNumber(current, markers),
        title: label,
      }));
    }
    return commandResult(t('当前会话：{title}', { title: label }));
  }

  const sessionId = parsed.n !== null
    ? (ring ? sessionRingEntryByNumber(ring, parsed.n)?.sessionId : null)
    : state?.sessionFor?.(key) ?? null;
  if (parsed.n !== null && !sessionId) return unknownEntryResult(parsed.n);
  if (!sessionId) {
    // No binding yet: remember the title for the Session the next message makes.
    await state?.setPendingTitle?.(key, parsed.title);
    return commandResult(t('已记住新会话标题「{title}」，将在下一条消息创建会话时应用。', { title: parsed.title }));
  }
  try {
    if (!(await renameSessionTitle(harness, key, sessionId, parsed.title))) {
      return commandResult(t('当前 Harness 暂不支持重命名会话。'));
    }
    const entryNumber = parsed.n ?? (ring
      ? sessionRingEntryBySessionId(ring, sessionId)?.n ?? null
      : null);
    if (entryNumber !== null) {
      await state?.renameSessionRing?.(key, entryNumber, parsed.title);
      await state?.markSessionRingUserTitled?.(key, entryNumber);
    }
    return commandResult(t('已将会话标题改为「{title}」。', { title: parsed.title }));
  } catch (error) {
    return commandResult(t('暂时无法重命名会话，请稍后重试。'));
  }
}

function forkErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (code === 'session/fork-unavailable' || code === 'fork-unavailable') {
    return t('当前会话还没有已完成的回合，无法分支。请先完成一个回合再 /fork。');
  }
  if (code === 'harness-api-not-found') {
    return t('当前 Host 不支持会话分支（fork）。');
  }
  if (isSessionNotFound(code) || code === 'session-archived' || code === 'session-not-registered') {
    return t('当前会话已不存在或已归档，无法分支。');
  }
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试 /fork。');
  }
  return t('暂时无法分支会话，请稍后重试。');
}

function forkBindErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code) || code === 'session-archived' || code === 'session-not-registered') {
    return t('分支出的子会话无法绑定，请重试。');
  }
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试 /fork。');
  }
  return t('暂时无法绑定分支出的子会话，请稍后重试。');
}

async function runFork(state, harness, key, rawTitle, { signal }) {
  const parentId = state?.sessionFor?.(key);
  if (!parentId) return commandResult(t('当前聊天尚未绑定会话。'));
  if (typeof harness?.forkSession !== 'function') {
    return commandResult(t('当前 Host 不支持会话分支（fork）。'));
  }
  // Refuse while the current turn is still running.
  const session = typeof harness?.workspaceSession === 'function'
    ? harness.workspaceSession(parentId, key)
    : null;
  if (session && typeof session.isRunning === 'function') {
    try {
      if (await session.isRunning()) {
        return commandResult(t('当前会话仍在生成回复，请先等待完成或发送 /stop 再分支。'));
      }
    } catch {
      // A failed run-state check must not block the fork; the Host rechecks.
    }
  }
  // Branch the Session.
  let childId;
  try {
    const forked = await harness.forkSession(parentId, { signal });
    childId = typeof forked === 'string' ? forked : forked?.sessionId;
    if (typeof childId !== 'string' || !childId) {
      throw Object.assign(new Error('fork returned no child session id'), { code: 'harness-response-invalid' });
    }
  } catch (error) {
    if (error?.code === 'harness-response-invalid') return commandResult(t('暂时无法分支会话，请稍后重试。'));
    return commandResult(forkErrorMessage(error));
  }

  // Bind the child and register it in the ring.
  try {
    const bound = await harness.bindWorkspaceSession(key, childId);
    if (bound?.archived === true) {
      return commandResult(t('分支出的子会话已归档，无法绑定。'));
    }
  } catch (error) {
    return commandResult(forkBindErrorMessage(error));
  }

  // Title: the argument when given (user-titled), otherwise the parent title
  // plus " (fork)", or the no-title form plus " (fork)".
  const explicit = typeof rawTitle === 'string' && rawTitle;
  const parentRing = state?.ringFor?.(key);
  const parentEntry = parentRing ? sessionRingEntryBySessionId(parentRing, parentId) : null;
  const title = explicit ? rawTitle : `${parentEntry?.title || t('无标题')} (fork)`;

  const childRing = state?.ringFor?.(key);
  const childEntry = childRing ? sessionRingEntryBySessionId(childRing, childId) : null;
  if (!childEntry) return commandResult(t('分支出的子会话无法绑定，请重试。'));

  // bindWorkspaceSession already appended the child as the current visit for a
  // non-navigation bind; just rename and mark it here.
  await renameSessionTitle(harness, key, childId, title);
  await state?.renameSessionRing?.(key, childEntry.n, title);
  if (explicit) await state?.markSessionRingUserTitled?.(key, childEntry.n);

  const markers = await computeRingMarkers(state, harness, key, { signal });
  const parentAvailability = parentEntry
    ? await entryAvailability(harness, key, parentEntry.sessionId, signal)
    : 'alive';
  return commandResult(t('已从会话 {parent} 分支到会话 {child}：{title}', {
    parent: parentEntry ? renderSessionNumber(parentEntry, markers, parentAvailability) : '?',
    child: renderSessionNumber(childEntry, markers),
    title,
  }));
}

function parseTailArgument(raw) {
  const tokens = (typeof raw === 'string' ? raw.trim() : '').split(/\s+/u).filter(Boolean);
  let exportFile = false;
  if (tokens.length > 0 && /^file$/iu.test(tokens[tokens.length - 1])) {
    exportFile = true;
    tokens.pop();
  }
  let n = null;
  let count = null;
  for (const token of tokens) {
    if (!/^\d+$/u.test(token)) continue;
    if (n === null) n = Number(token);
    else if (count === null) count = Number(token);
  }
  return { n, count, exportFile };
}

function resolveTailSession(state, key, n) {
  if (n === null) {
    const currentSessionId = state?.sessionFor?.(key) ?? null;
    if (!currentSessionId) {
      return { error: t('当前聊天尚未绑定会话，请先发送消息或使用 /session 绑定会话。') };
    }
    const ring = state?.ringFor?.(key);
    const entry = ring ? sessionRingEntryBySessionId(ring, currentSessionId) : null;
    return { sessionId: currentSessionId, n: entry?.n ?? null, title: entry?.title ?? null };
  }
  const ring = state?.ringFor?.(key);
  const entry = ring ? sessionRingEntryByNumber(ring, n) : null;
  if (!entry) return { error: t('没有编号为 {n} 的会话。用 /ls 查看列表。', { n }) };
  return { sessionId: entry.sessionId, n: entry.n, title: entry.title ?? null };
}

async function runTailPreview(harness, key, resolved, count, { signal }) {
  const session = harness?.workspaceSession?.(resolved.sessionId, key);
  if (!session || typeof session.readHistory !== 'function') {
    return commandResult(t('当前 Harness 暂不支持读取会话历史。'));
  }
  const { events, stopped } = await readTailEvents(session, {
    signal,
    stop: (acc) => tailMessages(sortedEvents(acc)).length >= count,
  });
  const messages = tailMessages(sortedEvents(events)).slice(-count);
  if (messages.length === 0) {
    return commandResult(stopped
      ? t('本次有限读取中未找到可预览的消息。')
      : t('当前会话暂无可预览的消息。'));
  }
  return commandResult(renderTailPreview(messages, { count, n: resolved.n }), { hide: true });
}

function exportFileName(title, n) {
  const fallback = `session-${n ?? 'export'}`;
  const base = (typeof title === 'string' && title.trim() ? title.trim() : fallback)
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
  return `${base || fallback}.md`;
}

/**
 * The export header carries an untrusted title. Collapse every line break and
 * control character to a single space so the title can never inject a heading
 * or a fence line; whatever remains stays on the one `# …` header line.
 */
function sanitizeExportTitle(title) {
  if (typeof title !== 'string') return null;
  const cleaned = title
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .replace(/[\t\r\n]+/gu, ' ')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
  return cleaned || null;
}

/**
 * Quote one message body verbatim inside a code fence whose delimiter is longer
 * than any leading run of fence characters in the body, so the body can never
 * close its own fence. The closing fence is always preceded by a newline.
 */
function fencedBody(body) {
  const delimiter = safeCodeFence(body, '');
  const padded = body.endsWith('\n') ? body : `${body}\n`;
  return `${delimiter}\n${padded}${delimiter}`;
}

function renderExport(messages, { title, n, truncated, exportedAt }) {
  const safeTitle = sanitizeExportTitle(title);
  // The skeleton is localized; message bodies stay verbatim inside fences, so a
  // reader can always tell structure from data.
  const headingParts = [];
  if (safeTitle) headingParts.push(safeTitle);
  if (n !== undefined && n !== null) headingParts.push(`${t('导出标题：会话')} ${n}`);
  const heading = `# ${headingParts.join(' — ')}`.trimEnd();
  const lines = [
    heading,
    '',
    t('导出时间：{time}', { time: new Date(exportedAt).toISOString() }),
    t('消息数：{count}', { count: messages.length }),
    t('正文说明：消息正文以代码围栏逐字引用，围栏长度大于正文中任意连续的围栏字符。'),
    ...(truncated ? [t('注意：因事件数量达到上限，导出内容被截断。')] : []),
    '',
  ];
  for (const message of messages) {
    const role = message.role === 'user' ? t('导出角色：用户') : t('导出角色：助手');
    lines.push(`## ${role}`, '', fencedBody(message.text), '');
  }
  return lines.join('\n');
}

async function runTailExport(harness, key, resolved, { signal, eventCap }) {
  const session = harness?.workspaceSession?.(resolved.sessionId, key);
  if (!session || typeof session.readHistory !== 'function') {
    return commandResult(t('当前 Harness 暂不支持读取会话历史。'));
  }
  const { events, stopped } = await readTailEvents(session, {
    signal,
    stop: (acc) => acc.size >= eventCap,
  });
  const messages = tailMessages(sortedEvents(events));
  const content = renderExport(messages, {
    title: resolved.title,
    n: resolved.n,
    truncated: stopped,
    exportedAt: Date.now(),
  });
  return documentResult({
    fileName: exportFileName(resolved.title, resolved.n),
    mediaType: 'text/markdown',
    content,
  });
}

async function runTail(harness, state, key, parsed, { signal, eventCap }) {
  const resolved = resolveTailSession(state, key, parsed.n);
  if (resolved.error) return commandResult(resolved.error);
  if (parsed.exportFile) return runTailExport(harness, key, resolved, { signal, eventCap });
  const count = Math.min(Math.max(parsed.count ?? DEFAULT_TAIL_COUNT, 1), MAX_TAIL_COUNT);
  return runTailPreview(harness, key, resolved, count, { signal });
}

/**
 * Handle one session-navigation command. Returns null when `text` is not one of
 * them, otherwise a result the bridge can render as text, a document, or a
 * button-carrying preview.
 */
export async function runSessionNavCommand(text, harness, state, key, options = {}) {
  if (!isSessionNavCommand(text)) return null;
  const command = text.trim();
  const { signal } = options;
  // The currently bound Session must always be listed; register it lazily if it
  // predates the navigation ring.
  await ensureCurrentSessionInRing(state, harness, key, { signal });
  const tailOptions = {
    signal,
    eventCap: Number.isSafeInteger(options?.tailExportEventCap) && options.tailExportEventCap > 0
      ? options.tailExportEventCap
      : TAIL_EXPORT_EVENT_CAP,
  };

  if (/^\/(?:ls|list)$/iu.test(command)) {
    return runList(state, harness, key, { signal });
  }
  if (/^\/go$/iu.test(command)) {
    return commandResult(t('用法：/go 会话编号（用 /ls 查看编号）。'));
  }
  const goMatch = GO_COMMAND.exec(command);
  if (goMatch) {
    const n = Number(goMatch[1]);
    if (!Number.isSafeInteger(n) || n < 1) return commandResult(t('用法：/go 会话编号（用 /ls 查看编号）。'));
    return runGo(state, harness, key, n, { signal, askText: goMatch[2] ?? null });
  }
  const prevMatch = PREV_COMMAND.exec(command);
  if (prevMatch) return runStep(state, harness, key, 'back', { signal, askText: prevMatch[1] ?? null });
  const nextMatch = NEXT_COMMAND.exec(command);
  if (nextMatch) return runStep(state, harness, key, 'forward', { signal, askText: nextMatch[1] ?? null });
  const dropMatch = DROP_COMMAND.exec(command);
  if (dropMatch) {
    if (dropMatch[1] === 'all' || dropMatch[1] === '*') {
      return runDropAll(state, key);
    }
    const n = Number(dropMatch[1]);
    if (!Number.isSafeInteger(n) || n < 1) return commandResult(t('用法：/drop 会话编号（用 /ls 查看编号）。'));
    return runDrop(state, harness, key, n, { signal });
  }
  const titleMatch = TITLE_COMMAND.exec(command);
  if (titleMatch) return runTitle(state, harness, key, titleMatch[1] ?? '', { signal });
  const forkMatch = FORK_COMMAND.exec(command);
  if (forkMatch) {
    const rawTitle = typeof forkMatch[1] === 'string' && forkMatch[1].trim()
      ? normalizeSessionTitle(forkMatch[1])
      : null;
    return runFork(state, harness, key, rawTitle, { signal });
  }
  const tailMatch = TAIL_COMMAND.exec(command);
  if (tailMatch) {
    try {
      return await runTail(harness, state, key, parseTailArgument(tailMatch[1] ?? ''), tailOptions);
    } catch (error) {
      return commandResult(tailErrorMessage(error));
    }
  }
  return commandResult(t('未知命令，请发送 /help 查看帮助。'));
}

/**
 * Text-only seam for bridges without document or button support. Detects a
 * session-navigation command, dispatches to the shared logic, and degrades a
 * file export to an honest "files unavailable" reply, so the caller only ever
 * sends text.
 */
export async function runSessionNavTextCommand(text, harness, state, key, options = {}) {
  const result = await runSessionNavCommand(text, harness, state, key, options);
  if (!result) return null;
  if (result.document) {
    const message = t('当前渠道不支持发送文件。');
    return { handled: true, message, messages: splitWorkspaceCommandMessage(message) };
  }
  return { handled: true, message: result.message, messages: result.messages, askText: result.askText };
}
