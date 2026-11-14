import { registerManagementRpc } from '../management-rpc.mjs';
import { deliverySyncPatchKeys } from '../../src/channels/shared/delivery-sync-settings.mjs';
import { getDeliverySyncSettingsStore } from '../../src/channels/shared/delivery-sync-settings-store.mjs';
import { t } from '../../src/channels/shared/i18n.mjs';

/**
 * Management channel for the delivery-sync settings. It is separate from the
 * loopback-only `/dsh-im-settings` channel on purpose: this page must stay
 * usable from an authenticated domain (the Host dashboard served beyond
 * loopback), so it follows the profile's `rpcAuthority` like the sidebar
 * settings do.
 */
export const DELIVERY_SYNC_RPC_CHANNEL = '/dsh-im-delivery-sync';

export const DELIVERY_SYNC_ENDPOINTS = Object.freeze({
  get: 'settings.delivery-sync.get',
  set: 'settings.delivery-sync.set',
});

const ENDPOINTS = new Set(Object.values(DELIVERY_SYNC_ENDPOINTS));

const BOOLEAN_FIELDS = new Set(['mirrorUserInput', 'deliverModelAnswers']);
const ICON_FIELDS = new Set(['inputIcon', 'modelIcon']);

/**
 * Validate one delivery-sync request. `get` takes an empty object; `set` takes
 * one or more of the four known fields, each with the type it is stored as.
 * An icon that is a string but unusable is accepted here and normalized to the
 * empty prefix by the store, so a reader never loses a save over a pasted
 * emoji sequence.
 */
export function validDeliverySyncPayload(endpoint, payload) {
  if (!ENDPOINTS.has(endpoint)) return false;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = deliverySyncPatchKeys(payload);
  if (keys === null) return false;
  if (endpoint === DELIVERY_SYNC_ENDPOINTS.get) return keys.length === 0;
  if (keys.length === 0) return false;
  return keys.every((key) => (BOOLEAN_FIELDS.has(key)
    ? typeof payload[key] === 'boolean'
    : ICON_FIELDS.has(key) && typeof payload[key] === 'string'));
}

export function createDeliverySyncRpcHandler(store, { logger = console } = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('createDeliverySyncRpcHandler requires a delivery sync settings store');
  }
  return async (endpoint, payload, signal) => {
    if (!validDeliverySyncPayload(endpoint, payload)) {
      return {
        ok: false,
        error: {
          code: 'bad-request',
          message: t('无效的会话同步设置：开关必须是布尔值，图标是不超过 32 个字符的文本。'),
        },
      };
    }
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: t('请求已取消。') } };
    }
    try {
      const value = endpoint === DELIVERY_SYNC_ENDPOINTS.get
        ? await store.get()
        : await store.set(payload);
      return { ok: true, value };
    } catch (error) {
      // The page only sees a stable code; the Host log keeps the cause, so a
      // damaged document or a permission problem stays diagnosable.
      logger?.warn?.(
        `[dsh-im] delivery-sync settings ${endpoint} failed`
          + ` [${error?.code ?? error?.name ?? 'unknown-error'}]: ${error?.message ?? ''}`,
      );
      return {
        ok: false,
        error: {
          code: 'delivery-sync-settings-unavailable',
          message: t('无法读取或保存会话同步设置，请稍后重试。'),
        },
      };
    }
  };
}

/** Install-time helper: the store the RPC and the coordinator share. */
export function deliverySyncStore(config) {
  return getDeliverySyncSettingsStore(config);
}

/**
 * Register the delivery-sync settings channel. The authority follows the
 * profile option (`trusted-host` by default) because the settings page is
 * commonly opened through the Host dashboard's own domain rather than
 * 127.0.0.1; `loopback` stays available for operators who pinned it.
 */
export function installDeliverySyncRpc(ctx, { config = {}, store = null, logger = console } = {}) {
  const handler = createDeliverySyncRpcHandler(store ?? deliverySyncStore(config), { logger });
  return registerManagementRpc(ctx, DELIVERY_SYNC_RPC_CHANNEL, handler, {
    authority: config.rpcAuthority,
  });
}
