import { createProductionController } from './production.mjs';
import { createWecomAppRpcHandler, installWecomAppRpc, WECOM_APP_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-wecom-app-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWecomAppRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'wecom-app',
    rpcChannel: WECOM_APP_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals),
    createHandler: controller => createWecomAppRpcHandler(controller, config.rpcOptions),
  });
}

export function createWecomAppHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  WECOM_APP_ENDPOINTS,
  WECOM_APP_RPC_CHANNEL,
  WECOM_APP_RPC_ENDPOINTS,
  createWecomAppRpcHandler,
  installWecomAppRpc,
} from './rpc.mjs';
export { WecomAppController } from '../../../../src/channels/wecom-app/wecom-app-controller.mjs';
export { WecomAppRuntime } from '../../../../src/channels/wecom-app/wecom-app-runtime.mjs';
