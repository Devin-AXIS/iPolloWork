import { createProductionController } from './production.mjs';
import { createSlackRpcHandler, installSlackRpc, SLACK_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-slack-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) return installSlackRpc(ctx, config.controller, config.rpcAuthority);
  return installProductionChannel(ctx, config, {
    channel: 'slack',
    rpcChannel: SLACK_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createSlackRpcHandler(controller),
  });
}

export function createSlackHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  SLACK_ENDPOINTS,
  SLACK_RPC_CHANNEL,
  SLACK_RPC_ENDPOINTS,
  createSlackRpcHandler,
  installSlackRpc,
} from './rpc.mjs';
export { SlackController } from '../../../../src/channels/slack/slack-controller.mjs';
export { SlackRuntime } from '../../../../src/channels/slack/slack-runtime.mjs';
