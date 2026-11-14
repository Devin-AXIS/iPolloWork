import {
  createAccessPolicy,
  createAccessPolicyScope,
} from '../../../../src/channels/shared/access-policy.mjs';

function policyUsers(users) {
  return users.map((id) => ({ id, canExecuteCommands: true }));
}

function openScope(allowlistUsers = []) {
  return createAccessPolicyScope({
    mode: 'open',
    open: {
      defaultCanExecuteCommands: true,
      commandPermissionOverrides: [],
    },
    allowlist: { users: policyUsers(allowlistUsers) },
  });
}

function allowlistScope(users = []) {
  return createAccessPolicyScope({
    mode: 'allowlist',
    open: {
      defaultCanExecuteCommands: false,
      commandPermissionOverrides: [],
    },
    allowlist: { users: policyUsers(users) },
  });
}

function cleanIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .filter((value) => typeof value === 'string' || typeof value === 'number'
      || typeof value === 'bigint')
    .map((value) => String(value).trim())
    .filter(Boolean))];
}

function whatsappNumberJids(values) {
  return cleanIds(values).map((value) => `${value.replace(/^\+/, '')}@s.whatsapp.net`);
}

/**
 * Build the one-time, backwards-compatible seed for a bot whose workspace
 * document does not yet contain an access policy.
 */
export function initialAccessPolicyFor(channel, config = {}) {
  const key = String(channel ?? '').trim().toLowerCase();
  if (key === 'weixin') {
    return createAccessPolicy({
      direct: allowlistScope(),
      group: allowlistScope(),
    });
  }
  if (key === 'feishu') {
    const owners = cleanIds(config.ownerOpenIds ?? config.ownerOpenId);
    const scope = owners.includes('*') ? openScope() : allowlistScope();
    return createAccessPolicy({ direct: scope, group: scope });
  }
  if (key === 'qq') {
    const owners = cleanIds(config.ownerUserOpenid);
    return createAccessPolicy({
      direct: owners.includes('*') ? openScope() : allowlistScope(),
      group: openScope(),
    });
  }
  if (key === 'telegram') {
    const users = cleanIds(config.allowedUsers);
    if ((config.accessMode ?? 'compatible') === 'private-allowlist') {
      return createAccessPolicy({
        direct: allowlistScope(users),
        group: allowlistScope(),
      });
    }
    return createAccessPolicy({
      direct: openScope(users),
      group: openScope(),
    });
  }
  if (key === 'whatsapp') {
    const mode = config.accessMode ?? 'self-only';
    const allowed = whatsappNumberJids(config.allowedNumbers);
    if (mode === 'open') {
      return createAccessPolicy({ direct: openScope(allowed), group: openScope() });
    }
    return createAccessPolicy({
      direct: allowlistScope(mode === 'private-allowlist'
        ? allowed
        : []),
      group: allowlistScope(),
    });
  }
  if (['dingtalk', 'wecom', 'wecom-app', 'slack', 'discord', 'imessage', 'matrix'].includes(key)) {
    return createAccessPolicy({ direct: openScope(), group: openScope() });
  }
  throw new TypeError(`Unsupported access-policy channel: ${channel}`);
}

/**
 * Seed newly connected bots after startup has migrated existing bots with
 * initialAccessPolicyFor(). Open Feishu/QQ messages and commands in both chat
 * types; workspace ensure() preserves any policy already saved.
 */
export function newBotAccessPolicyFor(channel, config = {}) {
  const key = String(channel ?? '').trim().toLowerCase();
  if (key === 'feishu' || key === 'qq') {
    return createAccessPolicy({ direct: openScope(), group: openScope() });
  }
  return initialAccessPolicyFor(channel, config);
}

export function privilegedSenderIdsFor(channel, config = {}) {
  const key = String(channel ?? '').trim().toLowerCase();
  if (key === 'weixin') return cleanIds(config.ownerUserId);
  if (key === 'feishu') {
    return cleanIds(config.ownerOpenIds ?? config.ownerOpenId).filter((id) => id !== '*');
  }
  if (key === 'dingtalk') {
    const approved = Array.isArray(config.approvedSenders) ? config.approvedSenders : [];
    return cleanIds(approved.map((entry) => entry?.staffId));
  }
  if (key === 'qq') return cleanIds(config.ownerUserOpenid).filter((id) => id !== '*');
  if (key === 'whatsapp') return cleanIds(config.accountJid);
  if (key === 'discord') return cleanIds(config.ownerUserId);
  return [];
}

export function accessPolicyProvider(workspaces, botId, { channel, config, equals } = {}) {
  if (!workspaces || typeof workspaces.accessPolicyFor !== 'function') {
    throw new TypeError('A workspace store with access policies is required');
  }
  const privilegedSenderIds = new Set(privilegedSenderIdsFor(channel, config));
  const sameSender = typeof equals === 'function' ? equals : (left, right) => left === right;
  return Object.freeze({
    botId,
    getSettings: () => workspaces.accessPolicyFor(botId),
    isPrivileged(senderIds, conversationType) {
      if (!['direct', 'group'].includes(conversationType)) return false;
      const candidates = Array.isArray(senderIds) ? senderIds : [senderIds];
      try {
        return candidates.some((senderId) => typeof senderId === 'string'
          && [...privilegedSenderIds].some((privilegedId) => (
            sameSender(senderId.trim(), privilegedId) === true
          )));
      } catch {
        return false;
      }
    },
  });
}
