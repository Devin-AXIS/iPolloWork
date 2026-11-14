/**
 * Bot in groups: per-chat reply rules for the Telegram channel.
 *
 * Each rule answers one question — which group messages should wake the bot:
 * never, only when it is mentioned or replied to, or every message; and whether
 * that applies to anyone or only to a list of member IDs.
 *
 * The rule set lives in the bot config, so saving restarts the runtime and the
 * new behaviour applies to the next incoming message.
 */
import * as React from 'react';

import { h } from '../../i18n.js';

export const GROUP_TRIGGERS_ENDPOINTS = Object.freeze({
  get: 'bot.group-triggers.get',
  set: 'bot.group-triggers.set',
  resolve: 'bot.group-triggers.resolve',
});

export const GROUP_TRIGGER_MODE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'off', label: '不响应' }),
  Object.freeze({ value: 'mention', label: '被 @ 或回复时（任何人）' }),
  Object.freeze({ value: 'mention-list', label: '被 @ 或回复时（仅名单成员）' }),
  Object.freeze({ value: 'all', label: '所有消息（任何人）' }),
  Object.freeze({ value: 'all-list', label: '所有消息（仅名单成员）' }),
]);

const LIST_MODES = new Set(['mention-list', 'all-list']);
const DEFAULT_ENTRY = Object.freeze({ mode: 'off', sendersText: '' });

function isListMode(mode) {
  return LIST_MODES.has(mode);
}

function modeLabel(value) {
  return GROUP_TRIGGER_MODE_OPTIONS.find((option) => option.value === value)?.label
    ?? GROUP_TRIGGER_MODE_OPTIONS[0].label;
}

export function splitMemberIds(text) {
  return String(text ?? '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

/** One stored rule → editor state (members stay as the owner typed them). */
export function entryFromConfig(value) {
  const mode = GROUP_TRIGGER_MODE_OPTIONS.some((option) => option.value === value?.mode)
    ? value.mode : 'off';
  const senders = Array.isArray(value?.senders) ? value.senders.map((id) => String(id)) : [];
  return { mode, sendersText: senders.join('\n') };
}

/** RPC snapshot → editor state. */
export function stateFromSnapshot(value) {
  const source = value && typeof value === 'object' ? value : {};
  const groups = {};
  for (const [chatId, entry] of Object.entries(source.groups ?? {})) {
    groups[String(chatId)] = entryFromConfig(entry);
  }
  const seen = {};
  for (const entry of Array.isArray(source.seen) ? source.seen : []) {
    const chatId = typeof entry?.chatId === 'string' ? entry.chatId : '';
    if (!chatId) continue;
    seen[chatId] = {
      title: typeof entry.title === 'string' ? entry.title : null,
      type: typeof entry.type === 'string' ? entry.type : null,
      lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
      lastSenderName: typeof entry.lastSenderName === 'string' ? entry.lastSenderName : null,
    };
  }
  return { defaults: entryFromConfig(source.defaults), groups, seen, removed: [] };
}

function unwrapRpcResult(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '无法读取或保存群聊设置，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result?.ok === true ? result.value : result;
}

function formatMoment(value) {
  if (typeof value !== 'string' || !value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

function memberHelp(entry) {
  if (splitMemberIds(entry.sendersText).length > 0) return null;
  return isListMode(entry.mode)
    ? '名单为空：该模式不会响应任何成员。'
    : '当前模式不使用名单。';
}

function ModeField({ entry, onChange, disabled }) {
  return h('label', { className: 'dim-accessField' },
    h('span', null, '响应条件'),
    h('select', {
      value: entry.mode,
      disabled,
      onChange: (event) => onChange(event.target.value),
    }, GROUP_TRIGGER_MODE_OPTIONS.map((option) => h('option', {
      key: option.value,
      value: option.value,
    }, option.label))));
}

function MembersField({ entry, onChange, disabled }) {
  const help = memberHelp(entry);
  return h('label', { className: 'dim-accessField' },
    h('span', null, '成员名单'),
    h('textarea', {
      ...AUTOFILL_GUARD,
      value: entry.sendersText,
      rows: 2,
      disabled,
      spellCheck: false,
      placeholder: '123456789',
      onChange: (event) => onChange(event.target.value),
    }),
    help ? h('span', { className: 'dim-channelHelp' }, help) : null);
}

function ValueRow({ label, value, suffix }) {
  return h('div', { className: 'dim-accessField' },
    h('span', null, label),
    h('code', { className: 'dim-groupTriggerValue' }, value, suffix ?? null));
}

/** Keeps browser password managers from treating these fields as logins. */
const AUTOFILL_GUARD = Object.freeze({
  autoComplete: 'off',
  autoCapitalize: 'none',
  autoCorrect: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
});

export function TelegramGroupTriggersSettings({ account, rpcCall }) {
  const [state, setState] = React.useState(null);
  const [addDraft, setAddDraft] = React.useState(null);
  const [manualId, setManualId] = React.useState('');
  const [phase, setPhase] = React.useState('loading');
  const [saving, setSaving] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);

  const botId = account?.botId;

  const load = React.useCallback(async () => {
    setPhase('loading');
    setFeedback(null);
    try {
      const value = unwrapRpcResult(await rpcCall(GROUP_TRIGGERS_ENDPOINTS.get, { botId }));
      setState(stateFromSnapshot(value));
      // The add form always starts blank: it is a new rule, not a copy of the
      // defaults, so the owner never edits the wrong card by accident.
      setAddDraft(null);
      setPhase('ready');
    } catch (error) {
      setPhase('error');
      setFeedback({ tone: 'error', message: error?.message || '无法读取群聊设置，请稍后重试。' });
    }
  }, [botId, rpcCall]);

  React.useEffect(() => { void load(); }, [load]);

  if (phase === 'loading') {
    return h('div', { className: 'dim-accessState', 'aria-busy': 'true' }, '正在读取群聊设置…');
  }
  if (phase === 'error' || !state) {
    return h('div', { className: 'dim-accessState', role: 'alert' },
      h('p', null, feedback?.message || '无法读取群聊设置，请稍后重试。'),
      h('button', { type: 'button', className: 'dim-deliveryButton', onClick: () => void load() },
        '重试'));
  }

  const removed = new Set(state.removed);
  const chatIds = [...new Set([...Object.keys(state.groups), ...Object.keys(state.seen)])]
    .filter((chatId) => !removed.has(chatId));
  const addEntry = addDraft ?? DEFAULT_ENTRY;

  const updateDefault = (patch) => {
    setState((current) => ({ ...current, defaults: { ...current.defaults, ...patch } }));
    setFeedback(null);
  };
  const updateGroup = (chatId, patch) => {
    setState((current) => ({
      ...current,
      groups: { ...current.groups, [chatId]: { ...(current.groups[chatId] ?? current.defaults), ...patch } },
    }));
    setFeedback(null);
  };
  const removeGroup = (chatId) => {
    setState((current) => {
      const groups = { ...current.groups };
      delete groups[chatId];
      return { ...current, groups, removed: [...current.removed, chatId] };
    });
    setFeedback({ tone: 'success', message: '已从列表移除，保存后生效。' });
  };
  const addGroup = async () => {
    const raw = manualId.replace(/[\s\u00a0]+/g, '');
    if (!raw) return;
    setResolving(true);
    setFeedback(null);
    try {
      const resolved = unwrapRpcResult(await rpcCall(GROUP_TRIGGERS_ENDPOINTS.resolve, { botId, input: raw }));
      const chatId = typeof resolved?.chatId === 'string' ? resolved.chatId : '';
      if (!chatId) throw new Error('无法解析该群聊，请重试或填写数字群 ID。');
      // A chat already carrying a rule cannot be added twice; a chat that is
      // only known from the archive is configurable, so it is not a duplicate.
      if (Object.hasOwn(state.groups, chatId)) {
        setFeedback({
          tone: 'error',
          message: '该群已在列表中，请编辑上方的卡片。',
          detail: chatId,
        });
        return;
      }
      setState((current) => ({
        ...current,
        groups: { ...current.groups, [chatId]: { ...addEntry } },
        // Re-adding a hidden chat must undo the previous removal.
        removed: current.removed.filter((entry) => entry !== chatId),
        seen: resolved?.title
          ? { ...current.seen, [chatId]: { ...(current.seen[chatId] ?? {}), title: resolved.title } }
          : current.seen,
      }));
      setManualId('');
      setAddDraft(null);
      setFeedback({
        tone: 'success',
        message: resolved?.verified === false
          ? '已添加。Telegram 未确认该群（机器人可能还不在群里），保存后生效。'
          : '已添加，保存后生效。',
      });
    } catch (error) {
      setFeedback({ tone: 'error', message: error?.message || '无法解析该群聊，请重试或填写数字群 ID。' });
    } finally {
      setResolving(false);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const groups = {};
      for (const [chatId, entry] of Object.entries(state.groups)) {
        groups[chatId] = { mode: entry.mode, senders: splitMemberIds(entry.sendersText) };
      }
      const value = unwrapRpcResult(await rpcCall(GROUP_TRIGGERS_ENDPOINTS.set, {
        botId,
        config: {
          defaults: { mode: state.defaults.mode, senders: splitMemberIds(state.defaults.sendersText) },
          groups,
        },
        removed: state.removed,
      }));
      setState(stateFromSnapshot(value));
      setAddDraft(null);
      setFeedback({ tone: 'success', message: '群聊设置已保存。' });
    } catch (error) {
      setFeedback({ tone: 'error', message: error?.message || '无法保存群聊设置，请稍后重试。' });
    } finally {
      setSaving(false);
    }
  };

  return h('form', { className: 'dim-accessPage', onSubmit: (event) => void save(event) },
    h('fieldset', { className: 'dim-accessScene' },
      h('legend', null, '新群聊默认设置'),
      h('div', { className: 'dim-accessControls' },
        h(ModeField, {
          entry: state.defaults,
          disabled: saving,
          onChange: (mode) => updateDefault({ mode }),
        })),
      h(MembersField, {
        entry: state.defaults,
        disabled: saving,
        onChange: (sendersText) => updateDefault({ sendersText }),
      })),

    chatIds.map((chatId) => {
      const configured = Object.hasOwn(state.groups, chatId);
      const entry = state.groups[chatId] ?? state.defaults;
      const info = state.seen[chatId] ?? {};
      return h('fieldset', { key: chatId, className: 'dim-accessScene' },
        h('legend', null, info.title || chatId),
        h(ValueRow, { label: '群 ID', value: chatId }),
        info.title ? h(ValueRow, { label: '标题', value: info.title }) : null,
        h(ValueRow, {
          label: '最近活动',
          value: `${formatMoment(info.lastSeenAt)}${info.lastSenderName ? ` · ${info.lastSenderName}` : ''}`,
        }),
        configured
          ? h(ModeField, {
              entry,
              disabled: saving,
              onChange: (mode) => updateGroup(chatId, { mode }),
            })
          : h(ValueRow, {
              label: '响应条件',
              value: modeLabel(state.defaults.mode),
              suffix: '（默认）',
            }),
        configured
          ? h(MembersField, {
              entry,
              disabled: saving,
              onChange: (sendersText) => updateGroup(chatId, { sendersText }),
            })
          : null,
        h('div', { className: 'dim-accessActions' },
          configured
            ? null
            : h('button', {
                type: 'button',
                className: 'dim-deliveryButton',
                'data-kind': 'primary',
                disabled: saving,
                onClick: () => updateGroup(chatId, {}),
              }, '自定义'),
          h('button', {
            type: 'button',
            className: 'dim-deliveryButton',
            'data-kind': 'danger',
            disabled: saving,
            onClick: () => removeGroup(chatId),
          }, '× 移除')));
    }),

    h('fieldset', { className: 'dim-accessScene' },
      h('legend', null, '添加群聊'),
      h('label', { className: 'dim-accessField' },
        h('span', null, '群 ID、@用户名或消息链接'),
        h('textarea', {
          ...AUTOFILL_GUARD,
          value: manualId,
          rows: 1,
          spellCheck: false,
          placeholder: '-1001234567890',
          style: { resize: 'none', minHeight: '2.4em', overflow: 'hidden' },
          onChange: (event) => setManualId(event.target.value.replace(/[\s\u00a0]+/g, '')),
          onKeyDown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (!saving && !resolving && manualId) void addGroup();
          },
        }),
        h('span', { className: 'dim-channelHelp' },
          '支持数字 ID、@用户名、t.me/<name> 或 t.me/c/<id>/<msg>；真实 ID 通过 getChat 解析。')),
      h('div', { className: 'dim-accessControls' },
        h(ModeField, {
          entry: addEntry,
          disabled: saving,
          onChange: (mode) => setAddDraft({ ...addEntry, mode }),
        })),
      h(MembersField, {
        entry: addEntry,
        disabled: saving,
        onChange: (sendersText) => setAddDraft({ ...addEntry, sendersText }),
      }),
      h('div', { className: 'dim-accessActions' },
        h('button', {
          type: 'button',
          className: 'dim-deliveryButton',
          'data-kind': 'primary',
          disabled: saving || resolving || !manualId,
          onClick: () => void addGroup(),
        }, resolving ? '…' : '+ 添加'))),

    feedback
      ? h('p', {
          className: 'dim-accessFeedback',
          'data-tone': feedback.tone,
          role: feedback.tone === 'error' ? 'alert' : 'status',
          'aria-live': 'polite',
        }, feedback.message, feedback.detail ? h('code', { className: 'dim-groupTriggerValue' }, feedback.detail) : null)
      : null,

    h('div', { className: 'dim-accessActions' },
      h('button', {
        type: 'submit',
        className: 'dim-deliveryButton',
        'data-kind': 'primary',
        disabled: saving,
      }, saving ? '正在保存…' : '保存群聊设置')));
}
