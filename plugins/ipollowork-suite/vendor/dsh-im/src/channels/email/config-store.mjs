import { t } from '../shared/i18n.mjs';
import {
  deriveTokenBotIdentity,
  maskPlatformId,
  TokenBotConfigStore,
} from '../shared/token-config-store.mjs';

const IDENTITY_OPTIONS = Object.freeze({
  botPrefix: 'email',
  tokenRefPrefix: 'DSH_EMAIL_PASSWORD',
});

const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * How the mailbox is reached. Each value maps to one transport implementation,
 * so adding a mail protocol adds a transport rather than another channel.
 */
export const EMAIL_TRANSPORTS = Object.freeze({
  'imap-smtp': Object.freeze({
    key: 'imap-smtp',
    label: 'IMAP / SMTP（任意邮箱）',
    // Needs the address plus an app password, and knows its server hosts.
    fields: Object.freeze(['address', 'password', 'provider', 'hosts', 'allowedSenders']),
  }),
  'agent-mail': Object.freeze({
    key: 'agent-mail',
    label: '腾讯 Agent 邮箱',
    // Authorizes by QR code, so no password and no server hosts.
    fields: Object.freeze(['address', 'allowedSenders']),
  }),
});

export const DEFAULT_EMAIL_TRANSPORT = 'imap-smtp';

/** Normalize a transport key, defaulting to the standard IMAP/SMTP one. */
export function normalizeEmailTransport(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!key) return DEFAULT_EMAIL_TRANSPORT;
  if (!Object.hasOwn(EMAIL_TRANSPORTS, key)) {
    throw new TypeError(`Unsupported email transport: ${value}`);
  }
  return key;
}

/** Well-known provider presets so users do not have to know IMAP/SMTP hosts. */
export const EMAIL_PROVIDERS = Object.freeze({
  qq: Object.freeze({
    key: 'qq', label: 'QQ 邮箱',
    imapHost: 'imap.qq.com', imapPort: 993,
    smtpHost: 'smtp.qq.com', smtpPort: 465,
  }),
  '163': Object.freeze({
    key: '163', label: '163 邮箱',
    imapHost: 'imap.163.com', imapPort: 993,
    smtpHost: 'smtp.163.com', smtpPort: 465,
  }),
  gmail: Object.freeze({
    key: 'gmail', label: 'Gmail',
    imapHost: 'imap.gmail.com', imapPort: 993,
    smtpHost: 'smtp.gmail.com', smtpPort: 465,
  }),
  custom: Object.freeze({ key: 'custom', label: '自定义' }),
});

/**
 * Email access is allowlist-only: a mail address is trivially forgeable, so an
 * open mailbox would let anyone drive the Harness. Unlike other channels the
 * policy is therefore not optional — `allowedSenders` must be non-empty.
 */
export function normalizeEmailAllowedSenders(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('allowedSenders must be an array of email addresses');
  const normalized = value.map((entry) => {
    const address = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    if (!EMAIL_ADDRESS.test(address)) {
      throw new TypeError('allowedSenders contains an invalid email address');
    }
    return address;
  });
  return Object.freeze([...new Set(normalized)]);
}

export function normalizeEmailAccessPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Email access policy must be an object');
  }
  return Object.freeze({ allowedSenders: normalizeEmailAllowedSenders(value.allowedSenders) });
}

function normalizePort(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const port = typeof value === 'number' ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(`${label} must be a valid TCP port`);
  }
  return port;
}

function normalizeHost(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const host = String(value).trim();
  if (!HOSTNAME.test(host)) throw new TypeError(`${label} must be a valid hostname`);
  return host;
}

/**
 * Channel-specific fields persisted alongside the shared token identity.
 * Only keys the caller actually supplied are written, so a later partial save
 * spreads over the previous record (see `save`).
 */
function normalizeEmailBotExtension(value) {
  const provider = typeof value.provider === 'string' ? value.provider.trim() : undefined;
  const present = [
    'transport', 'provider', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort',
    'allowedSenders',
  ];
  if (!present.some((key) => Object.hasOwn(value, key))) return {};
  const preset = EMAIL_PROVIDERS[provider] ?? null;
  try {
    const policy = normalizeEmailAccessPolicy({ allowedSenders: value.allowedSenders ?? [] });
    const transport = Object.hasOwn(value, 'transport')
      ? normalizeEmailTransport(value.transport)
      : undefined;
    return {
      ...(transport ? { transport } : {}),
      ...(provider ? { provider } : {}),
      imapHost: normalizeHost(value.imapHost, 'imapHost') ?? preset?.imapHost,
      imapPort: normalizePort(value.imapPort, preset?.imapPort ?? 993, 'imapPort'),
      smtpHost: normalizeHost(value.smtpHost, 'smtpHost') ?? preset?.smtpHost,
      smtpPort: normalizePort(value.smtpPort, preset?.smtpPort ?? 465, 'smtpPort'),
      allowedSenders: policy.allowedSenders,
    };
  } catch {
    return null;
  }
}

export function deriveEmailBotIdentity(address) {
  return deriveTokenBotIdentity(address, IDENTITY_OPTIONS);
}

export function maskEmailBotId(address) {
  const value = String(address ?? '');
  const at = value.indexOf('@');
  if (at <= 0) return maskPlatformId(value, t('邮箱'));
  const name = value.slice(0, at);
  const domain = value.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}${domain}`;
}

/**
 * The mailbox address is the platform identity; the password lives in the
 * credential store behind `tokenRef`.
 */
export function normalizeEmailAddress(value) {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_ADDRESS.test(address)) throw new TypeError(t('邮箱地址格式不正确'));
  return address;
}

export const EMAIL_CLIENT_DEFAULTS = Object.freeze({
  mailbox: 'INBOX',
  pollIntervalMs: 20_000,
});


export class EmailConfigStore extends TokenBotConfigStore {
  constructor(path) {
    super(path, {
      channel: 'Email',
      ...IDENTITY_OPTIONS,
      normalizeBotExtension: normalizeEmailBotExtension,
    });
  }

  async save(value) {
    // Merge over the stored record so a settings dialog can patch one field
    // without resending hosts and the allowlist. The bot id and credential ref
    // are derived from the address here, so callers only supply the mailbox.
    const previous = value?.platformId ? this.getByPlatformId(String(value.platformId)) : null;
    const merged = { ...previous, ...value };
    const platformId = typeof merged.platformId === 'string' ? merged.platformId.trim().toLowerCase() : '';
    if (platformId) {
      const identity = deriveEmailBotIdentity(platformId);
      merged.botId = identity.botId;
      merged.tokenRef = identity.tokenRef;
      merged.name = merged.name || platformId;
    }
    return super.save(merged);
  }
}
