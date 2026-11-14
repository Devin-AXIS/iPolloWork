import { createProductionController } from './production.mjs';
import { createWeixinRpcHandler, installWeixinRpc, WEIXIN_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';
import { publicChannelStartupError } from '../shared/startup-error.mjs';
import { createWeixinDiagnostics } from '../../../../src/channels/weixin/connection-error.mjs';

export const name = 'dsh-weixin-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-weixin') : (ctx.logger ?? console);
  const diagnostics = createWeixinDiagnostics({ logger });
  const rpcOptions = { ...config.rpcOptions, logger, diagnostics };
  if (config?.controller) {
    return installWeixinRpc(ctx, config.controller, rpcOptions, config.rpcAuthority);
  }

  return installProductionChannel(ctx, config, {
    channel: 'weixin',
    rpcChannel: WEIXIN_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, { ...config.internals, diagnostics }),
    createHandler: controller => createWeixinRpcHandler(controller, rpcOptions),
    reportStartupError: (error, warning) => diagnostics.report(error, {
      operation: 'startup', stage: warning ? 'connection.stop' : 'startup.load', warning,
      code: publicChannelStartupError('weixin', error).code,
    }).publicError,
  });
}

export function createWeixinHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createConnectionSupervisor, ConnectionSupervisor } from './connection-supervisor.mjs';
export { createProductionController } from './production.mjs';
export {
  WEIXIN_ENDPOINTS,
  WEIXIN_RPC_CHANNEL,
  WEIXIN_RPC_ENDPOINTS,
  createWeixinRpcHandler,
  installWeixinRpc,
} from './rpc.mjs';
export { WeixinController } from '../../../../src/channels/weixin/weixin-controller.mjs';
export { WeixinRuntime } from '../../../../src/channels/weixin/weixin-runtime.mjs';
