import { ConnectionError } from '../../connection-error.js';
import * as React from 'react';

import { SlackLogoGlyph } from '../../channel-logos.js';
import { h } from '../../i18n.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import {
  SLACK_CREATE_APP_URL,
  SLACK_APP_MANIFEST_YAML,
} from '../../../../src/channels/slack/manifest.mjs';
import { SLACK_ENDPOINTS, slackClientApi } from './api.js';
import { installSlackStyles } from './styles.js';

export function SlackCredentialPanel({ busy, error, onSubmit, onCancel }) {
  const [botToken, setBotToken] = React.useState('');
  const [appToken, setAppToken] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const headingId = React.useId();

  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(SLACK_APP_MANIFEST_YAML);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    const normalizedBotToken = botToken.trim();
    const normalizedAppToken = appToken.trim();
    if (!normalizedBotToken || !normalizedAppToken || busy) return;
    void onSubmit?.({ botToken: normalizedBotToken, appToken: normalizedAppToken });
  };

  return h('section', {
    className: 'ddt-card dim-surfaceCard dim-credentialPanel dsl-setup',
    'aria-labelledby': headingId,
  },
  h('h3', { id: headingId, className: 'dim-credentialTitle' }, '接入 Slack 机器人'),
  h('div', { className: 'dsl-guide' },
    h('div', { className: 'dsl-guideCopy' },
      h('strong', null, '先用 Manifest 创建并配置 Slack App'),
      h('p', null, '复制配置后，在 Slack 选择 From a manifest；创建完成后生成 connections:write App Token，并将应用安装到工作区。')),
    h('div', { className: 'dsl-guideActions' },
      h('button', {
        type: 'button',
        className: 'ddt-button',
        onClick: () => void copyManifest(),
        disabled: busy,
      }, copied ? h('span', { className: 'dsl-copyState' }, '已复制 Manifest') : '复制 Manifest'),
      h('a', {
        className: 'ddt-button',
        href: SLACK_CREATE_APP_URL,
        target: '_blank',
        rel: 'noreferrer',
      }, '打开 Slack 创建页'))),
  h('form', { className: 'dim-credentialForm dim-credentialFormSingle', onSubmit: submit },
    h('div', { className: 'dsl-fields' },
      h('label', { className: 'dim-credentialField' },
        h('span', null, 'Bot Token'),
        h('input', {
          type: 'password',
          value: botToken,
          onChange: (event) => setBotToken(event.target.value),
          placeholder: 'xoxb-…',
          maxLength: 4096,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          autoComplete: 'new-password',
          disabled: busy,
          required: true,
        })),
      h('label', { className: 'dim-credentialField' },
        h('span', null, 'App Token'),
        h('input', {
          type: 'password',
          value: appToken,
          onChange: (event) => setAppToken(event.target.value),
          placeholder: 'xapp-…',
          maxLength: 4096,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          autoComplete: 'new-password',
          disabled: busy,
          required: true,
        })),
      h('p', { className: 'dsl-tokenHint' }, 'Bot Token 来自 OAuth & Permissions；App Token 来自 Basic Information，并且必须包含 connections:write。')),
    error ? h(ConnectionError, { error: error }) : null,
    h('div', { className: 'ddt-actions dim-viewActions dim-credentialActions' },
      h('button', {
        type: 'submit',
        className: 'ddt-button',
        'data-kind': 'primary',
        disabled: busy || !botToken.trim() || !appToken.trim(),
      }, busy ? '正在验证并连接…' : '验证并连接'),
      h('button', {
        type: 'button',
        className: 'ddt-button',
        onClick: onCancel,
        disabled: busy,
      }, '取消'))));
}

const channel = createTokenChannelSettings({
  channel: 'Slack',
  endpoints: SLACK_ENDPOINTS,
  api: slackClientApi,
  LogoGlyph: SlackLogoGlyph,
  installStyles: installSlackStyles,
  pageClass: 'dsl-page',
  avatarClass: 'dsl-avatar',
  connectionLabel: 'Socket Mode 长连接',
  emptyTitle: '接入 Slack 机器人',
  emptyDescription: '使用官方 App Manifest 快速配置机器人，再填写 Bot Token 与 App Token 建立本地 Socket Mode 连接。',
  platformLabel: 'Slack 工作区',
  CredentialPanel: SlackCredentialPanel,
  credentialPayload: ({ botToken, appToken }) => ({ botToken, appToken }),
  credentialAriaLabel: '使用 Manifest 和双 Token 接入 Slack 机器人',
  credentialOpenLabel: '接入机器人',
  credentialCloseLabel: '收起接入',
  credentialNoun: 'Bot Token 与 App Token',
  emptyActionLabel: '开始接入',
});

export const SlackSettingsTab = channel.SettingsTab;
export const SlackAccountCard = channel.AccountCard;
