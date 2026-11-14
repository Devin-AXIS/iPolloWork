import { createProductionController } from './production.mjs';
import { createWecomRpcHandler, installWecomRpc, WECOM_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-wecom-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWecomRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'wecom',
    rpcChannel: WECOM_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals),
    createHandler: controller => createWecomRpcHandler(controller, config.rpcOptions),
  });
}

export function createWecomHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  WECOM_ENDPOINTS,
  WECOM_RPC_CHANNEL,
  WECOM_RPC_ENDPOINTS,
  createWecomRpcHandler,
  installWecomRpc,
} from './rpc.mjs';
export { WecomController } from '../../../../src/channels/wecom/wecom-controller.mjs';
export { WecomRuntime } from '../../../../src/channels/wecom/wecom-runtime.mjs';
