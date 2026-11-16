import * as React from 'react';
import { h } from '../../i18n.js';
import { FEISHU_ENDPOINTS } from './api.js';
import { normalizeConversationDirectory, validateConversationDirectory } from '../../../../src/channels/shared/conversation-directory.mjs';

function ConfigForm({ title, value, inherited, busy, onSave, onClear }) {
  const id = React.useId();
  const [draft, setDraft] = React.useState(() => normalizeConversationDirectory(value) ?? { enabled: false, strategy: 'per-conversation', prefix: 'conv-' });
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    setDraft(normalizeConversationDirectory(value) ?? { enabled: false, strategy: 'per-conversation', prefix: 'conv-' });
    setError(null);
  }, [value]);
  const update = (key, next) => { setDraft((current) => ({ ...current, [key]: next })); setError(null); };
  const save = async (event) => {
    event.preventDefault();
    try { setError(null); await onSave(validateConversationDirectory(draft)); }
    catch (cause) { setError(cause.message); }
  };
  return h('form', { className: 'dim-conversationDirectoryForm', onSubmit: save, 'aria-label': title },
    h('h3', null, title),
    inherited ? h('p', { className: 'dim-botGeneralHelp' }, '继承渠道默认；保存后仅覆盖当前机器人。') : null,
    h('label', { className: 'dim-botGeneralRow', htmlFor: `${id}-enabled` },
      h('span', { className: 'dim-botGeneralTitle' }, '启用会话目录隔离'),
      h('input', { id: `${id}-enabled`, type: 'checkbox', role: 'switch', className: 'dim-contextSwitch', checked: draft.enabled, disabled: busy, onChange: (event) => update('enabled', event.target.checked) })),
    h('label', { className: 'dim-conversationDirectoryField', htmlFor: `${id}-strategy` },
      h('span', null, '目录策略'),
      h('select', { id: `${id}-strategy`, value: draft.strategy, disabled: busy, onChange: (event) => update('strategy', event.target.value) },
        h('option', { value: 'per-conversation' }, '每个对话固定一个目录'),
        h('option', { value: 'per-session' }, '每次新建会话使用新目录'))),
    h('label', { className: 'dim-conversationDirectoryField', htmlFor: `${id}-prefix` },
      h('span', null, '目录前缀'),
      h('input', { id: `${id}-prefix`, value: draft.prefix, maxLength: 32, pattern: '[A-Za-z0-9_-]{1,32}', disabled: busy, onChange: (event) => update('prefix', event.target.value) })),
    h('p', { className: 'dim-botGeneralHelp' }, '1–32 位字母、数字、下划线或连字符，默认为 conv-。'),
    error ? h('p', { role: 'alert', className: 'dim-accessFeedback', 'data-tone': 'error' }, error) : null,
    h('div', { className: 'dim-targetFormActions' },
      h('button', { type: 'submit', className: 'dim-deliveryButton', disabled: busy }, '保存设置'),
      onClear ? h('button', { type: 'button', className: 'dim-deliveryButton', disabled: busy, onClick: () => void onClear() }, title === '当前机器人' ? '恢复继承渠道默认' : '清除渠道默认') : null));
}

export function FeishuConversationDirectorySettingsPage({ account, rpcCall }) {
  const [snapshot, setSnapshot] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const load = React.useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const result = await rpcCall(FEISHU_ENDPOINTS.status, {});
      if (result?.ok !== true) throw new Error(result?.error?.message ?? '无法读取会话目录设置。');
      setSnapshot(result.value);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }, [rpcCall]);
  React.useEffect(() => { void load(); }, [load]);
  const save = async (endpoint, config) => {
    setBusy(true); setError(null);
    try {
      const payload = endpoint === FEISHU_ENDPOINTS.setConversationDirectoryDefault ? { config } : { botId: account.botId, config };
      const result = await rpcCall(endpoint, payload);
      if (result?.ok !== true) throw new Error(result?.error?.message ?? '保存会话目录设置失败。');
      setSnapshot(result.value);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const bot = snapshot?.bots?.find((item) => item.botId === account.botId);
  return h('section', { className: 'dim-conversationDirectorySettings', 'aria-label': '会话目录隔离', 'aria-busy': busy },
    h('p', { className: 'dim-botGeneralHelp' }, '让每个对话在自己的目录里工作，避免多人使用同一机器人时互相覆盖文件。默认关闭。'),
    h('p', { className: 'dim-botGeneralHelp' }, '设置保存后对新会话生效。发送 /new 使用新设置；已有会话和旧目录中的文件保留。开启后无法手动修改工作区。'),
    error ? h('p', { role: 'alert' }, error) : null,
    bot ? h(React.Fragment, null,
      h(ConfigForm, { key: `bot-${account.botId}`, title: '当前机器人', value: bot.conversationDirectoryOverride ?? bot.conversationDirectory, inherited: bot.conversationDirectoryOverride == null, busy, onSave: (config) => save(FEISHU_ENDPOINTS.setConversationDirectory, config), onClear: () => save(FEISHU_ENDPOINTS.setConversationDirectory, null) }),
      h(ConfigForm, { key: `default-${JSON.stringify(snapshot.conversationDirectory)}`, title: '当前类型全部机器人会话目录隔离', value: snapshot.conversationDirectory, busy, onSave: (config) => save(FEISHU_ENDPOINTS.setConversationDirectoryDefault, config), onClear: () => save(FEISHU_ENDPOINTS.setConversationDirectoryDefault, null) })) : null);
}
