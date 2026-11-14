import { createProductionController } from './production.mjs';
import { createQqRpcHandler, installQqRpc, QQ_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-qq-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installQqRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'qq',
    rpcChannel: QQ_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals),
    createHandler: controller => createQqRpcHandler(controller, config.rpcOptions),
  });
}

export function createQqHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export { QQ_ENDPOINTS, QQ_RPC_CHANNEL, QQ_RPC_ENDPOINTS, createQqRpcHandler, installQqRpc } from './rpc.mjs';
export { QqController } from '../../../../src/channels/qq/qq-controller.mjs';
export { QqRuntime } from '../../../../src/channels/qq/qq-runtime.mjs';
