import { createProductionController } from './production.mjs';
import { createEmailRpcHandler, installEmailRpc, EMAIL_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';
import { emailChannelGate } from './availability.mjs';

export const name = 'dsh-im-email-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

/**
 * Cordis/DSH Host plugin entry. The management RPC is mounted before the
 * fallible production initialization so the channel's settings page stays
 * reachable (and can report why the mailbox failed) even when startup throws.
 * Tests and embedded distributions may inject a controller through config.
 *
 * While `EMAIL_CHANNEL_ENABLED` is off this mounts the management RPC only and
 * returns: no mailbox runtime is started and no configured mailbox is restored,
 * so a machine that already holds mailboxes sends no network request for them.
 * Nothing is deleted — reopening the switch restores every mailbox untouched.
 */
export async function apply(ctx, config = {}) {
  if (config?.controller) {
    return installEmailRpc(ctx, config.controller, config.rpcAuthority);
  }
  const closed = emailChannelGate(config);
  if (closed) return installEmailRpc(ctx, { disabled: () => closed }, config.rpcAuthority);
  return installProductionChannel(ctx, config, {
    channel: 'email',
    rpcChannel: EMAIL_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createEmailRpcHandler(controller),
  });
}

export { createProductionController } from './production.mjs';
export { EMAIL_ENDPOINTS, EMAIL_RPC_CHANNEL, EMAIL_RPC_ENDPOINTS,
  createEmailRpcHandler, installEmailRpc } from './rpc.mjs';
