import { setTimeout as delay } from 'node:timers/promises';
import { HarnessError } from '@deepseek-ai/dsh-error';
import { ensurePresetWorkspace } from './preset-workspaces.mjs';
import { t } from './i18n.mjs';
import { normalizeBusyMessageMode, validateBusyMessageMode } from './message-mode.mjs';
import { atConnectionStage, connectionStageError, extractConnectionEvidence } from './connection-error.mjs';
import { validateBotAlias, withBotAlias } from './bot-alias.mjs';
import { defaultImWorkspace, ensureImWorkspaceDirectory, sameWorkspacePath } from './default-workspace.mjs';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
  normalizeAgentPresetCatalog,
  normalizeAgentPresetId,
  validateAgentPresetId,
} from './agent-preset.mjs';
import {
  normalizeAccessPolicy,
  validateAccessPolicy,
} from './access-policy.mjs';
import { CONNECTION_TEST_STATE_IDENTITY } from './connection-test.mjs';
import { SESSION_BINDING_STATE_IDENTITY, withSessionBindingLock } from './session-binding-lock.mjs';
import {
  DEFAULT_CONTEXT_ENHANCEMENT_CONFIG,
  normalizeContextEnhancementConfig,
  validateContextEnhancementConfig,
} from './context-enhancement.mjs';
import {
  confirmsModelSelection,
  modelCatalogEntry,
  normalizeModelCatalog,
  sameModelSelection,
  validateModelSelection,
} from './model-setting.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';
import { configValidationError, withConfigResource } from './config-read-error.mjs';
import {
  DEFAULT_CONVERSATION_DIRECTORY,
  normalizeConversationDirectory,
  validateConversationDirectory,
  workspaceManualEditDisabled,
} from './conversation-directory.mjs';
import { conversationDirectoryName, prepareDirectoryPath } from './conversation-directory-ensure.mjs';

const DELIVERY_DOCUMENT_VERSION = 2;
const SESSION_SYNC_DOCUMENT_VERSION = 3;
const DS_BOT_DOCUMENT_VERSION = 4;
export const CURRENT_DOCUMENT_VERSION = 5;
const EMPTY_DOCUMENT = Object.freeze({ version: 1, workspaces: Object.freeze({}) });

function invalidWorkspaceConfig(field, issue) {
  throw configValidationError('dsh-im workspace config is invalid', field, issue);
}

function workspaceSessionStale(message) {
  const error = new Error(message);
  error.code = WORKSPACE_SESSION_STALE;
  return error;
}

async function canonicalWorkspacePath(value) {
  return resolve(await realpath(value));
}

function botIdOf(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TypeError('Invalid bot id');
  }
  return value;
}

function deliveryTargetError(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  return error;
}

function targetIdOf(value) {
  if (typeof value !== 'string'
    || !/^[A-Za-z0-9._:@-]{1,128}$/.test(value)) {
    throw deliveryTargetError('invalid-target', 'Invalid target id');
  }
  return value;
}

function jsonRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw deliveryTargetError('invalid-target', 'Invalid target route');
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('route is not JSON');
    const route = JSON.parse(serialized);
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new TypeError('route is not an object');
    }
    return route;
  } catch (cause) {
    throw deliveryTargetError('invalid-target', 'Invalid target route', { cause });
  }
}

function conversationKeyOf(value) {
  if (typeof value !== 'string' || !value || value.length > 1_024
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw deliveryTargetError('invalid-target', 'Invalid private conversation key');
  }
  return value;
}

function conversationWorkspaceGenerationKey(botId, conversationKey) {
  // Conversation keys validated by conversationKeyOf never contain the null
  // separator, so the compound key stays unambiguous.
  return `${botIdOf(botId)}\u0000${conversationKeyOf(conversationKey)}`;
}

function normalizeConversationWorkspaces(value) {
  const conversationWorkspaces = Object.create(null);
  if (value === undefined) return conversationWorkspaces;
  // Override damage is isolated: an invalid entry is dropped rather than
  // failing the whole document, because a missing/invalid override falls back
  // to the bot workspace safely.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return conversationWorkspaces;
  }
  for (const [botId, overrides] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) continue;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) continue;
    const normalized = Object.create(null);
    for (const [conversationKey, workspace] of Object.entries(overrides)) {
      if (typeof conversationKey !== 'string' || !conversationKey
        || typeof workspace !== 'string' || !isAbsolute(workspace)) continue;
      normalized[conversationKey] = resolve(workspace);
    }
    if (Object.keys(normalized).length > 0) conversationWorkspaces[botId] = normalized;
  }
  return conversationWorkspaces;
}

function normalizeConversationDirectoryOverrides(value) {
  const result = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [botId, config] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) continue;
    const normalized = normalizeConversationDirectory(config);
    if (normalized) result[botId] = normalized;
  }
  return result;
}

function normalizeSessionDirectories(value) {
  const result = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [botId, entries] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId) || !entries || typeof entries !== 'object') continue;
    const normalized = Object.create(null);
    for (const [key, record] of Object.entries(entries)) {
      if (!record || typeof record !== 'object' || typeof record.base !== 'string'
        || typeof record.workspace !== 'string' || !isAbsolute(record.base) || !isAbsolute(record.workspace)) continue;
      const config = normalizeConversationDirectory({ enabled: true, strategy: record.strategy, prefix: record.prefix });
      if (config) normalized[key] = {
        base: resolve(record.base), workspace: resolve(record.workspace), ...config,
        timestamp: Number.isSafeInteger(record.timestamp) && record.timestamp > 0
          ? record.timestamp : undefined,
        pending: record.pending === true,
        history: Array.isArray(record.history)
          ? [...new Set(record.history.filter((path) => typeof path === 'string' && isAbsolute(path)).map((path) => resolve(path)))]
          : [],
      };
    }
    if (Object.keys(normalized).length) result[botId] = normalized;
  }
  return result;
}

function normalizeDeliveryTarget(value, { targetId, allowSessionSync = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw deliveryTargetError('invalid-target', 'Invalid delivery target');
  }
  const allowed = targetId === undefined
    ? new Set(['targetId', 'name', 'kind', 'route', ...(allowSessionSync ? ['sessionSync'] : [])])
    : new Set(['name', 'kind', 'route', ...(allowSessionSync ? ['sessionSync'] : [])]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw deliveryTargetError('invalid-target', 'Invalid delivery target');
  }
  const id = targetIdOf(targetId ?? value.targetId);
  if (typeof value.kind !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.kind)) {
    throw deliveryTargetError('invalid-target', 'Invalid target kind');
  }
  let name;
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) {
      throw deliveryTargetError('invalid-target', 'Invalid target name');
    }
    name = value.name.trim();
  }
  let sessionSync;
  if (value.sessionSync !== undefined) {
    if (!allowSessionSync || !value.sessionSync || typeof value.sessionSync !== 'object'
      || Array.isArray(value.sessionSync)
      || Object.keys(value.sessionSync).length !== 1
      || !Object.hasOwn(value.sessionSync, 'conversationKey')) {
      throw deliveryTargetError('invalid-target', 'Invalid delivery target session sync');
    }
    sessionSync = { conversationKey: conversationKeyOf(value.sessionSync.conversationKey) };
  }
  return {
    targetId: id,
    ...(name === undefined ? {} : { name }),
    kind: value.kind,
    route: jsonRecord(value.route),
    ...(sessionSync === undefined ? {} : { sessionSync }),
  };
}

function publicDeliveryTarget(value, { targetId } = {}) {
  const normalized = normalizeDeliveryTarget(value, { targetId, allowSessionSync: true });
  const { sessionSync: _sessionSync, ...target } = normalized;
  return target;
}

function sameDeliveryRoute(left, right) {
  return left?.kind === right?.kind
    && JSON.stringify(left?.route) === JSON.stringify(right?.route);
}

function normalizeDeliveryTargets(value, { version } = {}) {
  const deliveryTargets = Object.create(null);
  if (value === undefined) return deliveryTargets;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidWorkspaceConfig('deliveryTargets', 'expected-object');
  let field = 'deliveryTargets';
  try {
    for (const [botIndex, [botId, targets]] of Object.entries(value).entries()) {
      field = `deliveryTargets[${botIndex}].key`;
      botIdOf(botId);
      field = `deliveryTargets[${botIndex}].targets`;
      if (!targets || typeof targets !== 'object' || Array.isArray(targets)) throw new TypeError('Invalid targets');
      const normalizedTargets = Object.create(null);
      for (const [targetIndex, [targetId, target]] of Object.entries(targets).entries()) {
        field = `deliveryTargets[${botIndex}].targets[${targetIndex}]`;
        // Backward compatibility: some released builds persisted the target id
        // inside the stored object as well. Accept a redundant targetId that
        // matches the map key when loading a stored document; a mismatch stays
        // invalid so a corrupted file still fails closed.
        let candidate = target;
        if (target && typeof target === 'object' && !Array.isArray(target)
          && target.targetId !== undefined) {
          if (target.targetId !== targetId) {
            throw deliveryTargetError('invalid-target', 'Invalid target id');
          }
          const { targetId: _legacyTargetId, ...withoutLegacyId } = target;
          candidate = withoutLegacyId;
        }
        const normalized = normalizeDeliveryTarget(candidate, {
          targetId,
          allowSessionSync: version >= SESSION_SYNC_DOCUMENT_VERSION,
        });
        const { targetId: _targetId, ...stored } = normalized;
        normalizedTargets[targetId] = stored;
      }
      deliveryTargets[botId] = normalizedTargets;
    }
  } catch {
    return invalidWorkspaceConfig(field, 'invalid-delivery-target');
  }
  return deliveryTargets;
}

function normalizeAccessPolicies(value, workspaces) {
  const accessPolicies = Object.create(null);
  if (value === undefined) return accessPolicies;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    // Preserve the distinction between a missing policy (eligible for startup
    // initialization) and damaged persisted data (fail closed).
    for (const botId of Object.keys(workspaces)) accessPolicies[botId] = null;
    return accessPolicies;
  }
  for (const [botId, policy] of Object.entries(value)) {
    try {
      botIdOf(botId);
      accessPolicies[botId] = normalizeAccessPolicy(policy);
    } catch {
      // An invalid key cannot identify a bot, so it is isolated and ignored.
    }
  }
  return accessPolicies;
}

function normalizeDsBotBindings(value) {
  const bindings = Object.create(null);
  if (value === undefined) return bindings;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidWorkspaceConfig('dsBotBindings', 'expected-object');
  }
  try {
    for (const [botId, conversations] of Object.entries(value)) {
      botIdOf(botId);
      if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) throw new TypeError();
      bindings[botId] = Object.fromEntries(Object.entries(conversations).map(([key, dsBotId]) => (
        [conversationKeyOf(key), dsBotId === null ? null : botIdOf(dsBotId)]
      )));
    }
  } catch {
    return invalidWorkspaceConfig('dsBotBindings', 'invalid-binding');
  }
  return bindings;
}

function normalizeDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidWorkspaceConfig('$', 'expected-object');
  if (![1, DELIVERY_DOCUMENT_VERSION, SESSION_SYNC_DOCUMENT_VERSION, DS_BOT_DOCUMENT_VERSION, CURRENT_DOCUMENT_VERSION].includes(value.version)) return invalidWorkspaceConfig('version', 'unsupported-version');
  if (!value.workspaces || typeof value.workspaces !== 'object' || Array.isArray(value.workspaces)) return invalidWorkspaceConfig('workspaces', 'expected-object');
  const workspaces = {};
  for (const [index, [botId, workspace]] of Object.entries(value.workspaces).entries()) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) return invalidWorkspaceConfig(`workspaces[${index}].key`, 'invalid-identifier');
    if (typeof workspace !== 'string' || !isAbsolute(workspace)) return invalidWorkspaceConfig(`workspaces[${index}].value`, 'invalid-workspace-path');
    workspaces[botId] = resolve(workspace);
  }
  const conversationWorkspaces = normalizeConversationWorkspaces(value.conversationWorkspaces);
  let agentPresets = {};
  if (value.agentPresets !== undefined) {
    if (!value.agentPresets || typeof value.agentPresets !== 'object'
      || Array.isArray(value.agentPresets)) return invalidWorkspaceConfig('agentPresets', 'expected-object');
    for (const [index, [botId, agentPreset]] of Object.entries(value.agentPresets).entries()) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) return invalidWorkspaceConfig(`agentPresets[${index}].key`, 'invalid-identifier');
      try {
        const normalized = validateAgentPresetId(agentPreset);
        if (!normalized) return invalidWorkspaceConfig(`agentPresets[${index}].value`, 'invalid-agent-preset');
        agentPresets[botId] = normalized;
      } catch {
        return invalidWorkspaceConfig(`agentPresets[${index}].value`, 'invalid-agent-preset');
      }
    }
  }
  const models = {};
  if (value.models !== undefined) {
    if (!value.models || typeof value.models !== 'object' || Array.isArray(value.models)) {
      return invalidWorkspaceConfig('models', 'expected-object');
    }
    for (const [index, [botId, model]] of Object.entries(value.models).entries()) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) return invalidWorkspaceConfig(`models[${index}].key`, 'invalid-identifier');
      try {
        const normalized = validateModelSelection(model);
        if (!normalized) return invalidWorkspaceConfig(`models[${index}].value`, 'invalid-model-selection');
        models[botId] = normalized;
      } catch {
        return invalidWorkspaceConfig(`models[${index}].value`, 'invalid-model-selection');
      }
    }
  }
  const contextEnhancement = Object.create(null);
  // Enhancement damage is isolated from the existing workspace/preset document.
  if (value.contextEnhancement && typeof value.contextEnhancement === 'object'
    && !Array.isArray(value.contextEnhancement)) {
    for (const [botId, config] of Object.entries(value.contextEnhancement)) {
      if (/^[A-Za-z0-9_-]{1,128}$/.test(botId)) {
        contextEnhancement[botId] = normalizeContextEnhancementConfig(config);
      }
    }
  }
  if (value.version === 1 && value.deliveryTargets !== undefined) return invalidWorkspaceConfig('deliveryTargets', 'unexpected-field');
  const deliveryTargets = normalizeDeliveryTargets(value.deliveryTargets, { version: value.version });
  const dsBotBindings = normalizeDsBotBindings(value.dsBotBindings);
  const aliases = Object.create(null);
  if (value.aliases && typeof value.aliases === 'object' && !Array.isArray(value.aliases)) {
    for (const [botId, alias] of Object.entries(value.aliases)) {
      try {
        botIdOf(botId);
        const normalized = validateBotAlias(alias);
        if (normalized) aliases[botId] = normalized;
      } catch { /* A damaged display name must not disable the bot. */ }
    }
  }
  const busyMessageModes = Object.create(null);
  if (value.busyMessageModes && typeof value.busyMessageModes === 'object'
    && !Array.isArray(value.busyMessageModes)) {
    for (const [id, mode] of Object.entries(value.busyMessageModes)) {
      if (Object.hasOwn(workspaces, id) && mode === 'steer') busyMessageModes[id] = mode;
    }
  }
  const accessPolicies = normalizeAccessPolicies(value.accessPolicies, workspaces);
  const conversationDirectory = normalizeConversationDirectory(value.conversationDirectory);
  const conversationDirectories = normalizeConversationDirectoryOverrides(value.conversationDirectories);
  const sessionDirectories = normalizeSessionDirectories(value.sessionDirectories);
  const version = Math.max(
    value.version,
    value.accessPolicies === undefined ? 1 : DELIVERY_DOCUMENT_VERSION,
  );
  return {
    // A v1 file cannot be emitted with this optional v2 section. If one is
    // recovered from an interrupted/manual edit, retain it on the next write.
    version,
    workspaces,
    conversationWorkspaces,
    conversationDirectory,
    conversationDirectories,
    sessionDirectories,
    agentPresets,
    models,
    contextEnhancement,
    deliveryTargets,
    dsBotBindings,
    accessPolicies,
    aliases,
    busyMessageModes,
  };
}

function storedDocument({
  version,
  workspaces,
  conversationWorkspaces,
  conversationDirectory,
  conversationDirectories,
  sessionDirectories,
  agentPresets,
  models,
  contextEnhancement,
  deliveryTargets,
  dsBotBindings,
  accessPolicies,
  aliases,
  busyMessageModes,
}) {
  const document = { version, workspaces };
  if (conversationDirectory) document.conversationDirectory = conversationDirectory;
  if (Object.keys(conversationDirectories).length) document.conversationDirectories = conversationDirectories;
  if (Object.keys(sessionDirectories).length) document.sessionDirectories = sessionDirectories;
  if (Object.keys(dsBotBindings).length > 0) document.dsBotBindings = dsBotBindings;
  if (Object.keys(busyMessageModes).length > 0) document.busyMessageModes = busyMessageModes;
  if (Object.keys(aliases).length > 0) document.aliases = aliases;
  if (Object.keys(conversationWorkspaces).length > 0) {
    document.conversationWorkspaces = conversationWorkspaces;
  }
  if (Object.keys(agentPresets).length > 0) document.agentPresets = agentPresets;
  if (Object.keys(models).length > 0) document.models = models;
  if (Object.keys(contextEnhancement).length > 0) {
    document.contextEnhancement = contextEnhancement;
  }
  if (version >= DELIVERY_DOCUMENT_VERSION && Object.keys(deliveryTargets).length > 0) {
    document.deliveryTargets = deliveryTargets;
  }
  if (version >= DELIVERY_DOCUMENT_VERSION && Object.keys(accessPolicies).length > 0) {
    document.accessPolicies = accessPolicies;
  }
  return document;
}

async function writeStoredDocument(path, document) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function validateWorkspacePath(value, { ungroupedWorkspace } = {}) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim())) {
    const error = new Error('工作区必须是绝对路径。');
    error.code = 'workspace-not-absolute';
    throw error;
  }
  const workspace = resolve(value.trim());
  await ensureImWorkspaceDirectory(workspace, ungroupedWorkspace);
  let info;
  try {
    info = await stat(workspace);
  } catch (cause) {
    const error = new Error('工作区路径不存在。', { cause });
    error.code = 'workspace-not-found';
    throw error;
  }
  if (!info.isDirectory()) {
    const error = new Error('工作区路径必须指向一个目录。');
    error.code = 'workspace-not-directory';
    throw error;
  }
  return workspace;
}

export class BotWorkspaceStore {
  #path;
  #defaultWorkspace;
  #ungroupedWorkspace;
  #groupByAgentPreset;
  #entryAgentPreset;
  #version = 1;
  #workspaces = {};
  #agentPresets = {};
  #models = {};
  #aliases = Object.create(null);
  #busyMessageModes = Object.create(null);
  #contextEnhancement = {};
  #deliveryTargets = Object.create(null);
  #dsBotBindings = Object.create(null);
  #accessPolicies = Object.create(null);
  #conversationWorkspaces = Object.create(null);
  #conversationDirectory = null;
  #conversationDirectories = Object.create(null);
  #sessionDirectories = Object.create(null);
  #generations = new Map();
  #nextGeneration = 1;
  #conversationGenerations = new Map();
  #nextConversationGeneration = 1;
  #incarnations = new Map();
  #nextIncarnation = 1;
  #removals = new Map();
  #removalDetails = new WeakMap();
  #dirtyRemovals = new Set();
  #writeQueue = Promise.resolve();
  #botQueues = new Map();

  constructor(path, { defaultWorkspace = defaultImWorkspace(), ungroupedWorkspace, groupByAgentPreset = false, entryAgentPreset } = {}) {
    if (typeof path !== 'string' || !path) throw new TypeError('workspace store path is required');
    this.#path = path;
    this.#defaultWorkspace = resolve(defaultWorkspace);
    this.#ungroupedWorkspace = ungroupedWorkspace;
    this.#groupByAgentPreset = groupByAgentPreset === true;
    this.#entryAgentPreset = validateAgentPresetId(entryAgentPreset);
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      this.#version = normalized.version;
      this.#workspaces = normalized.workspaces;
      this.#agentPresets = normalized.agentPresets;
      this.#models = normalized.models;
      this.#aliases = normalized.aliases;
      this.#busyMessageModes = normalized.busyMessageModes;
      this.#contextEnhancement = normalized.contextEnhancement;
      this.#deliveryTargets = normalized.deliveryTargets;
      this.#dsBotBindings = normalized.dsBotBindings;
      this.#accessPolicies = normalized.accessPolicies;
      this.#conversationWorkspaces = normalized.conversationWorkspaces;
      this.#conversationDirectory = normalized.conversationDirectory;
      this.#conversationDirectories = normalized.conversationDirectories;
      this.#sessionDirectories = normalized.sessionDirectories;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw withConfigResource(error, 'workspace-config');
      this.#version = 1;
      this.#workspaces = {};
      this.#agentPresets = {};
      this.#models = {};
      this.#aliases = Object.create(null);
      this.#busyMessageModes = Object.create(null);
      this.#contextEnhancement = {};
      this.#deliveryTargets = Object.create(null);
      this.#dsBotBindings = Object.create(null);
      this.#accessPolicies = Object.create(null);
      this.#conversationWorkspaces = Object.create(null);
      this.#conversationDirectory = null;
      this.#conversationDirectories = Object.create(null);
      this.#sessionDirectories = Object.create(null);
    }
    this.#generations.clear();
    this.#nextGeneration = 1;
    this.#conversationGenerations.clear();
    this.#nextConversationGeneration = 1;
    this.#incarnations.clear();
    this.#nextIncarnation = 1;
    this.#removals.clear();
    this.#dirtyRemovals.clear();
    for (const botId of Object.keys(this.#workspaces)) {
      this.#generations.set(botId, this.#freshGeneration());
      this.#incarnations.set(botId, this.#freshIncarnation());
    }
    return this;
  }

  has(botId) {
    const id = botIdOf(botId);
    return Object.hasOwn(this.#workspaces, id) && !this.#removals.has(id);
  }

  listBotIds() {
    return Object.keys(this.#workspaces)
      .filter((botId) => !this.#removals.has(botId))
      .sort();
  }

  incarnationFor(botId) {
    return this.#incarnations.get(botIdOf(botId)) ?? null;
  }

  workspaceFor(botId) {
    return this.#workspaces[botIdOf(botId)] ?? this.#defaultWorkspace;
  }

  conversationDirectoryFor(botId) {
    const id = botIdOf(botId);
    return { ...(Object.hasOwn(this.#conversationDirectories, id)
      ? this.#conversationDirectories[id]
      : this.#conversationDirectory ?? DEFAULT_CONVERSATION_DIRECTORY) };
  }

  conversationDirectoryOverrideFor(botId) {
    const id = botIdOf(botId);
    return Object.hasOwn(this.#conversationDirectories, id)
      ? { ...this.#conversationDirectories[id] } : null;
  }

  async setConversationDirectory(botId, config, { incarnation } = {}) {
    const id = botId === null ? null : botIdOf(botId);
    const normalized = config === null ? null : validateConversationDirectory(config);
    return this.#enqueue(id ?? '__channel__', async () => {
      if (id !== null && (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id)))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const previousDefault = this.#conversationDirectory;
      const previousOverrides = { ...this.#conversationDirectories };
      if (id === null) this.#conversationDirectory = normalized;
      else if (normalized === null) delete this.#conversationDirectories[id];
      else this.#conversationDirectories[id] = normalized;
      try { await this.#persist(); }
      catch (error) {
        this.#conversationDirectory = previousDefault;
        this.#conversationDirectories = previousOverrides;
        throw error;
      }
    });
  }

  conversationDirectoryPathsFor(botId) {
    return [...new Set(Object.values(this.#sessionDirectories[botIdOf(botId)] ?? {})
      .flatMap((entry) => [entry.workspace, ...(entry.history ?? [])]))];
  }

  async prepareConversationDirectory(botId, conversationKey, {
    explicitNew = false, incarnation, clearSession, onConversationGeneration,
  } = {}) {
    const id = botIdOf(botId);
    if (!this.has(id) || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const config = this.conversationDirectoryFor(id);
    if (!config.enabled) return null;
    return this.#enqueue(id, async () => {
      const existing = this.#sessionDirectories[id]?.[conversationKey];
      const current = this.conversationWorkspaceFor(id, conversationKey);
      const records = Object.values(this.#sessionDirectories[id] ?? {});
      let base = existing?.base ?? current;
      const visited = new Set();
      while (!visited.has(base)) {
        visited.add(base);
        const parent = records.find((record) => record.workspace === base
          || record.history?.includes(base))?.base;
        if (!parent || parent === base) break;
        base = parent;
      }
      const sameConfig = existing?.workspace === current && existing?.base === base
        && existing?.strategy === config.strategy && existing?.prefix === config.prefix;
      const reuse = sameConfig && (config.strategy === 'per-conversation'
        || (!explicitNew && existing?.pending));
      const timestamp = reuse ? existing.timestamp : Date.now();
      const workspace = reuse ? existing.workspace : resolve(base, conversationDirectoryName(conversationKey, config, timestamp, `${this.#path}:${id}`));
      try { await prepareDirectoryPath(base, workspace); }
      catch (error) {
        console.warn('[dsh-im] conversation directory preparation failed:', error?.message ?? error);
        return { warning: '会话目录未生效：无法创建目录（权限或磁盘空间不足）；本次仍在原工作区运行。' };
      }
      const entries = { ...(this.#sessionDirectories[id] ?? {}), [conversationKey]: {
        base, workspace, ...config, timestamp, pending: explicitNew,
        history: existing && existing.workspace !== workspace
          ? [...new Set([...(existing.history ?? []), existing.workspace])]
          : existing?.history ?? [],
      } };
      const previousRecords = this.#sessionDirectories[id];
      const previousOverrides = this.#conversationWorkspaces[id];
      if (workspace !== current) {
        const generation = this.publishConversationWorkspaceSwitch(id, conversationKey);
        onConversationGeneration?.(generation);
        await clearSession?.(conversationKey);
      }
      this.#sessionDirectories[id] = entries;
      const overrides = { ...(this.#conversationWorkspaces[id] ?? {}), [conversationKey]: workspace };
      this.#conversationWorkspaces[id] = overrides;
      try { await this.#persist(); }
      catch (error) {
        if (previousRecords) this.#sessionDirectories[id] = previousRecords;
        else delete this.#sessionDirectories[id];
        if (previousOverrides) this.#conversationWorkspaces[id] = previousOverrides;
        else delete this.#conversationWorkspaces[id];
        console.warn('[dsh-im] conversation directory switch failed:', error?.message ?? error);
        return { warning: '会话目录未生效：无法切换目录；本次仍在原工作区运行。' };
      }
      return { workspace };
    });
  }

  /**
   * An explicit override is stored even when it equals the current bot default,
   * so a later default change must never move a conversation that pinned its
   * own workspace.
   */
  hasConversationWorkspaceOverride(botId, conversationKey) {
    const id = botIdOf(botId);
    return Boolean(conversationKey) && Boolean(this.#conversationWorkspaces[id]?.[conversationKey]);
  }

  conversationWorkspaceFor(botId, conversationKey) {
    const id = botIdOf(botId);
    const override = this.#conversationWorkspaces[id]?.[conversationKey];
    if (override) return override;
    return this.workspaceFor(id);
  }

  conversationGenerationFor(botId, conversationKey) {
    if (typeof conversationKey !== 'string' || !conversationKey) return null;
    return this.#conversationGenerations.get(
      conversationWorkspaceGenerationKey(botId, conversationKey),
    ) ?? null;
  }

  groupsByAgentPreset(botId) {
    return this.#groupByAgentPreset && !this.conversationDirectoryFor(botId).enabled;
  }

  agentPresetFor(botId) {
    return this.#entryAgentPreset ?? this.#agentPresets[botIdOf(botId)] ?? null;
  }

  modelFor(botId) {
    const selection = this.#models[botIdOf(botId)];
    return selection ? { ...selection } : null;
  }

  aliasFor(botId) {
    const id = botIdOf(botId);
    return this.has(id) && Object.hasOwn(this.#aliases, id) ? this.#aliases[id] : '';
  }

  busyMessageModeFor(botId) {
    const id = botIdOf(botId);
    return normalizeBusyMessageMode(this.has(id) ? this.#busyMessageModes[id] : undefined);
  }

  contextEnhancementFor(botId) {
    const id = botIdOf(botId);
    return this.has(id) && Object.hasOwn(this.#contextEnhancement, id)
      ? this.#contextEnhancement[id]
      : DEFAULT_CONTEXT_ENHANCEMENT_CONFIG;
  }

  accessPolicyFor(botId) {
    const id = botIdOf(botId);
    return this.has(id) && Object.hasOwn(this.#accessPolicies, id)
      ? this.#accessPolicies[id]
      : null;
  }

  listDeliveryTargets(botId) {
    const id = botIdOf(botId);
    if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
    return Object.entries(this.#deliveryTargets[id] ?? {})
      .map(([targetId, target]) => publicDeliveryTarget(target, { targetId }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
  }

  deliveryTargetFor(botId, targetId) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
    const target = this.#deliveryTargets[id]?.[targetKey];
    return target ? publicDeliveryTarget(target, { targetId: targetKey }) : null;
  }

  listSessionSyncTargets() {
    const targets = [];
    for (const [botId, botTargets] of Object.entries(this.#deliveryTargets)) {
      if (!this.has(botId)) continue;
      for (const [targetId, target] of Object.entries(botTargets)) {
        const normalized = normalizeDeliveryTarget(target, {
          targetId,
          allowSessionSync: true,
        });
        if (!normalized.sessionSync) continue;
        targets.push({
          botId,
          targetId,
          conversationKey: normalized.sessionSync.conversationKey,
        });
      }
    }
    return targets.sort((left, right) => (
      left.botId.localeCompare(right.botId) || left.targetId.localeCompare(right.targetId)
    ));
  }

  async createDeliveryTarget(botId, value) {
    const id = botIdOf(botId);
    const target = normalizeDeliveryTarget(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
      if (Object.hasOwn(this.#deliveryTargets[id] ?? {}, target.targetId)) {
        throw deliveryTargetError('target-conflict', 'Target already exists');
      }
      const { targetId, ...stored } = target;
      const next = {
        ...this.#deliveryTargets,
        [id]: { ...(this.#deliveryTargets[id] ?? {}), [targetId]: stored },
      };
      const nextVersion = Math.max(this.#version, DELIVERY_DOCUMENT_VERSION);
      await this.#persist(this.#contextEnhancement, next, nextVersion);
      this.#deliveryTargets = next;
      this.#version = nextVersion;
      return publicDeliveryTarget(stored, { targetId });
    });
  }

  async updateDeliveryTarget(botId, targetId, value) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    const replacement = normalizeDeliveryTarget(value, { targetId: targetKey });
    return this.#enqueue(id, async () => {
      if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
      if (!Object.hasOwn(this.#deliveryTargets[id] ?? {}, targetKey)) {
        throw deliveryTargetError('unknown-target', 'Unknown target');
      }
      const { targetId: _targetId, ...stored } = replacement;
      const previous = this.#deliveryTargets[id][targetKey];
      const nextStored = previous.sessionSync && sameDeliveryRoute(previous, stored)
        ? { ...stored, sessionSync: previous.sessionSync }
        : stored;
      const next = {
        ...this.#deliveryTargets,
        [id]: { ...this.#deliveryTargets[id], [targetKey]: nextStored },
      };
      const nextVersion = Math.max(this.#version, DELIVERY_DOCUMENT_VERSION);
      await this.#persist(this.#contextEnhancement, next, nextVersion);
      this.#deliveryTargets = next;
      this.#version = nextVersion;
      return publicDeliveryTarget(nextStored, { targetId: targetKey });
    });
  }

  async deleteDeliveryTarget(botId, targetId) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    return this.#enqueue(id, async () => {
      if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
      if (!Object.hasOwn(this.#deliveryTargets[id] ?? {}, targetKey)) {
        throw deliveryTargetError('unknown-target', 'Unknown target');
      }
      const botTargets = { ...this.#deliveryTargets[id] };
      delete botTargets[targetKey];
      const next = { ...this.#deliveryTargets };
      if (Object.keys(botTargets).length > 0) next[id] = botTargets;
      else delete next[id];
      const nextVersion = Math.max(this.#version, DELIVERY_DOCUMENT_VERSION);
      await this.#persist(this.#contextEnhancement, next, nextVersion);
      this.#deliveryTargets = next;
      this.#version = nextVersion;
      return true;
    });
  }

  async setDeliveryTargetSessionSync(botId, targetId, conversationKeyOrNull) {
    const id = botIdOf(botId);
    const targetKey = targetIdOf(targetId);
    const conversationKey = conversationKeyOrNull === null
      ? null
      : conversationKeyOf(conversationKeyOrNull);
    return this.#enqueue(id, async () => {
      if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
      const previous = this.#deliveryTargets[id]?.[targetKey];
      if (!previous) throw deliveryTargetError('unknown-target', 'Unknown target');
      const previousKey = previous.sessionSync?.conversationKey ?? null;
      if (previousKey === conversationKey) return conversationKey !== null;
      const nextStored = { ...previous };
      if (conversationKey === null) delete nextStored.sessionSync;
      else nextStored.sessionSync = { conversationKey };
      const next = {
        ...this.#deliveryTargets,
        [id]: { ...this.#deliveryTargets[id], [targetKey]: nextStored },
      };
      await this.#persist(this.#contextEnhancement, next, CURRENT_DOCUMENT_VERSION);
      this.#deliveryTargets = next;
      this.#version = CURRENT_DOCUMENT_VERSION;
      return conversationKey !== null;
    });
  }

  generationFor(botId) {
    return this.#generations.get(botIdOf(botId)) ?? null;
  }

  dsBotBindingFor(botId, conversationKey) {
    const dsBotId = this.#dsBotBindings[botId]?.[conversationKey];
    return this.has(botId) && dsBotId ? { botId, conversationKey, dsBotId } : null;
  }

  listDsBotBindings(botId) {
    return Object.entries(this.#dsBotBindings).flatMap(([id, conversations]) => (
      this.has(id) && (botId === undefined || botId === id)
        ? Object.entries(conversations).filter(([, dsBotId]) => dsBotId !== null)
          .map(([conversationKey, dsBotId]) => ({ botId: id, conversationKey, dsBotId }))
        : []
    ));
  }

  dsBotConversationKeys(botId) {
    return this.has(botId) ? Object.keys(this.#dsBotBindings[botId] ?? {}) : [];
  }

  async setDsBotBinding(botId, conversationKey, dsBotId) {
    const id = botIdOf(botId);
    const key = conversationKeyOf(conversationKey);
    const selected = dsBotId === null ? null : botIdOf(dsBotId);
    return this.#enqueue(id, async () => {
      if (!this.has(id)) throw deliveryTargetError('unknown-bot', 'Unknown bot');
      const conversations = { ...this.#dsBotBindings[id] };
      if (selected !== null && (conversations[key] || Object.values(conversations).includes(selected))) {
        throw deliveryTargetError('ds-bot-binding-conflict', 'DS Bot or private chat is already bound');
      }
      // Keep a confirmed private-chat key after unbinding so it can be selected
      // again without keeping its old DS Bot session mapping alive.
      conversations[key] = selected;
      const next = { ...this.#dsBotBindings, [id]: conversations };
      if (!Object.keys(conversations).length) delete next[id];
      await this.#persist(
        this.#contextEnhancement, this.#deliveryTargets, CURRENT_DOCUMENT_VERSION,
        this.#accessPolicies, this.#aliases, this.#conversationWorkspaces, this.#busyMessageModes, next,
      );
      this.#dsBotBindings = next;
      this.#version = CURRENT_DOCUMENT_VERSION;
      return this.dsBotBindingFor(id, key);
    });
  }

  async whenIdle() {
    await this.#writeQueue;
  }

  async whenBotIdle(botId) {
    const id = botIdOf(botId);
    while (true) {
      const pending = this.#botQueues.get(id);
      if (!pending) return;
      await pending;
      if (this.#botQueues.get(id) === pending) return;
    }
  }

  async ensure(botId, {
    workspace = this.#defaultWorkspace,
    defaultAgentPreset,
    initialAccessPolicy,
  } = {}) {
    const id = botIdOf(botId);
    const initialWorkspace = resolve(workspace);
    return this.#enqueue(id, async () => {
      const createsBot = !this.#workspaces[id];
      const initializesAccessPolicy = initialAccessPolicy !== undefined
        && !Object.hasOwn(this.#accessPolicies, id);
      const accessPolicy = initializesAccessPolicy
        ? validateAccessPolicy(initialAccessPolicy)
        : undefined;
      const agentPreset = createsBot ? validateAgentPresetId(defaultAgentPreset) : null;
      // Resolve saved bot/conversation choices before preparing the shared IM
      // directory. Merely loading a channel must not create an unused fallback.
      const selectedWorkspaces = new Set([
        this.#workspaces[id] ?? initialWorkspace,
        ...Object.values(this.#conversationWorkspaces[id] ?? {}),
      ]);
      for (const selected of selectedWorkspaces) {
        await ensureImWorkspaceDirectory(selected, this.#ungroupedWorkspace);
      }
      if (createsBot || initializesAccessPolicy) {
        const hadAgentPreset = Object.hasOwn(this.#agentPresets, id);
        const previousAgentPreset = this.#agentPresets[id];
        const nextAccessPolicies = initializesAccessPolicy
          ? { ...this.#accessPolicies, [id]: accessPolicy }
          : this.#accessPolicies;
        if (createsBot) {
          this.#workspaces[id] = initialWorkspace;
          if (agentPreset) this.#agentPresets[id] = agentPreset;
          this.#generations.set(id, this.#freshGeneration());
          this.#incarnations.set(id, this.#freshIncarnation());
        }
        const nextVersion = initializesAccessPolicy
          ? Math.max(this.#version, DELIVERY_DOCUMENT_VERSION)
          : this.#version;
        try {
          await this.#persist(
            this.#contextEnhancement,
            this.#deliveryTargets,
            nextVersion,
            nextAccessPolicies,
          );
        } catch (error) {
          if (createsBot) {
            delete this.#workspaces[id];
            if (hadAgentPreset) this.#agentPresets[id] = previousAgentPreset;
            else delete this.#agentPresets[id];
            this.#generations.delete(id);
            this.#incarnations.delete(id);
          }
          throw error;
        }
        this.#accessPolicies = nextAccessPolicies;
        this.#version = nextVersion;
      } else if (!this.#generations.has(id)) {
        this.#generations.set(id, this.#freshGeneration());
      }
      return this.#workspaces[id];
    });
  }

  async setWorkspace(botId, value, { clearSessions, incarnation } = {}) {
    const id = botIdOf(botId);
    if (this.conversationDirectoryFor(id).enabled) throw workspaceManualEditDisabled();
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const workspace = await validateWorkspacePath(value, { ungroupedWorkspace: this.#ungroupedWorkspace });
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      if (workspace === this.workspaceFor(id)) return workspace;
      const previous = this.#workspaces[id];
      // Advance first so a session creation that started before this queued
      // transition can never be written back after the clear.
      this.#generations.set(id, this.#freshGeneration());
      // Clear the old session mapping before publishing the new workspace.
      // A crash can then lose conversation continuity, but can never pair the
      // new workspace with sessions created in the old one.
      await clearSessions?.();
      this.#workspaces[id] = workspace;
      try {
        await this.#persist();
      } catch (error) {
        this.#workspaces[id] = previous;
        throw error;
      }
      return workspace;
    });
  }

  async setConversationWorkspace(botId, conversationKey, value, {
    clearSession,
    incarnation,
  } = {}) {
    const id = botIdOf(botId);
    if (this.conversationDirectoryFor(id).enabled) throw workspaceManualEditDisabled();
    if (typeof conversationKey !== 'string' || !conversationKey
      || conversationKey.length > 1_024 || conversationKey.trim() !== conversationKey
      || /[\u0000-\u001f\u007f]/u.test(conversationKey)) {
      throw new TypeError('conversationKey is required');
    }
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const token = this.publishConversationWorkspaceSwitch(id, conversationKey);
    return this.applyConversationWorkspaceSwitch(id, conversationKey, value, {
      token,
      clearSession,
      incarnation,
    });
  }

  async setAgentPreset(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const agentPreset = validateAgentPresetId(value);
    if (this.#entryAgentPreset) {
      if (agentPreset && agentPreset !== this.#entryAgentPreset) {
        throw new HarnessError(t('此连接由总助手统一接待，专家由总助手在任务中调用。'), 'agent-preset-unavailable');
      }
      return this.#entryAgentPreset;
    }
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const previous = this.#agentPresets[id] ?? null;
      if (previous === agentPreset) return agentPreset;
      if (agentPreset) this.#agentPresets[id] = agentPreset;
      else delete this.#agentPresets[id];
      try {
        await this.#persist();
      } catch (error) {
        if (previous) this.#agentPresets[id] = previous;
        else delete this.#agentPresets[id];
        throw error;
      }
      return agentPreset;
    });
  }

  async setModel(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const model = validateModelSelection(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const previous = this.#models[id] ?? null;
      if (sameModelSelection(previous, model)) return model ? { ...model } : null;
      if (model) this.#models[id] = model;
      else delete this.#models[id];
      try {
        await this.#persist();
      } catch (error) {
        if (previous) this.#models[id] = previous;
        else delete this.#models[id];
        throw error;
      }
      return model ? { ...model } : null;
    });
  }

  async setAlias(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    const expectedIncarnation = incarnation === undefined ? this.incarnationFor(id) : incarnation;
    const alias = validateBotAlias(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id) || expectedIncarnation !== this.incarnationFor(id)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const next = { ...this.#aliases };
      if (alias) next[id] = alias;
      else delete next[id];
      await this.#persist(this.#contextEnhancement, this.#deliveryTargets,
        this.#version, this.#accessPolicies, next);
      this.#aliases = next;
      return alias;
    });
  }

  async setBusyMessageMode(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    const expectedIncarnation = incarnation === undefined ? this.incarnationFor(id) : incarnation;
    const mode = validateBusyMessageMode(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id) || expectedIncarnation !== this.incarnationFor(id)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const next = { ...this.#busyMessageModes };
      if (mode === 'steer') next[id] = mode;
      else delete next[id];
      // Publish only after the same atomic write used by the other bot settings.
      await this.#persist(this.#contextEnhancement, this.#deliveryTargets,
        this.#version, this.#accessPolicies, this.#aliases, this.#conversationWorkspaces, next);
      this.#busyMessageModes = next;
      return mode;
    });
  }

  async setContextEnhancement(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    const expectedIncarnation = incarnation === undefined ? this.incarnationFor(id) : incarnation;
    const config = validateContextEnhancementConfig(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id) || expectedIncarnation !== this.incarnationFor(id)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const next = { ...this.#contextEnhancement, [id]: config };
      // Messages keep the previous committed snapshot until rename succeeds.
      await this.#persist(next);
      this.#contextEnhancement = next;
      return config;
    });
  }

  async setAccessPolicy(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    const expectedIncarnation = incarnation === undefined ? this.incarnationFor(id) : incarnation;
    const policy = validateAccessPolicy(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id) || expectedIncarnation !== this.incarnationFor(id)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const next = { ...this.#accessPolicies, [id]: policy };
      // Inbound messages keep the previous committed snapshot until rename succeeds.
      await this.#persist(
        this.#contextEnhancement,
        this.#deliveryTargets,
        Math.max(this.#version, DELIVERY_DOCUMENT_VERSION),
        next,
      );
      this.#accessPolicies = next;
      this.#version = Math.max(this.#version, DELIVERY_DOCUMENT_VERSION);
      return policy;
    });
  }

  /**
   * Publish the fence for a conversation-level switch before its asynchronous
   * work starts. Every session that was resolved for this conversation is
   * invalidated from this moment on: a bind or prompt already in flight must
   * not keep running (or be written back) in the workspace being left behind.
   * Returns the opaque token that applyConversationWorkspaceSwitch requires, so
   * two overlapping switches cannot adopt each other's fence.
   */
  publishConversationWorkspaceSwitch(botId, conversationKey) {
    const id = botIdOf(botId);
    conversationKeyOf(conversationKey);
    const token = this.#freshConversationGeneration();
    this.#conversationGenerations.set(
      conversationWorkspaceGenerationKey(id, conversationKey),
      token,
    );
    return token;
  }

  /** True while this token is still the current fence for the conversation. */
  isConversationWorkspaceSwitchCurrent(botId, conversationKey, token) {
    const id = botIdOf(botId);
    conversationKeyOf(conversationKey);
    return this.#conversationGenerations.get(
      conversationWorkspaceGenerationKey(id, conversationKey),
    ) === token;
  }

  async applyConversationWorkspaceSwitch(botId, conversationKey, value, {
    token,
    clearSession,
    sessionMatchesWorkspace,
    incarnation,
  } = {}) {
    const id = botIdOf(botId);
    const key = conversationKeyOf(conversationKey);
    if (typeof token !== 'number') throw new TypeError('token is required');
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    // Validate before queueing so an invalid path fails without disturbing the
    // conversation's current workspace or its session.
    const workspace = value === null ? null : await validateWorkspacePath(value, {
      ungroupedWorkspace: this.#ungroupedWorkspace,
    });
    return this.#enqueue(id, async () => {
      const assertCurrentSwitch = () => {
        if (!this.has(id)
          || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
          const error = new Error('找不到要修改的机器人。');
          error.code = 'workspace-bot-not-found';
          throw error;
        }
        if (!this.isConversationWorkspaceSwitchCurrent(id, key, token)) {
          throw workspaceSessionStale(
            'The conversation workspace changed before this switch could be committed.',
          );
        }
      };
      assertCurrentSwitch();
      if (workspace === null) {
        await ensureImWorkspaceDirectory(this.workspaceFor(id), this.#ungroupedWorkspace);
        assertCurrentSwitch();
      }
      const previousOverrides = this.#conversationWorkspaces[id];
      const previous = previousOverrides?.[key];
      const hadOverride = Boolean(previousOverrides)
        && Object.hasOwn(previousOverrides, key);
      if (workspace === null ? !hadOverride : (hadOverride && previous === workspace)) {
        // The override may be unchanged while a binding persisted by an older
        // version still points elsewhere. Only preserve a verified matching
        // Session; never acknowledge /conv while keeping a foreign cwd.
        const matches = await sessionMatchesWorkspace?.(this.conversationWorkspaceFor(id, key));
        assertCurrentSwitch();
        if (matches === false) {
          await clearSession?.();
          assertCurrentSwitch();
        }
        return this.conversationWorkspaceFor(id, key);
      }
      const next = workspace === null
        ? (() => {
          const overrides = { ...previousOverrides };
          delete overrides[key];
          return overrides;
        })()
        : { ...previousOverrides, [key]: workspace };
      await clearSession?.();
      assertCurrentSwitch();
      if (Object.keys(next).length > 0) this.#conversationWorkspaces[id] = next;
      else delete this.#conversationWorkspaces[id];
      try {
        // Binding a conversation to its own current default is still persisted:
        // a later bot-default change must not move a conversation that pinned
        // the workspace it was using.
        await this.#persist();
      } catch (error) {
        if (Object.keys(next).length > 0 || hadOverride) {
          this.#conversationWorkspaces[id] = {
            ...(previousOverrides ?? {}),
            ...(hadOverride ? { [key]: previous } : {}),
          };
        } else {
          delete this.#conversationWorkspaces[id];
        }
        throw error;
      }
      return this.conversationWorkspaceFor(id, key);
    });
  }

  async bindWorkspaceSession(botId, value, {
    conversationKey,
    sessionId,
    clearSessions,
    clearSession,
    setSession,
    onConversationGeneration,
    incarnation,
    expectedGeneration,
    expectedConversationGeneration,
    preserveBotWorkspace = false,
  } = {}) {
    const id = botIdOf(botId);
    if (typeof conversationKey !== 'string' || !conversationKey
      || typeof sessionId !== 'string' || !sessionId) {
      throw new TypeError('conversationKey and sessionId are required');
    }
    if (typeof clearSessions !== 'function' || typeof setSession !== 'function') {
      throw new TypeError('session state callbacks are required');
    }
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    // Capture before any asynchronous lookup, unless the caller already captured
    // the fence before adopting the Session.
    let conversationGeneration = expectedConversationGeneration === undefined
      ? this.conversationGenerationFor(id, conversationKey)
      : expectedConversationGeneration;
    const assertConversationCurrent = () => {
      if (conversationGeneration !== this.conversationGenerationFor(id, conversationKey)) {
        throw workspaceSessionStale(
          'The conversation workspace changed before the session binding could be committed.',
        );
      }
    };
    const workspace = await canonicalWorkspacePath(await validateWorkspacePath(value, {
      ungroupedWorkspace: this.#ungroupedWorkspace,
    }));
    if (this.conversationDirectoryFor(id).enabled
      && !(await sameWorkspacePath(workspace, this.conversationWorkspaceFor(id, conversationKey)))) {
      throw workspaceManualEditDisabled();
    }
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      if (expectedGeneration !== undefined
        && expectedGeneration !== this.generationFor(id)) {
        throw workspaceSessionStale(
          'The bot workspace changed before the session binding could be committed.',
        );
      }
      // An explicit session binding is also a conversation-level statement: a
      // workspace switch queued while the session was being adopted must not be
      // silently overwritten by the binding that started before it.
      assertConversationCurrent();
      if (this.conversationDirectoryFor(id).enabled || preserveBotWorkspace) {
        if (!preserveBotWorkspace
          && !(await sameWorkspacePath(workspace, this.conversationWorkspaceFor(id, conversationKey)))) {
          throw workspaceManualEditDisabled();
        }
        assertConversationCurrent();
        await setSession(conversationKey, sessionId);
        assertConversationCurrent();
        return {
          workspace, sessionId,
          generation: this.#generations.get(id),
          conversationGeneration,
        };
      }
      const sameWorkspace = await sameWorkspacePath(workspace, this.workspaceFor(id));
      const previousOverrides = this.#conversationWorkspaces[id];
      const override = previousOverrides?.[conversationKey];
      const clearsOverride = override !== undefined && !(await sameWorkspacePath(workspace, override));
      assertConversationCurrent();
      if (!sameWorkspace || clearsOverride) {
        if (sameWorkspace && typeof clearSession !== 'function') {
          throw new TypeError('clearSession is required to reconcile a conversation workspace');
        }
        const previous = this.#workspaces[id];
        if (clearsOverride) {
          // /session keeps its bot-default semantics, but cannot leave this
          // conversation pinned to a different cwd from the adopted Session.
          // Publish the new fence to the scope before any asynchronous work.
          conversationGeneration = this.publishConversationWorkspaceSwitch(id, conversationKey);
          onConversationGeneration?.(conversationGeneration);
        }
        if (!sameWorkspace) {
          this.#generations.set(id, this.#freshGeneration());
          await clearSessions();
        } else {
          await clearSession(conversationKey);
        }
        assertConversationCurrent();
        if (!sameWorkspace) this.#workspaces[id] = workspace;
        if (clearsOverride) {
          const next = { ...previousOverrides };
          delete next[conversationKey];
          if (Object.keys(next).length) this.#conversationWorkspaces[id] = next;
          else delete this.#conversationWorkspaces[id];
        }
        try {
          await this.#persist();
        } catch (error) {
          // Session mappings stay cleared and the advanced generation stays
          // fenced. Restoring either could pair an old session with a state
          // transition whose durable outcome is unknown.
          this.#workspaces[id] = previous;
          if (clearsOverride) this.#conversationWorkspaces[id] = previousOverrides;
          throw error;
        }
      }

      // This write remains inside the same bot transition as the workspace
      // mutation, so another switch or bind cannot interleave between them.
      assertConversationCurrent();
      await setSession(conversationKey, sessionId);
      assertConversationCurrent();
      return {
        workspace,
        sessionId,
        generation: this.#generations.get(id),
        conversationGeneration,
      };
    });
  }

  async invalidateSessions(botId, { clearSessions } = {}) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      this.#generations.set(id, this.#freshGeneration());
      await clearSessions?.();
    });
  }

  /** Fence one lifecycle and return the opaque token required to abort/finish it. */
  async beginRemoval(botId, { clearSessions } = {}) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      const existing = this.#removals.get(id);
      if (existing) return existing;
      const transaction = Object.freeze({});
      this.#removals.set(id, transaction);
      this.#removalDetails.set(transaction, {
        botId: id,
        incarnation: this.incarnationFor(id),
      });
      this.#generations.set(id, this.#freshGeneration());
      try {
        await clearSessions?.();
      } catch (error) {
        if (this.#removals.get(id) === transaction) this.#removals.delete(id);
        throw error;
      }
      return transaction;
    });
  }

  /** Re-open only the lifecycle represented by transaction; stale tokens are no-ops. */
  async abortRemoval(transaction) {
    const { botId: id } = this.#removalDetailsFor(transaction);
    return this.#enqueue(id, async () => {
      if (this.#removals.get(id) !== transaction) return false;
      this.#removals.delete(id);
      if (Object.hasOwn(this.#workspaces, id)) {
        this.#generations.set(id, this.#freshGeneration());
        if (!this.#incarnations.has(id)) {
          this.#incarnations.set(id, this.#freshIncarnation());
        }
      }
      return true;
    });
  }

  /** Retire only the lifecycle represented by transaction; stale tokens are no-ops. */
  async finishRemoval(transaction) {
    const { botId: id, incarnation } = this.#removalDetailsFor(transaction);
    return this.#enqueue(id, async () => {
      if (this.#removals.get(id) !== transaction) {
        return { removed: false, persisted: true, error: null, stale: true };
      }
      if (this.incarnationFor(id) !== incarnation) {
        this.#removals.delete(id);
        return { removed: false, persisted: true, error: null, stale: true };
      }
      this.#removals.delete(id);
      return this.#retireCurrentIncarnation(id);
    });
  }

  /** Commit the workspace lifecycle after the config store durably removed a bot. */
  async retireAfterConfigCommit(botId) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      this.#removals.delete(id);
      return this.#retireCurrentIncarnation(id);
    });
  }

  /** A failed retirement must reach disk before the same config ID can be rebound. */
  flushPendingRemoval(botId) {
    if (!this.#dirtyRemovals.has(botId)) return undefined;
    return this.#enqueue(botId, async () => {
      if (this.#dirtyRemovals.has(botId)) await this.#persistCurrentDocument();
    });
  }

  async remove(botId) {
    const result = await this.retireAfterConfigCommit(botId);
    if (result.error) throw result.error;
    return result.removed;
  }

  async reconcile(activeBotIds) {
    const active = new Set([...activeBotIds].map(botIdOf));
    const candidates = new Set([
      ...Object.keys(this.#workspaces),
      ...Object.keys(this.#agentPresets),
      ...Object.keys(this.#models),
      ...Object.keys(this.#aliases),
      ...Object.keys(this.#busyMessageModes),
      ...Object.keys(this.#contextEnhancement),
      ...Object.keys(this.#deliveryTargets),
      ...Object.keys(this.#accessPolicies),
      ...Object.keys(this.#conversationWorkspaces),
      ...Object.keys(this.#conversationDirectories),
      ...Object.keys(this.#sessionDirectories),
      ...this.#dirtyRemovals,
    ]);
    for (const botId of candidates) {
      if (!active.has(botId)) await this.remove(botId);
    }
  }

  decorateStatus(status) {
    if (!status || typeof status !== 'object' || !Array.isArray(status.bots)) return status;
    return {
      ...status,
      conversationDirectory: this.#conversationDirectory ? { ...this.#conversationDirectory } : null,
      bots: status.bots.map((bot) => bot?.botId
        ? {
          ...bot,
          ...(this.aliasFor(bot.botId) ? { bot: withBotAlias(bot.bot, this.aliasFor(bot.botId)) } : {}),
          workspace: this.workspaceFor(bot.botId),
          conversationDirectory: this.conversationDirectoryFor(bot.botId),
          conversationDirectoryOverride: this.conversationDirectoryOverrideFor(bot.botId),
          agentPreset: this.agentPresetFor(bot.botId),
          model: this.modelFor(bot.botId),
          contextEnhancement: this.contextEnhancementFor(bot.botId),
          busyMessageMode: this.busyMessageModeFor(bot.botId),
          accessPolicy: this.accessPolicyFor(bot.botId),
        }
        : bot),
    };
  }

  #freshGeneration() {
    const generation = this.#nextGeneration;
    this.#nextGeneration += 1;
    return generation;
  }

  #freshIncarnation() {
    const incarnation = this.#nextIncarnation;
    this.#nextIncarnation += 1;
    return incarnation;
  }

  #freshConversationGeneration() {
    const generation = this.#nextConversationGeneration;
    this.#nextConversationGeneration += 1;
    return generation;
  }

  #removalDetailsFor(transaction) {
    if (!transaction || typeof transaction !== 'object') {
      throw new TypeError('Invalid workspace removal transaction');
    }
    const details = this.#removalDetails.get(transaction);
    if (!details) throw new TypeError('Invalid workspace removal transaction');
    return details;
  }

  async #retireCurrentIncarnation(id) {
    const hadWorkspace = Object.hasOwn(this.#workspaces, id);
    const hadPreset = Object.hasOwn(this.#agentPresets, id);
    const hadModel = Object.hasOwn(this.#models, id);
    const hadAlias = Object.hasOwn(this.#aliases, id);
    const hadMessageMode = Object.hasOwn(this.#busyMessageModes, id);
    const hadContextEnhancement = Object.hasOwn(this.#contextEnhancement, id);
    const hadDeliveryTargets = Object.hasOwn(this.#deliveryTargets, id);
    const hadDsBotBindings = Object.hasOwn(this.#dsBotBindings, id);
    const hadAccessPolicy = Object.hasOwn(this.#accessPolicies, id);
    const hadConversationWorkspaces = Object.hasOwn(this.#conversationWorkspaces, id);
    const hadDirectoryRecords = Object.hasOwn(this.#conversationDirectories, id) || Object.hasOwn(this.#sessionDirectories, id);
    const needsCleanup = hadWorkspace || hadPreset || hadModel || hadAlias || hadContextEnhancement
      || hadDeliveryTargets || hadDsBotBindings || hadAccessPolicy || hadConversationWorkspaces || hadMessageMode
      || hadDirectoryRecords
      || this.#dirtyRemovals.has(id);
    delete this.#workspaces[id];
    delete this.#agentPresets[id];
    delete this.#models[id];
    delete this.#aliases[id];
    delete this.#busyMessageModes[id];
    delete this.#contextEnhancement[id];
    delete this.#deliveryTargets[id];
    delete this.#dsBotBindings[id];
    delete this.#accessPolicies[id];
    delete this.#conversationWorkspaces[id];
    delete this.#conversationDirectories[id];
    delete this.#sessionDirectories[id];
    this.#generations.delete(id);
    this.#incarnations.delete(id);
    if (!needsCleanup) return {
      removed: false, persisted: true, error: null, stale: false,
    };
    try {
      await this.#persistCurrentDocument();
      return {
        removed: hadWorkspace, persisted: true, error: null, stale: false,
      };
    } catch (error) {
      this.#dirtyRemovals.add(id);
      return {
        removed: hadWorkspace, persisted: false, error, stale: false,
      };
    }
  }

  async #enqueue(botId, operation) {
    const queued = this.#writeQueue.then(operation, operation);
    const settled = queued.then(() => undefined, () => undefined);
    this.#writeQueue = settled;
    this.#botQueues.set(botId, settled);
    void settled.finally(() => {
      if (this.#botQueues.get(botId) === settled) this.#botQueues.delete(botId);
    });
    return queued;
  }

  async #persist(
    contextEnhancement = this.#contextEnhancement,
    deliveryTargets = this.#deliveryTargets,
    version = this.#version,
    accessPolicies = this.#accessPolicies,
    aliases = this.#aliases,
    conversationWorkspaces = this.#conversationWorkspaces,
    busyMessageModes = this.#busyMessageModes,
    dsBotBindings = this.#dsBotBindings,
    conversationDirectory = this.#conversationDirectory,
    conversationDirectories = this.#conversationDirectories,
    sessionDirectories = this.#sessionDirectories,
  ) {
    await writeStoredDocument(this.#path, storedDocument({
      version,
      workspaces: this.#workspaces,
      conversationWorkspaces,
      agentPresets: this.#agentPresets,
      models: this.#models,
      contextEnhancement,
      deliveryTargets,
      dsBotBindings,
      accessPolicies,
      aliases,
      busyMessageModes,
      conversationDirectory,
      conversationDirectories,
      sessionDirectories,
    }));
    this.#dirtyRemovals.clear();
  }

  async #persistCurrentDocument() {
    if (Object.keys(this.#workspaces).length > 0
      || Object.keys(this.#agentPresets).length > 0
      || Object.keys(this.#models).length > 0
      || Object.keys(this.#aliases).length > 0
      || Object.keys(this.#busyMessageModes).length > 0
      || Object.keys(this.#contextEnhancement).length > 0
      || Object.keys(this.#deliveryTargets).length > 0
      || Object.keys(this.#dsBotBindings).length > 0
      || Object.keys(this.#accessPolicies).length > 0
      || Object.keys(this.#conversationWorkspaces).length > 0) {
      await this.#persist();
      return;
    }
    try {
      const parent = await stat(dirname(this.#path));
      if (!parent.isDirectory()) {
        const error = new Error('workspace config parent is not a directory');
        error.code = 'ENOTDIR';
        throw error;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#dirtyRemovals.clear();
      return;
    }
    try {
      await unlink(this.#path);
      this.#dirtyRemovals.clear();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#dirtyRemovals.clear();
    }
  }
}

function resolveAgentPresetCatalog(catalog) {
  if (!catalog) return null;
  const value = typeof catalog === 'function' ? catalog() : catalog;
  return value && typeof value.then === 'function'
    ? value.then(normalizeAgentPresetCatalog)
    : normalizeAgentPresetCatalog(value);
}

function resolveModelCatalog(catalog, options) {
  if (!catalog) return null;
  const value = typeof catalog === 'function' ? catalog(options) : catalog;
  return value && typeof value.then === 'function'
    ? value.then(normalizeModelCatalog)
    : normalizeModelCatalog(value);
}

function unavailableAgentPreset() {
  const error = new Error('Agent Preset 不存在或不可用。');
  error.code = 'agent-preset-unavailable';
  return error;
}

function unavailableModel() {
  const error = new Error('模型不存在或不可用。');
  error.code = 'model-selection-unavailable';
  return error;
}

function unavailableModelCatalog(cause) {
  const error = new Error(t('无法读取所选模型的列表，模型设置未保存，请重试。'), { cause });
  error.code = 'model-catalog-unavailable';
  return connectionStageError(error, 'status.read', undefined, { method: 'llm.models' });
}

function assertCurrentBotScope(isCurrentScope) {
  if (isCurrentScope()) return;
  const error = new Error('找不到要修改的机器人。');
  error.code = 'workspace-bot-not-found';
  throw error;
}

function decorateResult(workspaces, result, agentPresetCatalogSource, modelCatalogSource) {
  const decorate = (value) => {
    const decorated = workspaces.decorateStatus(value);
    if ((!agentPresetCatalogSource && !modelCatalogSource)
      || !decorated || typeof decorated !== 'object') return decorated;
    const attachCatalogs = ([agentPresetCatalog, modelCatalog]) => ({
      ...decorated,
      ...(agentPresetCatalog ? { agentPresetCatalog } : {}),
      ...(modelCatalog ? { modelCatalog } : {}),
    });
    const catalogs = [
      resolveAgentPresetCatalog(agentPresetCatalogSource),
      resolveModelCatalog(modelCatalogSource),
    ];
    return catalogs.some((catalog) => catalog && typeof catalog.then === 'function')
      ? Promise.all(catalogs).then(attachCatalogs)
      : attachCatalogs(catalogs);
  };
  return result && typeof result.then === 'function'
    ? result.then(decorate)
    : decorate(result);
}

function targetStatus(controller) {
  return Promise.resolve(controller.status());
}

/** Observe durable removals and finish failed cleanup before a same-ID config save. */
export function observeBotWorkspaceRemovals(
  configStore,
  {
    workspaces,
    method = 'remove',
    botIdFromRemoved = (removed) => removed?.botId,
    saveMethod = 'save',
    botIdFromSave = (config) => config?.botId,
  },
) {
  if (!configStore || !workspaces || typeof configStore[method] !== 'function') {
    throw new TypeError('configStore removal observer dependencies are required');
  }
  return new Proxy(configStore, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === method) {
        return async (...args) => {
          const removed = await value.apply(target, args);
          const botId = removed ? botIdFromRemoved(removed, args) : null;
          if (botId) {
            const cleanup = await atConnectionStage('workspace.cleanup', () => workspaces.retireAfterConfigCommit(botId), 'workspace-config');
            if (cleanup?.error) throw connectionStageError(cleanup.error, 'workspace.cleanup', 'workspace-config');
          }
          return removed;
        };
      }
      if (property === saveMethod && typeof value === 'function') {
        return (...args) => {
          const cleanup = workspaces.flushPendingRemoval(botIdFromSave(args[0], args));
          return cleanup ? cleanup.then(() => value.apply(target, args)) : value.apply(target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createBotWorkspaceScope(
  harness,
  { botId, workspaces, state, agentPresetCatalog, dsBot } = {},
) {
  if (!harness || !workspaces || !state) throw new TypeError('harness, workspaces, and state are required');
  const incarnation = workspaces.incarnationFor(botId);
  const isCurrentScope = () => workspaces.has(botId)
    && workspaces.incarnationFor(botId) === incarnation;
  const dsBinding = (key) => workspaces.dsBotBindingFor?.(botId, key);
  const assertNoDsBinding = (key) => {
    if (dsBinding(key)) {
      throw deliveryTargetError('ds-bot-bound', t('请先在“绑定 DS Bot”中解除绑定，再切换会话或工作目录。'));
    }
  };
  const presetSettings = async (catalog = agentPresetCatalog) => {
    let normalizedCatalog;
    try {
      normalizedCatalog = await resolveAgentPresetCatalog(catalog)
        ?? normalizeAgentPresetCatalog(null);
    } catch (error) {
      assertCurrentBotScope(isCurrentScope);
      throw error;
    }
    assertCurrentBotScope(isCurrentScope);
    return {
      agentPreset: workspaces.agentPresetFor(botId),
      agentPresetCatalog: normalizedCatalog,
    };
  };
  const sessionGenerations = new Map();
  // A conversation-level switch/clear publishes an opaque mask token before it
  // starts its asynchronous work, so a bind or prompt that was already resolved
  // for that conversation is rejected instead of running in the old workspace.
  // The store keeps the same token as the conversation's generation, so the
  // scope marker and the durable generation never disagree.
  const conversationSwitchMasks = new Map();
  // The in-flight switch of each conversation, so a message that starts while
  // /conv is still committing waits for the new workspace instead of resolving
  // a session in the old one.
  const pendingConversationSwitches = new Map();

  function trackConversationSwitch(conversationKey, promise) {
    pendingConversationSwitches.set(conversationKey, promise);
    return promise.finally(() => {
      if (pendingConversationSwitches.get(conversationKey) === promise) {
        pendingConversationSwitches.delete(conversationKey);
        if (isCurrentScope()) refreshRetainedSession(conversationKey);
      }
    });
  }

  function currentConversationGeneration(conversationKey) {
    // The store reports "no override recorded yet" as null; map it to an opaque
    // token so "before the first switch" is still a comparable state.
    const generation = workspaces.conversationGenerationFor(botId, conversationKey);
    return generation ?? 0;
  }

  function maskConversationSwitch(conversationKey, token) {
    if (!conversationKey) return;
    conversationSwitchMasks.set(
      conversationKey,
      token === undefined ? currentConversationGeneration(conversationKey) : token,
    );
  }

  function conversationGenerationIsStale(conversationKey, expected) {
    if (typeof conversationKey !== 'string' || !conversationKey) return false;
    const mask = conversationSwitchMasks.get(conversationKey);
    if (mask !== undefined && mask !== currentConversationGeneration(conversationKey)) {
      return true;
    }
    if (expected === undefined) return false;
    return expected !== currentConversationGeneration(conversationKey);
  }

  function generationIsStale(entry, conversationKey = entry?.conversationKey) {
    return Boolean(entry)
      && ((entry.generation !== undefined && entry.generation !== workspaces.generationFor(botId))
        || (entry.conversationKey === conversationKey
          && conversationGenerationIsStale(conversationKey, entry.conversationGeneration)));
  }

  /**
   * Refresh provenance only for a mapping that survived an unchanged/failed
   * switch. Removed mappings and pending creates retain their old fence, so a
   * delayed setSession cannot resurrect them after the switch finishes.
   */
  function refreshRetainedSession(conversationKey) {
    const sessionId = state.sessionFor?.(conversationKey);
    const entry = sessionGenerations.get(sessionId);
    if (entry?.conversationKey === conversationKey
      && entry.generation === workspaces.generationFor(botId)) {
      sessionGenerations.set(sessionId, {
        ...entry,
        conversationGeneration: currentConversationGeneration(conversationKey),
      });
    }
  }

  async function conversationSessionMatchesWorkspace(conversationKey, workspace) {
    const sessionId = state.sessionFor?.(conversationKey);
    if (!sessionId) return true;
    let sessionWorkspace = sessionGenerations.get(sessionId)?.workspace;
    let matches = false;
    let unregistered = true;
    if (!sessionWorkspace && typeof harness.rpc === 'function') {
      // Read registration metadata only: adopting a Session is not a lookup.
      // Resolve by id before comparing real paths so symlink pins remain valid.
      const listed = await harness.rpc('workspace.list', {}, 30_000);
      if (!Array.isArray(listed?.items)) {
        throw new TypeError('Harness returned an invalid workspace list');
      }
      const owners = listed.items.filter((item) => Array.isArray(item?.sessionIds)
        && item.sessionIds.includes(sessionId));
      if (owners.length === 1 && typeof owners[0].path === 'string' && isAbsolute(owners[0].path)) {
        sessionWorkspace = owners[0].path;
      }
      unregistered = owners.length === 0;
    }
    if (!sessionWorkspace && unregistered && typeof harness.listWorkspaceSessions === 'function') {
      // After a restart, default IM sessions have no registry owner. Reuse
      // the read-only list, which also recognizes ungrouped default sessions.
      const listed = await harness.listWorkspaceSessions(await canonicalWorkspacePath(workspace));
      if (!Array.isArray(listed?.sessions)) {
        throw new TypeError('Harness returned an invalid workspace session list');
      }
      matches = listed.sessions.some((session) => session?.sessionId === sessionId);
    }
    if (sessionWorkspace) matches = await sameWorkspacePath(sessionWorkspace, workspace);
    if (state.sessionFor(conversationKey) !== sessionId) {
      throw workspaceSessionStale('The session binding changed while its workspace was being checked.');
    }
    return matches;
  }

  const scopedHarness = new Proxy(harness, {
    get(target, property) {
      if (property === 'sessionFor') {
        // Read-only state lookup used by /sessionlist to mark the binding. The
        // state proxy owns the generation checks, so delegate instead of
        // exposing the raw mapping.
        return (key, ...args) => scopedState.sessionFor(key, ...args);
      }
      if (property === 'resolveDsBotSession') {
        return async (key) => {
          assertCurrentBotScope(isCurrentScope);
          const binding = dsBinding(key);
          if (!binding) return null;
          if (!dsBot) throw deliveryTargetError('ds-bot-unavailable', 'DS Bot 当前不可用，请检查插件状态。');
          let bot = await dsBot.resolve(binding.dsBotId);
          if (typeof target.isSessionArchived === 'function' && (await target.isSessionArchived(bot.sessionId))) {
            for (let i = 0; i < 5; i += 1) {
              await new Promise((resolve) => setTimeout(resolve, 200));
              const updated = await dsBot.resolve(binding.dsBotId).catch(() => null);
              if (updated && updated.sessionId !== bot.sessionId && !(await target.isSessionArchived(updated.sessionId))) {
                bot = updated;
                break;
              }
            }
          }
          if (!(await target.sessionExists(bot.sessionId)) || (typeof target.isSessionArchived === 'function' && (await target.isSessionArchived(bot.sessionId)))) {
            throw deliveryTargetError('ds-bot-not-found', 'DS Bot 的当前会话不可用。');
          }
          assertCurrentBotScope(isCurrentScope);
          if (dsBinding(key)?.dsBotId !== binding.dsBotId) throw workspaceSessionStale('DS Bot binding changed');
          if (state.sessionFor(key) !== bot.sessionId) await state.setSession(key, bot.sessionId);
          sessionGenerations.set(bot.sessionId, {
            generation: workspaces.generationFor(botId),
            conversationKey: key,
            conversationGeneration: currentConversationGeneration(key),
          });
          return bot.sessionId;
        };
      }
      if (property === 'agentPresetSettings') {
        return async (options = {}) => {
          options?.signal?.throwIfAborted();
          assertCurrentBotScope(isCurrentScope);
          const settings = await presetSettings();
          options?.signal?.throwIfAborted();
          return settings;
        };
      }
      if (property === 'updateAgentPreset') {
        return async (value, options = {}) => {
          options?.signal?.throwIfAborted();
          assertCurrentBotScope(isCurrentScope);
          const agentPreset = value === '--default' ? null : validateAgentPresetId(value);
          let catalog = null;
          if (agentPreset) {
            ({ agentPresetCatalog: catalog } = await presetSettings());
            options?.signal?.throwIfAborted();
            if (!catalog.items.some((item) => item.id === agentPreset)) {
              throw unavailableAgentPreset();
            }
          }
          if (workspaces.groupsByAgentPreset?.(botId)) {
            await ensurePresetWorkspace(target, workspaces.workspaceFor(botId), agentPreset, catalog, options);
            assertCurrentBotScope(isCurrentScope);
          }
          await workspaces.setAgentPreset(botId, agentPreset, { incarnation });
          assertCurrentBotScope(isCurrentScope);
          if (catalog) {
            return {
              agentPreset: workspaces.agentPresetFor(botId),
              agentPresetCatalog: catalog,
            };
          }
          try {
            return await presetSettings();
          } catch (error) {
            if (error?.code === 'workspace-bot-not-found') throw error;
            assertCurrentBotScope(isCurrentScope);
            return {
              agentPreset: workspaces.agentPresetFor(botId),
              agentPresetCatalog: normalizeAgentPresetCatalog(null),
            };
          }
        };
      }
      if (property === 'currentBusyMessageMode') {
        return () => isCurrentScope() ? workspaces.busyMessageModeFor(botId) : 'queue';
      }
      if (property === 'currentWorkspace') {
        return () => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return workspaces.workspaceFor(botId);
        };
      }
      if (property === 'assertWorkspaceScope') {
        return () => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
        };
      }
      if (property === 'archiveWorkspaceSession' && typeof target[property] === 'function') {
        // Archiving mutates Harness state, so it checks the bot scope on both
        // sides of the call like every other write this scope exposes.
        return async (...args) => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          const result = await target.archiveWorkspaceSession(...args);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return result;
        };
      }
      if ((property === 'listWorkspaces'
        || property === 'listWorkspaceEntries'
        || property === 'listWorkspaceSessions'
        || property === 'listModels')
        && typeof target[property] === 'function') {
        return async (...args) => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          const result = await target[property](...args);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return result;
        };
      }
      if (property === 'switchWorkspace') {
        return (workspace) => {
          if (workspaces.conversationDirectoryFor(botId).enabled) {
            return Promise.reject(workspaceManualEditDisabled());
          }
          if (workspaces.listDsBotBindings(botId).length > 0) {
            throw deliveryTargetError('ds-bot-bound', '请先解除 DS Bot 绑定，再切换机器人工作目录。');
          }
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            return Promise.reject(error);
          }
          return workspaces.setWorkspace(botId, workspace, {
            clearSessions: () => state.clearSessions(),
            incarnation,
          });
        };
      }
      if (property === 'currentConversationWorkspace') {
        return (conversationKey) => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return workspaces.conversationWorkspaceFor(botId, conversationKey);
        };
      }
      if (property === 'resolveConversationWorkspace') {
        return async (conversationKey, options = {}) => {
          options.signal?.throwIfAborted();
          assertCurrentBotScope(isCurrentScope);
          const pending = pendingConversationSwitches.get(conversationKey);
          if (pending) await pending;
          await workspaces.whenBotIdle(botId);
          assertCurrentBotScope(isCurrentScope);
          const generation = workspaces.generationFor(botId);
          const conversationGeneration = currentConversationGeneration(conversationKey);
          const sessionId = scopedState.sessionFor(conversationKey);
          const configured = workspaces.conversationWorkspaceFor(botId, conversationKey);
          const preset = workspaces.agentPresetFor(botId);
          const assertUnchanged = () => {
            options.signal?.throwIfAborted();
            assertCurrentBotScope(isCurrentScope);
            if (generation !== workspaces.generationFor(botId)
              || conversationGenerationIsStale(conversationKey, conversationGeneration)
              || sessionId !== scopedState.sessionFor(conversationKey)
              || (!sessionId && preset !== workspaces.agentPresetFor(botId))) {
              throw workspaceSessionStale('The conversation changed while its workspace was being resolved.');
            }
          };
          if (sessionId) {
            const known = sessionGenerations.get(sessionId)?.workspace;
            if (known) {
              assertUnchanged();
              return known;
            }
            // The configured bot directory stays unchanged when a preset groups
            // a new session. Recover its actual owner after a restart, without
            // adopting the session or moving an older chat to the new preset.
            if (typeof target.rpc === 'function') {
              const listed = await target.rpc('workspace.list', {}, 30_000, options);
              assertUnchanged();
              if (!Array.isArray(listed?.items)) throw new TypeError('Harness returned an invalid workspace list');
              const owners = listed.items.filter((item) => Array.isArray(item?.sessionIds)
                && item.sessionIds.includes(sessionId));
              if (owners.length > 1) throw new TypeError('Harness returned multiple session workspaces');
              const workspace = owners[0]?.path ?? configured;
              if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
                throw new TypeError('Harness returned an invalid session workspace');
              }
              sessionGenerations.set(sessionId, { ...sessionGenerations.get(sessionId), workspace });
              return workspace;
            }
            return configured;
          }
          // With no binding (including after /new), list the next preset's
          // existing group. A read never creates a directory or registers it.
          if (preset && workspaces.groupsByAgentPreset?.(botId)
            && !workspaces.hasConversationWorkspaceOverride(botId, conversationKey)
            && await target.isUngroupedWorkspace?.(configured)) {
            const directory = join(configured, 'presets', preset);
            const exists = await stat(directory).then((entry) => entry.isDirectory(), (error) => {
              if (error?.code === 'ENOENT') return false;
              throw error;
            });
            assertUnchanged();
            if (exists) return directory;
          }
          assertUnchanged();
          return configured;
        };
      }
      if (property === 'hasConversationWorkspaceOverride') {
        return (conversationKey) => {
          assertCurrentBotScope(isCurrentScope);
          return workspaces.hasConversationWorkspaceOverride(botId, conversationKey);
        };
      }
      if (property === 'pendingConversationWorkspaceSwitch') {
        // Read-only: callers in the message path wait for a switch that is
        // still committing before they resolve a session for this conversation.
        return (conversationKey) => pendingConversationSwitches.get(conversationKey) ?? null;
      }
      if (property === 'conversationWorkspaceGeneration') {
        // Read-only fence token for the conversation's effective workspace.
        // Callers outside this scope (message bridging) compare it across the
        // bind and the send so a late switch cannot be outrun.
        return (conversationKey) => currentConversationGeneration(conversationKey);
      }
      if (property === 'conversationDirectoryConfig') {
        return () => workspaces.conversationDirectoryFor(botId);
      }
      if (property === 'conversationDirectoryPaths') {
        return () => workspaces.conversationDirectoryPathsFor(botId);
      }
      if (property === 'prepareConversationDirectory') {
        return async (conversationKey, options = {}) => {
          assertCurrentBotScope(isCurrentScope);
          assertNoDsBinding(conversationKey);
          const pending = pendingConversationSwitches.get(conversationKey);
          if (pending) await pending;
          assertCurrentBotScope(isCurrentScope);
          return trackConversationSwitch(conversationKey, workspaces.prepareConversationDirectory(botId, conversationKey, {
            ...options,
            incarnation,
            clearSession: (key) => state.clearSession(key),
            onConversationGeneration: (generation) => maskConversationSwitch(conversationKey, generation),
          }));
        };
      }
      if (property === 'switchConversationWorkspace') {
        return (conversationKey, workspace) => {
          if (workspaces.conversationDirectoryFor(botId).enabled) {
            return Promise.reject(workspaceManualEditDisabled());
          }
          assertNoDsBinding(conversationKey);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            return Promise.reject(error);
          }
          const token = workspaces.publishConversationWorkspaceSwitch(botId, conversationKey);
          maskConversationSwitch(conversationKey, token);
          return trackConversationSwitch(conversationKey, workspaces.applyConversationWorkspaceSwitch(botId, conversationKey, workspace, {
            token,
            sessionMatchesWorkspace: (selected) => conversationSessionMatchesWorkspace(conversationKey, selected),
            clearSession: async () => {
              await state.clearSession(conversationKey);
              // A handle resolved before this switch must not stay usable: the
              // conversation now belongs to another workspace.
            },
            incarnation,
          }));
        };
      }
      if (property === 'clearConversationWorkspace') {
        return (conversationKey) => {
          if (workspaces.conversationDirectoryFor(botId).enabled) {
            return Promise.reject(workspaceManualEditDisabled());
          }
          assertNoDsBinding(conversationKey);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            return Promise.reject(error);
          }
          const token = workspaces.publishConversationWorkspaceSwitch(botId, conversationKey);
          maskConversationSwitch(conversationKey, token);
          return trackConversationSwitch(conversationKey, workspaces.applyConversationWorkspaceSwitch(botId, conversationKey, null, {
            token,
            sessionMatchesWorkspace: (selected) => conversationSessionMatchesWorkspace(conversationKey, selected),
            clearSession: async () => {
              await state.clearSession(conversationKey);
            },
            incarnation,
          }));
        };
      }
      if (property === 'bindWorkspaceSession') {
        return async (conversationKey, sessionId, options = {}) => {
          const { expectedWorkspace } = options;
          assertNoDsBinding(conversationKey);
          if (typeof conversationKey !== 'string' || !conversationKey
            || typeof sessionId !== 'string' || !sessionId) {
            throw new TypeError('conversationKey and sessionId are required');
          }
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (typeof target.adoptWorkspaceSession !== 'function') {
            throw new TypeError('Harness does not support adopting workspace sessions');
          }
          const expectedGeneration = workspaces.generationFor(botId);
          const expectedConversationGeneration = workspaces.conversationGenerationFor(botId, conversationKey);
          const adopted = await target.adoptWorkspaceSession(sessionId);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (expectedGeneration !== workspaces.generationFor(botId)) {
            throw workspaceSessionStale(
              'The bot workspace changed while the session was being adopted.',
            );
          }
          if (expectedConversationGeneration
            !== workspaces.conversationGenerationFor(botId, conversationKey)) {
            throw workspaceSessionStale(
              'The conversation workspace changed while the session was being adopted.',
            );
          }
          if (!adopted || typeof adopted !== 'object'
            || adopted.sessionId !== sessionId || typeof adopted.workspace !== 'string') {
            throw new TypeError('Harness returned an invalid adopted workspace session');
          }
          // Title selection is local to the Workspace observed by the search.
          // Recheck it here before committing; explicit IDs retain their
          // existing bot-wide switching behavior.
          const localBinding = expectedWorkspace !== undefined;
          if (localBinding
            && (!(await sameWorkspacePath(adopted.workspace, expectedWorkspace))
              || !(await sameWorkspacePath(adopted.workspace,
                await scopedHarness.resolveConversationWorkspace(conversationKey))))) {
            throw workspaceSessionStale('The conversation workspace changed during session selection.');
          }
          // Selecting another session in the current automatic group must not
          // turn that group into the bot's manual directory and clear every
          // other conversation. Explicit cross-workspace selection keeps its
          // existing bot-wide semantics.
          const baseWorkspace = workspaces.workspaceFor(botId);
          const preserveBotWorkspace = localBinding || (!workspaces.hasConversationWorkspaceOverride(botId, conversationKey)
            && normalizeAgentPresetId(basename(adopted.workspace)) !== null
            && await target.isUngroupedWorkspace?.(baseWorkspace)
            && await sameWorkspacePath(dirname(adopted.workspace), join(baseWorkspace, 'presets'))
            && await sameWorkspacePath(adopted.workspace,
              await scopedHarness.resolveConversationWorkspace(conversationKey)));
          const bound = await workspaces.bindWorkspaceSession(botId, adopted.workspace, {
            conversationKey,
            sessionId,
            clearSessions: () => state.clearSessions(),
            clearSession: (key) => state.clearSession(key),
            setSession: (key, selectedSessionId) => state.setSession(key, selectedSessionId),
            onConversationGeneration: (generation) => maskConversationSwitch(conversationKey, generation),
            incarnation,
            expectedGeneration,
            expectedConversationGeneration,
            preserveBotWorkspace,
          });
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (bound.generation !== workspaces.generationFor(botId)
            || bound.conversationGeneration
              !== workspaces.conversationGenerationFor(botId, conversationKey)) {
            throw workspaceSessionStale(
              'The bot workspace changed before the session binding completed.',
            );
          }
          sessionGenerations.set(sessionId, {
            generation: bound.generation,
            workspace: bound.workspace,
            conversationKey,
            conversationGeneration: bound.conversationGeneration ?? 0,
          });
          // /session, /go, /prev and /next all bind through this one path, so the
          // navigation ring records the bind here and stays in sync with the
          // Session binding itself. Best-effort: a ring write must not fail a bind.
          // A non-navigation bind (/session adopt) appends the Session as the
          // ring's current position; /go, /prev and /next manage the visit stack
          // themselves and pass { navigation: true } to skip this.
          try {
            const registered = await state.ensureSessionRing?.(conversationKey, sessionId, {
              title: typeof adopted.title === 'string' && adopted.title ? adopted.title : undefined,
            });
            if (options.navigation !== true && registered?.entry) {
              await state.appendRing?.(conversationKey, registered.entry.n);
            }
          } catch (error) {
            console.warn('[dsh-im] unable to record the session in the navigation ring:', error?.message ?? error);
          }
          return {
            ...adopted,
            workspace: bound.workspace,
            sessionId: bound.sessionId,
          };
        };
      }
      if (property === 'createSession') {
        return async (options = {}) => {
          const { inheritBotModel = true, conversationKey, ...createOptions } = options;
          assertNoDsBinding(conversationKey);
          if (conversationKey) {
            const prepared = await scopedHarness.prepareConversationDirectory(conversationKey);
            if (prepared?.workspace) createOptions.workspace = prepared.workspace;
          }
          // /conv publishes its generation before path validation enters the
          // bot queue. Wait for both phases before pairing a workspace with its
          // generation; otherwise a new session can carry a new fence but old cwd.
          while (true) {
            const pendingSwitch = pendingConversationSwitches.get(conversationKey);
            if (pendingSwitch) await pendingSwitch;
            await workspaces.whenBotIdle(botId);
            if (!pendingConversationSwitches.has(conversationKey)) break;
          }
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          const generation = workspaces.generationFor(botId);
          const conversationGeneration = conversationKey
            ? currentConversationGeneration(conversationKey)
            : null;
          const agentPreset = workspaces.agentPresetFor(botId);
          const model = inheritBotModel === false ? null : workspaces.modelFor(botId);
          let workspace = workspaces.conversationWorkspaceFor(botId, conversationKey);
          if (agentPreset && workspaces.groupsByAgentPreset?.(botId)
            && !workspaces.hasConversationWorkspaceOverride(botId, conversationKey)) {
            const settings = await presetSettings();
            workspace = await ensurePresetWorkspace(target, workspace, agentPreset, settings.agentPresetCatalog, options);
            assertCurrentBotScope(isCurrentScope);
          }
          const sessionId = await target.createSession({
            ...createOptions,
            workspace,
            ...(agentPreset == null ? {} : { agentPreset }),
          });
          // A conversation-level workspace switch can commit while the session is
          // being created; never bind a session created in the stale workspace to
          // a conversation whose override already moved on.
          if (conversationGenerationIsStale(conversationKey, conversationGeneration)) {
            throw workspaceSessionStale(
              'The conversation workspace changed while the session was being created.',
            );
          }
          if (model) {
            if (typeof target.selectSessionModel !== 'function') {
              throw new TypeError('Harness does not support model selection');
            }
            const selected = await target.selectSessionModel(
              sessionId,
              model,
              options.signal ? { signal: options.signal } : {},
            );
            if (!confirmsModelSelection(selected?.selected, model)) {
              const error = new Error('Harness did not confirm the selected model');
              error.code = 'model-selection-mismatch';
              throw error;
            }
          }
          sessionGenerations.set(sessionId, {
            generation,
            workspace,
            conversationKey,
            conversationGeneration,
          });
          return sessionId;
        };
      }
      if (property === 'workspaceSession') {
        return (sessionId, sessionConversationKey) => {
          if (typeof sessionId !== 'string' || !sessionId) {
            // A caller whose mapping was cleared under it must retry the
            // resolution instead of crashing on a handle it cannot use.
            return null;
          }
          const entry = sessionGenerations.get(sessionId);
          const generation = entry?.generation
            ?? workspaces.generationFor(botId);
          // A session handle that names its conversation also fences the
          // conversation's effective workspace: a switch that starts after the
          // bind but before the prompt is sent must not run in the old workspace.
          const conversationKey = typeof sessionConversationKey === 'string'
            && sessionConversationKey
            ? sessionConversationKey
            : entry?.conversationKey ?? null;
          const conversationGeneration = conversationKey
            ? (entry?.conversationKey === conversationKey
              ? entry.conversationGeneration
              : currentConversationGeneration(conversationKey))
            : null;
          // Copy provenance into the immutable handle, but retain it for a later
          // setSession (notably /model, which binds after asynchronous selection).
          const dsBotId = dsBinding(conversationKey)?.dsBotId;
          const isCurrentSession = () => isCurrentScope()
            && dsBinding(conversationKey)?.dsBotId === dsBotId
            && generation === workspaces.generationFor(botId)
            && !conversationGenerationIsStale(conversationKey, conversationGeneration);
          const invokeCurrentSession = async (method, args, action) => {
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed before this ${action} started.`,
              );
            }
            const result = await target[method](sessionId, ...args);
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed while this ${action} was running.`,
              );
            }
            return result;
          };
          const invokeStartedSessionMutation = async (method, args, action) => {
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed before this ${action} started.`,
              );
            }
            // Once an irreversible control mutation has started, preserve its
            // actual outcome even if a workspace switch commits concurrently.
            return target[method](sessionId, ...args);
          };
          let replySessionId = sessionId;
          return Object.freeze({
            sessionId,
            get replySessionId() { return replySessionId; },
            async sessionExists(...args) {
              if (!isCurrentSession()) return false;
              const exists = await target.sessionExists(sessionId, ...args);
              return isCurrentSession() && exists;
            },
            models(...args) {
              return invokeCurrentSession('getSessionModels', args, 'model listing');
            },
            ...(typeof target.getSessionPermissions === 'function' ? {
              permissions(...args) {
                return invokeCurrentSession('getSessionPermissions', args, 'permission listing');
              },
            } : {}),
            readHistory(...args) {
              return invokeCurrentSession('readSessionHistory', args, 'history read');
            },
            ...(typeof target.renameSession === 'function' ? {
              renameTitle(...args) {
                return invokeStartedSessionMutation('renameSession', args, 'title rename');
              },
            } : {}),
            async selectModel(selection, options = {}) {
              if (!dsBotId) {
                return invokeCurrentSession('selectSessionModel', [selection, options], 'model selection');
              }
              options.signal?.throwIfAborted();
              if (!isCurrentSession()) throw workspaceSessionStale('DS Bot binding changed before model selection.');
              const bot = await dsBot?.resolve(dsBotId);
              options.signal?.throwIfAborted();
              if (!bot || bot.sessionId !== sessionId || !isCurrentSession()) {
                throw workspaceSessionStale('DS Bot changed before model selection.');
              }
              if (typeof dsBot.updateBotModel !== 'function') {
                throw deliveryTargetError('ds-bot-unavailable', 'DS Bot model selection is unavailable.');
              }
              // This is a Bot-wide setting. Never mutate only the IM session: DS
              // Bot applies the choice to its own and group sessions as well.
              const result = await dsBot.updateBotModel(dsBotId, selection, options);
              const selected = result?.selected;
              if (!selected || selected.reasoningEffort !== undefined) return result;
              // Without a level DS Bot sends none, and DSH runs the model's
              // default one: report the level the Session actually runs.
              const current = (await target.getSessionModels(sessionId, options))?.current;
              return current?.provider === selected.provider && current?.model === selected.model
                ? { selected: { ...current } }
                : result;
            },
            isRunning(...args) {
              return invokeCurrentSession('isSessionRunning', args, 'run-state check');
            },
            hasActiveTurn(...args) {
              return invokeCurrentSession('hasActiveTurn', args, 'turn ownership check');
            },
            stopActiveTurn(...args) {
              return invokeStartedSessionMutation('stopActiveTurn', args, 'turn stop');
            },
            stopDeferredTurn(...args) {
              return invokeStartedSessionMutation('stopDeferredTurn', args, 'deferred turn stop');
            },
            steerActiveTurn(...args) {
              return invokeStartedSessionMutation('steerActiveTurn', args, 'turn steering');
            },
            ...(typeof target.executeCommand === 'function' ? {
              executeCommand(...args) {
                return invokeStartedSessionMutation('executeCommand', args, 'command execution');
              },
            } : {}),
            async ask(...args) {
              if (!isCurrentSession()) {
                throw workspaceSessionStale(
                  'The bot workspace changed before this prompt started.',
                );
              }
              if (dsBotId) {
                const bot = await dsBot?.resolve(dsBotId);
                if (!bot) throw deliveryTargetError('ds-bot-unavailable', 'DS Bot 当前不可用。');
                if (bot.sessionId !== sessionId || !isCurrentSession()) {
                  throw workspaceSessionStale('DS Bot changed before this prompt started.');
                }
              }
              if (!dsBotId) return target.ask(sessionId, ...args);
              const options = typeof args[1] === 'number' ? { timeoutMs: args[1] } : args[1] ?? {};
              const handoffResources = { stagedBatches: [] };
              let currentSessionId = sessionId;
              let promptRpcId;
              const assertStillBound = () => {
                options.signal?.throwIfAborted();
                if (!isCurrentSession()) {
                  // This input was already accepted. A stale-session error here
                  // would cause the outer loop to submit it again after unbind.
                  throw new DOMException('DS Bot binding changed while awaiting a reply.', 'AbortError');
                }
              };
              for (;;) {
                try {
                  const answer = promptRpcId
                    ? await target.waitForTransferredReply(currentSessionId, {
                        ...options, handoffResources, promptRpcId, assertCurrent: assertStillBound,
                      })
                    : await target.ask(sessionId, args[0], { ...options, handoffResources });
                  if (promptRpcId) assertStillBound();
                  replySessionId = currentSessionId;
                  return answer;
                } catch (askError) {
                  if (!dsBotId || !['session-archived', 'turn-blocked'].includes(askError?.code)) throw askError;
                  assertStillBound();
                  const evidence = extractConnectionEvidence(askError);
                  const notSubmitted = evidence.details.submissionState === 'not-submitted';
                  const accepted = askError.promptAccepted === true || evidence.details.submissionState === 'accepted';
                  const originalRpcId = promptRpcId ?? askError.details?.promptRpcId ?? evidence.correlation.promptRpcId;
                  // A failed submit can have an unknown outcome. Only explicit
                  // pre-submit evidence permits replay; everything else needs
                  // the durable identity of an accepted message to follow.
                  if (!notSubmitted && (!accepted || !originalRpcId
                    || typeof target.waitForTransferredReply !== 'function')) throw askError;
                  let fresh;
                  for (let attempt = 0; attempt < 6; attempt += 1) {
                    assertStillBound();
                    fresh = await dsBot.resolve(dsBotId).catch(() => null);
                    assertStillBound();
                    if (fresh && fresh.sessionId !== currentSessionId) break;
                    await delay(200, undefined, { signal: options.signal });
                  }
                  if (!fresh || fresh.sessionId === currentSessionId) throw askError;
                  if (notSubmitted) throw workspaceSessionStale('DS Bot rolled over before this prompt was submitted.');
                  currentSessionId = fresh.sessionId;
                  promptRpcId = originalRpcId;
                  await withSessionBindingLock(state, conversationKey, async () => {
                    assertStillBound();
                    await state.setSession(conversationKey, currentSessionId);
                    assertStillBound();
                    sessionGenerations.set(currentSessionId, {
                      generation, conversationKey, conversationGeneration,
                    });
                  });
                }
              }
            },
          });
        };
      }
      if (property === 'sessionExists') {
        return (sessionId, ...args) => {
          if (!isCurrentScope()) return false;
          const entry = sessionGenerations.get(sessionId);
          if (generationIsStale(entry)) {
            return false;
          }
          return target.sessionExists(sessionId, ...args);
        };
      }
      if (property === 'forkSession') {
        return async (sessionId, options = {}) => {
          if (!isCurrentScope()) {
            throw workspaceSessionStale('The bot workspace changed before the fork.');
          }
          if (generationIsStale(sessionGenerations.get(sessionId))) {
            throw workspaceSessionStale('The session is no longer in the current workspace.');
          }
          if (typeof target.forkSession !== 'function') {
            const error = new Error('The Host does not support forking sessions');
            error.code = 'harness-api-not-found';
            throw error;
          }
          const result = await target.forkSession(sessionId, options);
          if (!isCurrentScope()) {
            throw workspaceSessionStale('The bot workspace changed while the fork was running.');
          }
          return result;
        };
      }
      if (property === 'ask') {
        return (sessionId, ...args) => {
          const entry = sessionGenerations.get(sessionId);
          if (!isCurrentScope() || generationIsStale(entry)) {
            const error = new Error('The bot workspace changed before this prompt started.');
            error.code = WORKSPACE_SESSION_STALE;
            throw error;
          }
          return target.ask(sessionId, ...args);
        };
      }
      if (property === 'executeCommand' && typeof target.executeCommand === 'function') {
        return (sessionId, ...args) => {
          const entry = sessionGenerations.get(sessionId);
          if (!isCurrentScope() || generationIsStale(entry)) {
            const error = new Error('The bot workspace changed before this command started.');
            error.code = WORKSPACE_SESSION_STALE;
            throw error;
          }
          return target.executeCommand(sessionId, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scopedState = new Proxy(state, {
    get(target, property) {
      if (property === CONNECTION_TEST_STATE_IDENTITY || property === SESSION_BINDING_STATE_IDENTITY) return target;
      if (property === 'sessionFor') {
        return (key, ...args) => {
          if (!isCurrentScope()) return null;
          const sessionId = target.sessionFor(key, ...args);
          if (sessionId) {
            const entry = sessionGenerations.get(sessionId);
            if (generationIsStale(entry, key)) {
              // The conversation's effective workspace already moved on, so the
              // stored mapping must not be treated as a usable session. The
              // caller re-resolves one in the current workspace instead.
              return null;
            }
            if (!entry) {
              sessionGenerations.set(sessionId, {
                generation: workspaces.generationFor(botId),
                conversationKey: key,
                conversationGeneration: currentConversationGeneration(key),
              });
            }
          }
          return sessionId;
        };
      }
      if (property === 'setSession') {
        return (key, sessionId, ...args) => {
          if (dsBinding(key) && target.sessionFor(key) !== sessionId) assertNoDsBinding(key);
          const entry = sessionGenerations.get(sessionId);
          if (!isCurrentScope() || generationIsStale(entry, key)) {
            return false;
          }
          return target.setSession(key, sessionId, ...args);
        };
      }
      if (property === 'clearSession') {
        return (key, ...args) => {
          assertNoDsBinding(key);
          return target.clearSession(key, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return Object.freeze({ harness: scopedHarness, state: scopedState });
}

export function createBotScopedHarness(harness, options) {
  return createBotWorkspaceScope(harness, options).harness;
}

export function createWorkspaceAwareController(controller, {
  workspaces,
  harness,
  stateFor,
  agentPresetCatalog,
  modelCatalog,
  validateAccessPolicyForBot,
} = {}) {
  if (!controller || !workspaces || typeof stateFor !== 'function') {
    throw new TypeError('controller, workspaces, and stateFor are required');
  }
  const transitions = new Map();
  const withBotTransition = (botId, operation) => {
    const previous = transitions.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    transitions.set(botId, current);
    return current.finally(() => {
      if (transitions.get(botId) === current) transitions.delete(botId);
    });
  };
  const decorate = (value) => decorateResult(
    workspaces,
    value,
    agentPresetCatalog,
    modelCatalog,
  );
  const updateWorkspace = (botId, workspace) => {
    // Capture at API invocation, before even waiting for an older outer
    // transition. A queued request still belongs to the incarnation that the
    // caller observed, not a deterministic same-id rebind that appears later.
    const incarnation = workspaces.incarnationFor(botId);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const state = await stateFor(botId);
      await workspaces.setWorkspace(botId, workspace, {
        clearSessions: () => state.clearSessions(),
        incarnation,
      });
      return decorate(await controller.status());
    });
  };
  const updateAgentPreset = (botId, agentPreset) => {
    const incarnation = workspaces.incarnationFor(botId);
    const normalizedAgentPreset = validateAgentPresetId(agentPreset);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const catalog = normalizedAgentPreset && agentPresetCatalog
        ? await resolveAgentPresetCatalog(agentPresetCatalog)
        : null;
      if (normalizedAgentPreset && agentPresetCatalog
        && !catalog?.items.some((item) => item.id === normalizedAgentPreset)) {
        throw unavailableAgentPreset();
      }
      if (workspaces.groupsByAgentPreset?.(botId)) {
        await ensurePresetWorkspace(harness, workspaces.workspaceFor(botId), normalizedAgentPreset, catalog);
      }
      await workspaces.setAgentPreset(botId, normalizedAgentPreset, { incarnation });
      return decorateResult(
        workspaces,
        await controller.status(),
        catalog ?? agentPresetCatalog,
        modelCatalog,
      );
    });
  };
  const updateModel = (botId, value) => {
    const incarnation = workspaces.incarnationFor(botId);
    const model = validateModelSelection(value);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      let catalog = null;
      if (model && modelCatalog) {
        try {
          catalog = await resolveModelCatalog(modelCatalog, { fresh: true, throwOnError: true });
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          throw unavailableModelCatalog(error);
        }
        if (catalog?.failures.some((failure) => failure.id === model.provider)) {
          throw unavailableModelCatalog();
        }
      }
      const entry = modelCatalogEntry(catalog, model);
      if (model && (!modelCatalog || !entry)) {
        throw unavailableModel();
      }
      if (model?.reasoningEffort !== undefined
        && !entry.reasoning?.efforts.some((effort) => effort.id === model.reasoningEffort)) {
        const error = new Error('当前模型不支持所选思考强度，请重新选择。');
        error.code = 'model-reasoning-unavailable';
        throw error;
      }
      await workspaces.setModel(botId, model, { incarnation });
      return decorateResult(
        workspaces,
        await controller.status(),
        agentPresetCatalog,
        catalog ?? modelCatalog,
      );
    });
  };
  const updateAlias = (botId, value, projectStatus) => {
    const incarnation = workspaces.incarnationFor(botId);
    const alias = validateBotAlias(value);
    return withBotTransition(botId, async () => {
      const snapshot = await decorate(await controller.status());
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const updated = { ...snapshot, bots: snapshot.bots.map((bot) => bot.botId === botId
        ? { ...bot, bot: withBotAlias(bot.bot, alias) } : bot) };
      const result = projectStatus ? await projectStatus(updated) : updated;
      await workspaces.setAlias(botId, alias, { incarnation });
      return result;
    });
  };
  const updateBusyMessageMode = (botId, value, projectStatus) => {
    const incarnation = workspaces.incarnationFor(botId);
    const busyMessageMode = validateBusyMessageMode(value);
    return withBotTransition(botId, async () => {
      const snapshot = await decorate(await controller.status());
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const updated = { ...snapshot, bots: snapshot.bots.map((bot) => bot.botId === botId
        ? { ...bot, busyMessageMode } : bot) };
      const result = projectStatus ? await projectStatus(updated) : updated;
      await workspaces.setBusyMessageMode(botId, busyMessageMode, { incarnation });
      return result;
    });
  };
  const updateContextEnhancement = (botId, value, projectStatus) => {
    const incarnation = workspaces.incarnationFor(botId);
    const config = validateContextEnhancementConfig(value);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const [catalog, models] = await Promise.all([
        resolveAgentPresetCatalog(agentPresetCatalog),
        resolveModelCatalog(modelCatalog),
      ]);
      const decorated = workspaces.decorateStatus(snapshot);
      const updated = {
        ...decorated,
        bots: decorated.bots.map((bot) => bot?.botId === botId
          ? { ...bot, contextEnhancement: config } : bot),
        ...(catalog ? { agentPresetCatalog: catalog } : {}),
        ...(models ? { modelCatalog: models } : {}),
      };
      // QR/status projection can fail too. Prepare the complete response before
      // commit so a failed save never publishes new running settings.
      const result = projectStatus ? await projectStatus(updated) : updated;
      await workspaces.setContextEnhancement(botId, config, { incarnation });
      return result;
    });
  };
  const updateAccessPolicy = (botId, value, projectStatus) => {
    const incarnation = workspaces.incarnationFor(botId);
    const policy = validateAccessPolicy(value);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      // Channel-specific identity checks must finish before projecting or
      // committing the new policy. Existing channels need no extra validation.
      await validateAccessPolicyForBot?.(botId, policy);
      const [catalog, models] = await Promise.all([
        resolveAgentPresetCatalog(agentPresetCatalog),
        resolveModelCatalog(modelCatalog),
      ]);
      const decorated = workspaces.decorateStatus(snapshot);
      const updated = {
        ...decorated,
        bots: decorated.bots.map((bot) => bot?.botId === botId
          ? { ...bot, accessPolicy: policy } : bot),
        ...(catalog ? { agentPresetCatalog: catalog } : {}),
        ...(models ? { modelCatalog: models } : {}),
      };
      // Prepare the complete channel-specific response before commit. Failed
      // projections and disk writes must leave the live policy unchanged.
      const result = projectStatus ? await projectStatus(updated) : updated;
      await workspaces.setAccessPolicy(botId, policy, { incarnation });
      return result;
    });
  };
  const deleteWithWorkspace = (botId, invokeDelete) => withBotTransition(botId, async () => {
    const warnings = [];
    const cleanupWarning = (error, stage = 'workspace.cleanup') => {
      if (!controller.diagnostics) return;
      warnings.push(controller.diagnostics.report(error, { operation: 'bot.delete', stage, botId, warning: true,
        publicError: { code: 'workspace-cleanup-failed', message: stage === 'state.cleanup'
          ? t('本地会话状态清理失败，请查看诊断详情。') : t('账号已移除，但本地状态清理失败。') } }).publicError);
    };
    const finishRemoval = async () => {
      const outcome = await workspaces.finishRemoval(removal);
      if (outcome?.error) cleanupWarning(outcome.error);
    };
    // Fence the old runtime without changing the durable mapping. A crash
    // before the controller removes its config therefore keeps the bot's
    // workspace, while a crash after that commit is healed by startup
    // reconciliation.
    const removal = await workspaces.beginRemoval(botId, {
      clearSessions: async () => {
        try {
          const state = await stateFor(botId);
          if (!state || typeof state.clearSessions !== 'function') {
            throw new TypeError('bot state does not support session cleanup');
          }
          await state.clearSessions();
        } catch (error) {
          if (controller.diagnostics) cleanupWarning(error, 'state.cleanup');
          else console.warn('[dsh-im] ignored session cleanup failure while deleting bot:', extractConnectionEvidence(error).details);
        }
      },
    });
    try {
      const result = await invokeDelete();
      await finishRemoval();
      return decorate({ ...result, ...(warnings.length ? { warnings: [...(result?.warnings ?? []), ...warnings] } : {}) });
    } catch (error) {
      const after = await targetStatus(controller).catch(() => null);
      const knownAbsent = Array.isArray(after?.bots)
        && !after.bots.some((bot) => bot?.botId === botId);
      if (knownAbsent) {
        if (controller.diagnostics) {
          cleanupWarning(error);
          try { await finishRemoval(); } catch (cleanupError) { cleanupWarning(cleanupError); }
          return decorate({ ...after, warnings });
        }
        await workspaces.finishRemoval(removal);
      } else await workspaces.abortRemoval(removal);
      throw error;
    }
  });

  return new Proxy(controller, {
    get(target, property) {
      if (property === 'updateConversationDirectory') {
        return async (botId, config) => {
          await workspaces.setConversationDirectory(
            botId,
            config,
            botId === null ? {} : { incarnation: workspaces.incarnationFor(botId) },
          );
          return decorate(await controller.status());
        };
      }
      if (property === 'updateWorkspace') return updateWorkspace;
      if (property === 'updateAgentPreset') return updateAgentPreset;
      if (property === 'updateModel') return updateModel;
      if (property === 'updateAlias') return updateAlias;
      if (property === 'updateBusyMessageMode') return updateBusyMessageMode;
      if (property === 'updateContextEnhancement') return updateContextEnhancement;
      if (property === 'updateAccessPolicy') return updateAccessPolicy;
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'deleteBot') {
        return (botId, ...args) => deleteWithWorkspace(
          botId,
          () => value.call(target, botId, ...args),
        );
      }
      if (property === 'disconnect') {
        return async (...args) => {
          const before = await target.status();
          const botId = before?.bots?.[0]?.botId;
          if (!botId) return decorate(value.apply(target, args));
          return deleteWithWorkspace(botId, () => value.apply(target, args));
        };
      }
      return (...args) => decorate(value.apply(target, args));
    },
  });
}
