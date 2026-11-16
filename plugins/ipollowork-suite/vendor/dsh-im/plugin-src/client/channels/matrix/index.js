import * as React from 'react';

import { MatrixLogoGlyph } from '../../channel-logos.js';
import { h } from '../../i18n.js';
import { createTokenChannelSettings } from '../shared/token-channel.js';
import { MATRIX_ENDPOINTS, matrixClientApi } from './api.js';
import { installMatrixStyles } from './styles.js';

const MATRIX_USER_ID_PATTERN = /^@[^:@\s]+:[^:@\s]+(?::\d{1,5})?$/u;

function validHomeserver(value) {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function MatrixCredentialPanel({ busy, error, onSubmit, onCancel }) {
  const [homeserver, setHomeserver] = React.useState('');
  const [accessToken, setAccessToken] = React.useState('');
  const [userId, setUserId] = React.useState('');
  const [password, setPassword] = React.useState('');
  const headingId = React.useId();

  const normalizedHomeserver = homeserver.trim();
  const normalizedUserId = userId.trim();
  const tokenMode = Boolean(accessToken.trim());
  const loginMode = Boolean(normalizedUserId) && Boolean(password);
  const canSubmit = validHomeserver(normalizedHomeserver)
    && (tokenMode
      ? (!normalizedUserId && !password && accessToken.trim().length >= 8)
      : (!accessToken.trim() && MATRIX_USER_ID_PATTERN.test(normalizedUserId) && password.length >= 1));

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    void onSubmit?.(tokenMode
      ? { homeserver: normalizedHomeserver, accessToken: accessToken.trim() }
      : {
        homeserver: normalizedHomeserver,
        userId: normalizedUserId,
        password,
      });
  };

  return h('section', {
    className: 'ddt-card dim-surfaceCard dim-credentialPanel dmt-setup',
    'aria-labelledby': headingId,
  },
  h('h3', { id: headingId, className: 'dim-credentialTitle' }, '接入 Matrix 机器人'),
  h('div', { className: 'dmt-guide' },
    h('div', { className: 'dmt-guideCopy' },
      h('strong', null, '连接你的 Matrix homeserver'),
      h('p', null, '填写 homeserver 地址，并提供访问令牌，或者用户 ID 与密码的组合。机器人只访问该 homeserver，不连接第三方服务器。'))),
  h('form', { className: 'dim-credentialForm dim-credentialFormSingle', onSubmit: submit },
    h('div', { className: 'dmt-fields' },
      h('label', { className: 'dim-credentialField dmt-fieldWide' },
        h('span', null, 'Homeserver 地址'),
        h('input', {
          type: 'url',
          value: homeserver,
          onChange: (event) => setHomeserver(event.target.value),
          placeholder: 'https://matrix.example.org',
          maxLength: 2048,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          disabled: busy,
          required: true,
        })),
      h('label', { className: 'dim-credentialField dmt-fieldWide' },
        h('span', null, '访问令牌（与用户 ID、密码二选一）'),
        h('input', {
          type: 'password',
          value: accessToken,
          onChange: (event) => setAccessToken(event.target.value),
          placeholder: 'syt_…',
          maxLength: 4096,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          autoComplete: 'new-password',
          disabled: busy,
        })),
      h('label', { className: 'dim-credentialField' },
        h('span', null, '用户 ID（可选）'),
        h('input', {
          type: 'text',
          value: userId,
          onChange: (event) => setUserId(event.target.value),
          placeholder: '@bot:example.org',
          maxLength: 512,
          autoCapitalize: 'none',
          autoCorrect: 'off',
          spellCheck: false,
          disabled: busy,
        })),
      h('label', { className: 'dim-credentialField' },
        h('span', null, '密码（可选）'),
        h('input', {
          type: 'password',
          value: password,
          onChange: (event) => setPassword(event.target.value),
          maxLength: 1024,
          autoComplete: 'new-password',
          disabled: busy,
        })),
      h('p', { className: 'dmt-tokenHint' }, '访问令牌来自 Element 设置 → 帮助 → 编辑设置，或 homeserver 的登录接口；用户 ID 与密码方式会为本安装派生稳定设备会话。')),
    error ? h('p', { className: 'dim-credentialError', role: 'alert' }, error.message ?? String(error)) : null,
    h('div', { className: 'ddt-actions dim-viewActions dim-credentialActions' },
      h('button', {
        type: 'submit',
        className: 'ddt-button',
        'data-kind': 'primary',
        disabled: busy || !canSubmit,
      }, busy ? '正在验证并连接…' : '验证并连接'),
      h('button', {
        type: 'button',
        className: 'ddt-button',
        onClick: onCancel,
        disabled: busy,
      }, '取消'))));
}

const channel = createTokenChannelSettings({
  channel: 'Matrix',
  endpoints: MATRIX_ENDPOINTS,
  api: matrixClientApi,
  LogoGlyph: MatrixLogoGlyph,
  installStyles: installMatrixStyles,
  pageClass: 'dmt-page',
  avatarClass: 'dmt-avatar',
  connectionLabel: 'CS API 长轮询',
  emptyTitle: '接入 Matrix 机器人',
  emptyDescription: '填写 homeserver 地址与访问令牌，或者用户 ID 与密码，即可让机器人以 CS API 长轮询接收消息并以富文本回复。',
  platformLabel: 'Matrix homeserver',
  CredentialPanel: MatrixCredentialPanel,
  credentialPayload: ({ homeserver, accessToken, userId, password }) => ({ homeserver, accessToken, userId, password }),
  credentialAriaLabel: '使用 homeserver 与凭据接入 Matrix 机器人',
  credentialOpenLabel: '接入机器人',
  credentialCloseLabel: '收起接入',
  credentialNoun: '访问令牌或用户 ID 与密码',
  emptyActionLabel: '开始接入',
});

export const MatrixSettingsTab = channel.SettingsTab;
export const MatrixAccountCard = channel.AccountCard;
