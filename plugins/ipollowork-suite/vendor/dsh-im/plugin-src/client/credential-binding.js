import * as React from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { channelName, h, localizeTemplate } from './i18n.js';

function ActionIcon({ children }) {
  return h('svg', {
    className: 'dim-actionIcon',
    width: 15,
    height: 15,
    viewBox: '0 0 20 20',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
    focusable: 'false',
  }, children);
}

export function QrActionIcon() {
  return h(ActionIcon, null,
    h('path', {
      d: 'M2.5 2.5h5v5h-5v-5Zm10 0h5v5h-5v-5Zm-10 10h5v5h-5v-5Z',
      stroke: 'currentColor', strokeWidth: '1.6', strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M11.5 11.5h2v2h-2v-2Zm4 0h2v3h-2v-3Zm-4 4h3v2h-3v-2Zm5 1h1v1h-1v-1Z',
      fill: 'currentColor',
    }));
}

export function CredentialActionIcon() {
  return h(ActionIcon, null,
    h('circle', {
      cx: '6.25', cy: '10', r: '3.5', stroke: 'currentColor', strokeWidth: '1.6',
    }),
    h('path', {
      d: 'M9.75 10h7.75m-2.5 0v2m-2.5-2v2',
      stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round', strokeLinejoin: 'round',
    }));
}

export function CredentialModal({ channel, busy, onCancel, children }) {
  return h(Modal, {
    open: true,
    title: localizeTemplate('手动接入{channel}机器人', { channel: channelName(channel) }),
    closeLabel: localizeTemplate('关闭'),
    className: 'dim-credentialModal',
    onClose: () => { if (!busy) onCancel?.(); },
  }, children);
}

export function CredentialBindingPanel({
  channel,
  identityLabel,
  identityPlaceholder,
  secretLabel,
  secretPlaceholder,
  busy = false,
  error = null,
  onSubmit,
  onCancel,
  children,
}) {
  const [identity, setIdentity] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const hasIdentity = Boolean(identityLabel);

  const submit = (event) => {
    event.preventDefault();
    const normalizedIdentity = identity.trim();
    const normalizedSecret = secret.trim();
    if ((hasIdentity && !normalizedIdentity) || !normalizedSecret || busy) return;
    void onSubmit?.({ identity: normalizedIdentity, secret: normalizedSecret });
  };

  return h(CredentialModal, { channel, busy, onCancel },
  children,
  h('form', {
    className: `dim-credentialForm${hasIdentity ? '' : ' dim-credentialFormSingle'}`,
    onSubmit: submit,
  },
    hasIdentity ? h('label', { className: 'dim-credentialField' },
      h('span', null, identityLabel),
      h('input', {
        value: identity,
        onChange: (event) => setIdentity(event.target.value),
        placeholder: identityPlaceholder,
        maxLength: 512,
        autoCapitalize: 'none',
        autoCorrect: 'off',
        spellCheck: false,
        autoComplete: 'off',
        disabled: busy,
        required: true,
      })) : null,
    h('label', { className: 'dim-credentialField' },
      h('span', null, secretLabel),
      h('input', {
        type: 'password',
        value: secret,
        onChange: (event) => setSecret(event.target.value),
        placeholder: secretPlaceholder,
        maxLength: 1024,
        autoCapitalize: 'none',
        autoCorrect: 'off',
        spellCheck: false,
        autoComplete: 'new-password',
        disabled: busy,
        required: true,
      })),
    error ? h('p', { className: 'dim-credentialError', role: 'alert' }, error.message ?? String(error)) : null,
    h('div', { className: 'ddt-actions dim-viewActions dim-credentialActions' },
      h('button', {
        type: 'submit',
        className: 'ddt-button',
        'data-kind': 'primary',
        disabled: busy || (hasIdentity && !identity.trim()) || !secret.trim(),
      }, busy ? '正在绑定…' : '绑定并连接'),
      h('button', {
        type: 'button',
        className: 'ddt-button',
        onClick: onCancel,
        disabled: busy,
      }, '取消'))));
}
