import * as React from 'react';
import { h } from './i18n.js';
import { DsBotAvatar } from './ds-bot-avatar.js';

export const DS_BOT_MESSAGES = Object.freeze({
  missing: '未安装 DS Bot，请先在 DSH 插件管理中安装 ds-bot，然后刷新。',
  disabled: 'DS Bot 尚未启用，请在 DSH 插件管理中启用后刷新。',
  unavailable: '暂时无法读取 DS Bot，请检查插件是否正常运行后重试。',
  readonly: 'DS Bot 当前由其他 Host 管理，请在运行它的 Host 中绑定。',
  remote: '绑定 DS Bot 仅支持当前 Host 的会话，请先检查机器人的 Harness 连接设置。',
});

export function dsBotErrorMessage(error) {
  return {
    'ds-bot-unavailable': DS_BOT_MESSAGES.unavailable,
    'ds-bot-not-found': '所选 DS Bot 已不存在，请刷新后重新选择。',
    'ds-bot-private-required': '仅支持已经建立会话的私聊，请先与机器人私聊后刷新。',
    'ds-bot-binding-conflict': '所选 DS Bot 或私聊对象已绑定，请刷新后重新选择。',
  }[error?.code] ?? '绑定设置保存失败，请刷新后重试。';
}

export function DsBotPicker({ bots, value, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const root = React.useRef(null);
  const trigger = React.useRef(null);
  const listId = React.useId();
  const selected = bots.find((bot) => bot.id === value);
  const isOpen = open && !disabled && bots.length > 0;
  React.useEffect(() => {
    const dismiss = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    if (open) globalThis.document?.addEventListener('pointerdown', dismiss);
    return () => globalThis.document?.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const choose = (bot) => { onChange(bot.id); setOpen(false); trigger.current?.focus(); };
  const optionId = (index) => `${listId}-${index}`;
  return h('div', { className: 'dim-dsBotPicker', ref: root },
    h('button', {
      type: 'button', role: 'combobox', ref: trigger, className: 'dim-dsBotPickerTrigger',
      disabled: disabled || !bots.length, 'aria-label': 'DS Bot', 'aria-expanded': isOpen, 'aria-controls': listId,
      'aria-haspopup': 'listbox', 'aria-activedescendant': isOpen ? optionId(active) : undefined,
      onClick: () => { setActive(Math.max(0, bots.findIndex((bot) => bot.id === value))); setOpen(!open); },
      onKeyDown: (event) => {
        if (disabled || !bots.length) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? bots.length - 1
            : open ? (active + (event.key === 'ArrowDown' ? 1 : -1) + bots.length) % bots.length
              : Math.max(0, bots.findIndex((bot) => bot.id === value));
          setActive(index); setOpen(true);
        } else if (open && ['Enter', ' '].includes(event.key)) {
          event.preventDefault(); if (bots[active]) choose(bots[active]);
        } else if (event.key === 'Escape' || event.key === 'Tab') setOpen(false);
      },
    },
    selected ? h(DsBotAvatar, { bot: selected }) : null,
    selected ? React.createElement('span', { className: 'dim-dsBotPickerName' }, selected.name)
      : h('span', { className: 'dim-dsBotPickerName' }, bots.length ? '选择 DS Bot' : '暂无可选 DS Bot'),
    h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
      h('path', { d: 'm4 6 4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
    isOpen ? h('div', { id: listId, role: 'listbox', 'aria-label': 'DS Bot', className: 'dim-dsBotOptions' },
      bots.map((bot, index) => h('button', {
        key: bot.id, id: optionId(index), type: 'button', role: 'option', tabIndex: -1,
        'aria-selected': value === bot.id, 'data-active': active === index,
        onMouseDown: (event) => event.preventDefault(), onMouseEnter: () => setActive(index), onClick: () => choose(bot),
      }, h(DsBotAvatar, { bot }),
      React.createElement('span', { className: 'dim-dsBotPickerName' }, bot.name),
      value === bot.id ? h('span', { 'aria-hidden': true }, '✓') : null))) : null);
}

function conversationLabel(conversation) {
  if (conversation.name) return conversation.name;
  const value = conversation.address;
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function DsBotSettingsPage({ botId, rpcCall }) {
  const [status, setStatus] = React.useState(null);
  const [dsBotId, setDsBotId] = React.useState('');
  const [conversationKey, setConversationKey] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const [feedbackTone, setFeedbackTone] = React.useState('success');
  const requests = React.useRef({ revision: 0, busy: false, controller: null });
  const refresh = React.useCallback(async (signal = requests.current.controller?.signal) => {
    const state = requests.current;
    if (signal?.aborted) return;
    const revision = ++state.revision;
    const current = () => !signal?.aborted && revision === state.revision;
    setLoading(true);
    try {
      const value = await rpcCall('ds-bot.status', { botId }, signal);
      if (current()) setStatus(value);
    } catch {
      if (current()) setStatus((previous) => ({ ...previous, state: 'unavailable' }));
    } finally {
      if (current()) setLoading(false);
    }
  }, [botId, rpcCall]);
  React.useEffect(() => {
    const controller = new AbortController();
    requests.current.controller = controller;
    void refresh(controller.signal);
    return () => {
      controller.abort();
      requests.current.revision++;
    };
  }, [refresh]);
  const conversations = status?.conversations ?? [];
  const bots = status?.bots ?? [];
  const bindings = conversations.filter((conversation) => conversation.dsBotId);
  const usedBotIds = new Set(bindings.map((binding) => binding.dsBotId));
  const availableBots = bots.filter((bot) => !usedBotIds.has(bot.id));
  const availableConversations = conversations.filter((conversation) => !conversation.dsBotId);
  const canSave = !busy && !loading && status?.state === 'ready'
    && availableBots.some((bot) => bot.id === dsBotId)
    && availableConversations.some((conversation) => conversation.conversationKey === conversationKey);
  React.useEffect(() => {
    setDsBotId((value) => availableBots.some((bot) => bot.id === value) ? value : '');
    setConversationKey((value) => availableConversations.some((conversation) => conversation.conversationKey === value) ? value : '');
  }, [status]);
  const save = async (event) => {
    event.preventDefault();
    if (!canSave || requests.current.busy) return;
    requests.current.busy = true;
    requests.current.revision++;
    setBusy(true); setFeedback(null);
    try {
      await rpcCall('ds-bot.bind', { botId, conversationKey, dsBotId });
      setDsBotId(''); setConversationKey('');
      await refresh();
      setFeedbackTone('success'); setFeedback('绑定已保存。');
    } catch (error) {
      if (error?.code === 'ds-bot-binding-conflict') await refresh();
      setFeedbackTone('error'); setFeedback(dsBotErrorMessage(error));
    } finally { requests.current.busy = false; setBusy(false); }
  };
  const unbind = async (key) => {
    if (requests.current.busy) return;
    requests.current.busy = true;
    requests.current.revision++;
    setBusy(true); setFeedback(null);
    try {
      await rpcCall('ds-bot.unbind', { botId, conversationKey: key });
      await refresh();
      setFeedbackTone('success'); setFeedback('已解除绑定，聊天记录保留。');
    } catch (error) {
      setFeedbackTone('error'); setFeedback(dsBotErrorMessage(error));
    } finally { requests.current.busy = false; setBusy(false); }
  };
  return h('section', { className: 'dim-deliveryTargets dim-dsBotSettings', 'aria-label': '绑定 DS Bot' },
    h('div', { className: 'dim-deliverySectionHeading' },
      h('div', null, h('h3', null, '绑定 DS Bot'), h('p', null, '选择 DS Bot 和私聊对象，直接使用 Bot 的会话。')),
      h('button', { className: 'dim-deliveryButton', type: 'button', disabled: busy || loading, onClick: () => void refresh() }, '刷新')),
    !status ? h('p', { className: 'dim-dsBotNotice', role: 'status' }, '正在检测 DS Bot…')
      : status.state !== 'ready' ? h('p', { className: 'dim-dsBotNotice', role: 'status' }, DS_BOT_MESSAGES[status.state] ?? DS_BOT_MESSAGES.unavailable)
      : !bots.length ? h('p', { className: 'dim-dsBotNotice' }, '还没有 DS Bot，请先在 DS Bot 中创建机器人后刷新。')
      : !conversations.length ? h('p', { className: 'dim-dsBotNotice' }, '还没有可绑定的私聊。先给这个机器人发一条私聊消息，再点击刷新。')
      : h('form', { className: 'dim-dsBotForm', onSubmit: save },
        h('div', { className: 'dim-targetFormGrid' },
          h('div', { className: 'dim-targetField' }, h('span', null, 'DS Bot'),
            h(DsBotPicker, { bots: availableBots, value: dsBotId, onChange: setDsBotId, disabled: busy || loading })),
          h('label', { className: 'dim-targetField' }, h('span', null, '私聊对象'),
            h('select', {
              value: conversationKey, required: true, disabled: busy || loading || !availableConversations.length,
              onChange: (event) => setConversationKey(event.target.value),
            }, h('option', { value: '' }, availableConversations.length ? '选择私聊对象' : '暂无可选私聊对象'),
            availableConversations.map((conversation) => React.createElement('option', {
              key: conversation.conversationKey, value: conversation.conversationKey,
            }, conversationLabel(conversation)))))),
        !availableBots.length || !availableConversations.length
          ? h('p', { className: 'dim-dsBotNotice' }, '已绑定的 DS Bot 和私聊对象不可重复选择，解除绑定后可重新选择。')
          : null,
        h('div', { className: 'dim-targetFormActions' },
          h('button', { type: 'submit', className: 'dim-deliveryButton', 'data-kind': 'primary',
            disabled: !canSave,
          }, busy ? '正在保存…' : '保存绑定'))),
    bindings.length ? h('ul', { className: 'dim-targetList' }, bindings.map((conversation) => {
      const bot = bots.find((entry) => entry.id === conversation.dsBotId);
      return h('li', { className: 'dim-targetRow dim-dsBotBinding', key: conversation.conversationKey },
        h('div', { className: 'dim-dsBotBoundIdentity' },
          h(DsBotAvatar, { bot: bot ?? { id: conversation.dsBotId }, size: 32 }),
          h('div', { className: 'dim-targetSummary' },
            h('div', { className: 'dim-targetTitle' },
              bot ? React.createElement('strong', null, bot.name) : h('strong', null, 'DS Bot 暂不可用'),
              h('span', null, '已绑定')),
            React.createElement('p', { className: 'dim-dsBotDestination' }, conversationLabel(conversation)))),
        h('button', { type: 'button', className: 'dim-deliveryButton', 'data-kind': 'danger', disabled: busy || loading,
          onClick: () => void unbind(conversation.conversationKey),
        }, '解除绑定'));
    })) : null,
    feedback ? h('p', { role: 'status', className: 'dim-targetFeedback', 'data-tone': feedbackTone }, feedback) : null);
}
