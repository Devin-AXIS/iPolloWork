import { registerManagementRpc } from '../management-rpc.mjs';
import {
  normalizeInterfaceLanguageTag,
  normalizeMessageLanguageChoice,
} from '../../src/channels/shared/interface-language.mjs';

export const HOST_LANGUAGE_RPC_CHANNEL = '/dsh-im-language';
export const HOST_LANGUAGE_ENDPOINTS = Object.freeze({
  get: 'settings.language.get',
  set: 'settings.language.set',
  mirror: 'settings.language.mirror',
});

const ENDPOINTS = new Set(Object.values(HOST_LANGUAGE_ENDPOINTS));

export function validHostLanguagePayload(endpoint, payload) {
  if (!ENDPOINTS.has(endpoint)) return false;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (endpoint === HOST_LANGUAGE_ENDPOINTS.set) {
    if (keys.length !== 1 || keys[0] !== 'language') return false;
    // 'auto' clears the explicit choice; a tag must be one the shipped
    // dictionaries can serve, so the page cannot pin a language nobody wrote.
    return normalizeMessageLanguageChoice(payload.language) !== null;
  }
  if (endpoint === HOST_LANGUAGE_ENDPOINTS.mirror) {
    if (keys.length !== 1 || keys[0] !== 'locale') return false;
    // An explicit null clears the mirror; anything else must be a usable tag.
    return payload.locale === null || normalizeInterfaceLanguageTag(payload.locale) !== null;
  }
  return keys.length === 0;
}

/**
 * Serve the interface-language mirror. The settings UI is the only caller: it
 * knows the locale the interface is actually rendered in, including a
 * browser-derived one that DSH never stores.
 */
export function createHostLanguageRpcHandler({ controller, logger = null } = {}) {
  if (!controller || typeof controller.snapshot !== 'function'
    || typeof controller.mirror !== 'function' || typeof controller.select !== 'function') {
    throw new TypeError('createHostLanguageRpcHandler requires a host language controller');
  }
  return async (endpoint, payload, signal) => {
    if (!validHostLanguagePayload(endpoint, payload)) {
      return { ok: false, error: { code: 'bad-request', message: 'Invalid interface language request.' } };
    }
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.' } };
    }
    try {
      if (endpoint === HOST_LANGUAGE_ENDPOINTS.get) {
        return { ok: true, value: controller.snapshot() };
      }
      if (endpoint === HOST_LANGUAGE_ENDPOINTS.set) {
        const choice = normalizeMessageLanguageChoice(payload.language);
        return { ok: true, value: await controller.select(choice === 'auto' ? null : choice) };
      }
      return { ok: true, value: await controller.mirror(payload.locale) };
    } catch (error) {
      // The failure is almost always a settings-directory write problem; keep
      // the path and the underlying message out of the browser response.
      logger?.warn?.('[dsh-im] could not persist the mirrored DSH interface language', error);
      return {
        ok: false,
        error: {
          code: 'interface-language-unavailable',
          message: 'interface-language-unavailable',
        },
      };
    }
  };
}

export function installHostLanguageRpc(ctx, controller, authority) {
  const logger = typeof ctx?.logger === 'function'
    ? ctx.logger('dsh-im:language')
    : (ctx?.logger ?? null);
  return registerManagementRpc(
    ctx,
    HOST_LANGUAGE_RPC_CHANNEL,
    createHostLanguageRpcHandler({ controller, logger }),
    { authority },
  );
}
