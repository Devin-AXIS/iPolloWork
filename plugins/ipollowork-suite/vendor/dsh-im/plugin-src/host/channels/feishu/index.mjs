import { createProvisioningBackedController } from './controller.mjs';
import { createProductionController } from './production.mjs';
import { createFeishuRpcHandler, installFeishuRpc, FEISHU_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-feishu-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

function controllerFrom(ctx, config) {
  if (config?.controller) return config.controller;
  if (typeof config?.createController === 'function') return config.createController();
  if (typeof config?.createProvisioningManager === 'function') {
    return createProvisioningBackedController(config);
  }
  // Cordis deliberately throws when a plugin reads an undeclared service,
  // even through optional chaining. Production uses the explicit services in
  // `inject`; test/programmatic controllers must therefore come from config.
  return undefined;
}

/**
 * Cordis/DSH Host plugin entry.  Production composition may supply an owned
 * controller service; tests and embedded distributions may inject one through
 * config without changing the Connection RPC boundary.
 */
export async function apply(ctx, config = {}) {
  const controller = controllerFrom(ctx, config);
  if (controller) {
    return installFeishuRpc(ctx, controller, config.rpcOptions, config.rpcAuthority);
  }

  return installProductionChannel(ctx, config, {
    channel: 'feishu',
    rpcChannel: FEISHU_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals),
    createHandler: controller => createFeishuRpcHandler(controller, config.rpcOptions),
  });
}

/** Create a programmatic plugin module with dependencies closed over. */
export function createFeishuHostPlugin(config) {
  return Object.freeze({
    name,
    inject,
    apply: (ctx) => apply(ctx, config),
  });
}

export {
  ProvisioningBackedController,
  createProvisioningBackedController,
} from './controller.mjs';
export { createProductionController } from './production.mjs';
export { ConnectionSupervisor, createConnectionSupervisor } from './connection-supervisor.mjs';
export { MultiBotDshFeishuController } from '../../../../src/channels/feishu/multi-bot-controller.mjs';
export {
  FEISHU_APP_ID_REF,
  FEISHU_APP_SECRET_REF,
  createDshCredentialStore,
} from './credential-store.mjs';
export {
  FEISHU_ENDPOINTS,
  FEISHU_MULTI_ENDPOINTS,
  FEISHU_RPC_CHANNEL,
  FEISHU_RPC_ENDPOINTS,
  createFeishuRpcHandler,
  installFeishuRpc,
  toPublicFeishuStatus,
} from './rpc.mjs';
