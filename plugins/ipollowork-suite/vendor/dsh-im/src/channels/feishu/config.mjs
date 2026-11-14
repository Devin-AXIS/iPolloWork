import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function required(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value.trim();
}

function readSecret(appId) {
  if (process.env.FEISHU_APP_SECRET?.trim()) return process.env.FEISHU_APP_SECRET.trim();

  const service = process.env.FEISHU_SECRET_SERVICE?.trim();
  if (!service) throw new Error('Missing FEISHU_APP_SECRET or FEISHU_SECRET_SERVICE');

  try {
    return execFileSync('/usr/bin/security', [
      'find-generic-password',
      '-a',
      appId,
      '-s',
      service,
      '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`Unable to read Feishu app secret from macOS Keychain service ${service}`);
  }
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function csvSet(value) {
  return new Set((value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
}

function requiredCsvSet(name, value) {
  const items = csvSet(value);
  if (items.size === 0) throw new Error(`Missing required configuration: ${name}`);
  return items;
}

export function loadConfig() {
  const appId = required('FEISHU_APP_ID', process.env.FEISHU_APP_ID);
  const appSecret = required('FEISHU_APP_SECRET', readSecret(appId));
  const workspace = required('HARNESS_WORKSPACE', process.env.HARNESS_WORKSPACE);

  return Object.freeze({
    appId,
    appSecret,
    harnessBaseUrl: new URL(process.env.HARNESS_BASE_URL ?? 'http://127.0.0.1:3080'),
    harnessWorkspace: resolve(workspace),
    harnessAgentPreset: process.env.HARNESS_AGENT_PRESET?.trim() || 'standard',
    harnessAutostart: bool('HARNESS_AUTOSTART', true),
    dshBin: process.env.DSH_BIN?.trim() || 'dsh',
    healthPort: Number.parseInt(process.env.BRIDGE_HEALTH_PORT ?? '3091', 10),
    statePath: resolve(process.env.BRIDGE_STATE_PATH ?? './data/state.json'),
    replyTimeoutMs: Number.parseInt(process.env.HARNESS_REPLY_TIMEOUT_MS ?? '600000', 10),
    allowedSenderOpenIds: requiredCsvSet(
      'FEISHU_ALLOWED_OPEN_IDS',
      process.env.FEISHU_ALLOWED_OPEN_IDS,
    ),
  });
}
