import { registerManagementRpc } from '../management-rpc.mjs';
import { normalizeInboundTtlHours } from '../../src/channels/shared/inbound-ttl.mjs';
import { getInboundTtlRuntime } from './inbound-ttl-runtime.mjs';
import { getImageInputSettingsStore } from '../../src/channels/shared/image-input-settings-store.mjs';
import { createImageInputRpcHandler, IMAGE_INPUT_ENDPOINTS } from './image-input-rpc.mjs';
import { getGroupHistoryStore } from './group-history-runtime.mjs';
import { createGroupHistoryRpcHandler, GROUP_HISTORY_ENDPOINTS } from './group-history-rpc.mjs';

export const INBOUND_TTL_RPC_CHANNEL = '/dsh-im-settings';
export const INBOUND_TTL_ENDPOINTS = Object.freeze({
  get: 'settings.inbound-ttl.get',
  set: 'settings.inbound-ttl.set',
  sweep: 'settings.inbound-ttl.sweep',
});

const ENDPOINTS = new Set(Object.values(INBOUND_TTL_ENDPOINTS));

export function validInboundTtlPayload(endpoint, payload) {
  if (!ENDPOINTS.has(endpoint)) return false;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (endpoint === INBOUND_TTL_ENDPOINTS.set) {
    return keys.length === 1 && keys[0] === 'ttlHours'
      && normalizeInboundTtlHours(payload.ttlHours) !== null;
  }
  return keys.length === 0;
}

export function createInboundTtlRpcHandler({ store, service, logger = null } = {}) {
  if (!store || typeof store.getTtlHours !== 'function'
    || typeof store.setTtlHours !== 'function'
    || !service || typeof service.sweepNow !== 'function') {
    throw new TypeError('createInboundTtlRpcHandler requires an inbound TTL store and service');
  }
  return async (endpoint, payload, signal) => {
    if (!validInboundTtlPayload(endpoint, payload)) {
      return { ok: false, error: { code: 'bad-request', message: 'Invalid inbound TTL request.' } };
    }
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.' } };
    }
    try {
      if (endpoint === INBOUND_TTL_ENDPOINTS.get) {
        return { ok: true, value: { ttlHours: store.getTtlHours() } };
      }
      if (endpoint === INBOUND_TTL_ENDPOINTS.set) {
        const ttlHours = await store.setTtlHours(payload.ttlHours);
        // Re-arm the sweep interval so the saved value gets a full window
        // before its first scheduled enforcement.
        service.resetSweepSchedule?.();
        return { ok: true, value: { ttlHours } };
      }
      const summary = await service.sweepNow();
      // The UI shows no result text, so the host log is the only place a
      // manual sweep can be diagnosed (TTL applied, coverage, deletions).
      logger?.info?.(
        `[dsh-im] manual inbound attachment sweep: ${summary.deletedDirectories} deleted`
        + ` across ${summary.sweptWorkspaces} workspaces (ttl ${store.getTtlHours()}h)`,
      );
      return { ok: true, value: summary };
    } catch (error) {
      if (error?.code === 'inbound-ttl-invalid') {
        return {
          ok: false,
          error: {
            code: 'inbound-ttl-invalid',
            message: '附件保留时长无效：请输入 -1、0 或 1-8760 之间的整数小时数。',
          },
        };
      }
      return { ok: false, error: { code: 'inbound-ttl-unavailable', message: 'inbound-ttl-unavailable' } };
    }
  };
}

export function installInboundTtlRpc(ctx, options = {}) {
  const runtime = options.runtime ?? getInboundTtlRuntime(ctx, options.config);
  const logger = typeof ctx?.logger === 'function'
    ? ctx.logger('dsh-im:inbound-ttl') : (ctx?.logger ?? null);
  const ttl = createInboundTtlRpcHandler({ ...runtime, logger });
  const image = createImageInputRpcHandler(getImageInputSettingsStore(options.config));
  const history = createGroupHistoryRpcHandler(options.groupHistory ?? getGroupHistoryStore(ctx, options.config));
  return registerManagementRpc(ctx,
    INBOUND_TTL_RPC_CHANNEL,
    (endpoint, payload, signal) => Object.values(GROUP_HISTORY_ENDPOINTS).includes(endpoint)
      ? history(endpoint, payload, signal) : Object.values(IMAGE_INPUT_ENDPOINTS).includes(endpoint)
        ? image(endpoint, payload, signal) : ttl(endpoint, payload, signal),
    { authority: options.config?.rpcAuthority },
  );
}
