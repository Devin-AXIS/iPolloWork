import { enhanceContextContent } from './context-enhancement.mjs';
import { t } from './i18n.mjs';
import manifest from '../../../package.json' with { type: 'json' };

const CONTROL_COMMAND = /^\/(?:stop|steer|version)(?=$|\s)/iu;
const STOP_COMMAND = /^\/stop(?=$|\s)/iu;
const VERSION_COMMAND = /^\/version(?=$|\s)/iu;
const STOP_USAGE = '用法：/stop（不带参数）';
const VERSION_USAGE = '用法：/version（不带参数）';
const STEER_USAGE = '用法：/steer <补充指令>';
const TEXT_ONLY = '控制命令仅支持纯文字，请移除图片后重试。';

function commandResult(message, extra = {}) {
  return { message, ...extra };
}

function requestOptions(signal) {
  return signal ? { signal } : {};
}

function boundSession(harness, state, key) {
  if (typeof state?.sessionFor !== 'function') return null;
  const sessionId = state.sessionFor(key);
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof harness?.workspaceSession !== 'function') {
    throw new TypeError('Harness does not support workspace sessions');
  }
  const session = harness.workspaceSession(sessionId, key);
  if (!session || typeof session !== 'object') {
    throw new TypeError('Harness returned an invalid workspace session');
  }
  return session;
}

export function isControlCommand(text) {
  return typeof text === 'string' && CONTROL_COMMAND.test(text.trim());
}

// Shared by explicit /steer and ordinary messages configured to steer. A false
// result guarantees no submission; exceptions must never trigger a second ask.
export async function steerMessage(text, harness, state, key, {
  signal, control, enhancement, pendingInteraction = false,
} = {}) {
  if (pendingInteraction) return false;
  const session = boundSession(harness, state, key);
  if (!session) return false;
  if (typeof session.steerActiveTurn !== 'function') {
    throw new TypeError('Harness session does not support steering active turns');
  }
  const steering = enhancement
    ? enhanceContextContent(text, enhancement.snapshot, enhancement.source)
    : text;
  return session.steerActiveTurn(steering, control, requestOptions(signal));
}

export async function runControlCommand(text, harness, state, key, {
  signal,
  hasImages = false,
  pendingInteraction = false,
  control,
  deferredDelivery,
  enhancement,
} = {}) {
  if (!isControlCommand(text)) return null;
  const command = text.trim();
  const stop = STOP_COMMAND.test(command);
  const version = VERSION_COMMAND.test(command);

  if (hasImages) return commandResult(t(TEXT_ONLY));

  if (version) {
    return /^\/version$/iu.test(command)
      ? commandResult(`dsh-im v${manifest.version}`)
      : commandResult(t(VERSION_USAGE));
  }

  if (stop) {
    if (!/^\/stop$/iu.test(command)) return commandResult(t(STOP_USAGE));
    const session = boundSession(harness, state, key);
    if (!session) return commandResult(t('当前聊天没有正在运行的任务。'));
    if (typeof session.stopActiveTurn !== 'function') {
      throw new TypeError('Harness session does not support stopping active turns');
    }
    const stopped = await session.stopActiveTurn(control, requestOptions(signal));
    if (!stopped && deferredDelivery) {
      const background = await deferredDelivery.stop(key);
      if (background === 'stopped') return commandResult(t('已请求停止后台任务。'), { stopped: true });
      if (background === 'unavailable') {
        return commandResult(t('无法安全停止后台任务，请在 Harness 中查看并停止对应任务。'));
      }
    }
    return stopped
      ? commandResult(t('已请求停止当前任务。'), { stopped: true })
      : commandResult(t('当前聊天没有正在运行的任务。'));
  }

  const match = /^\/steer(?:\s+([\s\S]*))?$/iu.exec(command);
  const instruction = match?.[1]?.trim() ?? '';
  if (!instruction) return commandResult(t(STEER_USAGE));
  if (pendingInteraction) {
    return commandResult([
      t('当前任务正在等待你的回答或审批。'),
      '',
      t('请先处理当前请求，或者发送 /stop 停止任务。'),
    ].join('\n'));
  }

  const session = boundSession(harness, state, key);
  if (!session) {
    return commandResult(t('当前聊天没有绑定会话，无法补充指令。请先绑定会话。'));
  }
  // A mid-turn correction carries the same provenance as the message that
  // opened the turn, so a group member who steers is identified too.
  const steered = await steerMessage(instruction, harness, state, key, {
    signal, control, enhancement,
  });
  return steered
    ? commandResult(t('已提交补充指令，Agent 会在下一步读取。'))
    : commandResult(t('任务已结束，没有正在运行的任务，无法补充指令。请直接发送消息开始新任务。'));
}
