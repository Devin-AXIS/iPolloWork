import { isSessionNotFound } from './session-error.mjs';
import { t } from './i18n.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

// Session-scoped Host commands that are not part of the shared bot command
// table. The plugin does not implement them; it delegates the full command
// line to the DSH Host command gateway, exactly like /compact and /clear:
//   /plan          enter plan mode (optionally with a steering message)
//   /plan off      leave plan mode
//   /goal          view the current goal / available subcommands
//   /goal <...>    set, edit, clear, pause or resume the goal
// When the Host has not registered a command the gateway result is undefined
// and the user gets a "not registered" notice instead of a silent fallback.
const PLAN_COMMAND = /^\/plan(?=$|\s)([\s\S]*)$/i;
const GOAL_COMMAND = /^\/goal(?=$|\s)([\s\S]*)$/i;

function commandResult(message) {
  return { handled: true, message, messages: [message] };
}

function delegatedResultText(commandName, execution) {
  const result = execution?.result;
  if (!result || typeof result !== 'object'
    || !['success', 'error'].includes(result.kind)
    || (result.text !== undefined && typeof result.text !== 'string')) {
    throw new TypeError(`Harness returned an invalid ${commandName} result`);
  }
  const text = result.text?.trim() ?? '';
  if (text) return text;
  return result.kind === 'success'
    ? t('{name} 已执行。', { name: commandName })
    : t('{name} 执行失败。', { name: commandName });
}

function delegatedErrorText(commandName, error) {
  const code = error?.code ?? error?.failure?.code;
  if (isSessionNotFound(code)) {
    return t('当前聊天绑定的会话已不存在，请发送新消息开启会话。');
  }
  if (code === 'agent-busy') return t('当前会话正在生成回复，请稍后重试。');
  if (code === 'cancelled' || error?.name === 'AbortError') return t('操作已取消。');
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试。');
  }
  if (code === 'commands-unavailable') {
    return t('当前 Host 不支持命令委派，请确认 DSH 命令网关可用。');
  }
  return t('{name} 执行失败，请稍后重试。', { name: commandName });
}

async function runDelegatedCommand({
  commandName,
  commandLine,
  harness,
  state,
  conversationKey,
  options,
}) {
  if (typeof state?.sessionFor !== 'function') {
    return commandResult(t('当前机器人没有可用的会话状态。'));
  }
  const sessionId = state.sessionFor(conversationKey);
  if (typeof sessionId !== 'string' || !sessionId) {
    return commandResult(t('当前聊天还没有可用的会话，请先发送一条消息。'));
  }
  try {
    let execution;
    if (typeof harness?.workspaceSession === 'function') {
      const session = harness.workspaceSession(sessionId, conversationKey);
      if (typeof session?.executeCommand !== 'function') {
        return commandResult(t('当前机器人暂不支持 {name} 命令。', { name: commandName }));
      }
      execution = await session.executeCommand(commandLine, options);
    } else {
      // Legacy Harnesses have no scoped Session handle to carry the route fence.
      if (typeof harness?.executeCommand !== 'function') {
        return commandResult(t('当前机器人暂不支持 {name} 命令。', { name: commandName }));
      }
      execution = await harness.executeCommand(sessionId, commandLine, options);
    }
    if (execution === undefined) {
      return commandResult(t('当前 Host 未注册 {name} 命令。', { name: commandName }));
    }
    return commandResult(delegatedResultText(commandName, execution));
  } catch (error) {
    return commandResult(delegatedErrorText(commandName, error));
  }
}

/**
 * Execute the Host /plan command against the IM conversation's bound Session.
 * Unknown input returns null so the caller may continue ordinary message
 * routing.
 */
export async function runPlanCommand(text, harness, state, conversationKey, options = {}) {
  if (!isPlanCommand(text)) return null;
  const rest = PLAN_COMMAND.exec(text.trim())[1].trim();
  return runDelegatedCommand({
    commandName: '/plan',
    commandLine: rest ? `/plan ${rest}` : '/plan',
    harness,
    state,
    conversationKey,
    options,
  });
}

export function isPlanCommand(text) {
  return typeof text === 'string' && PLAN_COMMAND.test(text.trim());
}

/**
 * Execute the Host /goal command against the IM conversation's bound Session.
 * Unknown input returns null so the caller may continue ordinary message
 * routing.
 */
export async function runGoalCommand(text, harness, state, conversationKey, options = {}) {
  if (!isGoalCommand(text)) return null;
  const rest = GOAL_COMMAND.exec(text.trim())[1].trim();
  return runDelegatedCommand({
    commandName: '/goal',
    commandLine: rest ? `/goal ${rest}` : '/goal',
    harness,
    state,
    conversationKey,
    options,
  });
}

export function isGoalCommand(text) {
  return typeof text === 'string' && GOAL_COMMAND.test(text.trim());
}
