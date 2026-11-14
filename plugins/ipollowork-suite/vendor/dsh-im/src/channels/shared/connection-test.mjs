import { t } from './i18n.mjs';

const targets = new WeakMap();

export const CONNECTION_TEST_STATE_IDENTITY = Symbol('dsh-im.connection-test-state-identity');

function stateIdentity(state) {
  return state?.[CONNECTION_TEST_STATE_IDENTITY] ?? state;
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function rememberConnectionTestTarget(state, target) {
  if (!state || !target || typeof target !== 'object') return false;
  try {
    targets.set(stateIdentity(state), structuredClone(target));
    return true;
  } catch {
    return false;
  }
}

export function connectionTestTarget(state) {
  const target = state ? targets.get(stateIdentity(state)) : null;
  return target ? structuredClone(target) : null;
}

export function connectionTestMessage(botName, channelLabel = t('机器人')) {
  const name = cleanText(botName) ?? channelLabel;
  return `${t('✅ DeepSeek Harness 连接测试成功')}\n${t('这条消息由「IM机器人」设置页中的“{name}”机器人卡片发出。', { name })}`;
}

export function connectionTestTargetUnavailable(channelLabel = t('机器人')) {
  const error = new Error(t('{channelLabel}尚未收到可用于测试的私聊消息。', { channelLabel }));
  error.code = 'test-target-unavailable';
  return error;
}

export async function sendRememberedConnectionTest({ state, send, text, channelLabel }) {
  const target = connectionTestTarget(state);
  if (!target) throw connectionTestTargetUnavailable(channelLabel);
  await send(target, text);
  return { sent: true };
}

export function publicConnectionTestResult(error, { diagnostics, botId } = {}) {
  if (!error) return Object.freeze({ sent: true });
  return Object.freeze({
    sent: false,
    code: error?.code === 'test-target-unavailable'
      ? 'test-target-unavailable'
      : 'test-message-failed',
    ...(diagnostics && error?.code !== 'test-target-unavailable'
      ? { error: diagnostics.report(error, { operation: 'connection.test', stage: 'connection.test', botId }).publicError } : {}),
  });
}
