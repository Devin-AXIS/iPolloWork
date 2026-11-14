import * as React from 'react';

import {
  DEFAULT_ACCESS_POLICY,
  normalizeAccessPolicy,
  validateAccessPolicy,
} from '../../src/channels/shared/access-policy.mjs';
import { h, localizeText } from './i18n.js';

export const ACCESS_POLICY_ENDPOINT = 'bot.access-policy.set';
const CONFIRMED_OWNER_CHANNELS = new Set(['weixin', 'feishu', 'qq', 'whatsapp', 'discord']);

export const ACCESS_CHANNEL_DEFINITIONS = Object.freeze({
  weixin: Object.freeze({
    directUserLabel: '微信用户 ID',
    directPlaceholder: '填写微信用户 ID',
    groupSupported: false,
  }),
  feishu: Object.freeze({
    directUserLabel: '飞书 Open ID',
    directPlaceholder: '填写使用者的 Open ID（ou_xxx），不是机器人 ID',
    groupUserLabel: '群成员 Open ID',
    groupPlaceholder: '填写使用者的 Open ID（ou_xxx），不是机器人 ID',
  }),
  dingtalk: Object.freeze({
    directUserLabel: '钉钉用户 ID',
    directPlaceholder: '填写 senderStaffId 或 senderId',
    groupUserLabel: '群成员用户 ID',
    groupPlaceholder: '填写 senderStaffId 或 senderId',
  }),
  wecom: Object.freeze({
    directUserLabel: '企业微信用户 ID',
    directPlaceholder: '填写 userid',
    groupUserLabel: '群成员用户 ID',
    groupPlaceholder: '填写 userid',
  }),
  wecomApp: Object.freeze({
    directUserLabel: '企业微信用户 ID',
    directPlaceholder: '填写 userid',
    groupUserLabel: '群成员用户 ID',
    groupPlaceholder: '填写 userid',
  }),
  qq: Object.freeze({
    directUserLabel: 'QQ User Open ID',
    directPlaceholder: '填写 user_openid',
    groupUserLabel: '群成员 Open ID',
    groupPlaceholder: '填写 member_openid',
  }),
  slack: Object.freeze({
    directUserLabel: 'Slack User ID',
    directPlaceholder: 'U0123456789',
    groupUserLabel: '群成员 User ID',
    groupPlaceholder: 'U0123456789',
  }),
  telegram: Object.freeze({
    directUserLabel: 'Telegram User ID',
    directPlaceholder: '填写数字 User ID',
    groupUserLabel: '群成员 User ID',
    groupPlaceholder: '填写数字 User ID',
  }),
  discord: Object.freeze({
    directUserLabel: 'Discord User ID',
    directPlaceholder: '填写数字 User ID',
    groupUserLabel: '群成员 User ID',
    groupPlaceholder: '填写数字 User ID',
  }),
  whatsapp: Object.freeze({
    directUserLabel: 'WhatsApp 电话号码或 JID',
    directPlaceholder: '8613800000000 或完整 JID',
    groupUserLabel: '群成员电话号码或 JID',
    groupPlaceholder: '8613800000000 或完整 JID',
  }),
  imessage: Object.freeze({
    directUserLabel: 'iMessage Chat GUID',
    directPlaceholder: 'iMessage;+;chat123',
    groupSupported: false,
  }),
});

function clonePolicy(policy) {
  const cloneScope = (scope) => ({
    mode: scope.mode,
    open: {
      defaultCanExecuteCommands: scope.open.defaultCanExecuteCommands,
      commandPermissionOverrides: scope.open.commandPermissionOverrides.map((user) => ({
        ...user,
      })),
    },
    allowlist: {
      users: scope.allowlist.users.map((user) => ({ ...user })),
    },
  });
  return {
    direct: cloneScope(policy.direct),
    group: cloneScope(policy.group),
  };
}

function unwrapRpcResult(result) {
  if (result?.ok === true) return result.value;
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '访问设置保存失败，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result;
}

function policyFromSnapshot(value, botId) {
  const source = value?.snapshot ?? value;
  const bot = Array.isArray(source?.bots)
    ? source.bots.find((entry) => entry?.botId === botId)
    : null;
  return normalizeAccessPolicy(bot?.accessPolicy ?? source?.accessPolicy ?? source?.policy);
}

function commandValue(value) {
  return value === 'allow';
}

function ScenePolicyEditor({
  scene,
  title,
  policy,
  userLabel,
  placeholder,
  disabled = false,
  unsupported = false,
  ownerHelp,
  identityHelp,
  onChange,
}) {
  const ownerHelpId = React.useId();
  const emptyAllowlistHelpId = React.useId();
  const allowlist = policy.mode === 'allowlist';
  const collectionKey = allowlist ? 'users' : 'commandPermissionOverrides';
  const branchKey = allowlist ? 'allowlist' : 'open';
  const users = policy[branchKey][collectionKey];
  const emptyAllowlist = allowlist && users.length === 0;
  const updateUsers = (nextUsers) => onChange({
    ...policy,
    [branchKey]: {
      ...policy[branchKey],
      [collectionKey]: nextUsers,
    },
  });
  const updateUser = (index, patch) => updateUsers(users.map((user, userIndex) => (
      userIndex === index ? { ...user, ...patch } : user
    )));

  return h('fieldset', {
    className: 'dim-accessScene',
    disabled,
    'data-scene': scene,
    'aria-label': localizeText(title),
  },
  h('legend', null,
    h('span', { className: 'dim-accessLegendContent' },
      h('span', null, title),
      h('span', { className: 'dim-channelHelp dim-accessLegendHelp' },
        h('button', {
          type: 'button',
          className: 'dim-channelHelpButton',
          'aria-label': [localizeText(title), localizeText('查看访问权限说明')].join(' '),
          'aria-describedby': ownerHelpId,
        }, h('span', { 'aria-hidden': true }, '?')),
        h('span', {
          id: ownerHelpId,
          className: 'dim-channelTooltip dim-accessHelpTooltip',
          role: 'tooltip',
        }, ownerHelp, identityHelp ? h('br') : null, identityHelp)))),
  unsupported
    ? h('div', { className: 'dim-accessUnsupported', role: 'note' },
        h('strong', null, '当前渠道不支持群聊'),
        h('p', null, '此区域无需配置，保存私聊设置时会保留现有群聊策略。'))
    : h(React.Fragment, null,
        h('div', { className: 'dim-accessControls', 'data-mode': policy.mode },
          h('label', { className: 'dim-accessField' },
            h('span', null, '访问模式'),
            h('select', {
              value: policy.mode,
              'aria-label': [localizeText(title), localizeText('访问模式')].join(' '),
              onChange: (event) => onChange({ ...policy, mode: event.target.value }),
            },
            h('option', { value: 'open' }, '允许所有用户'),
            h('option', { value: 'allowlist' }, '仅白名单用户'))),
          allowlist ? null : h('label', { className: 'dim-accessField' },
              h('span', null, '默认命令权限'),
              h('select', {
                value: policy.open.defaultCanExecuteCommands ? 'allow' : 'deny',
                'aria-label': [localizeText(title), localizeText('默认命令权限')].join(' '),
                onChange: (event) => onChange({
                  ...policy,
                  open: {
                    ...policy.open,
                    defaultCanExecuteCommands: commandValue(event.target.value),
                  },
                }),
              },
              h('option', { value: 'allow' }, '可以执行命令'),
              h('option', { value: 'deny' }, '不可以执行命令')))),
        h('div', { className: 'dim-accessUsers' },
          h('div', { className: 'dim-accessUsersHeading' },
            h('div', { className: 'dim-accessUsersTitle' },
              h('strong', null, allowlist ? '白名单用户' : '命令权限例外'),
              emptyAllowlist
                ? h('span', { className: 'dim-channelHelp dim-accessUsersHelp' },
                    h('button', {
                      type: 'button',
                      className: 'dim-channelHelpButton',
                      'aria-label': [localizeText(title), localizeText('查看白名单说明')].join(' '),
                      'aria-describedby': emptyAllowlistHelpId,
                    }, h('span', { 'aria-hidden': true }, '?')),
                    h('span', {
                      id: emptyAllowlistHelpId,
                      className: 'dim-channelTooltip dim-accessEmptyAllowlistTooltip',
                      role: 'tooltip',
                    }, '当前没有白名单用户，保存后普通用户将无法使用机器人。'))
                : null),
            h('button', {
              type: 'button',
              className: 'dim-deliveryButton dim-accessAddUser',
              'aria-label': [localizeText(title), localizeText('新增用户')].join(' '),
              title: localizeText('新增用户'),
              onClick: () => updateUsers([...users, {
                id: '',
                canExecuteCommands: allowlist
                  ? false
                  : !policy.open.defaultCanExecuteCommands,
              }]),
            }, h('span', { 'aria-hidden': true }, '+'))),
          users.length === 0
            ? h('div', { className: 'dim-accessUsersEmpty' }, '尚未添加用户')
            : h('ul', { className: 'dim-accessUserList' }, users.map((user, index) =>
                h('li', { key: `${scene}-${policy.mode}-${index}`, className: 'dim-accessUserRow' },
                  h('label', { className: 'dim-accessField dim-accessUserId' },
                    h('span', null, userLabel),
                    h('input', {
                      value: user.id,
                      maxLength: 256,
                      required: true,
                      autoCapitalize: 'none',
                      autoCorrect: 'off',
                      spellCheck: false,
                      placeholder,
                      'aria-label': [localizeText(title), localizeText(userLabel), index + 1].join(' '),
                      onChange: (event) => updateUser(index, { id: event.target.value }),
                    })),
                  h('label', { className: 'dim-accessField dim-accessUserCommand' },
                    h('span', null, '命令权限'),
                    h('select', {
                      value: user.canExecuteCommands ? 'allow' : 'deny',
                      'aria-label': [
                        localizeText(title), localizeText('用户'), index + 1,
                        localizeText('命令权限'),
                      ].join(' '),
                      onChange: (event) => updateUser(index, {
                        canExecuteCommands: commandValue(event.target.value),
                      }),
                    },
                    h('option', { value: 'allow' }, '可以执行命令'),
                    h('option', { value: 'deny' }, '不可以执行命令'))),
                  h('button', {
                    type: 'button',
                    className: 'dim-deliveryButton dim-accessDeleteUser',
                    'data-kind': 'danger',
                    'aria-label': [
                      localizeText(title), localizeText('删除'),
                      localizeText('用户'), index + 1,
                    ].join(' '),
                    onClick: () => updateUsers(users.filter((_, userIndex) => userIndex !== index)),
                  }, '删除')))))));
}

export function AccessPolicySettingsPage({ channel, account, rpcCall, onSaved }) {
  const definition = ACCESS_CHANNEL_DEFINITIONS[channel];
  const ownerHelp = CONFIRMED_OWNER_CHANNELS.has(channel)
    ? '已由接入流程确认的所有者可以访问并执行命令，不受本页限制。未识别到所有者身份时，按本页访问设置执行。'
    : '原所有者或扫码接入者始终可以访问并执行命令；以下设置仅约束其他用户。';
  const identityHelp = channel === 'feishu'
    ? '白名单请填写使用者的 Open ID，不是机器人的 Open ID。仅保存通配符的接入配置不包含所有者身份。'
    : null;
  const initialPolicy = normalizeAccessPolicy(account?.accessPolicy);
  const initialKey = JSON.stringify(initialPolicy);
  const [draft, setDraft] = React.useState(() => clonePolicy(
    initialPolicy ?? DEFAULT_ACCESS_POLICY,
  ));
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);

  React.useEffect(() => {
    const next = normalizeAccessPolicy(account?.accessPolicy);
    setDraft(clonePolicy(next ?? DEFAULT_ACCESS_POLICY));
  }, [account?.botId, initialKey]);

  React.useEffect(() => {
    setFeedback(null);
  }, [account?.botId]);

  if (!definition) {
    return h('div', { className: 'dim-accessState', role: 'alert' },
      '当前渠道暂不支持访问设置。');
  }

  const save = async (event) => {
    event.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      const policy = validateAccessPolicy(draft);
      if (typeof rpcCall !== 'function') throw new Error('访问设置暂不可用。');
      const value = unwrapRpcResult(await rpcCall(ACCESS_POLICY_ENDPOINT, {
        botId: account.botId,
        policy,
      }));
      const saved = policyFromSnapshot(value, account.botId);
      if (!saved) throw new Error('服务没有返回已保存的访问策略，请刷新后重试。');
      setDraft(clonePolicy(saved));
      onSaved?.(saved);
      setFeedback({ tone: 'success', message: '访问设置已保存。' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error?.message || '访问设置保存失败，请稍后重试。',
      });
    } finally {
      setSaving(false);
    }
  };

  return h('form', {
    className: 'dim-accessPage',
    onSubmit: (event) => void save(event),
  },
  initialPolicy
    ? null
    : h('div', { className: 'dim-accessState', role: 'alert' },
        '访问策略尚未就绪，请返回机器人列表刷新后重试。'),
  h(ScenePolicyEditor, {
    scene: 'direct',
    title: '私聊',
    policy: draft.direct,
    userLabel: definition.directUserLabel,
    placeholder: definition.directPlaceholder,
    ownerHelp,
    identityHelp,
    disabled: saving,
    onChange: (direct) => { setDraft((current) => ({ ...current, direct })); setFeedback(null); },
  }),
  h(ScenePolicyEditor, {
    scene: 'group',
    title: '群聊',
    policy: draft.group,
    userLabel: definition.groupUserLabel ?? definition.directUserLabel,
    placeholder: definition.groupPlaceholder ?? definition.directPlaceholder,
    ownerHelp,
    identityHelp: channel === 'qq'
      ? '扫码获得的是私聊身份，群聊只有匹配已确认的所有者身份时才豁免；其他成员按群聊白名单设置执行。'
      : identityHelp,
    disabled: saving || definition.groupSupported === false,
    unsupported: definition.groupSupported === false,
    onChange: (group) => { setDraft((current) => ({ ...current, group })); setFeedback(null); },
  }),
  feedback ? h('p', {
    className: 'dim-accessFeedback',
    'data-tone': feedback.tone,
    role: feedback.tone === 'error' ? 'alert' : 'status',
    'aria-live': 'polite',
  }, feedback.message) : null,
  h('div', { className: 'dim-accessActions' },
    h('button', {
      type: 'submit',
      className: 'dim-deliveryButton',
      'data-kind': 'primary',
      disabled: saving || !initialPolicy,
    }, saving ? '正在保存…' : '保存访问设置')));
}
