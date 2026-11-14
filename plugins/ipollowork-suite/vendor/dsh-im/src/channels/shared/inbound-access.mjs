import { evaluateAccessPolicy } from './access-policy.mjs';
import { isSharedLocalCommand } from './command-permission.mjs';

export const COMMAND_PERMISSION_DENIED_MESSAGE = '你可以发送普通消息，但没有执行命令的权限。请联系管理员在 DSH 设置 → IM机器人 → 对应机器人 → 访问设置中，为你开启当前私聊或群聊场景的命令权限后重试。';

const POLICY_NOT_CONFIGURED = Object.freeze({ allowed: true, reason: 'policy-not-configured' });
const PRIVILEGED_SENDER = Object.freeze({ allowed: true, reason: 'privileged-sender' });

/**
 * Read one committed policy snapshot and decide a single inbound event.
 * A missing provider is kept backward-compatible for direct bridge fixtures;
 * production always injects a provider, whose missing/damaged value fails closed.
 */
export function evaluateInboundAccess(accessPolicy, {
  conversationType,
  senderIds,
  text = '',
  hasImages = false,
  hasFiles = false,
  isCommand = isSharedLocalCommand(text, { hasImages, hasFiles }),
} = {}) {
  if (!accessPolicy) return POLICY_NOT_CONFIGURED;
  try {
    if (typeof accessPolicy.isPrivileged === 'function'
      && accessPolicy.isPrivileged(senderIds, conversationType) === true) {
      return PRIVILEGED_SENDER;
    }
  } catch {
    // A broken privilege lookup must not bypass the persisted policy.
  }
  let policy = null;
  try {
    policy = accessPolicy.getSettings();
  } catch {
    // Provider failures are equivalent to an unavailable persisted policy.
  }
  return evaluateAccessPolicy(policy, {
    conversationType,
    senderIds,
    isCommand,
    ...(typeof accessPolicy.equals === 'function' ? { equals: accessPolicy.equals } : {}),
  });
}
