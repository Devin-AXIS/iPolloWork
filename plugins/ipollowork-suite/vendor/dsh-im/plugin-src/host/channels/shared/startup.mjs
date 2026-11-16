import { registerManagementRpc } from '../../../management-rpc.mjs';
import { onImHostLanguageChange } from '../../../../src/channels/shared/i18n.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';
import { publicChannelInitializing, publicChannelStartupError } from './startup-error.mjs';
import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';

/**
 * Keep a channel's platform-side command menu in the current host message
 * language. Menus are registered with the platform when a bot connects, so a
 * later language change has to re-send them; channels that publish no menu
 * expose no refresh hook and are left alone.
 */
function followHostLanguage(ctx, channel, controller, logger) {
  if (typeof controller?.refreshCommandMenus !== 'function') return;
  const unsubscribe = onImHostLanguageChange(() => {
    // Never run a slow or failing platform call inside the language switch:
    // subscribers are synchronous and must not delay or break one another.
    void Promise.resolve()
      .then(() => controller.refreshCommandMenus())
      .catch((error) => logger.warn?.(
        `[dsh-im] failed to re-send the ${channel} command menu after a language change`,
        error,
      ));
  });
  ctx.effect(() => unsubscribe, `dsh-im: follow the host language for ${channel} command menus`);
}

/** Mount the native management RPC before any fallible production initialization. */
export async function installProductionChannel(ctx, config, {
  channel, rpcChannel, createProduction, createHandler, reportStartupError,
}) {
  let startupError = publicChannelInitializing(channel);
  let handler = async () => ({ ok: false, error: startupError });
  const logger = typeof ctx.logger === 'function' ? ctx.logger(`dsh-im:${channel}`) : (ctx.logger ?? console);
  const diagnostics = createConnectionDiagnostics({ channel, logger });
  const disposeRpc = registerManagementRpc(ctx, rpcChannel, async (endpoint, payload, signal) => {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'The request was cancelled.', details: {} } };
    }
    try { return await handler(endpoint, payload, signal); }
    catch (error) {
      // Preserve a final Host diagnostic if an endpoint misses its own catch.
      return diagnosticRpcResult(diagnostics, error, { ok: false, error: { code: `${channel}-operation-failed` } }, { operation: endpoint });
    }
  }, { authority: resolveRpcAuthority(config.rpcAuthority) });
  let production;
  let unregisterDelivery;
  let closing;
  const closeProduction = () => (closing ??= (async () => {
    try {
      await unregisterDelivery?.();
    } finally {
      await production?.close();
    }
  })());
  try {
    production = await createProduction();
    unregisterDelivery = config.deliveryService && production.deliveryAdapter
      ? config.deliveryService.registerAdapter(production.deliveryAdapter) : undefined;
    const readyHandler = createHandler(production.controller);
    ctx.effect(() => closeProduction, `dsh-im: close ${channel} connections`);
    followHostLanguage(ctx, channel, production.controller, logger);
    handler = readyHandler;
  } catch (error) {
    startupError = reportStartupError
      ? reportStartupError(error, false)
      : diagnostics.report(error, { operation: 'startup', stage: 'startup.load', publicError: publicChannelStartupError(channel, error) }).publicError;
    try {
      await closeProduction();
    } catch (cleanupError) {
      if (reportStartupError) reportStartupError(cleanupError, true);
      else diagnostics.report(cleanupError, { operation: 'startup', stage: 'connection.stop', warning: true });
    }
  }
  return disposeRpc;
}
