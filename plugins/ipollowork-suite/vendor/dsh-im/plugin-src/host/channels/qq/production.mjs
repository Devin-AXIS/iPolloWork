import { getGroupHistoryStore } from '../../group-history-runtime.mjs';
import { getImageInputSettingsStore } from '../../../../src/channels/shared/image-input-settings-store.mjs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { QqConfigStore } from '../../../../src/channels/qq/config-store.mjs';
import { QqHarnessClient } from '../../../../src/channels/qq/harness-client.mjs';
import { QqController } from '../../../../src/channels/qq/qq-controller.mjs';
import { QqRuntime } from '../../../../src/channels/qq/qq-runtime.mjs';
import { QqQrAuth } from '../../../../src/channels/qq/qr-auth.mjs';
import { QqStateStore } from '../../../../src/channels/qq/state-store.mjs';
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
  newBotAccessPolicyFor,
} from '../shared/access-policy-production.mjs';

function pluginPaths(config) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-qq'));
  return {
    config: resolve(config.configPath ?? join(root, 'config.json')),
    bots: resolve(config.botsDir ?? join(root, 'bots')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  if (!ctx?.credentials) throw new TypeError('dsh-im QQ requires ctx.credentials');
  const connection = harnessConnection(ctx, config, { competitiveApprovals: true });

  const ConfigStore = internals.ConfigStore ?? QqConfigStore;
  const StateStore = internals.StateStore ?? QqStateStore;
  const Harness = internals.HarnessClient ?? QqHarnessClient;
  const Controller = internals.Controller ?? QqController;
  const Runtime = internals.Runtime ?? QqRuntime;
  const QrAuth = internals.QrAuth ?? QqQrAuth;
  const createSupervisor = internals.createConnectionSupervisor ?? createConnectionSupervisor;
  const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-im:qq') : (ctx.logger ?? console);
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
    initialAccessPolicy: initialAccessPolicyFor('qq', bot),
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  const qrAuth = internals.qrAuth ?? new QrAuth({ source: config.qrSource ?? 'deepseek-harness' });
  const stateStores = new Map();
  const statePath = (botId) => resolve(paths.bots, botId, 'state.json');
  /**
   * Every binding change is announced the moment it is written: a bind before the
   * Session exists, an unbind when the conversation moves to another session or
   * its binding is cleared. Listeners run synchronously.
   */
  const announcer = createBindingAnnouncer({
    channel: 'qq',
    emit: (event, payload) => ctx.emit(event, payload),
    authorsOf: (botId) => (typeof stateStores.get(botId)?.snapshot === 'function'
      ? stateStores.get(botId).snapshot()?.authors ?? null
      : null),
  });
  const { stateFor, stateForSync, prime, forget } = createAnnouncedStateStore({
    announcer,
    StateStore,
    statePath,
    storeOptions: { logger },
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
    qrAuth,
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    logger,
    createRuntime: async ({ botId, config: botConfig, appSecret }) => {
      const state = await stateFor(botId);
      await workspaces.ensure(botId, {
        defaultAgentPreset: config.agentPreset,
        initialAccessPolicy: newBotAccessPolicyFor('qq', botConfig),
      });
      const workspaceScope = createBotWorkspaceScope(harness, {
        dsBot: config.deliveryService?.dsBot,
        botId, workspaces, state, agentPresetCatalog,
      });
      return new Runtime({
        config: botConfig,
        appSecret,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        groupHistory: internals.groupHistory ?? getGroupHistoryStore(ctx, config),
        contextEnhancement: { botId, getSettings: () => workspaces.contextEnhancementFor(botId) },
        accessPolicy: accessPolicyProvider(workspaces, botId, {
          channel: 'qq', config: botConfig,
        }),
        replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
        connectTimeoutMs: config.connectTimeoutMs ?? 20_000,
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
    deliveryAdapter: createDeliveryAdapter({ dsBot: config.deliveryService?.dsBot, channel: 'qq', workspaces, coreController, stateFor,
      // The same store, without the await: it is a memo of already loaded bots.
      stateForSync }),
    ready: supervisor.ready,
    async close() {
      await supervisor.close();
      await controller.close();
      harness.stopManagedProcess();
    },
  };
}
