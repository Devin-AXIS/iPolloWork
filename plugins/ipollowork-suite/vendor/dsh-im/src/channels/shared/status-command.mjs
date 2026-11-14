import { t } from './i18n.mjs';

/** Long enough to tell sessions apart in a chat, short enough to read. */
const SESSION_ID_DISPLAY_LENGTH = 12;

/**
 * Optional /status fields must not hold the reply open when the Host is stuck.
 * Three seconds is well above a healthy local RPC and short enough that the
 * connection line is never buried behind a frozen Session/models read.
 */
export const STATUS_FIELD_TIMEOUT_MS = 3_000;

function shortenedSessionId(sessionId) {
  return sessionId.length > SESSION_ID_DISPLAY_LENGTH
    ? `${sessionId.slice(0, SESSION_ID_DISPLAY_LENGTH)}…`
    : sessionId;
}

/**
 * The workspace the current conversation actually runs in: an explicit
 * per-conversation pin when present, otherwise the bot-wide default.
 */
function readWorkspace(harness, conversationKey) {
  if (typeof harness?.currentConversationWorkspace === 'function'
    && typeof conversationKey === 'string' && conversationKey) {
    const workspace = harness.currentConversationWorkspace(conversationKey);
    if (typeof workspace === 'string' && workspace) return workspace;
  }
  if (typeof harness?.currentWorkspace === 'function') {
    const workspace = harness.currentWorkspace();
    if (typeof workspace === 'string' && workspace) return workspace;
  }
  return null;
}

async function readPreset(harness, options) {
  if (typeof harness?.agentPresetSettings !== 'function') return null;
  const settings = await harness.agentPresetSettings(options);
  const preset = settings?.agentPreset;
  if (typeof preset !== 'string' || !preset) return t('跟随 Host 默认');
  const item = settings?.agentPresetCatalog?.items?.find((entry) => entry?.id === preset);
  return item?.label ? `${item.label}（${preset}）` : preset;
}

async function readModel(session, options) {
  if (typeof session?.models !== 'function') return null;
  const catalog = await session.models(options);
  const current = catalog?.current;
  if (typeof current?.provider !== 'string' || !current.provider
    || typeof current?.model !== 'string' || !current.model) return null;
  return `${current.provider}/${current.model}`;
}

async function readRunning(session, options) {
  if (typeof session?.isRunning !== 'function') return false;
  return (await session.isRunning(options)) === true;
}

/** Give the optional reads their own deadline, without cancelling the turn. */
function fieldReadOptions(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

/** A status field is optional: one failing read must not fail the command. */
async function settled(operation) {
  try {
    return await operation();
  } catch {
    return null;
  }
}

/**
 * A status field is optional AND must not outlive its deadline.
 *
 * The abort signal alone is not enough: the real Host chain
 * (`agentPresetSettings()` reads the preset directory before it re-checks the
 * signal) can ignore it and never settle, which would hold the whole reply
 * open. Race the read against its own timer so the deadline holds no matter
 * how the underlying RPC behaves; the signal still lets cooperative readers
 * cancel their work early.
 */
function settledWithin(operation, timeoutMs) {
  return new Promise((resolve) => {
    let settledAlready = false;
    const finish = (value) => {
      if (settledAlready) return false;
      settledAlready = true;
      clearTimeout(timer);
      resolve(value ?? null);
      return true;
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    (async () => operation())().then(finish, () => finish(null));
  });
}

/**
 * Render one readable /status reply for the text channels.
 *
 * The first line is the historical connection confirmation. Everything after
 * it is best-effort: a workspace, session binding, model or Agent Preset that
 * cannot be read is omitted (or explained) instead of turning the command into
 * a failure. The running-task line appears only when this chat's bound session
 * is actually running, so the common idle case stays short. Optional reads use
 * a bounded signal ({@link STATUS_FIELD_TIMEOUT_MS}) so a frozen Host cannot
 * make the command hang.
 */
export async function runStatusCommand({
  descriptor,
  harness,
  state,
  conversationKey,
  signal,
  fieldTimeoutMs = STATUS_FIELD_TIMEOUT_MS,
} = {}) {
  if (!harness || typeof harness.ensureRunning !== 'function') {
    throw new TypeError('A Harness client with ensureRunning is required');
  }
  const options = signal ? { signal } : {};
  await harness.ensureRunning(options);
  const fieldTimeout = Number.isSafeInteger(fieldTimeoutMs) && fieldTimeoutMs > 0
    ? fieldTimeoutMs
    : STATUS_FIELD_TIMEOUT_MS;
  const fieldOptions = fieldReadOptions(signal, fieldTimeout);

  const label = descriptor?.label ?? 'Telegram';
  const lines = [t('{label}机器人与 DeepSeek Harness 连接正常。', { label })];

  const workspace = await settled(() => readWorkspace(harness, conversationKey));
  if (workspace) lines.push(t('工作区：{workspace}', { workspace }));

  const sessionId = await settled(async () => (typeof state?.sessionFor === 'function'
    ? state.sessionFor(conversationKey)
    : null));
  const boundSessionId = typeof sessionId === 'string' && sessionId ? sessionId : null;
  lines.push(boundSessionId
    ? t('绑定会话：{session}', { session: shortenedSessionId(boundSessionId) })
    : t('绑定会话：未绑定（发送消息后自动创建）'));

  const session = boundSessionId
    ? await settled(() => (typeof harness.workspaceSession === 'function'
      ? harness.workspaceSession(boundSessionId, conversationKey)
      : null))
    : null;
  const [model, preset, running] = await Promise.all([
    session ? settledWithin(() => readModel(session, fieldOptions), fieldTimeout) : null,
    settledWithin(() => readPreset(harness, fieldOptions), fieldTimeout),
    session ? settledWithin(() => readRunning(session, fieldOptions), fieldTimeout) : false,
  ]);
  if (model) lines.push(t('当前模型：{model}', { model }));
  else if (!session) lines.push(t('当前模型：暂无（创建会话后显示）'));
  if (preset) lines.push(t('Agent Preset（预设）：{preset}', { preset }));
  if (running === true) lines.push(t('运行中任务：有（发送 /stop 可停止）'));

  return { message: lines.join('\n') };
}
