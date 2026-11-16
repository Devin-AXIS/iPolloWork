import * as React from 'react';

import { AccessPolicySettingsPage } from './access-policy-settings.js';
import { BotGeneralSettingsPage } from './bot-general-settings.js';
import { BotSettingsTabs } from './bot-settings-tabs.js';
import { DsBotSettingsPage } from './ds-bot-settings.js';
import { FeishuGroupSettingsPage } from './channels/feishu/group-settings.js';
import { FeishuVoiceSettingsPage } from './channels/feishu/voice-settings.js';
import { FeishuSlashPanelSettingsPage } from './channels/feishu/slash-panel-settings.js';
import { FeishuConversationDirectorySettingsPage } from './channels/feishu/conversation-directory-settings.js';
import { TelegramGroupTriggersSettings } from './channels/telegram/group-triggers-settings.js';
import { h, imLocale, localizeTemplate, localizeText } from './i18n.js';

export const DELIVERY_RPC_CHANNEL = '/dsh-im-delivery';

const DELIVERY_DOCS_URL = Object.freeze({
  zh: 'https://github.com/xmanrui/dsh-im/blob/main/PROACTIVE_DELIVERY.md',
  en: 'https://github.com/xmanrui/dsh-im/blob/main/PROACTIVE_DELIVERY.en.md',
});

export const DELIVERY_ENDPOINTS = Object.freeze({
  list: 'target.list',
  listSuggestions: 'target.suggestion.list',
  create: 'target.create',
  update: 'target.update',
  delete: 'target.delete',
  sessionSync: 'target.session-sync.set',
  test: 'target.test',
});

export const BOT_SETTINGS_TABS = Object.freeze([
  Object.freeze({ id: 'general', label: '通用' }),
  Object.freeze({ id: 'delivery', label: '投递设置' }),
  Object.freeze({ id: 'ds-bot', label: '绑定 DS Bot' }),
  Object.freeze({ id: 'access', label: '访问设置' }),
]);

export const FEISHU_BOT_SETTINGS_TABS = Object.freeze([
  ...BOT_SETTINGS_TABS,
  Object.freeze({ id: 'conversation-directory', label: '会话目录' }),
  Object.freeze({ id: 'group', label: '群聊' }),
  Object.freeze({ id: 'slash', label: '指令面板' }),
  Object.freeze({ id: 'voice', label: '语音交互' }),
]);

export const TELEGRAM_BOT_SETTINGS_TABS = Object.freeze([
  ...BOT_SETTINGS_TABS,
  Object.freeze({ id: 'groups', label: '机器人群聊行为' }),
]);

export function botSettingsTabsForChannel(channel) {
  if (channel === 'feishu') return FEISHU_BOT_SETTINGS_TABS;
  if (channel === 'telegram') return TELEGRAM_BOT_SETTINGS_TABS;
  return BOT_SETTINGS_TABS;
}

const CHANNEL_DEFINITIONS = Object.freeze({
  weixin: {
    label: '微信',
    kinds: [{ value: 'user', label: '用户' }],
    fields: { user: [{ key: 'toUserId', label: '微信用户 ID', placeholder: '填写接收消息的用户 ID' }] },
  },
  feishu: {
    label: '飞书',
    kinds: [{ value: 'user', label: '私聊' }, { value: 'group', label: '群聊' }],
    fields: {
      user: [{ key: 'openId', label: 'Open ID', placeholder: 'ou_xxx' }],
      group: [{ key: 'chatId', label: '群 Chat ID', placeholder: 'oc_xxx' }],
    },
  },
  dingtalk: {
    label: '钉钉',
    kinds: [{ value: 'user', label: '用户' }, { value: 'group', label: '群聊' }],
    fields: {
      user: [{ key: 'userId', label: '用户 ID', placeholder: '填写钉钉用户 ID' }],
      group: [{ key: 'openConversationId', label: '群 Open Conversation ID', placeholder: 'cidxxx' }],
    },
  },
  wecom: {
    label: '企业微信',
    kinds: [{ value: 'user', label: '私聊' }, { value: 'group', label: '群聊' }],
    fields: {
      user: [{ key: 'chatId', label: '用户 ID', placeholder: '填写企业微信用户 ID' }],
      group: [{ key: 'chatId', label: '群 Chat ID', placeholder: '填写群 chatid' }],
    },
  },
  wecomApp: {
    label: '企业微信应用',
    kinds: [{ value: 'user', label: '私聊' }],
    fields: {
      user: [{ key: 'chatId', label: '用户 ID', placeholder: '填写企业微信用户 ID' }],
    },
  },
  qq: {
    label: 'QQ',
    kinds: [{ value: 'user', label: '单聊' }, { value: 'group', label: '群聊' }],
    fields: {
      user: [{ key: 'userOpenId', label: '用户 Open ID', placeholder: '填写 user_openid' }],
      group: [{ key: 'groupOpenId', label: '群 Open ID', placeholder: '填写 group_openid' }],
    },
  },
  slack: {
    label: 'Slack',
    kinds: [{ value: 'conversation', label: '会话' }, { value: 'thread', label: '线程' }],
    fields: {
      conversation: [{ key: 'channelId', label: 'Channel ID', placeholder: 'C0123456789' }],
      thread: [
        { key: 'channelId', label: 'Channel ID', placeholder: 'C0123456789' },
        { key: 'threadTs', label: 'Thread 时间戳', placeholder: '1712345678.123456' },
      ],
    },
  },
  telegram: {
    label: 'Telegram',
    kinds: [{ value: 'chat', label: '聊天' }, { value: 'topic', label: '话题' }],
    fields: {
      chat: [{ key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890', inputMode: 'numeric' }],
      topic: [
        { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890', inputMode: 'numeric' },
        { key: 'messageThreadId', label: 'Topic ID', placeholder: '123', inputMode: 'numeric', integer: true },
      ],
    },
  },
  discord: {
    label: 'Discord',
    kinds: [{ value: 'channel', label: '频道或私信' }],
    fields: { channel: [{ key: 'channelId', label: 'Channel ID', placeholder: '填写可发消息的 Channel ID', inputMode: 'numeric' }] },
  },
  whatsapp: {
    label: 'WhatsApp',
    kinds: [{ value: 'user', label: '用户' }, { value: 'group', label: '群聊' }],
    fields: {
      user: [{ key: 'jid', label: '用户 JID', placeholder: '8613800000000@s.whatsapp.net' }],
      group: [{ key: 'jid', label: '群 JID', placeholder: '1234567890@g.us' }],
    },
  },
  imessage: {
    label: 'iMessage',
    kinds: [{ value: 'user', label: '私聊' }],
    fields: { user: [{ key: 'chatGuid', label: 'Chat GUID', placeholder: 'iMessage;+;chat123' }] },
  },
  // 邮箱渠道在 Host 侧（delivery-adapter 的 case 'email'）早于投递设置页面支持，
  // route 只有 address 一个字段，kind 固定为 user，这里补齐表单定义让投递目标可选。
  email: {
    label: '邮箱',
    kinds: [{ value: 'user', label: '收件人' }],
    fields: {
      user: [{ key: 'address', label: '邮箱地址', placeholder: 'name@example.com', inputMode: 'email' }],
    },
  },
});

export const DELIVERY_CHANNEL_DEFINITIONS = CHANNEL_DEFINITIONS;

function presentError(error, fallback) {
  return error?.message || fallback;
}

function unwrapRpcResult(result) {
  if (result?.ok === true) return result.value;
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '请求失败，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

function targetsFrom(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.targets) ? value.targets : [];
}

function suggestionsFrom(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.suggestions) ? value.suggestions : [];
}

function kindLabel(definition, kind) {
  return definition.kinds.find((entry) => entry.value === kind)?.label ?? kind;
}

function fieldsFor(definition, kind) {
  return definition.fields[kind] ?? [];
}

function cleanDisplayName(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null;
}

function suggestionDisplayName(suggestion) {
  return cleanDisplayName(
    suggestion?.name ?? suggestion?.displayName ?? suggestion?.label,
  );
}

function routeIdentity(definition, candidate) {
  const fields = fieldsFor(definition, candidate?.kind);
  if (fields.length === 0 || !candidate?.route || typeof candidate.route !== 'object') return null;
  const values = [];
  for (const field of fields) {
    const value = candidate.route[field.key];
    if (value === undefined || value === null || String(value).trim() === '') return null;
    values.push(String(value).trim());
  }
  return JSON.stringify([candidate.kind, ...values]);
}

function validSuggestions(definition, value) {
  const seen = new Set();
  return suggestionsFrom(value).filter((suggestion) => {
    const identity = routeIdentity(definition, suggestion);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function maskRouteValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const at = text.indexOf('@');
  if (at > 0) {
    const local = text.slice(0, at);
    const domain = text.slice(at);
    const visible = local.length <= 4
      ? `${local.slice(0, 1)}••${local.slice(-1)}`
      : `${local.slice(0, 3)}…${local.slice(-2)}`;
    return `${visible}${domain}`;
  }
  if (text.length <= 6) return `${text.slice(0, 2)}…${text.slice(-1)}`;
  if (text.length <= 12) return `${text.slice(0, 3)}…${text.slice(-3)}`;
  return `${text.slice(0, 5)}…${text.slice(-4)}`;
}

function suggestionFallbackName(definition, suggestion) {
  const displayName = suggestionDisplayName(suggestion);
  if (displayName) return displayName;
  const firstField = fieldsFor(definition, suggestion.kind)[0];
  const route = firstField ? maskRouteValue(suggestion.route?.[firstField.key]) : '';
  return `${localizeText(kindLabel(definition, suggestion.kind))}${route ? ` · ${route}` : ''}`;
}

function randomTargetId(targets) {
  const used = new Set(targets.map((target) => target?.targetId));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const bytes = new Uint8Array(8);
    const crypto = globalThis.crypto;
    if (typeof crypto?.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    const targetId = `tgt_${suffix}`;
    if (!used.has(targetId)) return targetId;
  }
  throw new Error('无法生成未占用的 Target ID，请重试。');
}

function DeliveryButton({ children, kind = 'secondary', className = '', ...props }) {
  return h('button', {
    ...props,
    type: props.type ?? 'button',
    className: `dim-deliveryButton ${className}`.trim(),
    'data-kind': kind,
  }, children);
}

async function copyText(value) {
  const clipboard = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText !== 'function') {
    throw new Error('当前浏览器不支持自动复制，请手动选择复制。');
  }
  await clipboard.writeText(value);
}

function TargetForm({
  definition,
  mode,
  initialValue,
  source,
  busy,
  connected,
  onCancel,
  onSave,
  onTest,
}) {
  const editing = mode === 'edit';
  const initialKind = initialValue?.kind && definition.fields[initialValue.kind]
    ? initialValue.kind
    : definition.kinds[0].value;
  const [targetId, setTargetId] = React.useState(initialValue?.targetId ?? '');
  const [name, setName] = React.useState(initialValue?.name ?? '');
  const [kind, setKind] = React.useState(initialKind);
  const [route, setRoute] = React.useState(initialValue?.route ?? {});
  const [error, setError] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const [testState, setTestState] = React.useState(null);

  const currentTarget = () => {
    const normalizedRoute = Object.fromEntries(fieldsFor(definition, kind).map((field) => {
      const raw = String(route[field.key] ?? '').trim();
      return [field.key, field.integer ? Number(raw) : raw];
    }));
    return {
      targetId: targetId.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      kind,
      route: normalizedRoute,
    };
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave({
        ...currentTarget(),
      });
    } catch (caught) {
      setError(presentError(caught, '目标保存失败，请检查后重试。'));
    }
  };

  const testTarget = async () => {
    if (typeof onTest !== 'function') return;
    setTesting(true);
    setTestState(null);
    try {
      const target = currentTarget();
      await onTest({ kind: target.kind, route: target.route });
      setTestState({ tone: 'success', message: '测试消息已发送，请到目标会话确认。' });
    } catch (caught) {
      setTestState({ tone: 'error', message: presentError(caught, '测试发送失败，请稍后重试。') });
    } finally {
      setTesting(false);
    }
  };
  const testReady = fieldsFor(definition, kind).every((field) => (
    String(route[field.key] ?? '').trim()
  ));

  return h('form', { className: 'dim-targetForm', onSubmit: submit },
    h('div', { className: 'dim-targetFormHeading' },
      h('h3', null, editing ? '编辑投递目标' : '新建投递目标'),
      h('p', { style: { color: '#92400e', background: '#fffbeb', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 } },
        '目标是细粒度设置：某个机器人一旦配置了目标（哪怕关闭会话同步），该机器人的投递就按目标走。如需使用「通用设置 → 投递」里的简单开关，请先删除该机器人的全部目标。'),
      editing
        ? initialValue?.sessionSync?.enabled
          ? h('p', null, '修改接收位置会关闭会话双向同步。')
          : null
        : h('p', null, source === 'suggestion'
            ? '已从会话自动填入目标信息；确认后再保存。'
            : '请手动填写从对应平台取得的原生标识。')),
    h('div', { className: 'dim-targetFormGrid' },
      h('label', { className: 'dim-targetField' },
        h('span', null, 'Target ID'),
        h('input', {
          name: 'targetId',
          value: targetId,
          readOnly: editing,
          disabled: testing,
          required: true,
          pattern: '[A-Za-z0-9._:@-]{1,128}',
          maxLength: 128,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          placeholder: '例如 daily-report',
          onChange: (event) => setTargetId(event.target.value),
        })),
      h('label', { className: 'dim-targetField' },
        h('span', null, '显示名称（可选）'),
        h('input', {
          name: 'name',
          value: name,
          disabled: testing,
          maxLength: 80,
          placeholder: '例如 每日汇报群',
          onChange: (event) => setName(event.target.value),
        })),
      h('label', { className: 'dim-targetField' },
        h('span', null, '目标类型'),
        h('select', {
          name: 'kind',
          value: kind,
          disabled: testing,
          onChange: (event) => {
            setKind(event.target.value);
            setRoute({});
            setTestState(null);
          },
        }, definition.kinds.map((entry) => h('option', {
          key: entry.value,
          value: entry.value,
        }, entry.label)))),
      fieldsFor(definition, kind).map((field) => h('label', {
        key: field.key,
        className: 'dim-targetField',
      },
      h('span', null, field.label),
      h('input', {
        name: field.key,
        value: route[field.key] ?? '',
        disabled: testing,
        required: true,
        inputMode: field.inputMode,
        autoCapitalize: 'none',
        autoCorrect: 'off',
        spellCheck: false,
        placeholder: field.placeholder,
        onChange: (event) => {
          setRoute((current) => ({
            ...current,
            [field.key]: event.target.value,
          }));
          setTestState(null);
        },
      })))),
    error ? h('p', { className: 'dim-targetFormError', role: 'alert' }, error) : null,
    testState ? h('p', {
      className: 'dim-targetFeedback',
      'data-tone': testState.tone,
      role: 'status',
      'aria-live': 'polite',
    }, testState.message) : null,
    h('div', { className: 'dim-targetFormActions' },
      h(DeliveryButton, { onClick: onCancel, disabled: busy || testing }, '取消'),
      h(DeliveryButton, {
        onClick: () => void testTarget(),
        disabled: busy || testing || !connected || !testReady || typeof onTest !== 'function',
        title: connected ? undefined : '机器人离线时不可发送测试消息',
        'aria-label': '测试投递目标',
      }, testing ? '测试中…' : '测试'),
      h(DeliveryButton, { type: 'submit', kind: 'primary', disabled: busy || testing },
        busy ? '正在保存…' : '保存目标')));
}

function suggestionOptionLabel(definition, suggestion, added) {
  const name = suggestionDisplayName(suggestion);
  const type = localizeText(kindLabel(definition, suggestion.kind));
  const route = fieldsFor(definition, suggestion.kind)
    .map((field) => maskRouteValue(suggestion.route?.[field.key]))
    .filter(Boolean)
    .join(' · ');
  return [name, type, route, added ? localizeText('已添加') : null]
    .filter(Boolean)
    .join(' · ');
}

function TargetSuggestionPicker({
  definition,
  phase,
  suggestions,
  error,
  targets,
  onRefresh,
  onSelect,
  onManual,
  onCancel,
}) {
  const configured = new Set(targets.map((target) => routeIdentity(definition, target)).filter(Boolean));

  return h('section', { className: 'dim-targetSuggestions', 'aria-label': '从已聊过的会话选择' },
    h('div', { className: 'dim-targetSuggestionHeading' },
      h('div', null,
        h('h3', null, '从已聊过的会话选择'),
        h('p', null, '选择后会自动填写目标信息和调用别名，确认后再保存。')),
      h(DeliveryButton, {
        onClick: () => void onRefresh(),
        disabled: phase === 'loading',
      }, phase === 'loading' ? '正在刷新…' : '刷新')),
    phase === 'loading'
      ? h('div', { className: 'dim-targetSuggestionState', 'aria-busy': 'true' }, '正在读取已聊会话…')
      : phase === 'error'
        ? h('div', { className: 'dim-targetSuggestionState', role: 'alert' },
            h('p', null, error),
            h(DeliveryButton, { onClick: () => void onRefresh() }, '重新读取'))
        : suggestions.length === 0
          ? h('div', { className: 'dim-targetSuggestionState' },
              h('strong', null, '还没有可选择的会话'),
              h('p', null, '先在对应平台与机器人聊一条消息，再刷新。'))
          : h('label', { className: 'dim-targetSuggestionField' },
              h('span', null, '已聊会话'),
              h('select', {
                name: 'suggestion',
                value: '',
                onChange: (event) => {
                  if (event.target.value === '') return;
                  const suggestion = suggestions[Number(event.target.value)];
                  if (suggestion) onSelect(suggestion);
                },
              },
              h('option', { value: '', disabled: true }, '从会话选择targetID'),
              suggestions.map((suggestion, index) => {
                const identity = routeIdentity(definition, suggestion);
                const added = configured.has(identity);
                return React.createElement('option', {
                  key: suggestion.id ?? suggestion.suggestionId ?? `${identity}:${index}`,
                  value: String(index),
                  disabled: added,
                }, suggestionOptionLabel(definition, suggestion, added));
              }))),
    h('div', { className: 'dim-targetFormActions' },
      h(DeliveryButton, { onClick: onCancel }, '取消'),
      h(DeliveryButton, { onClick: onManual }, '手动填写（高级）')));
}

function TargetRow({ definition, target, botId, connected, rpcCall, onChanged, onEdit }) {
  const [action, setAction] = React.useState(null);
  const [testState, setTestState] = React.useState(null);
  const [syncFeedback, setSyncFeedback] = React.useState(null);
  const [copyState, setCopyState] = React.useState(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const sessionSync = target.sessionSync ?? { enabled: false, state: 'unavailable' };
  const syncDescription = sessionSync.state === 'active'
    ? '自动跟随该私聊的当前会话'
    : sessionSync.state === 'waiting'
      ? '等待该私聊建立新会话'
      : sessionSync.state === 'unavailable'
        ? '仅支持已经聊过、已建立当前会话且使用当前 Host Harness 的私聊目标'
        : '关闭时不发送 DSH 会话消息';
  const testTarget = async () => {
    setAction('test');
    setTestState(null);
    try {
      await rpcCall(DELIVERY_ENDPOINTS.test, { botId, targetId: target.targetId });
      setTestState({ tone: 'success', message: '测试消息已发送，请到目标会话确认。' });
    } catch (error) {
      setTestState({ tone: 'error', message: presentError(error, '测试发送失败，请稍后重试。') });
    } finally {
      setAction(null);
    }
  };

  const copyPair = async () => {
    setCopyState(null);
    try {
      await copyText(JSON.stringify({ botId, targetId: target.targetId }));
      setCopyState('已复制调用参数');
    } catch (error) {
      setCopyState(presentError(error, '复制失败。'));
    }
  };

  const deleteTarget = async () => {
    setAction('delete');
    try {
      await rpcCall(DELIVERY_ENDPOINTS.delete, { botId, targetId: target.targetId });
      await onChanged();
    } catch (error) {
      setTestState({ tone: 'error', message: presentError(error, '删除失败，请稍后重试。') });
      setAction(null);
      setConfirmDelete(false);
    }
  };

  const setSessionSync = async (enabled) => {
    setAction('sync');
    setSyncFeedback(null);
    try {
      await rpcCall(DELIVERY_ENDPOINTS.sessionSync, {
        botId,
        targetId: target.targetId,
        enabled,
      });
      await onChanged();
    } catch (error) {
      setSyncFeedback({
        tone: 'error',
        message: error?.code === 'session-sync-unavailable'
          ? '会话同步仅支持已经聊过、已建立当前会话且使用当前 Host Harness 的私聊目标。'
          : presentError(error, '会话同步设置失败，请稍后重试。'),
      });
    } finally {
      setAction(null);
    }
  };

  return h('li', { className: 'dim-targetRow', 'data-target-id': target.targetId },
    h('div', { className: 'dim-targetSummary' },
      h('div', { className: 'dim-targetTitle' },
        React.createElement('strong', null, target.name || target.targetId),
        h('span', null, kindLabel(definition, target.kind))),
      h('code', null, `targetId: ${target.targetId}`)),
    h('div', { className: 'dim-targetActions' },
      h(DeliveryButton, { onClick: () => void copyPair() }, '复制调用参数'),
      h(DeliveryButton, {
        onClick: () => void testTarget(),
        disabled: !connected || action === 'test',
        title: connected ? undefined : '机器人离线时不可发送测试消息',
        'aria-label': '测试投递目标',
      }, action === 'test' ? '测试中…' : '测试'),
      h(DeliveryButton, { onClick: onEdit, disabled: Boolean(action) }, '编辑'),
      h(DeliveryButton, {
        kind: 'danger',
        onClick: () => setConfirmDelete(true),
        disabled: Boolean(action),
      }, '删除')),
    h('label', { className: 'dim-targetSessionSync' },
      h('span', { className: 'dim-targetSessionSyncCopy' },
        h('strong', null, '会话双向同步'),
        h('small', null, syncDescription)),
      h('input', {
        type: 'checkbox',
        checked: sessionSync.enabled === true,
        disabled: Boolean(action)
          || (sessionSync.enabled !== true && sessionSync.state === 'unavailable'),
        onChange: (event) => void setSessionSync(event.target.checked),
        'aria-label': '会话双向同步',
      })),
    copyState ? h('p', { className: 'dim-targetFeedback', role: 'status' }, copyState) : null,
    syncFeedback ? h('p', {
      className: 'dim-targetFeedback',
      'data-tone': syncFeedback.tone,
      role: 'alert',
    }, syncFeedback.message) : null,
    testState ? h('p', {
      className: 'dim-targetFeedback',
      'data-tone': testState.tone,
      role: 'status',
      'aria-live': 'polite',
    }, testState.message) : null,
    confirmDelete ? h('div', { className: 'dim-targetDeleteConfirm', role: 'alertdialog' },
      h('p', null,
        '删除 ', h('code', null, target.targetId),
        '？使用这个 targetId 的外部调用将返回 unknown-target。',
        sessionSync.enabled ? ' 会话同步设置也会一并删除。' : null),
      h('div', { className: 'dim-targetFormActions' },
        h(DeliveryButton, {
          onClick: () => setConfirmDelete(false),
          disabled: action === 'delete',
        }, '取消'),
        h(DeliveryButton, {
          kind: 'danger',
          onClick: () => void deleteTarget(),
          disabled: action === 'delete',
        }, action === 'delete' ? '正在删除…' : '确认删除')))
      : null);
}

export function DeliveryTargetSettingsPage({
  channel,
  account,
  rpcCall,
  accessRpcCall,
  onBack,
}) {
  const definition = CHANNEL_DEFINITIONS[channel];
  const [activeTabId, setActiveTabId] = React.useState(BOT_SETTINGS_TABS[0].id);
  const [phase, setPhase] = React.useState('loading');
  const [targets, setTargets] = React.useState([]);
  const [suggestionPhase, setSuggestionPhase] = React.useState('idle');
  const [suggestions, setSuggestions] = React.useState([]);
  const [suggestionError, setSuggestionError] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [editor, setEditor] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [botCopyState, setBotCopyState] = React.useState(null);
  const [accessPolicy, setAccessPolicy] = React.useState(account.accessPolicy);
  // The slash panel page re-reads its baseline from this snapshot after a save,
  // so the saved panel has to land here — a stale account would put the
  // pre-save list back on screen and into the next "copy to other bots" payload.
  const [slashPanel, setSlashPanel] = React.useState(account.slashPanel);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    setAccessPolicy(account.accessPolicy);
  }, [account.botId, account.accessPolicy]);

  React.useEffect(() => {
    setSlashPanel(account.slashPanel);
  }, [account.botId, account.slashPanel]);

  const invoke = React.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== 'function') throw new Error('投递目标设置暂不可用。');
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);

  const loadTargets = React.useCallback(async ({ signal, silent = false } = {}) => {
    if (!silent) setPhase('loading');
    setError(null);
    try {
      const value = await invoke(DELIVERY_ENDPOINTS.list, { botId: account.botId }, signal);
      if (signal?.aborted || !mounted.current) return;
      setTargets(targetsFrom(value));
      setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || caught?.name === 'AbortError' || !mounted.current) return;
      setError(presentError(caught, '无法读取投递目标，请稍后重试。'));
      setPhase('error');
    }
  }, [account.botId, invoke]);

  const loadSuggestions = React.useCallback(async () => {
    setSuggestionPhase('loading');
    setSuggestionError(null);
    try {
      const value = await invoke(DELIVERY_ENDPOINTS.listSuggestions, { botId: account.botId });
      if (!mounted.current) return;
      setSuggestions(validSuggestions(definition, value));
      setSuggestionPhase('ready');
    } catch (caught) {
      if (caught?.name === 'AbortError' || !mounted.current) return;
      setSuggestionError(presentError(caught, '无法读取已聊会话，请稍后重试。'));
      setSuggestionPhase('error');
    }
  }, [account.botId, definition, invoke]);

  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void loadTargets({ signal: controller.signal });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [loadTargets]);

  if (!definition) {
    return h('section', { className: 'dim-deliveryPage' },
      h(DeliveryButton, { className: 'dim-deliveryBack', onClick: onBack }, '← 返回机器人列表'),
      h('p', { role: 'alert' }, '当前渠道暂不支持投递目标。'));
  }

  const saveTarget = async (target) => {
    setSaving(true);
    try {
      if (editor?.mode === 'edit') {
        await invoke(DELIVERY_ENDPOINTS.update, {
          botId: account.botId,
          targetId: editor.target.targetId,
          target: {
            ...(target.name ? { name: target.name } : {}),
            kind: target.kind,
            route: target.route,
          },
        });
      } else {
        await invoke(DELIVERY_ENDPOINTS.create, { botId: account.botId, target });
      }
      await loadTargets({ silent: true });
      if (mounted.current) setEditor(null);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const openSuggestionPicker = () => {
    setEditor({ mode: 'suggestions' });
    void loadSuggestions();
  };

  const selectSuggestion = (suggestion) => {
    const identity = routeIdentity(definition, suggestion);
    if (!identity) return;
    const route = Object.fromEntries(fieldsFor(definition, suggestion.kind).map((field) => [
      field.key,
      suggestion.route[field.key],
    ]));
    setEditor({
      mode: 'create',
      source: 'suggestion',
      draftKey: identity,
      initialValue: {
        targetId: randomTargetId(targets),
        name: suggestionFallbackName(definition, suggestion),
        kind: suggestion.kind,
        route,
      },
    });
  };

  const copyBotId = async () => {
    setBotCopyState(null);
    try {
      await copyText(account.botId);
      setBotCopyState('已复制 Bot ID');
    } catch (caught) {
      setBotCopyState(presentError(caught, '复制失败。'));
    }
  };

  const settingsTabs = botSettingsTabsForChannel(channel);
  const activeTab = settingsTabs.find((tab) => tab.id === activeTabId)
    ?? settingsTabs[0];
  const activeTabDomId = `dim-bot-settings-${activeTab.id}-tab`;
  const activePanelId = `dim-bot-settings-${activeTab.id}-panel`;

  return h('section', {
    className: 'dim-deliveryPage',
    'aria-label': localizeTemplate('{name}机器人设置', { name: account.botName || definition.label }),
  },
  h('header', { className: 'dim-deliveryHeader' },
    h(DeliveryButton, { className: 'dim-deliveryBack', onClick: onBack }, '← 返回机器人列表')),
  h(BotSettingsTabs, { tabs: settingsTabs, activeTabId: activeTab.id, onChange: setActiveTabId }),
  h('div', {
    id: activePanelId,
    className: 'dim-botSettingsTabPanel',
    role: 'tabpanel',
    'aria-labelledby': activeTabDomId,
  },
  activeTab.id === 'general'
    ? h(BotGeneralSettingsPage, { key: `${channel}:${account.botId}`, channel, account, rpcCall: accessRpcCall })
    : activeTab.id === 'ds-bot'
    ? h(DsBotSettingsPage, {
        key: account.botId, botId: account.botId, rpcCall: invoke,
      })
    : activeTab.id === 'access'
    ? h(AccessPolicySettingsPage, {
        channel,
        account: { ...account, accessPolicy },
        rpcCall: accessRpcCall,
        onSaved: setAccessPolicy,
      })
    : activeTab.id === 'conversation-directory' && channel === 'feishu'
      ? h(FeishuConversationDirectorySettingsPage, { account, rpcCall: accessRpcCall })
    : activeTab.id === 'groups' && channel === 'telegram'
      ? h(TelegramGroupTriggersSettings, {
          key: `${channel}:${account.botId}:groups`,
          account,
          rpcCall: accessRpcCall,
        })
    : activeTab.id === 'group' && channel === 'feishu'
      ? h(FeishuGroupSettingsPage, {
          account,
          rpcCall: accessRpcCall,
        })
    : activeTab.id === 'slash' && channel === 'feishu'
      ? h(FeishuSlashPanelSettingsPage, {
          account: { ...account, slashPanel },
          rpcCall: accessRpcCall,
          onSaved: setSlashPanel,
        })
    : activeTab.id === 'voice' && channel === 'feishu'
      ? h(FeishuVoiceSettingsPage, {
          key: account.botId,
          account,
          rpcCall: accessRpcCall,
        })
    : h(React.Fragment, null,
  h('section', { className: 'dim-deliveryIdentity', 'aria-labelledby': 'dim-delivery-bot-title' },
    h('div', { className: 'dim-deliveryIdentityHeading' },
      h('h2', { id: 'dim-delivery-bot-title', className: 'dim-deliveryBotName' },
        account.botName || '机器人设置'),
      h('a', {
        className: 'dim-deliveryDocsLink',
        href: imLocale() === 'zh' ? DELIVERY_DOCS_URL.zh : DELIVERY_DOCS_URL.en,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': '打开主动投递使用文档',
      },
      h('span', null, '使用文档'),
      h('span', { 'aria-hidden': 'true' }, '↗'))),
    h('div', { className: 'dim-deliveryBotId' },
      h('span', null, 'Bot ID'),
      h('code', { title: account.botId }, account.botId),
      h(DeliveryButton, { onClick: () => void copyBotId() }, '复制')),
    botCopyState ? h('p', { className: 'dim-targetFeedback', role: 'status' }, botCopyState) : null),
  h('section', { className: 'dim-deliveryTargets', 'aria-labelledby': 'dim-delivery-targets-title' },
    h('div', { className: 'dim-deliverySectionHeading' },
      h('div', null,
        h('h3', { id: 'dim-delivery-targets-title' }, '投递目标'),
        account.connected
          ? null
          : h('p', null, '机器人当前离线；仍可配置目标，恢复连接后再测试。')),
      h(DeliveryButton, {
        kind: 'primary',
        onClick: openSuggestionPicker,
        disabled: Boolean(editor) || phase !== 'ready',
        title: phase === 'ready' ? undefined : '请先完成投递目标读取',
      }, '新建目标')),
    editor?.mode === 'suggestions'
      ? h(TargetSuggestionPicker, {
          definition,
          phase: suggestionPhase,
          suggestions,
          error: suggestionError,
          targets,
          onRefresh: loadSuggestions,
          onSelect: selectSuggestion,
          onManual: () => setEditor({
            mode: 'create',
            source: 'manual',
            draftKey: 'manual',
            initialValue: { targetId: randomTargetId(targets) },
          }),
          onCancel: () => setEditor(null),
        })
      : editor ? h(TargetForm, {
          key: editor.mode === 'edit' ? editor.target.targetId : editor.draftKey,
          definition,
          mode: editor.mode,
          initialValue: editor.mode === 'edit' ? editor.target : editor.initialValue,
          source: editor.source,
          busy: saving,
          connected: account.connected,
          onCancel: () => setEditor(editor.source === 'suggestion'
            ? { mode: 'suggestions' }
            : null),
          onSave: saveTarget,
          onTest: (target) => invoke(DELIVERY_ENDPOINTS.test, {
            botId: account.botId,
            target,
          }),
        }) : null,
    phase === 'loading'
      ? h('div', { className: 'dim-deliveryState', 'aria-busy': 'true' }, '正在读取投递目标…')
      : phase === 'error'
        ? h('div', { className: 'dim-deliveryState', role: 'alert' },
            h('p', null, error),
            h(DeliveryButton, { onClick: () => void loadTargets() }, '重新读取'))
        : targets.length === 0
          ? h('div', { className: 'dim-deliveryState dim-deliveryEmpty' },
              h('strong', null, '尚未配置投递目标'),
              h('p', null, '点击“新建目标”可从已聊过的会话选择，也可手动填写。'))
          : h('ul', { className: 'dim-targetList' }, targets.map((target) => h(TargetRow, {
              key: target.targetId,
              definition,
              target,
              botId: account.botId,
              connected: account.connected,
              rpcCall: invoke,
              onChanged: () => loadTargets({ silent: true }),
              onEdit: () => setEditor({ mode: 'edit', target, source: 'edit' }),
            })))))));
}
