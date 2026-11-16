import { createProductionController } from './production.mjs';
import { createMatrixRpcHandler, installMatrixRpc, MATRIX_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-matrix-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) return installMatrixRpc(ctx, config.controller, config.rpcAuthority);
  return installProductionChannel(ctx, config, {
    channel: 'matrix',
    rpcChannel: MATRIX_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createMatrixRpcHandler(controller),
  });
}

export function createMatrixHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  MATRIX_ENDPOINTS,
  MATRIX_RPC_CHANNEL,
  MATRIX_RPC_ENDPOINTS,
  createMatrixRpcHandler,
  installMatrixRpc,
} from './rpc.mjs';
export { MatrixController } from '../../../../src/channels/matrix/matrix-controller.mjs';
export { MatrixRuntime } from '../../../../src/channels/matrix/matrix-runtime.mjs';
