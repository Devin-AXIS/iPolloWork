import { EmailConfigStore } from '../../../../src/channels/email/config-store.mjs';
import { EmailHarnessClient } from '../../../../src/channels/email/harness-client.mjs';
import { EmailStateStore } from '../../../../src/channels/email/state-store.mjs';
import { EmailController } from '../../../../src/channels/email/email-controller.mjs';
import { EmailRuntime } from '../../../../src/channels/email/email-runtime.mjs';
import {
  createAccessPolicy,
  createAccessPolicyScope,
} from '../../../../src/channels/shared/access-policy.mjs';
import { createTokenProductionController } from '../shared/production.mjs';

/**
 * Email has no group concept, and a mail address is trivially forgeable, so
 * both scopes start as an allowlist seeded from the mailbox's configured
 * senders instead of the open baseline other token channels use. With no
 * senders configured the allowlist is empty, which denies everyone until the
 * user adds one — the channel fails closed.
 */
function emailAccessPolicyFor(bot) {
  const senders = Array.isArray(bot?.allowedSenders) ? bot.allowedSenders : [];
  const scope = createAccessPolicyScope({
    mode: 'allowlist',
    open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
    // Every policy user entry carries its command permission alongside the id.
    allowlist: { users: senders.map((id) => ({ id, canExecuteCommands: true })) },
  });
  return createAccessPolicy({ direct: scope, group: scope });
}

/**
 * Email is a token-shaped channel: one mailbox identity plus one secret. It
 * reuses the shared token production assembly, which wires the workspace
 * scope, access policy, delivery adapter, and connection supervisor.
 */
export function createProductionController(ctx, config = {}, internals = {}) {
  return createTokenProductionController(ctx, config, internals, {
    channel: 'email',
    ConfigStore: EmailConfigStore,
    StateStore: EmailStateStore,
    HarnessClient: EmailHarnessClient,
    Controller: EmailController,
    Runtime: EmailRuntime,
    runtimeOptions: (channelConfig) => ({
      ...(channelConfig.pollIntervalMs === undefined
        ? {} : { pollIntervalMs: channelConfig.pollIntervalMs }),
    }),
    initialAccessPolicyForBot: emailAccessPolicyFor,
    // Declares that this channel keeps its allowlist in its own config and
    // pushes the derived policy into the workspace store on change.
    accessPolicyForBot: emailAccessPolicyFor,
    // The mailbox settings page can pin the chat to an existing session.
    supportsSessionBinding: true,
    // The Agent mailbox rotates its refresh token on every refresh, so the new
    // pair must be written back through the controller.
    persistBotCredential: ({ botId, tokens, controller }) =>
      controller?.persistTokens?.(botId, tokens) ?? Promise.resolve(false),
  });
}
