import { registerManagementRpc } from '../management-rpc.mjs';
import { createUpdateRuntime } from './update-runtime.mjs';
import { createUpdateService } from './update-service.mjs';

export const UPDATE_RPC_CHANNEL = '/dsh-im';
export const UPDATE_ENDPOINTS = Object.freeze(['update.status', 'update.check', 'update.install']);

function validPayload(endpoint, payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (endpoint !== 'update.install') return keys.length === 0;
  return keys.length === 2 && keys.every((key) => key === 'checkId' || key === 'requestId')
    && ['checkId', 'requestId'].every((key) => typeof payload[key] === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(payload[key]));
}

const PUBLIC_ERRORS = new Set([
  'check-failed', 'invalid-release', 'check-expired', 'installation-changed', 'update-busy',
  'install-failed', 'verify-failed', 'state-unavailable', 'interrupted', 'disposed',
  'source-install', 'unknown-profile', 'unsupported-runtime', 'registry-conflict',
  'incompatible-node', 'pending-restart', 'recovery-required', 'executor-unavailable',
  'invalid-installation', 'registry-check-failed', 'install-timeout', 'install-interrupted', 'invalid-version',
]);

export function createUpdateRpcHandler(service) {
  return async (endpoint, payload, signal) => {
    if (!UPDATE_ENDPOINTS.includes(endpoint) || !validPayload(endpoint, payload)) {
      return { ok: false, error: { code: 'bad-request', message: 'Invalid update request.' } };
    }
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'Request cancelled.' } };
    try {
      // The submitted install belongs to the Host, not the lifetime of this browser request.
      const value = endpoint === 'update.install' ? await service.install(payload)
        : endpoint === 'update.check' ? await service.check() : await service.status();
      return { ok: true, value };
    } catch (error) {
      const code = PUBLIC_ERRORS.has(error?.code) ? error.code : 'update-failed';
      return { ok: false, error: { code, message: code } };
    }
  };
}

export function installUpdateRpc(ctx, options = {}) {
  const runtime = options.runtime ?? createUpdateRuntime({ ctx, moduleUrl: import.meta.url });
  const service = options.service ?? createUpdateService({ runtime });
  const dispose = registerManagementRpc(ctx, UPDATE_RPC_CHANNEL, createUpdateRpcHandler(service), {
    authority: options.authority,
  });
  ctx.effect(() => () => service.close(), 'dsh-im: close update installer');
  return dispose;
}
