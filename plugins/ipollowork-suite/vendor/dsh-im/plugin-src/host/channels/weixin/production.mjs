import { getImageInputSettingsStore } from '../../../../src/channels/shared/image-input-settings-store.mjs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

import { WeixinConfigStore } from '../../../../src/channels/weixin/config-store.mjs';
import { HarnessClient } from '../../../../src/channels/weixin/harness-client.mjs';
import { WeixinStateStore } from '../../../../src/channels/weixin/state-store.mjs';
import {
  createWeixinApi,
  DEFAULT_WEIXIN_MAX_MESSAGE_CHARS,
} from '../../../../src/channels/weixin/weixin-api.mjs';
import { WeixinController } from '../../../../src/channels/weixin/weixin-controller.mjs';
import { WeixinRuntime } from '../../../../src/channels/weixin/weixin-runtime.mjs';
import { createWeixinDiagnostics, knownWeixinErrorCode, weixinStageError } from '../../../../src/channels/weixin/connection-error.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { prepareBotWorkspace } from '../../../../src/channels/shared/default-workspace.mjs';
import { listAgentPresetCatalog } from '../../../../src/channels/shared/agent-preset.mjs';
import { listModelCatalog } from '../../../../src/channels/shared/model-setting.mjs';
import { createDeliveryAdapter } from '../../delivery-adapter.mjs';
import { createAnnouncedStateStore, createBindingAnnouncer } from '../shared/binding-events.mjs';
import { createConnectionSupervisor } from './connection-supervisor.mjs';
import { createHarnessCommandExecutor } from '../../harness-command-executor.mjs';
import { harnessConnection } from '../../harness-connection.mjs';
import { createHarnessSessionExecutors } from '../../harness-session-coordinator.mjs';
import {
  getInboundTtlRuntime,
  registerInboundTtlWorkspaces,
} from '../../inbound-ttl-runtime.mjs';
import {
  accessPolicyProvider,
  initialAccessPolicyFor,
} from '../shared/access-policy-production.mjs';

function pluginPaths(config) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-weixin'));
  return {
    root,
    config: resolve(config.configPath ?? join(root, 'config.json')),
    accounts: resolve(config.accountsDir ?? join(root, 'accounts')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

// Keep shared workspace lifecycle semantics; expose its fallible persistence only to Weixin.
function diagnosticWorkspaces(store) {
  const writes = new Set(['ensure', 'setWorkspace', 'setModel', 'setAgentPreset', 'setAlias', 'setContextEnhancement', 'setAccessPolicy', 'flushPendingRemoval']);
  const removals = new Set(['retireAfterConfigCommit', 'finishRemoval']);
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (!writes.has(property) && !removals.has(property)) return value.bind(target);
      return (...args) => {
        const failure = error => {
          throw knownWeixinErrorCode(error?.code) ? error
            : weixinStageError(removals.has(property) ? 'workspace-cleanup-failed' : 'workspace-save-failed', error);
        };
        try {
          const result = value.apply(target, args);
          // flushPendingRemoval must remain synchronous when no cleanup is pending.
          return result?.then ? result.then(value => {
            if (removals.has(property) && value?.error) failure(value.error);
            return value;
          }, failure) : result;
        } catch (error) { return failure(error); }
      };
    },
  });
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  if (!ctx?.credentials) throw new TypeError('dsh-weixin requires ctx.credentials');
  const connection = harnessConnection(ctx, config, { competitiveApprovals: true });

  const ConfigStore = internals.ConfigStore ?? WeixinConfigStore;
  const StateStore = internals.StateStore ?? WeixinStateStore;
  const Harness = internals.HarnessClient ?? HarnessClient;
  const Controller = internals.Controller ?? WeixinController;
  const Runtime = internals.Runtime ?? WeixinRuntime;
  let uploadDispatcher;
  const api = internals.api ?? createWeixinApi({
    uploadFetchImpl: (url, options) => {
      // Keep CDN response headers independent of the host's global dispatcher.
      uploadDispatcher ??= new EnvHttpProxyAgent();
      return undiciFetch(url, { ...options, dispatcher: uploadDispatcher });
    },
  });
  const createSupervisor = internals.createConnectionSupervisor ?? createConnectionSupervisor;
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger('dsh-weixin')
    : (ctx.logger ?? console);
  const diagnostics = internals.diagnostics ?? createWeixinDiagnostics({ logger });
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);
  const paths = pluginPaths(config);
  const configStore = await new ConfigStore(paths.config).load();
  const { defaultWorkspace, ungroupedWorkspace } = await prepareBotWorkspace(config);
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = diagnosticWorkspaces(internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace, ungroupedWorkspace, groupByAgentPreset: config.groupByAgentPreset, entryAgentPreset: config.entryAgentPreset }).load());
  const configuredBots = configStore.list();
  await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
    initialAccessPolicy: initialAccessPolicyFor('weixin', bot),
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const stateStores = new Map();

  const statePath = (botId) => resolve(paths.accounts, botId, 'state.json');
  /**
   * Every binding change is announced the moment it is written: a bind before the
   * Session exists, an unbind when the conversation moves to another session or
   * its binding is cleared. Listeners run synchronously.
   */
  const announcer = createBindingAnnouncer({
    channel: 'weixin',
    emit: (event, payload) => ctx.emit(event, payload),
    authorsOf: (botId) => (typeof stateStores.get(botId)?.snapshot === 'function'
      ? stateStores.get(botId).snapshot()?.authors ?? null
      : null),
  });
  const { stateFor, stateForSync, prime, forget } = createAnnouncedStateStore({
    announcer,
    StateStore,
    statePath,
    states: stateStores,
    logger,
  });
  // Warm the per-bot state memo now: the synchronous identity lookup can only
  // answer from state that is already loaded in this process, and the first prompt
  // of a session arrives long before any delivery call would load it.
  await prime(configuredBots.map((bot) => bot.botId));
  const commandExecutor = createHarnessCommandExecutor(ctx, internals.commandExecutor);
  const inboundTtl = internals.inboundTtl ?? getInboundTtlRuntime(ctx, config);
  const inboundTtlService = inboundTtl?.service ?? inboundTtl;
  registerInboundTtlWorkspaces(ctx, inboundTtlService, {
    workspaces,
    configStore: observedConfigStore,
    defaultWorkspace,
  });
  const { controlExecutor, sessionMaintenanceExecutor, fileIngressExecutor, completionExecutor } = createHarnessSessionExecutors(ctx, {
    controlExecutor: internals.controlExecutor,
    sessionMaintenanceExecutor: internals.sessionMaintenanceExecutor,
    fileIngressExecutor: internals.fileIngressExecutor,
    inboundTtlService,
  });
  const harness = new Harness({
    ...connection,
    workspace: defaultWorkspace,
    ungroupedWorkspace,
    autostart: false,
    dshBin: config.dshBin ?? 'dsh',
    ...(commandExecutor ? { commandExecutor } : {}),
    ...(controlExecutor ? { controlExecutor } : {}),
    ...(sessionMaintenanceExecutor ? { sessionMaintenanceExecutor } : {}),
    ...(fileIngressExecutor ? { fileIngressExecutor } : {}),
    ...(completionExecutor ? { completionExecutor } : {}),
    imageInputPolicy: () => getImageInputSettingsStore(config).get(),
  });
  const modelCatalog = (options) => listModelCatalog(harness, options);
  const coreController = new Controller({
    api,
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    logger,
    diagnostics,
    createRuntime: async ({ botId, config: accountConfig, token }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId, {
        defaultAgentPreset: config.agentPreset,
        initialAccessPolicy: initialAccessPolicyFor('weixin', accountConfig),
      });
      const workspaceScope = createBotWorkspaceScope(harness, {
        dsBot: config.deliveryService?.dsBot,
        botId, workspaces, state, agentPresetCatalog,
      });
      return new Runtime({
        diagnostics,
        api,
        config: accountConfig,
        token,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        contextEnhancement: { botId, getSettings: () => workspaces.contextEnhancementFor(botId) },
        accessPolicy: accessPolicyProvider(workspaces, botId, {
          channel: 'weixin', config: accountConfig,
        }),
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
        maxMessageChars: config.maxMessageChars ?? DEFAULT_WEIXIN_MAX_MESSAGE_CHARS,
        logger: {
          error: (...args) => logger.error?.(`[${botId}]`, ...args),
          warn: (...args) => logger.warn?.(`[${botId}]`, ...args),
          info: (...args) => logger.info?.(`[${botId}]`, ...args),
          debug: (...args) => logger.debug?.(`[${botId}]`, ...args),
        },
      });
    },
    deleteState: async ({ botId }) => {
      const state = stateForSync(botId);
      forget(botId);
      if (state && typeof state.remove === 'function') {
        await state.remove();
      } else {
        try {
          await unlink(statePath(botId));
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    },
  });
  const workspaceController = createWorkspaceAwareController(coreController, {
    harness,
    workspaces,
    stateFor,
    agentPresetCatalog,
    modelCatalog,
  });
  const controller = new Proxy(workspaceController, {
    get(target, property) {
      if (property === 'deleteBot') return async (...args) => {
        const existed = Boolean(configStore.get(args[0]));
        try { return await target.deleteBot(...args); }
        catch (error) {
          if (!existed || configStore.get(args[0])) throw error;
          // The shared workspace wrapper can fail cleaning up after the account commit.
          const warning = diagnostics.report(weixinStageError('workspace-cleanup-failed', error), {
            operation: 'bot.delete', botId: args[0], warning: true,
          }).publicError;
          try { return { ...await target.status(), warnings: [warning] }; }
          catch (readError) { throw weixinStageError('status-read-failed', readError, 'status.read'); }
        }
      };
      return Reflect.get(target, property);
    },
  });
  const supervisor = createSupervisor({
    controller,
    harness,
    logger,
    diagnostics,
    retryDelaysMs: config.retryDelaysMs,
    healthyIntervalMs: config.healthyIntervalMs,
  }).start();
  return {
    controller,
    deliveryAdapter: createDeliveryAdapter({ dsBot: config.deliveryService?.dsBot,
      channel: 'weixin', workspaces, coreController, stateFor,
      // The same store, without the await: it is a memo of already loaded bots.
      stateForSync,
    }),
    ready: supervisor.ready,
    async close() {
      try {
        await supervisor.close();
        await controller.close();
      } finally {
        const dispatcher = uploadDispatcher;
        uploadDispatcher = undefined;
        try {
          await dispatcher?.destroy();
        } finally {
          harness.stopManagedProcess();
        }
      }
    },
  };
}
