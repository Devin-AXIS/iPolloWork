import { createProductionController } from './production.mjs';
import { createDingtalkRpcHandler, installDingtalkRpc, DINGTALK_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-dingtalk-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installDingtalkRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }

  return installProductionChannel(ctx, config, {
    channel: 'dingtalk',
    rpcChannel: DINGTALK_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals),
    createHandler: controller => createDingtalkRpcHandler(controller, config.rpcOptions),
  });
}

export function createDingtalkHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  DINGTALK_ENDPOINTS,
  DINGTALK_RPC_CHANNEL,
  DINGTALK_RPC_ENDPOINTS,
  createDingtalkRpcHandler,
  installDingtalkRpc,
} from './rpc.mjs';
export { DingtalkController } from '../../../../src/channels/dingtalk/dingtalk-controller.mjs';
export { DingtalkRuntime } from '../../../../src/channels/dingtalk/dingtalk-runtime.mjs';
