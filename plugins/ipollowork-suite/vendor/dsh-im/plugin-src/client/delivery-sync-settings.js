import * as React from 'react';

import {
  DEFAULT_DELIVERY_SYNC_SETTINGS,
  normalizeDeliverySyncIcon,
  normalizeDeliverySyncSettings,
} from '../../src/channels/shared/delivery-sync-settings.mjs';
import { h } from './i18n.js';

/**
 * Delivery-sync settings: which turns the chat mirrors even though they did not
 * start in the chat (a turn typed in the Web GUI, a turn started by a schedule
 * reminder or a subagent notice), the two prefix icons, and the language the
 * plugin's own chat messages are written in.
 */
/**
 * Management channel serving these endpoints. Separate from the loopback-only
 * `/dsh-im-settings` so the page also works when the dashboard is opened
 * through its own domain.
 */
export const DELIVERY_SYNC_SETTINGS_RPC_CHANNEL = '/dsh-im-delivery-sync';

export const DELIVERY_SYNC_SETTINGS_ENDPOINTS = Object.freeze({
  get: 'settings.delivery-sync.get',
  set: 'settings.delivery-sync.set',
  getLanguage: 'settings.language.get',
  setLanguage: 'settings.language.set',
});

/** The languages the plugin ships chat-message dictionaries for, plus "follow DSH". */
export const MESSAGE_LANGUAGE_OPTIONS = Object.freeze([
  { value: 'auto', label: '跟随 DSH 界面语言' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
]);

function unwrap(result) {
  if (result?.ok === true) return result.value;
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '无法读取或保存会话同步设置，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

/**
 * The select shows the pinned language only while it is actually in force: a
 * snapshot resolved by the operator's `language` option keeps reporting its own
 * source, and the page must not claim that selection came from here.
 */
export function messageLanguageFromSnapshot(snapshot) {
  if (snapshot?.source !== 'explicit') return 'auto';
  const language = snapshot.language;
  return MESSAGE_LANGUAGE_OPTIONS.some((option) => option.value === language) ? language : 'auto';
}

export function DeliverySyncSettings({ rpcCall, languageRpcCall = null }) {
  const [values, setValues] = React.useState(DEFAULT_DELIVERY_SYNC_SETTINGS);
  const [language, setLanguage] = React.useState('auto');
  const [savedLanguage, setSavedLanguage] = React.useState('auto');
  const [phase, setPhase] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saved, setSaved] = React.useState(false);
  const mounted = React.useRef(false);
  const busy = React.useRef(false);
  const id = React.useId();
  const languageAvailable = typeof languageRpcCall === 'function';

  const load = React.useCallback(async (signal) => {
    setPhase('loading');
    setError(null);
    setSaved(false);
    try {
      // There is no fallback channel: without the delivery-sync one the page
      // says so instead of silently reading another document.
      if (typeof rpcCall !== 'function') throw new Error('投递同步设置通道不可用。');
      const settings = normalizeDeliverySyncSettings(
        unwrap(await rpcCall(DELIVERY_SYNC_SETTINGS_ENDPOINTS.get, {}, signal)),
      );
      if (!settings) throw new Error('会话同步设置返回了无法识别的响应。');
      const snapshot = languageAvailable
        ? unwrap(await languageRpcCall(DELIVERY_SYNC_SETTINGS_ENDPOINTS.getLanguage, {}, signal))
        : null;
      if (signal?.aborted || !mounted.current) return;
      setValues(settings);
      const current = messageLanguageFromSnapshot(snapshot);
      setLanguage(current);
      setSavedLanguage(current);
      setPhase('ready');
    } catch (caught) {
      if (signal?.aborted || !mounted.current) return;
      setError(caught.message || '无法读取或保存会话同步设置，请稍后重试。');
      setPhase('error');
    }
  }, [languageAvailable, languageRpcCall, rpcCall]);

  React.useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);

  const edit = (patch) => {
    setValues((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError(null);
  };

  const save = async (event) => {
    event.preventDefault();
    if (busy.current || phase !== 'ready') return;
    busy.current = true;
    setPhase('saving');
    setError(null);
    setSaved(false);
    try {
      if (languageAvailable && language !== savedLanguage) {
        unwrap(await languageRpcCall(
          DELIVERY_SYNC_SETTINGS_ENDPOINTS.setLanguage,
          { language },
        ));
        if (mounted.current) setSavedLanguage(language);
      }
      // Send the icons already trimmed: the Host normalizes them anyway, and
      // the echoed document then matches the field the reader is looking at.
      const settings = normalizeDeliverySyncSettings(unwrap(await rpcCall(
        DELIVERY_SYNC_SETTINGS_ENDPOINTS.set,
        {
          ...values,
          inputIcon: normalizeDeliverySyncIcon(values.inputIcon),
          modelIcon: normalizeDeliverySyncIcon(values.modelIcon),
        },
      )));
      if (!settings) throw new Error('会话同步设置返回了无法识别的响应。');
      if (!mounted.current) return;
      setValues(settings);
      setSaved(true);
    } catch (caught) {
      if (mounted.current) setError(caught.message || '无法读取或保存会话同步设置，请稍后重试。');
    } finally {
      busy.current = false;
      if (mounted.current) setPhase('ready');
    }
  };

  const disabled = phase !== 'ready';
  const iconHint = '最多 32 个字符；留空则不添加前缀。';
  const rows = [
    {
      key: 'mirrorUserInput',
      icon: 'inputIcon',
      title: '镜像 Web 中输入的消息',
      help: '在 Web GUI 中发送的消息会作为一条带前缀的消息转发到本聊天的会话同步目标。',
      iconLabel: '输入前缀图标',
    },
    {
      key: 'deliverModelAnswers',
      icon: 'modelIcon',
      title: '投递模型回答',
      help: '其他回合（Web 输入、定时提醒、子代理通知等）的模型回答会发送到会话同步目标。',
      iconLabel: '回答前缀图标',
    },
  ];

  const helpId = `${id}-help`;

  const head = h('div', { className: 'dim-globalHead' },
    h('div', { className: 'dim-globalHeadTitle' },
      h('h3', null, '会话同步'),
      h('div', { className: 'dim-globalTtlHelp' },
        h('button', {
          type: 'button',
          className: 'dim-channelHelpButton dim-globalTtlHelpButton',
          'aria-label': '查看会话同步说明',
          'aria-describedby': helpId,
        }, h('span', { 'aria-hidden': 'true' }, '?')),
        h('div', {
          id: helpId,
          className: 'dim-globalTtlTooltip dim-deliverySyncTooltip',
          role: 'tooltip',
        }, '只对已开启会话同步的目标生效：在 Web GUI 里输入的回合、定时提醒、子代理通知等“不是本聊天发起”的回合，其回答会转发到这些目标。消息语言同时影响机器人发送的命令菜单文本。'))));

  const languageField = h('div', { className: 'dim-deliverySyncField' },
    h('div', { className: 'dim-deliverySyncLabel' },
      h('label', { htmlFor: `${id}-language` }, '插件消息语言'),
      h('p', { className: 'dim-deliverySyncHelp', id: `${id}-language-help` },
        languageAvailable
          ? '默认跟随 DSH 界面语言；可以单独固定机器人消息的语言。'
          : '语言设置暂不可用。')),
    h('select', {
      id: `${id}-language`,
      className: 'dim-globalTtlInput dim-deliverySyncSelect',
      value: language,
      disabled: disabled || !languageAvailable,
      'aria-describedby': `${id}-language-help`,
      onChange: (event) => { setLanguage(event.target.value); setSaved(false); setError(null); },
    }, ...MESSAGE_LANGUAGE_OPTIONS.map((option) => h('option', {
      key: option.value,
      value: option.value,
    }, option.label))));

  const iconFields = rows.map((row) => h('div', { className: 'dim-deliverySyncField', key: row.key },
    h('div', { className: 'dim-deliverySyncLabel' },
      h('label', { className: 'dim-deliverySyncCheckLabel', htmlFor: `${id}-${row.key}` },
        h('input', {
          id: `${id}-${row.key}`,
          type: 'checkbox',
          checked: values[row.key] === true,
          disabled,
          'aria-describedby': `${id}-${row.key}-help`,
          onChange: (event) => edit({ [row.key]: event.target.checked }),
        }),
        h('span', null, row.title)),
      h('p', { className: 'dim-deliverySyncHelp', id: `${id}-${row.key}-help` }, row.help)),
    h('div', { className: 'dim-deliverySyncIcon' },
      h('input', {
        id: `${id}-${row.icon}`,
        className: 'dim-globalTtlInput dim-deliverySyncIconInput',
        type: 'text',
        value: values[row.icon],
        maxLength: 32,
        autoComplete: 'off',
        placeholder: '🔔',
        'aria-label': row.iconLabel,
        'aria-describedby': `${id}-${row.icon}-help`,
        disabled,
        onChange: (event) => edit({ [row.icon]: event.target.value }),
      }),
      h('p', { className: 'dim-deliverySyncHelp', id: `${id}-${row.icon}-help` }, iconHint))));

  const actions = h('div', { className: 'dim-imageSettingsActions' },
    h('button', {
      type: 'submit',
      className: 'dim-deliveryButton dim-globalSaveButton',
      'data-kind': 'primary',
      disabled,
    }, phase === 'saving' ? '保存中…' : '保存投递设置'),
    phase === 'error'
      ? h('button', {
        type: 'button',
        className: 'dim-deliveryButton dim-globalSaveButton',
        onClick: () => void load(),
      }, '重试')
      : null);

  return h('section', {
    className: 'dim-globalSection dim-deliverySyncSettings',
    'aria-label': '会话同步',
    'aria-busy': phase === 'loading' || phase === 'saving',
  },
  head,
  h('form', { onSubmit: save },
    h('div', { className: 'dim-deliverySyncFields' }, languageField, ...iconFields),
    actions),
  error
    ? h('p', {
      className: 'dim-globalInline dim-deliverySyncFeedback',
      'data-tone': 'error',
      role: 'alert',
    }, error)
    : null,
  saved ? h('p', { className: 'dim-globalInline dim-deliverySyncFeedback', role: 'status' }, '已保存') : null,
  phase === 'loading'
    ? h('p', { className: 'dim-globalInline dim-deliverySyncFeedback', role: 'status' }, '正在读取投递设置…')
    : null);
}
