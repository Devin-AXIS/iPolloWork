import { ConnectionError } from '../../connection-error.js';
import * as React from 'react';
import { IMessageLogoGlyph } from '../../channel-logos.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import { IMESSAGE_ENDPOINTS, imessageClientApi } from './api.js';
import { installIMessageStyles } from './styles.js';
import { h } from '../../i18n.js';

function PermissionPanel({ permissions, busy, error, onSubmit, onCancel }) {
  const databaseReady = permissions?.database === 'granted';
  const automationReady = permissions?.automation === 'granted';
  return h('section', { className: 'ddt-card dim-surfaceCard dim-imessagePermissionPanel' },
    h('h3', null, '启用 macOS 原生 iMessage'),
    h('p', null, '支持同账号自聊：在 iPhone 或 Mac 上给自己已登录的 iMessage 邮箱或号码发指令。AI 回复以 🤖 DSH 开头，不会再次触发机器人。'),
    h('p', null, 'DeepSeek Harness 通过 macOS Messages.app 收发文本消息。首次使用需要授予以下权限：'),
    h('ol', { className: 'dim-imessagePermissionSteps' },
      h('li', null,
        h('strong', null, databaseReady ? '✓ 完全磁盘访问权限已授予' : '1. 授予完全磁盘访问权限'),
        databaseReady ? null : h('p', null, '在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”中，打开运行 DeepSeek Harness 的终端或应用。'),
        databaseReady ? null : h('a', { href: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles' }, '打开完全磁盘访问权限设置')),
      h('li', null,
        h('strong', null, automationReady ? '✓ Messages 自动化权限已授予' : '2. 允许自动化控制 Messages'),
        automationReady ? null : h('p', null, '在“系统设置 → 隐私与安全性 → 自动化”中，允许运行 DeepSeek Harness 的应用控制 Messages。'),
        automationReady ? null : h('a', { href: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation' }, '打开自动化设置'))),
    error ? h(ConnectionError, { error: error }) : null,
    h('div', { className: 'ddt-actions dim-viewActions' },
      h('button', { type: 'button', className: 'ddt-button', onClick: onCancel, disabled: busy }, '取消'),
      h('button', { type: 'button', className: 'ddt-button', 'data-kind': 'primary', onClick: () => onSubmit({}), disabled: busy },
        busy ? '正在检查…' : '检查权限并启用')));
}

const channel = createTokenChannelSettings({
  channel: 'iMessage', endpoints: IMESSAGE_ENDPOINTS, api: imessageClientApi,
  LogoGlyph: IMessageLogoGlyph, installStyles: installIMessageStyles,
  pageClass: 'dim-pageIMessage', avatarClass: 'dim-avatarIMessage',
  connectionLabel: ' macOS Messages 连接',
  tokenPlaceholder: '', emptyTitle: '接入 macOS 原生 iMessage',
  emptyDescription: '无需安装第三方服务；请按指引授予 macOS Messages 访问权限。',
  platformLabel: 'macOS Messages', credentialPayload: () => ({}),
  CredentialPanel: PermissionPanel,
  credentialAriaLabel: '配置 macOS Messages 权限', credentialOpenLabel: '配置本机权限',
  credentialNoun: 'macOS Messages 权限', emptyActionLabel: '配置本机权限',
});

export const IMessageSettingsTab = channel.SettingsTab;
export const IMessageAccountCard = channel.AccountCard;
