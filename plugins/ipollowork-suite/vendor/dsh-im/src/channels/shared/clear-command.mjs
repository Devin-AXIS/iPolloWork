import { isSessionNotFound } from './session-error.mjs';
import { t } from './i18n.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const CLEAR_COMMAND = /^\/clear(?=$|\s)([\s\S]*)$/iu;
const CLEAR_USAGE = '用法：/clear（不带参数且不可附带图片或文件）';

function commandResult(message) {
  return { handled: true, message, messages: [message] };
}

function clearErrorMessage(error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code)) {
    return t('当前聊天绑定的会话已不存在，未清空上下文；请先发送新消息开启会话。');
  }
  if (code === 'agent-busy' || code === 'pending-interaction') {
    return t('当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /clear。');
  }
  if (code === 'cancelled' || error?.name === 'AbortError') {
    return t('上下文清理已取消，当前会话未修改。');
  }
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，未清空当前会话，请重试。');
  }
  if (code === 'commands-unavailable') {
    return t('当前 Host 不支持 /clear，当前会话未修改。');
  }
  return t('清空当前会话上下文失败，当前会话未修改，请稍后重试。');
}

/**
 * Execute Host's argument-free /clear command without changing the dsh-im
 * Session binding. Hosts that do not register /clear return undefined and
 * are reported explicitly; the command never falls back to /new.
 */
export async function runClearCommand(text, harness, state, conversationKey, options = {}) {
  if (!isClearCommand(text)) return null;
  const match = CLEAR_COMMAND.exec(text.trim());
  if (match[1].trim() || options.hasImages || options.hasFiles) {
    return commandResult(t(CLEAR_USAGE));
  }
  if (options.pendingInteraction || options.busy) {
    return commandResult(t('当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /clear。'));
  }
  if (typeof state?.sessionFor !== 'function') {
    return commandResult(t('当前机器人没有可用的会话状态，未清空当前会话。'));
  }
  const sessionId = state.sessionFor(conversationKey);
  if (typeof sessionId !== 'string' || !sessionId) {
    return commandResult(t('当前聊天还没有可清空的会话，请先发送一条消息。'));
  }
  try {
    let execution;
    if (typeof harness?.workspaceSession === 'function') {
      const session = harness.workspaceSession(sessionId, conversationKey);
      if (typeof session?.executeCommand !== 'function') {
        return commandResult(t('当前 Host 不支持 /clear，当前会话未修改。'));
      }
      execution = await session.executeCommand('/clear', options);
    } else {
      if (typeof harness?.executeCommand !== 'function') {
        return commandResult(t('当前 Host 不支持 /clear，当前会话未修改。'));
      }
      execution = await harness.executeCommand(sessionId, '/clear', options);
    }
    if (execution === undefined) {
      return commandResult(t('当前 Host 不支持 /clear，当前会话未修改。'));
    }
    const result = execution?.result;
    if (!result || !['success', 'error'].includes(result.kind)
      || (result.text !== undefined && typeof result.text !== 'string')) {
      return commandResult(t('清空当前会话上下文失败，当前会话未修改，请稍后重试。'));
    }
    if (result.kind === 'error') {
      return commandResult(clearErrorMessage({ ...result, failure: result.failure ?? result }));
    }
    return commandResult(t('当前会话上下文已清空；Session 绑定和历史记录仍保留。'));
  } catch (error) {
    return commandResult(clearErrorMessage(error));
  }
}

export function isClearCommand(text) {
  return typeof text === 'string' && CLEAR_COMMAND.test(text.trim());
}
