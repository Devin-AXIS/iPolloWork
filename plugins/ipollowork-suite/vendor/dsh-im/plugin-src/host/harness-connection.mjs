import { modernHarnessApi } from './modern-harness-api.mjs';

/** Connect to this Host directly unless an external Harness URL was configured. */
export function harnessConnection(ctx, config = {}, { competitiveApprovals = false } = {}) {
  if (config.harnessBaseUrl !== undefined) {
    return { baseUrl: new URL(config.harnessBaseUrl) };
  }
  const apiProxy = modernHarnessApi(ctx, { deliveryService: config.deliveryService });
  return {
    apiProxy,
    competitiveApprovals,
    // Cordis child contexts share one root; different Hosts must not share
    // ownership of pending questions and approvals.
    interactionScope: ctx.root ?? ctx,
  };
}
