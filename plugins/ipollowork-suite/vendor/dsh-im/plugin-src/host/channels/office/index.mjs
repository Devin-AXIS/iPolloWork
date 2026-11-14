import { createProductionController } from './production.mjs';
import { createOfficeRpcHandler, installOfficeRpc } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';
import { OFFICE_RPC_CHANNEL } from '../../../../src/channels/office/protocol.mjs';

export async function apply(ctx, config = {}) {
  if (config.controller) return installOfficeRpc(ctx, config.controller, config.rpcAuthority);
  return installProductionChannel(ctx, config, {
    channel: 'office',
    rpcChannel: OFFICE_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createOfficeRpcHandler(controller),
  });
}
