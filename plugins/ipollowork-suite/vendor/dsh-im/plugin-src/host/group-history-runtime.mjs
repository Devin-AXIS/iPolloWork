import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { GroupHistoryStore } from '../../src/channels/shared/group-history-store.mjs';
import { getInboundTtlRuntime } from './inbound-ttl-runtime.mjs';

const runtimes = new Map();

export function getGroupHistoryStore(ctx, config = {}) {
  const home = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const root = join(home, 'integrations', 'dsh-im');
  if (runtimes.has(root)) return runtimes.get(root);
  const logger = typeof ctx?.logger === 'function' ? ctx.logger('dsh-im:group-history') : ctx?.logger ?? console;
  const store = new GroupHistoryStore(root, { logger, copyService: getInboundTtlRuntime(ctx, config).service });
  runtimes.set(root, store);
  void store.start().catch((error) => logger.error?.('[dsh-im] group history unavailable:', error.message));
  ctx?.effect?.(() => () => {
    if (runtimes.get(root) === store) runtimes.delete(root);
    return store.close();
  }, 'dsh-im: close group history');
  return store;
}
