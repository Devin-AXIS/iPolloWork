import { getImageInputSettingsStore } from '../../../../src/channels/shared/image-input-settings-store.mjs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { WecomAppConfigStore } from '../../../../src/channels/wecom-app/config-store.mjs';
import { WecomAppHarnessClient } from '../../../../src/channels/wecom-app/harness-client.mjs';
import { WecomAppStateStore } from '../../../../src/channels/wecom-app/state-store.mjs';
import { WecomAppController } from '../../../../src/channels/wecom-app/wecom-app-controller.mjs';
import { WecomAppRuntime } from '../../../../src/channels/wecom-app/wecom-app-runtime.mjs';
import { WecomAppCallbackServer } from '../../../../src/channels/wecom-app/callback-server.mjs';
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
import { createConnectionSupervisor } from '../wecom/connection-supervisor.mjs';
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
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-wecom-app'));
  return {
    config: resolve(config.configPath ?? join(root, 'config.json')),
    bots: resolve(config.botsDir ?? join(root, 'bots')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

function normalizeOrigin(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw ? raw.replace(/\/+$/u, '') : null;
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  if (!ctx?.credentials) throw new TypeError('dsh-im Enterprise WeChat app requires ctx.credentials');
  const connection = harnessConnection(ctx, config, { competitiveApprovals: true });

  const ConfigStore = internals.ConfigStore ?? WecomAppConfigStore;
  const StateStore = internals.StateStore ?? WecomAppStateStore;
  const Harness = internals.HarnessClient ?? WecomAppHarnessClient;
  const Controller = internals.Controller ?? WecomAppController;
  const Runtime = internals.Runtime ?? WecomAppRuntime;
  const CallbackServer = internals.CallbackServer ?? WecomAppCallbackServer;
  const createSupervisor = internals.createConnectionSupervisor ?? createConnectionSupervisor;
  const baseLogger = typeof ctx.logger === 'function' ? ctx.logger('dsh-im:wecom-app') : (ctx.logger ?? console);
  // The cordis logger never surfaces in the web profile journal; tee every
  // level to the process console so callback verification attempts stay
  // observable (journald captures the dsh web process stdout).
  const logger = {
    log: (...args) => { baseLogger.log?.(...args); console.log('[dsh-im:wecom-app]', ...args); },
    info: (...args) => { baseLogger.info?.(...args); console.info('[dsh-im:wecom-app]', ...args); },
    warn: (...args) => { baseLogger.warn?.(...args); console.warn('[dsh-im:wecom-app]', ...args); },
    error: (...args) => { baseLogger.error?.(...args); console.error('[dsh-im:wecom-app]', ...args); },
  };
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);
  const paths = pluginPaths(config);
  const configStore = await new ConfigStore(paths.config).load();
  const { defaultWorkspace, ungroupedWorkspace } = await prepareBotWorkspace(config);
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace, ungroupedWorkspace, groupByAgentPreset: config.groupByAgentPreset, entryAgentPreset: config.entryAgentPreset }).load();
  const configuredBots = configStore.list();
  await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
    initialAccessPolicy: initialAccessPolicyFor('wecom-app', bot),
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const callbackServer = internals.callbackServer ?? new CallbackServer({
    host: config.callbackListenHost ?? '127.0.0.1',
    port: config.callbackListenPort ?? 30987,
    logger,
  });
  // The callback listener starts on demand with the first bound app and
  // stops once the last app is removed, so hosts that never use this channel
  // do not keep port 30987 occupied.
  const ensureCallbackListener = async () => {
    if (callbackServer.listening !== true) await callbackServer.start();
    return callbackServer;
  };
  const baseRegisterRoute = callbackServer.registerRoute.bind(callbackServer);
  callbackServer.registerRoute = (route) => ensureCallbackListener().then(() => baseRegisterRoute(route));
  const baseUnregisterRoute = callbackServer.unregisterRoute.bind(callbackServer);
  callbackServer.unregisterRoute = (botId) => {
    baseUnregisterRoute(botId);
    if (callbackServer.routeCount() === 0 && callbackServer.listening) return callbackServer.stop();
  };
  const publicOrigin = normalizeOrigin(config.callbackBaseUrl);
  const buildCallbackUrl = (bot) => {
    const origin = normalizeOrigin(bot?.callbackBaseUrl) ?? publicOrigin;
    return origin ? `${origin}${callbackServer.routePath(bot)}` : null;
  };
  const stateStores = new Map();
  const statePath = (botId) => resolve(paths.bots, botId, 'state.json');
  /**
   * Every binding change is announced the moment it is written: a bind before the
   * Session exists, an unbind when the conversation moves to another session or
   * its binding is cleared. Listeners run synchronously.
   */
  const announcer = createBindingAnnouncer({
    channel: 'wecom-app',
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
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    buildCallbackUrl,
    logger,
    createRuntime: async ({ botId, config: botConfig, secrets }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId, {
        defaultAgentPreset: config.agentPreset,
        initialAccessPolicy: initialAccessPolicyFor('wecom-app', botConfig),
      });
      const workspaceScope = createBotWorkspaceScope(harness, {
        dsBot: config.deliveryService?.dsBot,
        botId, workspaces, state, agentPresetCatalog,
      });
      return new Runtime({
        config: botConfig,
        secrets,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        contextEnhancement: { botId, getSettings: () => workspaces.contextEnhancementFor(botId) },
        accessPolicy: accessPolicyProvider(workspaces, botId, {
          channel: 'wecom-app', config: botConfig,
        }),
        callbackServer,
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
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
  const controller = createWorkspaceAwareController(coreController, {
    harness,
    workspaces,
    stateFor,
    agentPresetCatalog,
    modelCatalog,
  });
  const supervisor = createSupervisor({
    controller,
    harness,
    logger,
    retryDelaysMs: config.retryDelaysMs,
    healthyIntervalMs: config.healthyIntervalMs,
  }).start();
  return {
    controller,
    deliveryAdapter: createDeliveryAdapter({ dsBot: config.deliveryService?.dsBot,
      channel: 'wecom-app', workspaces, coreController, stateFor,
      // The same store, without the await: it is a memo of already loaded bots.
      stateForSync,
    }),
    ready: supervisor.ready,
    async close() {
      await supervisor.close();
      await controller.close();
      await callbackServer.stop();
      harness.stopManagedProcess();
    },
  };
}
