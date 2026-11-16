import { ConnectionError } from './connection-error.js';
import * as React from 'react';

import { h, imLocale } from './i18n.js';

export const BotSettingsContext = React.createContext(Object.freeze({
  openBotSettings() {},
}));

export function SettingsGlyph() {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  },
  h('circle', { cx: 12, cy: 12, r: 3 }),
  h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.08V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z' }));
}

export function BotSettingsButton({
  channel,
  botId,
  botName,
  connected,
  accessPolicy,
  channelSettings,
}) {
  const { openBotSettings } = React.useContext(BotSettingsContext);
  return h('span', { className: 'dim-botSettingsAction' },
    h('button', {
      type: 'button',
      className: 'dim-botSettingsButton',
      'data-delivery-channel': channel,
      'aria-label': '更多机器人设置',
      onClick: () => openBotSettings?.({
        ...(channelSettings && typeof channelSettings === 'object' ? channelSettings : {}),
        channel,
        botId,
        botName,
        connected: Boolean(connected),
        accessPolicy,
      }),
    }, h(SettingsGlyph), h('span', null, '更多设置'),
    h('span', { className: 'dim-moreSettingsChevron', 'aria-hidden': 'true' })));
}

// Date formatting follows the interface language, not English-vs-not: a
// Russian reader is served ru-RU numerals and month names, not Chinese ones.
const INTL_LOCALES = Object.freeze({ zh: 'zh-CN', en: 'en-US', ru: 'ru-RU' });

function messageErrorTime(value) {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALES[imLocale()] ?? 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return null;
  }
}

export function ChannelListHeading({ className = '', id, title, connectionLabel }) {
  const helpId = React.useId();
  return h('div', { className: `${className} dim-listHeading`.trim() },
    h('div', { className: 'dim-listTitle' },
      h('h3', id ? { id } : null, title),
      h('span', { className: 'dim-channelHelp' },
        h('button', {
          type: 'button',
          className: 'dim-channelHelpButton',
          'aria-label': '查看消息通道说明',
          'aria-describedby': helpId,
        }, h('span', { 'aria-hidden': 'true' }, '?')),
        h('span', {
          id: helpId,
          className: 'dim-channelTooltip',
          role: 'tooltip',
        },
        h('span', null, '消息通道'),
        h('strong', null, connectionLabel)))));
}

export function BotStatusMeta({
  className = '',
  dotClassName = '',
  tone,
  stateLabel,
  lastCheckedAt,
  formatCheckedTime,
  healthState,
}) {
  return h('div', { className: 'dim-botHealthGroup' },
    h('div', {
      className: `${className} dim-botHealth`.trim(),
      ...(healthState ? { 'data-health': healthState } : {}),
    },
    h('span', {
      className: `${dotClassName} dim-healthDot`.trim(),
      'data-tone': tone,
    }),
    h('span', null, stateLabel)),
    h('div', { className: 'dim-lastChecked' },
      h('span', null, '最近检查'),
      h('span', null, formatCheckedTime(lastCheckedAt))));
}

export function LastMessageErrorSummary({ className = '', error }) {
  if (!error) return null;
  const occurredAt = messageErrorTime(error.at);
  return h('div', {
    className: `${className} dim-cardSummary`.trim(),
    role: 'status',
  },
  h('strong', null, '最近一条消息处理失败'),
  '：',
  h('span', null, error.message),
    error.details ? h(ConnectionError, { error, showMessage: false }) : null,
  '（',
  h('span', null, '错误码'),
  ` ${error.code} · `,
  h('span', null, '参考号'),
  ` ${error.referenceId}`,
  occurredAt ? h(React.Fragment, null,
    ' · ',
    h('time', { dateTime: new Date(error.at).toISOString() }, occurredAt)) : null,
  '）');
}
