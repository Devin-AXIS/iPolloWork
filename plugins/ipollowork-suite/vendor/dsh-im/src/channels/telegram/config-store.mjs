import { t } from '../shared/i18n.mjs';
import {
  deriveTokenBotIdentity,
  maskPlatformId,
  TokenBotConfigStore,
} from '../shared/token-config-store.mjs';
import { normalizeGroupTriggers } from './group-triggers.mjs';
import {
  normalizeThinkingIntervalSeconds,
  normalizeThinkingNumbering,
} from '../shared/thinking-cadence.mjs';

export {
  DEFAULT_THINKING_INTERVAL_SECONDS,
  normalizeThinkingIntervalSeconds,
  normalizeThinkingNumbering,
  SET_THINKING_CADENCE_ENDPOINT,
  THINKING_INTERVAL_MAX_SECONDS,
} from '../shared/thinking-cadence.mjs';
import { normalizeSendLimitPerMinute } from '../shared/send-limit.mjs';

export {
  DEFAULT_SEND_LIMIT_PER_MINUTE,
  normalizeSendLimitPerMinute,
  SEND_LIMIT_MAX_PER_MINUTE,
  SEND_LIMIT_MIN_PER_MINUTE,
  SET_SEND_LIMIT_ENDPOINT,
} from '../shared/send-limit.mjs';

const IDENTITY_OPTIONS = Object.freeze({
  botPrefix: 'telegram',
  tokenRefPrefix: 'DSH_TELEGRAM_BOT_TOKEN',
});

export const TELEGRAM_ACCESS_MODES = Object.freeze({
  compatible: 'compatible',
  privateAllowlist: 'private-allowlist',
});

const TELEGRAM_USER_ID = /^[1-9]\d{0,15}$/;

export function normalizeTelegramAllowedUsers(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError('allowedUsers must be an array of numeric Telegram User IDs');
  }
  const normalized = value.map((entry) => {
    const userId = typeof entry === 'number' && Number.isSafeInteger(entry)
      ? String(entry) : typeof entry === 'string' ? entry.trim() : '';
    if (!TELEGRAM_USER_ID.test(userId)) {
      throw new TypeError('allowedUsers contains an invalid Telegram User ID');
    }
    return userId;
  });
  return Object.freeze([...new Set(normalized)]);
}

export function normalizeTelegramAccessPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Telegram access policy must be an object');
  }
  const accessMode = value.accessMode ?? TELEGRAM_ACCESS_MODES.compatible;
  if (!Object.values(TELEGRAM_ACCESS_MODES).includes(accessMode)) {
    throw new TypeError('Telegram accessMode must be compatible or private-allowlist');
  }
  return Object.freeze({
    accessMode,
    allowedUsers: normalizeTelegramAllowedUsers(value.allowedUsers),
  });
}

function normalizeTelegramBotExtension(value) {
  const hasAccessMode = Object.hasOwn(value, 'accessMode');
  const hasAllowedUsers = Object.hasOwn(value, 'allowedUsers');
  const hasThinkingTraces = Object.hasOwn(value, 'thinkingTraces');
  const hasGroupTriggers = Object.hasOwn(value, 'groupTriggers');
  const hasThinkingNumbering = Object.hasOwn(value, 'thinkingNumbering');
  const hasThinkingInterval = Object.hasOwn(value, 'thinkingIntervalSeconds');
  const hasSendLimit = Object.hasOwn(value, 'sendLimitPerMinute');
  if (!hasAccessMode && !hasAllowedUsers && !hasThinkingTraces && !hasGroupTriggers
    && !hasThinkingNumbering && !hasThinkingInterval && !hasSendLimit) return {};
  try {
    const policy = normalizeTelegramAccessPolicy(value);
    return {
      ...(hasAccessMode ? { accessMode: policy.accessMode } : {}),
      ...(hasAllowedUsers || hasAccessMode ? { allowedUsers: policy.allowedUsers } : {}),
      // Explicit field is kept; an absent field stays absent.
      ...(hasThinkingTraces ? { thinkingTraces: value.thinkingTraces === true } : {}),
      // Per-group reply triggers; absent means "no rule configured".
      ...(hasGroupTriggers ? { groupTriggers: normalizeGroupTriggers(value.groupTriggers) } : {}),
      // Trace cadence: stored clamped, so a bad value never reaches the runtime.
      ...(hasThinkingNumbering
        ? { thinkingNumbering: normalizeThinkingNumbering(value.thinkingNumbering) } : {}),
      ...(hasThinkingInterval
        ? { thinkingIntervalSeconds: normalizeThinkingIntervalSeconds(value.thinkingIntervalSeconds) }
        : {}),
      // Stored clamped so a bad value never reaches the runtime.
      ...(hasSendLimit ? { sendLimitPerMinute: normalizeSendLimitPerMinute(value.sendLimitPerMinute) } : {}),
    };
  } catch {
    return null;
  }
}

export function deriveTelegramBotIdentity(platformId) {
  return deriveTokenBotIdentity(platformId, IDENTITY_OPTIONS);
}

export function maskTelegramBotId(platformId) {
  return maskPlatformId(platformId, t('Telegram机器人'));
}

export class TelegramConfigStore extends TokenBotConfigStore {
  constructor(path) {
    super(path, {
      channel: 'Telegram',
      ...IDENTITY_OPTIONS,
      normalizeBotExtension: normalizeTelegramBotExtension,
    });
  }

  async save(value) {
    const previous = value?.platformId ? this.getByPlatformId(String(value.platformId)) : null;
    return super.save({ ...previous, ...value });
  }
}
