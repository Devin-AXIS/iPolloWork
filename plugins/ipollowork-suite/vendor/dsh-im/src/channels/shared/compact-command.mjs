import { isSessionNotFound } from './session-error.mjs';
import { t } from './i18n.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const COMPACT_COMMAND = /^\/compact(?=$|\s)([\s\S]*)$/i;
const COMPACT_USAGE = '用法：/compact（不带参数）';

const COMPACT_RESULT_TEXT = new Map([
  ['No compactable history yet.', '暂无可压缩的历史记录。'],
  [
    'Compaction is unavailable because this process has an active compaction, or the agent is not idle.',
    '当前会话正在生成回复或执行压缩，请稍后重试。',
  ],
  ['Compaction cancelled.', '上下文压缩已取消。'],
  [
    'The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log.',
    '压缩期间会话历史发生变化，本次未修改会话，请重试。',
  ],
  [
    'Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log.',
    '未能生成有效的压缩摘要，本次未修改会话。',
  ],
  [
    'Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying.',
    '上下文压缩未正常完成，部分会话历史可能已变化，请检查会话后再重试。',
  ],
  [
    'Compaction finished, but the session could not be saved.',
    '上下文已压缩，但会话保存失败。',
  ],
]);

function commandResult(message) {
  return { handled: true, message, messages: [message] };
}

function compactResultText(result) {
  if (!result || typeof result !== 'object'
    || !['success', 'error'].includes(result.kind)
    || (result.text !== undefined && typeof result.text !== 'string')) {
    throw new TypeError('Harness returned an invalid /compact result');
  }
  const text = result.text?.trim() ?? '';
  const compacted = /^Compacted (\d+) history items \(~(\d+) tokens\)\.$/u.exec(text);
  if (compacted) {
    return t('已压缩 {count} 条历史记录（约 {tokens} 个 token）。', { count: compacted[1], tokens: compacted[2] });
  }
  if (COMPACT_RESULT_TEXT.has(text)) return t(COMPACT_RESULT_TEXT.get(text));
  if (text) return text;
  return result.kind === 'success' ? t('上下文压缩完成。') : t('上下文压缩失败。');
}

function compactErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code)) {
    return t('当前聊天绑定的会话已不存在，请发送新消息开启会话。');
  }
  if (code === 'agent-busy') return t('当前会话正在生成回复，请稍后重试。');
  if (code === 'cancelled' || error?.name === 'AbortError') return t('上下文压缩已取消。');
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试。');
  }
  if (code === 'commands-unavailable') {
    return t('当前 Harness 暂不支持从机器人执行上下文压缩。');
  }
  return t('上下文压缩失败，请稍后重试。');
}

/**
 * Execute the explicit Harness compaction command for an existing IM conversation Session.
 * Unknown input returns null so the caller may continue ordinary message routing.
 */
export async function runCompactCommand(text, harness, state, conversationKey, options = {}) {
  if (!isCompactCommand(text)) return null;
  const match = COMPACT_COMMAND.exec(text.trim());
  if (match[1].trim()) return commandResult(t(COMPACT_USAGE));
  if (typeof state?.sessionFor !== 'function') {
    return commandResult(t('当前机器人没有可用的会话状态。'));
  }
  const sessionId = state.sessionFor(conversationKey);
  if (typeof sessionId !== 'string' || !sessionId) {
    return commandResult(t('当前聊天还没有可压缩的会话，请先发送一条消息。'));
  }
  try {
    let execution;
    if (typeof harness?.workspaceSession === 'function') {
      const session = harness.workspaceSession(sessionId, conversationKey);
      if (typeof session?.executeCommand !== 'function') {
        return commandResult(t('当前机器人暂不支持上下文压缩。'));
      }
      execution = await session.executeCommand('/compact', options);
    } else {
      // Legacy Harnesses have no scoped Session handle to carry the route fence.
      if (typeof harness?.executeCommand !== 'function') {
        return commandResult(t('当前机器人暂不支持上下文压缩。'));
      }
      execution = await harness.executeCommand(sessionId, '/compact', options);
    }
    if (execution === undefined) {
      return commandResult(t('当前 Harness 未注册 /compact 命令，请确认上下文压缩组件已启用。'));
    }
    return commandResult(compactResultText(execution?.result));
  } catch (error) {
    return commandResult(compactErrorMessage(error));
  }
}

export function isCompactCommand(text) {
  return typeof text === 'string' && COMPACT_COMMAND.test(text.trim());
}
