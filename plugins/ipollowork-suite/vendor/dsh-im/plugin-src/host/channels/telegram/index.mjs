import { createProductionController } from './production.mjs';
import { createTelegramRpcHandler, installTelegramRpc, TELEGRAM_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-telegram-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installTelegramRpc(ctx, config.controller, config.rpcAuthority);
  }
  return installProductionChannel(ctx, config, {
    channel: 'telegram',
    rpcChannel: TELEGRAM_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createTelegramRpcHandler(controller),
  });
}

export function createTelegramHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  GROUP_TRIGGERS_ENDPOINTS,
  TELEGRAM_ENDPOINTS,
  TELEGRAM_RPC_CHANNEL,
  TELEGRAM_RPC_ENDPOINTS,
  createTelegramRpcHandler,
  installTelegramRpc,
} from './rpc.mjs';
export { TelegramController } from '../../../../src/channels/telegram/telegram-controller.mjs';
export { TelegramRuntime } from '../../../../src/channels/telegram/telegram-runtime.mjs';
