import * as React from 'react';
import { h } from './i18n.js';
import { SET_MESSAGE_MODE_ENDPOINT, normalizeBusyMessageMode } from '../../src/channels/shared/message-mode.mjs';
import { normalizeFeishuStepCardPanels } from '../../src/channels/feishu/step-push-mode.mjs';
import { FEISHU_ENDPOINTS } from './channels/feishu/api.js';

function settingsFromResult(result, botId) {
  if (result?.ok !== true) throw new Error(result?.error?.message || '无法读取通用设置，请稍后重试。');
  const bot = result.value?.bots?.find((entry) => entry.botId === botId);
  if (!bot) throw new Error('找不到要修改的机器人。');
  return {
    busyMessageMode: normalizeBusyMessageMode(bot.busyMessageMode),
    stepCardPanels: normalizeFeishuStepCardPanels(bot.stepCardPanels),
  };
}

export function BotGeneralSettingsPage({ channel, account, rpcCall }) {
  const modeId = React.useId();
  const [settings, setSettings] = React.useState(() => ({
    busyMessageMode: 'queue', stepCardPanels: normalizeFeishuStepCardPanels(),
  }));
  const [savedSettings, setSavedSettings] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const mounted = React.useRef(false);
  const inFlight = React.useRef(false);
  const mode = settings.busyMessageMode;

  const load = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const value = settingsFromResult(await rpcCall('connection.status', {}), account.botId);
      if (!mounted.current) return;
      setSettings(value);
      setSavedSettings(value);
    } catch (error) {
      if (mounted.current) setFeedback(error.message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [account.botId, rpcCall]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const save = async (field, value) => {
    if (inFlight.current || savedSettings === null || value === savedSettings[field]) return;
    inFlight.current = true;
    setSettings({ ...settings, [field]: value });
    setBusy(true);
    setFeedback(null);
    try {
      const endpoint = field === 'stepCardPanels' ? FEISHU_ENDPOINTS.setStepCardPanels : SET_MESSAGE_MODE_ENDPOINT;
      const saved = settingsFromResult(await rpcCall(endpoint, {
        botId: account.botId, [field]: value,
      }), account.botId);
      if (!mounted.current) return;
      setSettings(saved);
      setSavedSettings(saved);
    } catch (error) {
      if (mounted.current) {
        setSettings(savedSettings);
        setFeedback(error.message);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return h('section', { className: 'dim-botGeneralSettings', 'aria-label': '机器人通用设置', 'aria-busy': busy },
    h('div', { className: 'dim-botGeneralList' },
      h('div', { className: 'dim-botGeneralRow' },
        h('div', { className: 'dim-botGeneralText' },
          h('label', { className: 'dim-botGeneralTitle', htmlFor: modeId }, '消息处理方式'),
          h('p', { className: 'dim-botGeneralHelp', id: `${modeId}-description` }, mode === 'queue'
            ? '当前任务结束后处理新消息'
            : '将新消息补充到当前任务')),
        h('div', { className: 'dim-botGeneralControl' },
          h('select', {
            id: modeId, value: mode, disabled: busy || savedSettings === null,
            'aria-label': '消息处理方式',
            'aria-describedby': `${modeId}-description`,
            onChange: (event) => void save('busyMessageMode', event.target.value),
          },
          h('option', { value: 'queue' }, '排队'),
          h('option', { value: 'steer' }, '插话')),
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
            h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
      channel === 'feishu' ? [
        ['thinkingExpanded', '展开思考过程'],
        ['toolsExpanded', '展开工具摘要'],
      ].map(([field, label]) => h('div', { key: field, className: 'dim-botGeneralRow dim-botGeneralPanelRow' },
        h('label', { className: 'dim-botGeneralTitle', htmlFor: `${modeId}-${field}` }, label),
        h('div', { className: 'dim-botGeneralControl' },
          h('input', {
            id: `${modeId}-${field}`, type: 'checkbox', role: 'switch', className: 'dim-contextSwitch',
            checked: settings.stepCardPanels[field], disabled: busy || savedSettings === null,
            'aria-label': label, 'aria-describedby': `${modeId}-panels-description`,
            onChange: (event) => void save('stepCardPanels', {
              ...settings.stepCardPanels, [field]: event.target.checked,
            }),
          })))) : null),
    channel === 'feishu' ? h('p', { className: 'dim-botGeneralHelp dim-botGeneralPanelHelp', id: `${modeId}-panels-description` },
      '仅对实时过程卡生效，任务结束后自动收起。') : null,
    feedback ? h('p', {
      className: 'dim-accessFeedback', 'data-tone': 'error', role: 'alert',
    }, feedback) : null,
    savedSettings === null && !busy ? h('div', { className: 'dim-botGeneralActions' },
      h('button', {
        type: 'button', className: 'dim-deliveryButton', onClick: () => void load(),
      }, '重新读取')) : null);
}
