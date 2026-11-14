import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { OfficeConfigStore } from '../../../../src/channels/office/config-store.mjs';
import { OfficeController } from '../../../../src/channels/office/office-controller.mjs';
import { OfficeRuntime } from '../../../../src/channels/office/office-runtime.mjs';
import { HarnessClient } from '../../../../src/channels/shared/harness-client.mjs';
import { harnessConnection } from '../../harness-connection.mjs';

export function officePaths(config = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = resolve(config.dataDir ?? join(dshHome, 'integrations', 'dsh-office'));
  return { root, config: resolve(config.configPath ?? join(root, 'config.json')) };
}

export async function createProductionController(ctx, config = {}, internals = {}) {
  const connection = harnessConnection(ctx, config);
  const Store = internals.ConfigStore ?? OfficeConfigStore;
  const Controller = internals.Controller ?? OfficeController;
  const Runtime = internals.Runtime ?? OfficeRuntime;
  const ResolvedHarness = internals.HarnessClient ?? HarnessClient;
  const paths = officePaths(config);
  const configStore = await new Store(paths.config).load();
  const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-im:office') : (ctx.logger ?? console);
  const createHarness = internals.createHarness ?? (({ workspace }) => new ResolvedHarness({
    ...connection,
    workspace,
    autostart: false,
    dshBin: config.dshBin ?? 'dsh',
    rpcIdPrefix: 'office',
    logPrefix: 'dsh-im:office',
  }));
  const controller = new Controller({
    credentials: ctx.credentials,
    configStore,
    logger,
    createRuntime: (options) => new Runtime({
      ...options,
      createHarness,
      ...(internals.transport ? { transport: internals.transport } : {}),
    }),
  });
  await controller.initialize();
  return { controller, close: () => controller.close(), paths };
}
