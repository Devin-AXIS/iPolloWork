import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { InboundTtlStore } from '../../src/channels/shared/inbound-ttl-store.mjs';
import { createInboundTtlService } from './inbound-ttl-service.mjs';

const runtimes = new Map();

/**
 * Resolve the global settings file shared by every channel. The dshHome
 * resolution mirrors pluginPaths: config.dshHome, then DSH_HOME, then the
 * user's home directory. Channel-specific dataDir values never apply.
 */
export function inboundTtlSettingsPath(config = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  return resolve(dshHome, 'integrations', 'dsh-im', 'settings.json');
}

/**
 * Per-process inbound TTL runtime, cached by resolved settings path so every
 * channel shares one store, one staged registry, and one sweep timer. The
 * entry is dropped (and the sweeper stopped) when the owning context is
 * disposed, letting a later activation rebuild from disk.
 */
export function getInboundTtlRuntime(ctx, config = {}) {
  const settingsPath = inboundTtlSettingsPath(config);
  const existing = runtimes.get(settingsPath);
  if (existing) return existing.runtime;
  const logger = typeof ctx?.logger === 'function'
    ? ctx.logger('dsh-im:inbound-ttl') : (ctx?.logger ?? console);
  const store = new InboundTtlStore(settingsPath);
  const service = createInboundTtlService({ store, logger });
  const runtime = Object.freeze({ store, service });
  const entry = { runtime };
  runtimes.set(settingsPath, entry);
  // Load persisted settings before the first sweep so a keep-forever TTL can
  // never be overtaken by the in-memory default. An unreadable store keeps
  // sweeping disabled rather than deleting files of unknown intent.
  void store.load().then(
    () => service.start(),
    (error) => logger.error?.('[dsh-im] unable to load inbound attachment settings; sweeping stays disabled', error),
  );
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => {
      if (runtimes.get(settingsPath) !== entry) return;
      runtimes.delete(settingsPath);
      service.stop();
    }, 'dsh-im: stop inbound attachment TTL sweeper');
  }
  return runtime;
}

/**
 * Advertise one channel's bot workspaces to the global sweeper. The provider
 * is consulted at sweep time, so bots added or removed later are always
 * current. The default workspace is always included.
 */
export function registerInboundTtlWorkspaces(ctx, service, {
  workspaces,
  configStore,
  defaultWorkspace,
  botIdFrom = (bot) => bot?.botId,
} = {}) {
  if (!service || typeof service.registerWorkspaceProvider !== 'function') return undefined;
  if (!workspaces || typeof workspaces.workspaceFor !== 'function'
    || typeof defaultWorkspace !== 'string' || !defaultWorkspace) {
    return undefined;
  }
  const unregister = service.registerWorkspaceProvider(() => {
    const bots = typeof configStore?.list === 'function' ? configStore.list() : [];
    const paths = [defaultWorkspace];
    for (const bot of Array.isArray(bots) ? bots : []) {
      try {
        paths.push(workspaces.workspaceFor(botIdFrom(bot)));
      } catch {
        // A malformed config entry must not hide the remaining workspaces.
      }
    }
    return paths;
  });
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => unregister, 'dsh-im: unregister inbound TTL workspaces');
  }
  return unregister;
}
