import { createCommandListSnapshots, COMMAND_LIST_TTL_MS, COMMAND_LIST_MAX_ENTRIES } from './command-list-snapshots.mjs';
import {
  normalizeAgentPresetCatalog,
  normalizeAgentPresetId,
} from './agent-preset.mjs';
import { t } from './i18n.mjs';
import { withSessionBindingLock } from './session-binding-lock.mjs';
import { splitWorkspaceCommandMessage } from './workspace-command.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const PRESET_COMMAND = /^\/preset(?=$|\s)/iu;
const PRESET_LIST_COMMAND = /^\/(?:presetlist|presets)(?=$|\s)/iu;
const PRESET_LIST_USAGE = '用法：/presetlist（不带参数）';
const PRESET_USAGE = [
  '用法：',
  '/preset  查看当前设置',
  '/preset <序号>  按最近一次 /presetlist 的序号选择',
  '/preset <ID>  按 Agent Preset ID 选择',
  '/preset id:<纯数字 ID>  选择纯数字 ID',
  '/preset --default  跟随 Host 默认',
].join('\n');
const UNSAFE_DISPLAY_TEXT_GLOBAL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const LIST_SNAPSHOTS = createCommandListSnapshots();
export const PRESET_LIST_SNAPSHOT_TTL_MS = COMMAND_LIST_TTL_MS;
export const PRESET_LIST_SNAPSHOT_MAX_ENTRIES = COMMAND_LIST_MAX_ENTRIES;

function commandResult(message) {
  return {
    handled: true,
    message,
    messages: splitWorkspaceCommandMessage(message),
  };
}

function safeDisplayText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(UNSAFE_DISPLAY_TEXT_GLOBAL, ' ').replace(/\s+/gu, ' ').trim();
}

function rpcOptions(signal) {
  return signal ? { signal } : {};
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !value.agentPresetCatalog || typeof value.agentPresetCatalog !== 'object'
    || !Array.isArray(value.agentPresetCatalog.items)) {
    throw new TypeError('Harness returned invalid Agent Preset settings');
  }
  const agentPreset = value.agentPreset === null
    ? null
    : normalizeAgentPresetId(value.agentPreset);
  if (value.agentPreset !== null && agentPreset === null) {
    throw new TypeError('Harness returned an invalid current Agent Preset');
  }
  return {
    agentPreset,
    agentPresetCatalog: normalizeAgentPresetCatalog(value.agentPresetCatalog),
  };
}

function presetItemText(item) {
  const label = safeDisplayText(item.label) || item.id;
  return t('{label}（{id}）', { label, id: item.id });
}

function itemFor(catalog, id) {
  return catalog.items.find((item) => item.id === id) ?? null;
}

function defaultDescription(catalog) {
  if (!catalog.defaultId) return t('未设置或当前不可用');
  const item = itemFor(catalog, catalog.defaultId);
  return item
    ? presetItemText(item)
    : t('{id}（当前不可用）', { id: catalog.defaultId });
}

function currentDescription(settings) {
  const { agentPreset, agentPresetCatalog: catalog } = settings;
  if (agentPreset === null) {
    const item = itemFor(catalog, catalog.defaultId);
    return item
      ? t('跟随 Host 默认：{preset}', { preset: presetItemText(item) })
      : t('跟随 Host 默认（Host 默认当前不可用）');
  }
  const item = itemFor(catalog, agentPreset);
  return item
    ? presetItemText(item)
    : t('{id}（已不可用）', { id: agentPreset });
}

function formatCurrent(settings) {
  return [
    t('当前机器人用于新会话的 Agent Preset：'),
    currentDescription(settings),
    '',
    t('已有会话不会受此设置影响。'),
    t('查看可用项：/presetlist'),
    t('恢复跟随 Host 默认：/preset --default'),
  ].join('\n');
}

function formatList(settings) {
  const { agentPreset, agentPresetCatalog: catalog } = settings;
  const lines = [
    t('当前机器人用于新会话的 Agent Preset：'),
    currentDescription(settings),
    '',
    t('Host 默认：{preset}', { preset: defaultDescription(catalog) }),
    '',
    t('可用 Agent Preset（{count}）：', { count: catalog.items.length }),
  ];
  if (catalog.items.length === 0) {
    lines.push(t('当前没有可用 Agent Preset。'));
  } else {
    catalog.items.forEach((item, index) => {
      const markers = [];
      if (item.id === catalog.defaultId) markers.push(t('Host 默认'));
      if (item.id === agentPreset) markers.push(t('当前选择'));
      if (agentPreset === null && item.id === catalog.defaultId) markers.push(t('当前生效'));
      const annotation = markers.length > 0 ? `（${markers.join('，')}）` : '';
      lines.push(`${index + 1}. ${presetItemText(item)}${annotation}`);
    });
  }
  lines.push(
    '',
    t('选择：/preset <序号或 ID>'),
    t('纯数字 ID：/preset id:<ID>'),
    t('恢复跟随 Host 默认：/preset --default'),
  );
  return lines.join('\n');
}

function formatUpdated(settings) {
  return [
    t('当前机器人用于新会话的 Agent Preset 已设置为：'),
    currentDescription(settings),
    '',
    t('已有会话不变。若当前聊天已有会话，请先发送 /new，再发送普通消息，才会使用新设置创建会话。'),
  ].join('\n');
}

function presetFromSnapshot(state, key, requested) {
  if (!/^\d+$/u.test(requested)) return { numeric: false, id: null };
  const index = Number(requested);
  if (!Number.isSafeInteger(index) || index < 1) {
    return { numeric: true, error: t('Agent Preset 序号无效，请先执行 /presetlist。') };
  }
  const snapshot = LIST_SNAPSHOTS.load(state, key);
  if (!snapshot) {
    return { numeric: true, error: t('请先执行 /presetlist，再按列表序号选择 Agent Preset。') };
  }
  const id = snapshot[index - 1];
  return id
    ? { numeric: true, id }
    : { numeric: true, error: t('Agent Preset 序号不存在，请重新执行 /presetlist。') };
}

function errorCode(error) {
  return error?.code ?? error?.failure?.code;
}

function presetErrorMessage(error, action) {
  const code = errorCode(error);
  if (code === 'agent-preset-invalid') {
    return t(`Agent Preset ID 格式无效。
{usage}`, { usage: t(PRESET_USAGE) });
  }
  if (code === 'agent-preset-unavailable') {
    return t('Agent Preset 不存在或当前不可用，请重新执行 /presetlist。');
  }
  if (code === WORKSPACE_SESSION_STALE || code === 'workspace-bot-not-found') {
    return t('工作区或机器人状态已发生变化，请重试。');
  }
  if (code === 'cancelled' || error?.name === 'AbortError') {
    if (action === 'list') return t('获取 Agent Preset 列表已取消。');
    if (action === 'current') return t('获取 Agent Preset 设置已取消。');
    return t('Agent Preset 修改已取消。');
  }
  if (action === 'list') return t('暂时无法获取 Agent Preset 列表，请稍后重试。');
  if (action === 'current') return t('暂时无法获取 Agent Preset 设置，请稍后重试。');
  return t('Agent Preset 修改失败，请稍后重试。');
}

async function settings(harness, options) {
  if (typeof harness?.agentPresetSettings !== 'function') {
    throw new TypeError('Harness does not support Agent Preset settings');
  }
  return normalizeSettings(await harness.agentPresetSettings(options));
}

async function update(harness, value, options) {
  if (typeof harness?.updateAgentPreset !== 'function') {
    throw new TypeError('Harness does not support updating Agent Preset settings');
  }
  return normalizeSettings(await harness.updateAgentPreset(value, options));
}

export function isPresetCommand(text) {
  if (typeof text !== 'string') return false;
  const command = text.trim();
  return PRESET_LIST_COMMAND.test(command) || PRESET_COMMAND.test(command);
}

export async function runPresetCommand(text, harness, state, key, options = {}) {
  if (!isPresetCommand(text)) return null;
  const command = text.trim();
  if (options.hasImages) {
    return commandResult(t('Agent Preset 命令仅支持纯文字，请移除图片后重试。'));
  }
  const requestOptions = rpcOptions(options.signal);

  if (PRESET_LIST_COMMAND.test(command)) {
    if (!/^\/(?:presetlist|presets)[ \t]*$/iu.test(command)) return commandResult(t(PRESET_LIST_USAGE));
    try {
      const current = await settings(harness, requestOptions);
      LIST_SNAPSHOTS.save(state, key, current.agentPresetCatalog.items.map((item) => item.id));
      return commandResult(formatList(current));
    } catch (error) {
      return commandResult(presetErrorMessage(error, 'list'));
    }
  }

  const match = /^\/preset(?:[ \t]+([^\s]+))?[ \t]*$/iu.exec(command);
  if (!match) return commandResult(t(PRESET_USAGE));
  const requested = match[1];
  if (!requested) {
    try {
      return commandResult(formatCurrent(await settings(harness, requestOptions)));
    } catch (error) {
      return commandResult(presetErrorMessage(error, 'current'));
    }
  }

  let selected;
  if (requested.toLowerCase() === '--default') {
    selected = null;
  } else {
    const explicitNumericId = /^id:(\d+)$/iu.exec(requested);
    if (explicitNumericId) {
      selected = explicitNumericId[1];
    } else {
      const fromSnapshot = presetFromSnapshot(state, key, requested);
      if (fromSnapshot.numeric) {
        if (fromSnapshot.error) return commandResult(fromSnapshot.error);
        selected = fromSnapshot.id;
      } else {
        selected = normalizeAgentPresetId(requested);
        if (!selected) return commandResult(t(`Agent Preset ID 格式无效。
{usage}`, { usage: t(PRESET_USAGE) }));
      }
    }
  }

  try {
    return await withSessionBindingLock(state, key, async () => (
      commandResult(formatUpdated(await update(harness, selected, requestOptions)))
    ));
  } catch (error) {
    return commandResult(presetErrorMessage(error, 'update'));
  }
}
