import { diagnosticFields } from '../../../../src/channels/shared/diagnostic-details.mjs';
import {
  OFFICE_PROTOCOL_VERSION,
  OFFICE_RPC_CHANNEL,
  OFFICE_RPC_ENDPOINTS,
  officeHookUrls,
} from '../../../../src/channels/office/protocol.mjs';

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function unwrapOfficeRpc(result) {
  if (!record(result) || typeof result.ok !== 'boolean') throw new Error('AI Office 服务返回了无法识别的响应');
  if (!result.ok) {
    const error = new Error(typeof result.error?.message === 'string' ? result.error.message : 'AI Office 操作失败');
    error.code = typeof result.error?.code === 'string' ? result.error.code : 'office-rpc-error';
    Object.assign(error, diagnosticFields(result.error));
    throw error;
  }
  return result.value;
}

export function normalizeOfficeStatus(value) {
  if (!record(value) || value.configured !== true) {
    return { configured: false, connected: false, state: 'unconfigured', config: null, health: null };
  }
  const config = record(value.config) ? value.config : {};
  return {
    configured: true,
    connected: value.connected === true,
    state: typeof value.state === 'string' ? value.state : 'idle',
    tokenConfigured: value.tokenConfigured === true,
    config: {
      protocolVersion: config.protocolVersion ?? OFFICE_PROTOCOL_VERSION,
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
      deviceId: typeof config.deviceId === 'string' ? config.deviceId : '',
      maxConcurrency: Number(config.maxConcurrency ?? 1),
      heartbeatSeconds: Number(config.heartbeatSeconds ?? 30),
      workspaces: record(config.workspaces) ? config.workspaces : {},
      instructionPresets: record(config.instructionPresets) ? config.instructionPresets : {},
      hooks: record(config.hooks) ? config.hooks : {},
    },
    health: record(value.health) ? value.health : null,
  };
}

export { OFFICE_PROTOCOL_VERSION, OFFICE_RPC_CHANNEL, OFFICE_RPC_ENDPOINTS, officeHookUrls };
