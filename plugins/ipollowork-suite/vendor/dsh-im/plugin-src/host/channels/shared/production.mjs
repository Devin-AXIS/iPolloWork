import { getGroupHistoryStore } from '../../group-history-runtime.mjs';
import { getImageInputSettingsStore } from '../../../../src/channels/shared/image-input-settings-store.mjs';
import { unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { createBindingAnnouncer } from './binding-events.mjs';
import { createTokenConnectionSupervisor } from './connection-supervisor.mjs';
import { createHarnessCommandExecutor } from '../../harness-command-executor.mjs';
import { harnessConnection } from '../../harness-connection.mjs';
import { createHarnessSessionExecutors } from '../../harness-session-coordinator.mjs';
import {
  getInboundTtlRuntime,
  registerInboundTtlWorkspaces,
} from '../../inbound-ttl-runtime.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { prepareBotWorkspace } from '../../../../src/channels/shared/default-workspace.mjs';
import { listAgentPresetCatalog } from '../../../../src/channels/shared/agent-preset.mjs';
import { listModelCatalog } from '../../../../src/channels/shared/model-setting.mjs';
import {
  SHARED_COMMAND_CATALOG,
  availableCommandCatalog,
} from '../../../../src/channels/shared/command-catalog.mjs';
import {
  createDeliveryAdapter,
  supportsDeliveryChannel,
} from '../../delivery-adapter.mjs';
import {
  accessPolicyProvider,
  initialAccessPolicyFor,
} from './access-policy-production.mjs';

export function pluginPaths(config, channel) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', `dsh-${channel}`));
  return {
    config: resolve(config.configPath ?? join(root, 'config.json')),
    bots: resolve(config.botsDir ?? join(root, 'bots')),
    workspaces: resolve(config.workspacesPath ?? join(root, 'workspaces.json')),
  };
}

export async function createTokenProductionController(ctx, config, internals, definitions) {
  const {
    channel, ConfigStore, StateStore, HarnessClient, Controller, Runtime, runtimeOptions,
  } = definitions;
  if (!ctx?.credentials) throw new TypeError(`dsh-im ${channel} requires ctx.credentials`);
  const connection = harnessConnection(ctx, config, { competitiveApprovals: ['telegram', 'discord'].includes(channel) });

  const ResolvedConfigStore = internals.ConfigStore ?? ConfigStore;
  const ResolvedStateStore = internals.StateStore ?? StateStore;
  const ResolvedHarness = internals.HarnessClient ?? HarnessClient;
  const ResolvedController = internals.Controller ?? Controller;
  const ResolvedRuntime = internals.Runtime ?? Runtime;
  const channelRuntimeOptions = typeof runtimeOptions === 'function' ? runtimeOptions(config) : {};
  if (!channelRuntimeOptions || typeof channelRuntimeOptions !== 'object'
    || Array.isArray(channelRuntimeOptions)) {
    throw new TypeError(`dsh-im ${channel} runtimeOptions must return an object`);
  }
  const createSupervisor = internals.createConnectionSupervisor ?? createTokenConnectionSupervisor;
  const seedAccessPolicy = typeof definitions.initialAccessPolicyForBot === 'function'
    ? definitions.initialAccessPolicyForBot
    // Telegram is the only token channel with a legacy access model. Other
    // current token channels preserve their fully-open baseline.
    : (bot) => initialAccessPolicyFor(channel === 'telegram' ? 'telegram' : 'discord', bot);
  const logger = typeof ctx.logger === 'function'
    ? ctx.logger(`dsh-im:${channel}`) : (ctx.logger ?? console);
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);
  const paths = pluginPaths(config, channel);
  const configStore = await new ResolvedConfigStore(paths.config).load();
  const { defaultWorkspace, ungroupedWorkspace } = await prepareBotWorkspace(config);
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, { defaultWorkspace, ungroupedWorkspace, groupByAgentPreset: config.groupByAgentPreset, entryAgentPreset: config.entryAgentPreset }).load();
  const configuredBots = configStore.list();
  await workspaces.reconcile(configuredBots.map((bot) => bot.botId));
  await Promise.all(configuredBots.map((bot) => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
    initialAccessPolicy: seedAccessPolicy(bot),
  })));
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;
  // Idempotent, and shared with createRuntime below so both paths seed a new
  // bot's workspace identically. A channel that must write something into the
  // workspace store before the runtime exists (email pushes its sender
  // allowlist into the access policy) needs the record to exist first —
  // setAccessPolicy refuses a bot the store has never seen. The call is safe to
  // repeat: ensure() only seeds the policy when the bot has none yet.
  const ensureWorkspace = (botId, botConfig) => workspaces.ensure(botId, {
    defaultAgentPreset: config.agentPreset,
    initialAccessPolicy: seedAccessPolicy(botConfig),
  });
  const stateStores = new Map();
  const statePath = (botId) => resolve(paths.bots, botId, 'state.json');

  /**
   * Every binding change is announced the moment it is written: a bind before the
   * Session exists, an unbind when the conversation moves to another session or
   * its binding is cleared. Listeners run synchronously.
   */
  const announcer = createBindingAnnouncer({
    channel,
    emit: (event, payload) => ctx.emit(event, payload),
    authorsOf: (botId) => (typeof stateStores.get(botId)?.snapshot === 'function'
      ? stateStores.get(botId).snapshot()?.authors ?? null
      : null),
  });

  /** Every loaded store reports its own bindings, once. */
  const stateFor = async (botId) => {
    let state = stateStores.get(botId);
    if (!state) {
      state = announcer.wrap(botId, await new ResolvedStateStore(statePath(botId)).load());
      stateStores.set(botId, state);
    }
    return state;
  };
  // Warm the per-bot state memo now: the synchronous identity lookup can only
  // answer from state that is already loaded in this process, and the first prompt
  // of a session arrives long before any delivery call would load it.
  await Promise.all(configuredBots.map((bot) => stateFor(bot.botId).catch(() => null)));
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
  const harness = new ResolvedHarness({
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
  // Assigned just below. A transport may need to write a rotated token back
  // through the controller, which is only constructible after createRuntime is
  // defined, so the reference is held in a slot rather than captured directly.
  let controllerRef = null;
  const coreController = new ResolvedController({
    credentials: ctx.credentials,
    configStore: observedConfigStore,
    // Channel settings scoped per chat need the archived group list (titles and
    // real chat IDs) to offer something better than a blank form.
    ...(definitions.controllerGroupHistory ? {
      groupHistory: internals.groupHistory ?? getGroupHistoryStore(ctx, config),
    } : {}),
    logger,
    ...(internals.inspectToken ? { inspectToken: internals.inspectToken } : {}),
    // Optional per-channel hook: a channel whose own settings also express an
    // access rule (email's sender allowlist) can push the derived policy into
    // the workspace store, which is what the runtime actually reads.
    ...(typeof definitions.accessPolicyForBot === 'function' ? {
      syncAccessPolicy: async (botId, policy) => {
        await workspaces.setAccessPolicy(botId, policy, {
          incarnation: workspaces.incarnationFor(botId),
        });
      },
      // Exposed so the controller can create the workspace record before it
      // pushes a policy into it.
      ensureWorkspace,
    } : {}),
    // Channels that pin conversations to an existing session need the per-bot
    // state and the session catalog to drive their settings UI.
    ...(definitions.supportsSessionBinding ? {
      stateFor,
      listWorkspaceSessions: (workspace) => harness.listWorkspaceSessions(workspace),
      botWorkspaceFor: (botId) => workspaces.workspaceFor(botId),
      defaultWorkspace,
    } : {}),
    createRuntime: async ({ botId, config: botConfig, token, credential, createTransport }) => {
      const state = await stateFor(botId);
      await ensureWorkspace(botId, botConfig);
      const workspaceScope = createBotWorkspaceScope(harness, {
        dsBot: config.deliveryService?.dsBot,
        botId, workspaces, state, agentPresetCatalog,
      });
      const persistTokens = typeof definitions.persistBotCredential === 'function'
        ? (tokens) => definitions.persistBotCredential({
          botId, config: botConfig, tokens, controller: controllerRef,
        })
        : null;
      return new ResolvedRuntime({
        ...channelRuntimeOptions,
        config: botConfig,
        token,
        // The mailbox may authenticate with an OAuth pair instead of a password.
        ...(credential ? { credential } : {}),
        // A transport that rotates its tokens needs them written back.
        ...(persistTokens ? { onTokensRefreshed: persistTokens } : {}),
        // The channel decides which transport a mailbox uses; without this the
        // runtime falls back to its own IMAP/SMTP default.
        ...(typeof createTransport === 'function' ? { createTransport } : {}),
        harness: workspaceScope.harness,
        state: workspaceScope.state,
        // Hide /fork when the host facade cannot actually branch a session.
        commandCatalog: availableCommandCatalog(SHARED_COMMAND_CATALOG, {
          supportsFork: harness.supportsSessionFork?.(),
        }),
        groupHistory: internals.groupHistory ?? (['telegram', 'discord'].includes(channel) ? getGroupHistoryStore(ctx, config) : undefined),
        // A transport that carries voice notes composes its own transcriber
        // from Host services; without one voice messages stay textless.
        ...(typeof definitions.createVoiceTranscriber === 'function'
          ? { voice: definitions.createVoiceTranscriber(ctx, config, internals) }
          : {}),
        contextEnhancement: { botId, getSettings: () => workspaces.contextEnhancementFor(botId) },
        accessPolicy: accessPolicyProvider(workspaces, botId, { channel, config: botConfig }),
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
      const state = stateStores.get(botId);
      stateStores.delete(botId);
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
  controllerRef = coreController;
  const controller = createWorkspaceAwareController(coreController, {
    harness,
    workspaces,
    stateFor,
    agentPresetCatalog,
    modelCatalog,
  });
  const supervisor = createSupervisor({
    channel,
    controller,
    harness,
    logger,
    retryDelaysMs: config.retryDelaysMs,
    healthyIntervalMs: config.healthyIntervalMs,
  }).start();
  return {
    controller,
    ...(supportsDeliveryChannel(channel) ? {
      deliveryAdapter: createDeliveryAdapter({
        dsBot: config.deliveryService?.dsBot,
        channel,
        workspaces,
        coreController,
        stateFor,
        // The same store, without the await: it is a memo of already loaded bots.
        stateForSync: (botId) => stateStores.get(botId) ?? null,
      }),
    } : {}),
    ready: supervisor.ready,
    async close() {
      await supervisor.close();
      await controller.close();
      harness.stopManagedProcess();
    },
  };
}
