import { isSessionNotFound } from './session-error.mjs';
import { isDeepStrictEqual } from 'node:util';

import { t } from './i18n.mjs';
import { splitWorkspaceCommandMessage } from './workspace-command.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const HISTORY_COMMAND = /^\/history(?=$|\s)([\s\S]*)$/iu;
const HISTORY_USAGE = '用法：/history [数量]（默认 3 条，最多 5 条）';
const MAX_MESSAGES = 5;
const PAGE_SIZE = 50;
const MAX_PAGES = 3;
const READ_TIMEOUT_MS = 10_000;

function commandResult(message) {
  return { handled: true, message, messages: splitWorkspaceCommandMessage(message) };
}

function previewText(content) {
  if (!Array.isArray(content)) throw new TypeError('Invalid history message content');
  return content.flatMap((block) => {
    if (block?.type === 'text' && typeof block.text === 'string') return [block.text];
    if (block?.type === 'image') return [t('[图片]')];
    if (block?.type === 'file') return [t('[文件]')];
    return [];
  }).join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim()
    || t('本条没有可预览的文字。');
}

function visibleMessages(events) {
  const messages = [];
  const assistants = new Map();
  for (const event of events) {
    const data = event.data;
    if (event.type === 'user/message' && event.surfaceOp === 'append'
      && data?.source?.kind === 'user') {
      // Older sessions may contain commands saved before the local fast path
      // existed. Exclude them before counting, so normal messages fill the limit.
      if (isHistoryCommand(previewText(data.content))) continue;
      messages.push({ seq: event.seq, role: 'user', content: data.content });
    } else if (event.type === 'assistant/message' && event.surfaceOp === 'append'
      && Number.isSafeInteger(data?.turn) && data.turn >= 0) {
      // Remember even an empty/interrupted final message: never substitute an
      // earlier tool-step explanation for the turn's final answer.
      assistants.set(data.turn, event);
    } else if (event.type === 'turn/end') {
      const assistant = assistants.get(data?.turn);
      assistants.delete(data?.turn);
      if ((data?.reason?.kind ?? data?.reason) !== 'completed'
        || !assistant || assistant.data.interrupted === true) continue;
      messages.push({
        seq: assistant.seq,
        role: 'assistant',
        content: assistant.data.message?.content,
      });
    }
  }
  return messages.sort((left, right) => left.seq - right.seq);
}

function truncateText(text, limit) {
  if (text.length <= limit) return text;
  const suffix = t('（已截断）');
  let end = Math.max(0, limit - suffix.length);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, Math.max(0, end))}${suffix}`;
}

function formatHistory(sessionId, records, requested, hasMore) {
  const shortId = sessionId.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').slice(0, 12);
  const header = t('会话历史｜{session}｜最近 {count} 条', { session: shortId, count: records.length });
  const footer = [t('以上为历史记录，不是本次新回复。')];
  if (records.length < requested) {
    footer.unshift(hasMore
      ? t('本次有限读取中仅找到 {count} 条可预览消息。', { count: records.length })
      : t('当前会话仅有 {count} 条可预览消息。', { count: records.length }));
  }
  const entries = records.map((record) => ({ ...record, text: previewText(record.content) }));
  let bodyLimit = 500;
  let result;
  do {
    const sections = entries.map((entry, index) => (
      `${index + 1}. ${entry.role === 'user' ? t('用户') : t('助手')}\n${truncateText(entry.text, bodyLimit)}`
    ));
    result = commandResult([header, ...sections, footer.join('\n')].join('\n\n'));
    bodyLimit = Math.floor(bodyLimit / 2);
  } while (bodyLimit > 0 && (result.message.length > 3_000 || result.messages.length > 3));
  return result;
}

function historyErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code)) return t('当前聊天绑定的会话已不存在，请重新绑定会话。');
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found'
    || code === 'session-binding-changed') return t('会话、工作区或机器人状态已发生变化，请重新执行 /history。');
  if (code === 'harness-api-not-found') return t('当前 Harness 暂不支持读取会话历史。');
  if (error?.name === 'AbortError') return t('历史读取已取消。');
  if (error?.name === 'TimeoutError' || code === 'harness-timeout') return t('读取历史超时，请稍后重试。');
  return t('暂时无法读取会话历史，请稍后重试。');
}

export function isHistoryCommand(text) {
  return typeof text === 'string' && HISTORY_COMMAND.test(text.trim());
}

/** Read the current binding only; never create/resume a session or prompt the model. */
export async function runHistoryCommand(text, harness, state, key, {
  signal: callerSignal,
  isDirect = false,
  hasImages = false,
  hasFiles = false,
} = {}) {
  if (!isHistoryCommand(text)) return null;
  const argument = HISTORY_COMMAND.exec(text.trim())[1].trim();
  if (argument && (!/^\d+$/u.test(argument) || /^0+$/u.test(argument))) {
    return commandResult(t(HISTORY_USAGE));
  }
  const count = argument ? Math.min(Number(argument), MAX_MESSAGES) : 3;
  if (!isDirect) return commandResult(t('请在与机器人的私聊中使用 /history。'));
  if (hasImages || hasFiles) return commandResult(t('/history 仅支持文字命令，请移除图片或文件后重试。'));
  const sessionId = state?.sessionFor?.(key);
  if (typeof sessionId !== 'string' || !sessionId) {
    return commandResult(t('当前聊天尚未绑定会话，请先发送消息或使用 /session 绑定会话。'));
  }

  try {
    const session = harness?.workspaceSession?.(sessionId, key);
    if (typeof session?.readHistory !== 'function') {
      return commandResult(t('当前 Harness 暂不支持读取会话历史。'));
    }
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const deadline = Date.now() + READ_TIMEOUT_MS;
    const events = new Map();
    let beforeSeq;
    let snapshotEnd;
    let records = [];
    let hasMore = false;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new DOMException('History read timed out', 'TimeoutError');
      const page = await session.readHistory({
        maxMessages: PAGE_SIZE,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        timeoutMs: Math.max(1, deadline - Date.now()),
        signal,
      });
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new DOMException('History read timed out', 'TimeoutError');
      if (state.sessionFor(key) !== sessionId) {
        const error = new Error('Session binding changed during history read');
        error.code = 'session-binding-changed';
        throw error;
      }
      if (!page || !Array.isArray(page.events) || typeof page.hasMore !== 'boolean') {
        throw new TypeError('Invalid history page');
      }
      let oldestSeq = beforeSeq ?? Infinity;
      for (const entry of page.events) {
        const event = entry?.event;
        if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0
          || typeof event.type !== 'string' || !event.type) throw new TypeError('Invalid history event');
        // Subsequent pages must not extend the snapshot taken by the first read.
        if (snapshotEnd !== undefined && event.seq > snapshotEnd) continue;
        const previous = events.get(event.seq);
        if (previous) {
          if (!isDeepStrictEqual(previous, event)) throw new TypeError('Conflicting history events');
        } else {
          if (beforeSeq !== undefined && event.seq >= beforeSeq) throw new TypeError('Invalid history cursor');
          events.set(event.seq, event);
        }
        oldestSeq = Math.min(oldestSeq, event.seq);
      }
      const ordered = [...events.values()].sort((left, right) => left.seq - right.seq);
      snapshotEnd ??= ordered.at(-1)?.seq;
      hasMore = page.hasMore;
      if (hasMore && (!Number.isFinite(oldestSeq) || oldestSeq === beforeSeq)) {
        throw new TypeError('History cursor did not advance');
      }
      records = visibleMessages(ordered).slice(-count);
      if (records.length >= count || !hasMore) break;
      beforeSeq = oldestSeq;
    }
    if (records.length === 0) {
      return commandResult(hasMore
        ? t('本次有限读取中未找到可预览的历史消息。')
        : t('当前会话暂无可预览的历史消息。'));
    }
    return formatHistory(sessionId, records, count, hasMore);
  } catch (error) {
    return commandResult(historyErrorMessage(error));
  }
}
