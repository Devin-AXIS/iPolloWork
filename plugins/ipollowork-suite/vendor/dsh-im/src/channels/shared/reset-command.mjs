import { t } from './i18n.mjs';
import { replaceConversationSession } from './new-command.mjs';

const RESET_COMMAND = /^\/reset(?=$|\s)([\s\S]*)$/iu;
const RESET_USAGE = '用法：/reset（不带参数且不可附带图片或文件）';

function commandResult(message) {
  return { handled: true, message, messages: [message] };
}

/**
 * /reset is answered locally: it creates a fresh Session through the same eager
 * path /new uses and swaps it into the current ring entry in place, so the
 * number stays, /ls does not grow, the title and user-titled flag survive, and
 * the previous Session simply leaves this chat's ring (it is never deleted or
 * archived). It never reaches the Host command registry.
 */
export async function runResetCommand(text, harness, state, conversationKey, options = {}) {
  if (!isResetCommand(text)) return null;
  const match = RESET_COMMAND.exec(text.trim());
  if (match[1].trim() || options.hasImages || options.hasFiles) {
    return commandResult(t(RESET_USAGE));
  }
  if (options.pendingInteraction || options.busy) {
    return commandResult(t('当前会话正在生成回复或等待交互，请先完成交互或发送 /stop，再执行 /reset。'));
  }
  if (typeof state?.sessionFor !== 'function') {
    return commandResult(t('当前机器人没有可用的会话状态，未重置当前会话。'));
  }
  if (typeof harness?.createSession !== 'function') {
    return commandResult(t('当前 Host 不支持 /reset，当前会话未修改。'));
  }
  const previous = state.sessionFor(conversationKey);
  const result = await replaceConversationSession({ state, harness, key: conversationKey });
  if (result.failed || typeof result.sessionId !== 'string' || !result.sessionId) {
    return commandResult(t('重置当前会话上下文失败，当前会话未修改，请稍后重试。'));
  }
  if (typeof previous === 'string' && previous) {
    return commandResult(t('当前会话上下文已重置（编号保持不变）。旧会话 ID：{id}，可用 /session {id} 重新绑定。', { id: previous }));
  }
  return commandResult(t('当前聊天还没有会话，已开启全新会话。'));
}

export function isResetCommand(text) {
  return typeof text === 'string' && RESET_COMMAND.test(text.trim());
}
