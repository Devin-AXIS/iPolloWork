import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { OFFICE_RPC_CHANNEL, OFFICE_RPC_ENDPOINTS } from '../../../../src/channels/office/protocol.mjs';

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) { return record(value) && Object.keys(value).every((key) => keys.includes(key)); }

function validConfigure(payload) {
  return exact(payload, [
    'baseUrl', 'deviceId', 'deviceToken', 'maxConcurrency', 'heartbeatSeconds',
    'workspaces', 'instructionPresets',
  ]) && typeof payload.baseUrl === 'string' && typeof payload.deviceId === 'string'
    && (payload.deviceToken === undefined || typeof payload.deviceToken === 'string')
    && record(payload.workspaces) && record(payload.instructionPresets);
}

export function createOfficeRpcHandler(controller) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: 'office' });
  for (const method of ['status', 'configure', 'reconnect', 'test', 'remove']) {
    if (typeof controller?.[method] !== 'function') throw new TypeError(`AI Office controller requires ${method}()`);
  }
  return async (endpoint, payload, signal) => {
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.' } };
    try {
      let value;
      if (endpoint === OFFICE_RPC_ENDPOINTS.status && exact(payload, [])) value = await controller.status();
      else if (endpoint === OFFICE_RPC_ENDPOINTS.configure && validConfigure(payload)) value = await controller.configure(payload);
      else if (endpoint === OFFICE_RPC_ENDPOINTS.reconnect && exact(payload, [])) value = await controller.reconnect();
      else if (endpoint === OFFICE_RPC_ENDPOINTS.test && exact(payload, [])) value = await controller.test();
      else if (endpoint === OFFICE_RPC_ENDPOINTS.remove && exact(payload, ['confirm']) && payload.confirm === true) value = await controller.remove();
      else return { ok: false, error: { code: 'bad-request', message: 'Invalid AI Office connector request.' } };
      return { ok: true, value };
    } catch (error) {
      const code = error?.code === 'invalid-device-token' ? 'invalid-device-token'
        : error?.code === 'office-hook-unavailable' ? 'office-hook-unavailable' : 'office-operation-failed';
      const message = code === 'invalid-device-token' ? 'AI Office Device Token 无效。'
        : code === 'office-hook-unavailable' ? 'AI Office Hook 尚未上线或地址不正确。'
          : error instanceof TypeError ? error.message : 'AI Office 连接操作失败，请稍后重试。';
      return diagnosticRpcResult(diagnostics, error, { ok: false, error: { code, message } }, { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
    }
  };
}

export function installOfficeRpc(ctx, controller, authority) {
  return registerManagementRpc(ctx,
    OFFICE_RPC_CHANNEL,
    createOfficeRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
