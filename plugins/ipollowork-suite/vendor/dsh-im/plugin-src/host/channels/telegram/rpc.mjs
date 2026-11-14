import { registerManagementRpc } from '../../../management-rpc.mjs';
import {
  TOKEN_BOT_ENDPOINTS,
  createTokenBotRpcHandler,
} from '../shared/rpc.mjs';
import {
  GROUP_TRIGGERS_ENDPOINTS,
  createGroupTriggersRpcHandler,
} from '../shared/group-triggers-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';

export const TELEGRAM_RPC_CHANNEL = '/telegram';
export { GROUP_TRIGGERS_ENDPOINTS } from '../shared/group-triggers-rpc.mjs';
export const TELEGRAM_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  ...GROUP_TRIGGERS_ENDPOINTS,
});
export const TELEGRAM_RPC_ENDPOINTS = Object.freeze(Object.values(TELEGRAM_ENDPOINTS));

export function createTelegramRpcHandler(controller) {
  const handler = createTokenBotRpcHandler(controller, { channel: 'Telegram' });
  // Per-group reply rules are Telegram-only, so they are layered on top of the
  // shared token-bot endpoints instead of widening them for every channel.
  const groupTriggers = createGroupTriggersRpcHandler(controller);
  return async (endpoint, payload, signal) => {
    const handled = await groupTriggers(endpoint, payload, signal);
    return handled ?? handler(endpoint, payload, signal);
  };
}

export function installTelegramRpc(ctx, controller, authority) {
  return registerManagementRpc(ctx,
    TELEGRAM_RPC_CHANNEL,
    createTelegramRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
