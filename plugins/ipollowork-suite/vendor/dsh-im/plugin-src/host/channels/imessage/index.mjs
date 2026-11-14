import { createProductionController } from './production.mjs';
import { installIMessageRpc } from './rpc.mjs';

export const name = 'dsh-im-imessage-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) return installIMessageRpc(ctx, config.controller, config.rpcAuthority);
  const production = await createProductionController(ctx, config, config.internals ?? {});
  const unregisterDelivery = config.deliveryService && production.deliveryAdapter
    ? config.deliveryService.registerAdapter(production.deliveryAdapter) : undefined;
  const disposeRpc = installIMessageRpc(ctx, production.controller, config.rpcAuthority);
  ctx.effect(() => async () => {
    await unregisterDelivery?.(); await production.close();
  }, 'dsh-im: close iMessage connections');
  return disposeRpc;
}

export { createProductionController } from './production.mjs';
export { IMESSAGE_ENDPOINTS, IMESSAGE_RPC_CHANNEL, IMESSAGE_RPC_ENDPOINTS,
  createIMessageRpcHandler, installIMessageRpc } from './rpc.mjs';
