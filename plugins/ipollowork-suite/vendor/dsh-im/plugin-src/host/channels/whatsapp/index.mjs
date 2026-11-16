import { createProductionController } from './production.mjs';
import { createWhatsappRpcHandler, installWhatsappRpc, WHATSAPP_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-whatsapp-host';
export const inject = ['connection', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installWhatsappRpc(ctx, config.controller, config.rpcOptions, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'whatsapp',
    rpcChannel: WHATSAPP_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createWhatsappRpcHandler(controller, config.rpcOptions),
  });
}

export function createWhatsappHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  WHATSAPP_ENDPOINTS,
  WHATSAPP_RPC_CHANNEL,
  WHATSAPP_RPC_ENDPOINTS,
  createWhatsappRpcHandler,
  installWhatsappRpc,
} from './rpc.mjs';
export { WhatsappController } from '../../../../src/channels/whatsapp/whatsapp-controller.mjs';
export { WhatsappRuntime } from '../../../../src/channels/whatsapp/whatsapp-runtime.mjs';
