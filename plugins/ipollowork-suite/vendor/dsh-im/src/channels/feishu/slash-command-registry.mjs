/**
 * Feishu native Slash Command registration for the dsh-im Feishu channel.
 *
 * The Feishu client shows a "/" command panel in the chat input box. The
 * command list is stored server-side per bot application and is NOT pushed
 * by dsh/Harness. dsh-im holds its own static command manifest and calls the
 * Feishu OpenAPI to register it, so users can discover commands by typing "/".
 *
 * Reference (official):
 *   https://open.feishu.cn/document/mcp_open_tools/agent-best-practices/agent-supports-slash-commands
 *
 * The registered command panel is only a client-side convenience: when a user
 * taps a command, Feishu sends it to the bot as an ordinary text message via
 * im.message.receive_v1. The bridge's #handle() command matcher therefore
 * needs no changes as long as every registered command name matches the
 * existing "/xxx" text commands.
 */

import {
  DEFAULT_SLASH_COMMAND_ICON,
  SLASH_COMMAND_MANIFEST,
  isCustomSlashPanel,
  resolveSlashPanelManifest,
} from './slash-command-panel.mjs';

// The manifest describes the panel, so it lives with the panel's configuration;
// re-exported here because this is where callers have always imported it from.
export { SLASH_COMMAND_MANIFEST };

const SLASH_ENDPOINT = '/open-apis/application/v7/app_slash_commands';
const MISSING_PERMISSION_CODES = new Set(['99991640', '99991672']);

export const SLASH_COMMAND_TENANT_SCOPES = Object.freeze([
  'application:app_slash_command:read',
  'application:app_slash_command:write',
]);

const DEFAULT_ICON = DEFAULT_SLASH_COMMAND_ICON;

/**
 * Feishu returns the panel in creation order (newest first, time to the
 * second), so a chosen order is only reachable by creating the commands in
 * reverse, one per second. Anything faster lands in the same second and the
 * order degrades to the platform's tie-break.
 */
export const SLASH_PANEL_CREATE_INTERVAL_MS = 1_100;

// Commands that require a parameter are registered too, so the user can type
// "/watch <session ID>" from the panel. A leading placeholder hint is not part of
// the registered name; Feishu only allows a plain command token.

function endpointFor(domain, path) {
  const origin = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
  return new URL(path, origin);
}

function jsonResponse(body, operation) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${operation} returned a non-JSON response`);
  }
  if (body.code !== 0) {
    const error = new Error(`${operation} failed: ${body.msg || `code ${body.code}`}`);
    error.code = String(body.code);
    error.msg = body.msg;
    throw error;
  }
  return body;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestJson(httpInstance, options, operation) {
  try {
    return jsonResponse(await httpInstance.request(options), operation);
  } catch (error) {
    const body = error?.response?.data;
    if (body && typeof body === 'object' && !Array.isArray(body)
      && Object.hasOwn(body, 'code')) {
      return jsonResponse(body, operation);
    }
    throw error;
  }
}

/** Fetch a tenant_access_token for the app. */
async function fetchTenantAccessToken({
  appId, appSecret, domain, httpInstance, timeoutMs, signal,
}) {
  if (!appId || !appSecret) throw new Error('Feishu slash registration requires app credentials');
  if (!httpInstance || typeof httpInstance.request !== 'function') {
    throw new TypeError('Feishu slash registration requires an HTTP instance');
  }
  const body = await requestJson(httpInstance, {
    method: 'POST',
    url: endpointFor(domain, '/open-apis/auth/v3/tenant_access_token/internal').href,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: { app_id: appId, app_secret: appSecret },
    signal: requestSignal(signal, timeoutMs),
    timeout: timeoutMs,
  }, 'Feishu authentication');
  if (!body.tenant_access_token) {
    throw new Error('Feishu authentication returned no tenant access token');
  }
  return body.tenant_access_token;
}

async function listSlashCommandsWithToken({
  tenantAccessToken, domain, httpInstance, timeoutMs, signal,
}) {
  const body = await requestJson(httpInstance, {
    method: 'GET',
    url: endpointFor(domain, SLASH_ENDPOINT).href,
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    signal: requestSignal(signal, timeoutMs),
    timeout: timeoutMs,
  }, 'Feishu slash command list');
  return Array.isArray(body.data?.items) ? body.data.items : [];
}

/** List every slash command currently registered for the app. */
export async function listSlashCommands({
  appId, appSecret, domain = 'feishu', httpInstance, timeoutMs = 15000, signal,
}) {
  const tenantAccessToken = await fetchTenantAccessToken({
    appId, appSecret, domain, httpInstance, timeoutMs, signal,
  });
  return listSlashCommandsWithToken({
    tenantAccessToken, domain, httpInstance, timeoutMs, signal,
  });
}

async function createSlashCommandWithToken({
  tenantAccessToken, domain, httpInstance, timeoutMs, signal,
  command, description, icon = DEFAULT_ICON,
}) {
  const data = { command };
  if (description && (description.default_value || description.i18n)) {
    data.description = description;
  } else if (typeof description === 'string' && description.trim()) {
    data.description = { default_value: description.trim() };
  }
  if (icon) data.description = { ...(data.description ?? {}), icon: { icon_key: icon } };
  const body = await requestJson(httpInstance, {
    method: 'POST',
    url: endpointFor(domain, SLASH_ENDPOINT).href,
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    data,
    signal: requestSignal(signal, timeoutMs),
    timeout: timeoutMs,
  }, `Feishu slash command create (/${command})`);
  return body.data?.command_id ?? null;
}

/** Register a single slash command. Returns the server-assigned command_id. */
export async function createSlashCommand({
  appId, appSecret, domain = 'feishu', httpInstance, timeoutMs = 15000,
  signal, command, description, icon = DEFAULT_ICON,
}) {
  const tenantAccessToken = await fetchTenantAccessToken({
    appId, appSecret, domain, httpInstance, timeoutMs, signal,
  });
  return createSlashCommandWithToken({
    tenantAccessToken, domain, httpInstance, timeoutMs, signal,
    command, description, icon,
  });
}

/** Delete a registered slash command by its server command_id. */
export async function deleteSlashCommand({
  appId, appSecret, domain = 'feishu', httpInstance, timeoutMs = 15000, signal, commandId,
}) {
  const tenantAccessToken = await fetchTenantAccessToken({
    appId, appSecret, domain, httpInstance, timeoutMs, signal,
  });
  await requestJson(httpInstance, {
    method: 'DELETE',
    url: endpointFor(domain, `${SLASH_ENDPOINT}/${commandId}`).href,
    headers: { authorization: `Bearer ${tenantAccessToken}` },
    signal: requestSignal(signal, timeoutMs),
    timeout: timeoutMs,
  }, 'Feishu slash command delete');
}

/**
 * Best-effort sync of the manifest into the app's registered slash commands.
 * Creates any command in the manifest that is not yet registered and returns
 * a structured report. This is idempotent (the API rejects duplicates with
 * "command already exists", so we skip existing names).
 *
 * @returns {{ created: Array<{command,command_id}>, existing: string[], failed: Array<{command,error}> }}
 */
export async function registerSlashCommands({
  appId, appSecret, domain = 'feishu', httpInstance, timeoutMs = 15000,
  signal, manifest = SLASH_COMMAND_MANIFEST,
}) {
  const tenantAccessToken = await fetchTenantAccessToken({
    appId, appSecret, domain, httpInstance, timeoutMs, signal,
  });
  const existing = new Set((await listSlashCommandsWithToken({
    tenantAccessToken, domain, httpInstance, timeoutMs, signal,
  }))
    .map((item) => item.command));

  const created = [];
  const failed = [];
  for (const entry of manifest) {
    const command = String(entry.command ?? '').replace(/^\//, '');
    if (!command) continue;
    if (existing.has(command)) continue;
    try {
      const description = {
        default_value: entry.default ?? entry.en_us ?? command,
        i18n: {
          zh_cn: entry.default ?? command,
          en_us: entry.en_us ?? entry.default ?? command,
        },
      };
      const commandId = await createSlashCommandWithToken({
        tenantAccessToken, domain, httpInstance, timeoutMs, signal,
        command, description, icon: entry.icon ?? DEFAULT_ICON,
      });
      created.push({ command, command_id: commandId });
    } catch (error) {
      // "command already exists" can race with concurrent runs; treat as existing.
      if (error?.code === '40000000' && /already exists/i.test(error?.msg ?? '')) {
        existing.add(command);
        continue;
      }
      if (MISSING_PERMISSION_CODES.has(error?.code)
        || /(?:lacks permission|access denied)/i.test(error?.msg ?? '')) {
        // Missing app_slash_command:write permission; abort the batch.
        failed.push({ command, error });
        break;
      }
      failed.push({ command, error: error?.message ?? String(error) });
    }
  }

  return {
    created,
    existing: [...existing].filter((c) => c !== null && c !== undefined),
    failed,
  };
}

/** Delete one registered command with an already-fetched tenant token. */
async function deleteSlashCommandWithToken({
  tenantAccessToken, domain, httpInstance, timeoutMs, signal, commandId,
}) {
  await requestJson(httpInstance, {
    method: 'DELETE',
    url: endpointFor(domain, `${SLASH_ENDPOINT}/${commandId}`).href,
    headers: { authorization: `Bearer ${tenantAccessToken}` },
    signal: requestSignal(signal, timeoutMs),
    timeout: timeoutMs,
  }, 'Feishu slash command delete');
}

/** Plain timer used between creates; tests inject their own. */
function defaultWait(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function commandNameOf(item) {
  return typeof item?.command === 'string' && item.command ? item.command : null;
}

/**
 * The commands of ours in panel order. Feishu returns the list newest-first
 * with second precision, so `create_time` is the panel order and `command_id`
 * only breaks ties inside the same second.
 */
function orderedOwnedNames(items, owned) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => owned.has(commandNameOf(item)))
    .sort((a, b) => {
      const aTime = Number(a.item.create_time);
      const bTime = Number(b.item.create_time);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
      const aId = Number(a.item.command_id);
      const bId = Number(b.item.command_id);
      if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return bId - aId;
      return a.index - b.index;
    })
    .map(({ item }) => commandNameOf(item))
    .filter(Boolean);
}

function slashPanelDescription(entry, command) {
  return {
    default_value: entry.default ?? entry.en_us ?? command,
    i18n: {
      zh_cn: entry.default ?? command,
      en_us: entry.en_us ?? entry.default ?? command,
    },
  };
}

/**
 * Sync one bot's "/" panel with its configured manifest.
 *
 * `default` mode is the pre-configurable behaviour: create what is missing and
 * leave everything else alone. `custom` mode converges the app to the
 * configured commands *and order*:
 *
 *   1. read the registered commands (with command_id and create_time);
 *   2. stop when the panel already holds exactly that order — Feishu reports the
 *      panel in creation order, so a matching order needs no calls at all;
 *   3. otherwise delete our commands and recreate the configured ones
 *      newest-first, one per `intervalMs`, because the order *is* the creation
 *      order.
 *
 * Commands registered outside the manifest are never deleted: dsh-im does not
 * own them, and their position is the platform's business.
 *
 * @returns {{ created: Array<{command,command_id}>, deleted: string[],
 *   existing: string[], external: string[], failed: Array<{command,error}>,
 *   changed: boolean, superseded: boolean }} `superseded` marks a run that
 *   stopped early because a newer panel config took over; it reports what it
 *   managed to do, and the newer run converges the panel from there.
 */
export async function syncSlashCommands({
  appId, appSecret, domain = 'feishu', httpInstance, timeoutMs = 15000,
  signal, manifest = SLASH_COMMAND_MANIFEST, config = null,
  intervalMs = SLASH_PANEL_CREATE_INTERVAL_MS, wait = defaultWait,
}) {
  // A superseded run — the runtime aborts this signal when a newer panel config
  // arrives — must not send further create/delete calls: the newer run re-reads
  // the panel and converges it, and letting both write would leave the older
  // plan's commands behind. Requests already in flight are left to finish.
  const stopped = () => signal?.aborted === true;
  const tenantAccessToken = await fetchTenantAccessToken({
    appId, appSecret, domain, httpInstance, timeoutMs, signal,
  });
  const items = await listSlashCommandsWithToken({
    tenantAccessToken, domain, httpInstance, timeoutMs, signal,
  });
  const owned = new Set(manifest.map((entry) => commandNameOf(entry)).filter(Boolean));
  const external = items
    .map((item) => commandNameOf(item))
    .filter((name) => name && !owned.has(name));
  const registered = new Set(
    items.map((item) => commandNameOf(item)).filter(Boolean),
  );

  if (!isCustomSlashPanel(config)) {
    const created = [];
    const failed = [];
    for (const entry of resolveSlashPanelManifest(config, manifest)) {
      if (stopped()) break;
      const command = commandNameOf(entry);
      if (!command || registered.has(command)) continue;
      try {
        const commandId = await createSlashCommandWithToken({
          tenantAccessToken, domain, httpInstance, timeoutMs, signal,
          command,
          description: slashPanelDescription(entry, command),
          icon: entry.icon ?? DEFAULT_ICON,
        });
        created.push({ command, command_id: commandId });
        registered.add(command);
      } catch (error) {
        if (stopped()) break;
        if (error?.code === '40000000' && /already exists/i.test(error?.msg ?? '')) {
          registered.add(command);
          continue;
        }
        failed.push({ command, error: error?.message ?? String(error) });
        if (MISSING_PERMISSION_CODES.has(error?.code)
          || /(?:lacks permission|access denied)/i.test(error?.msg ?? '')) {
          break;
        }
      }
    }
    return {
      created,
      deleted: [],
      existing: [...registered].filter(Boolean),
      external,
      failed,
      changed: created.length > 0,
      superseded: stopped(),
    };
  }

  const current = orderedOwnedNames(items, owned);
  const plannedEntries = resolveSlashPanelManifest(config, manifest)
    .filter((entry) => commandNameOf(entry));
  const plannedNames = plannedEntries.map((entry) => commandNameOf(entry));
  if (current.length === plannedNames.length
    && plannedNames.every((name, index) => name === current[index])) {
    return {
      created: [], deleted: [], existing: current, external, failed: [], changed: false,
    };
  }

  // A newer config took over while we were reading the panel: leave the rebuild
  // to its run rather than deleting commands for a plan nobody wants anymore.
  if (stopped()) {
    return {
      created: [], deleted: [], existing: current, external, failed: [], changed: false, superseded: true,
    };
  }

  const byName = new Map(
    items.map((item) => [commandNameOf(item), item]).filter(([name]) => name && owned.has(name)),
  );
  const deleted = [];
  const failed = [];
  for (const name of current) {
    if (stopped()) break;
    const item = byName.get(name);
    if (!item?.command_id) {
      failed.push({ command: name, error: 'the registered command reports no command_id' });
      continue;
    }
    try {
      await deleteSlashCommandWithToken({
        tenantAccessToken, domain, httpInstance, timeoutMs, signal, commandId: item.command_id,
      });
      deleted.push(name);
    } catch (error) {
      if (stopped()) break;
      failed.push({ command: name, error: error?.message ?? String(error) });
    }
  }
  // A superseded run stops before rebuilding: the newer run owns the panel now.
  if (stopped()) {
    return {
      created: [], deleted, existing: current, external, failed, changed: deleted.length > 0, superseded: true,
    };
  }
  // Deleting only part of the panel would leave it half-converged, and
  // recreating a name that still exists is rejected as a duplicate. Stop here;
  // the next sync (config change, reconnect, or a later start) converges.
  if (failed.length > 0) {
    return { created: [], deleted, existing: current, external, failed, changed: deleted.length > 0 };
  }

  const created = [];
  for (const [index, entry] of [...plannedEntries].reverse().entries()) {
    if (stopped()) break;
    const command = commandNameOf(entry);
    try {
      if (index > 0) {
        await wait(intervalMs, signal);
        // The wait wakes on abort as well, so re-check instead of recording a
        // superseded run as a failed create.
        if (stopped()) break;
      }
      const commandId = await createSlashCommandWithToken({
        tenantAccessToken, domain, httpInstance, timeoutMs, signal,
        command,
        description: slashPanelDescription(entry, command),
        icon: entry.icon ?? DEFAULT_ICON,
      });
      created.push({ command, command_id: commandId });
    } catch (error) {
      if (stopped()) break;
      failed.push({ command, error: error?.message ?? String(error) });
      if (MISSING_PERMISSION_CODES.has(error?.code)
        || /(?:lacks permission|access denied)/i.test(error?.msg ?? '')) {
        break;
      }
    }
  }

  return {
    created,
    deleted,
    existing: [],
    external,
    failed,
    changed: created.length > 0 || deleted.length > 0,
    superseded: stopped(),
  };
}

export default registerSlashCommands;
