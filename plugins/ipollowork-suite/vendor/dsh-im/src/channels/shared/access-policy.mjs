// Shared by the Host and settings UI; keep this module browser-compatible.
export const ACCESS_POLICY_MODES = Object.freeze(['open', 'allowlist']);
export const ACCESS_POLICY_CONVERSATION_TYPES = Object.freeze(['direct', 'group']);
export const ACCESS_POLICY_USER_ID_MAX_LENGTH = 256;

const POLICY_KEYS = ['direct', 'group'];
const SCOPE_KEYS = ['mode', 'open', 'allowlist'];
const OPEN_KEYS = ['defaultCanExecuteCommands', 'commandPermissionOverrides'];
const ALLOWLIST_KEYS = ['users'];
const USER_KEYS = ['id', 'canExecuteCommands'];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

function invalidAccessPolicy(message) {
  const error = new TypeError(message);
  error.code = 'access-policy-invalid';
  return error;
}

function hasExactKeys(input, keys) {
  return input && typeof input === 'object' && !Array.isArray(input)
    && [Object.prototype, null].includes(Object.getPrototypeOf(input))
    && Reflect.ownKeys(input).length === keys.length
    && keys.every((key) => Object.hasOwn(input, key));
}

/** Normalize one opaque channel identity without interpreting its contents. */
export function normalizeAccessPolicyUserId(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidAccessPolicy('用户标识无效。');
    value = String(value);
  } else if (typeof value === 'bigint') {
    value = String(value);
  }
  if (typeof value !== 'string') throw invalidAccessPolicy('用户标识必须是字符串。');
  const id = value.trim();
  if (!id || id.length > ACCESS_POLICY_USER_ID_MAX_LENGTH || CONTROL_CHARACTERS.test(id)) {
    throw invalidAccessPolicy(`用户标识不能为空、包含控制字符或超过 ${ACCESS_POLICY_USER_ID_MAX_LENGTH} 个字符。`);
  }
  return id;
}

function validateAccessPolicyUser(input) {
  if (!hasExactKeys(input, USER_KEYS)) {
    throw invalidAccessPolicy('用户条目必须包含用户标识和命令权限。');
  }
  if (typeof input.canExecuteCommands !== 'boolean') {
    throw invalidAccessPolicy('命令权限必须是布尔值。');
  }
  return Object.freeze({
    id: normalizeAccessPolicyUserId(input.id),
    canExecuteCommands: input.canExecuteCommands,
  });
}

function validateUsers(input, { listMessage, duplicateMessage }) {
  if (!Array.isArray(input)) throw invalidAccessPolicy(listMessage);
  const users = input.map(validateAccessPolicyUser);
  if (new Set(users.map(({ id }) => id)).size !== users.length) {
    throw invalidAccessPolicy(duplicateMessage);
  }
  return Object.freeze(users);
}

function validateOpenSettings(input) {
  if (!hasExactKeys(input, OPEN_KEYS)) {
    throw invalidAccessPolicy('开放模式设置必须完整。');
  }
  if (typeof input.defaultCanExecuteCommands !== 'boolean') {
    throw invalidAccessPolicy('开放模式默认命令权限必须是布尔值。');
  }
  return Object.freeze({
    defaultCanExecuteCommands: input.defaultCanExecuteCommands,
    commandPermissionOverrides: validateUsers(input.commandPermissionOverrides, {
      listMessage: '开放模式命令权限覆盖用户必须是数组。',
      duplicateMessage: '开放模式命令权限覆盖用户不能包含重复的用户标识。',
    }),
  });
}

function validateAllowlistSettings(input) {
  if (!hasExactKeys(input, ALLOWLIST_KEYS)) {
    throw invalidAccessPolicy('白名单模式设置必须完整。');
  }
  return Object.freeze({
    users: validateUsers(input.users, {
      listMessage: '白名单模式用户必须是数组。',
      duplicateMessage: '白名单模式用户不能包含重复的用户标识。',
    }),
  });
}

function validateAccessPolicyScope(input) {
  if (!hasExactKeys(input, SCOPE_KEYS)) {
    throw invalidAccessPolicy('访问场景设置必须同时包含模式、开放模式设置和白名单模式设置。');
  }
  if (!ACCESS_POLICY_MODES.includes(input.mode)) {
    throw invalidAccessPolicy('访问模式只能是 open 或 allowlist。');
  }
  return Object.freeze({
    mode: input.mode,
    open: validateOpenSettings(input.open),
    allowlist: validateAllowlistSettings(input.allowlist),
  });
}

/** Validate one canonical direct + group atomic save. */
export function validateAccessPolicy(input) {
  if (!hasExactKeys(input, POLICY_KEYS)) {
    throw invalidAccessPolicy('请同时提交完整的私聊和群聊访问设置。');
  }
  return Object.freeze({
    direct: validateAccessPolicyScope(input.direct),
    group: validateAccessPolicyScope(input.group),
  });
}

/** Normalize canonical persisted/runtime data; damaged settings fail closed. */
export function normalizeAccessPolicy(input) {
  try {
    return validateAccessPolicy(input);
  } catch {
    return null;
  }
}

/** Small canonical constructor used by channel initialization. */
export function createAccessPolicyScope(options) {
  return validateAccessPolicyScope(options === undefined ? {
    mode: 'allowlist',
    open: {
      defaultCanExecuteCommands: false,
      commandPermissionOverrides: [],
    },
    allowlist: { users: [] },
  } : options);
}

const DENY_SCOPE = createAccessPolicyScope();

export const DEFAULT_ACCESS_POLICY = Object.freeze({
  direct: DENY_SCOPE,
  group: DENY_SCOPE,
});

export const DENY_ALL_ACCESS_POLICY = DEFAULT_ACCESS_POLICY;

export function createAccessPolicy({
  direct = DEFAULT_ACCESS_POLICY.direct,
  group = DEFAULT_ACCESS_POLICY.group,
} = {}) {
  return validateAccessPolicy({ direct, group });
}

const ALLOWED = Object.freeze({ allowed: true, reason: 'allowed' });
const POLICY_UNAVAILABLE = Object.freeze({ allowed: false, reason: 'policy-unavailable' });
const INVALID_CONTEXT = Object.freeze({ allowed: false, reason: 'invalid-context' });
const SENDER_UNAVAILABLE = Object.freeze({ allowed: false, reason: 'sender-unavailable' });
const SENDER_NOT_ALLOWED = Object.freeze({ allowed: false, reason: 'sender-not-allowed' });
const COMMAND_NOT_ALLOWED = Object.freeze({ allowed: false, reason: 'command-not-allowed' });

/**
 * Decide access for one ordinary message or one already-recognized command.
 * `senderIds` accepts multiple identities so WhatsApp can reuse its JID aliases.
 * Privileged/owner bypass is intentionally handled by the inbound adapter.
 */
export function evaluateAccessPolicy(policy, {
  conversationType,
  senderIds,
  isCommand = false,
  equals = (left, right) => left === right,
} = {}) {
  const normalizedPolicy = normalizeAccessPolicy(policy);
  if (!normalizedPolicy) return POLICY_UNAVAILABLE;
  if (!ACCESS_POLICY_CONVERSATION_TYPES.includes(conversationType)
    || typeof isCommand !== 'boolean' || typeof equals !== 'function') {
    return INVALID_CONTEXT;
  }
  const candidates = (Array.isArray(senderIds) ? senderIds : [senderIds])
    .flatMap((candidate) => {
      try {
        return [normalizeAccessPolicyUserId(candidate)];
      } catch {
        return [];
      }
    });
  if (candidates.length === 0) return SENDER_UNAVAILABLE;

  const scope = normalizedPolicy[conversationType];
  const users = scope.mode === 'open'
    ? scope.open.commandPermissionOverrides
    : scope.allowlist.users;
  let matchedUsers;
  try {
    matchedUsers = users.filter((user) => (
      candidates.some((candidate) => equals(candidate, user.id) === true)
    ));
  } catch {
    return INVALID_CONTEXT;
  }
  if (scope.mode === 'allowlist' && matchedUsers.length === 0) return SENDER_NOT_ALLOWED;
  if (isCommand) {
    const canExecuteCommands = scope.mode === 'open'
      ? (matchedUsers.length > 0
        ? matchedUsers.every((user) => user.canExecuteCommands)
        : scope.open.defaultCanExecuteCommands)
      : matchedUsers.every((user) => user.canExecuteCommands);
    if (!canExecuteCommands) return COMMAND_NOT_ALLOWED;
  }
  return ALLOWED;
}
