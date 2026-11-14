import { createConnectionDiagnostics, diagnosticRpcResult } from '../../../../src/channels/shared/connection-error.mjs';
import { createTokenBotRpcHandler } from '../shared/rpc.mjs';
import { registerManagementRpc } from '../../../management-rpc.mjs';
import { resolveRpcAuthority } from '../../rpc-authority.mjs';

export const EMAIL_RPC_CHANNEL = '/email';
export const EMAIL_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  // Lets the client hide the mailbox entry point while the channel is closed,
  // instead of offering a form whose submissions the Host would refuse.
  availability: 'channel.availability',
  bindMailbox: 'bot.bind-mailbox',
  updateMailbox: 'bot.mailbox.update',
  reconnectBot: 'bot.reconnect',
  deleteBot: 'bot.delete',
  setWorkspace: 'bot.workspace.set',
  setModel: 'bot.model.set',
  setAgentPreset: 'bot.agent-preset.set',
  setContextEnhancement: 'bot.context-enhancement.set',
  setBusyMessageMode: 'bot.message-mode.set',
  setAccessPolicy: 'bot.access-policy.set',
  setAlias: 'bot.alias.set',
  // Session binding: read the current bindings, change them, and list the
  // candidate sessions for the picker.
  // QR device flow for transports that authorize out of band (Agent mailbox).
  startAuth: 'bot.auth.start',
  pollAuth: 'bot.auth.poll',
  getBinding: 'bot.session-binding.get',
  setBinding: 'bot.session-binding.set',
  listSessions: 'bot.session.list',
});
export const EMAIL_RPC_ENDPOINTS = Object.freeze(Object.values(EMAIL_ENDPOINTS));

/** The mailbox fields, with the addressing field removed. */
function stripBotId(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const { botId, update, ...rest } = payload;
  return rest;
}

function failure(code, error) {
  return {
    ok: false,
    error: {
      code: error?.code ?? code,
      message: error?.message ?? String(error),
      details: error?.details ?? {},
    },
  };
}

function withRpcDetails(result) {
  if (result?.ok !== false) return result;
  return { ...result, error: { ...result.error, details: result.error?.details ?? {} } };
}

/**
 * Mailbox-specific endpoints are handled here; everything else (status,
 * reconnect, delete, workspace, model, preset, alias, access policy) goes
 * through the shared token-bot handler, which already knows the endpoint
 * payload shapes.
 */
export function createEmailRpcHandler(controller) {
  const diagnostics = controller.diagnostics ?? createConnectionDiagnostics({ channel: 'email' });
  // Availability is answered before anything else, including the controller
  // shape check: the client asks this endpoint to decide whether to show the
  // mailbox entry point at all, so it must work even while the channel is
  // closed and no controller is wired.
  //
  // While the channel is closed the settings page must still get a clear,
  // non-throwing answer rather than a crash from an unwired controller; every
  // other endpoint fails closed through `controller.disabled()`.
  const disabled = typeof controller?.disabled === 'function';
  const closed = disabled ? controller.disabled() : null;
  const shared = disabled ? null : createTokenBotRpcHandler(controller, { channel: 'Email' });
  return async (endpoint, payload, signal) => {
    if (endpoint === EMAIL_ENDPOINTS.availability) {
      return { ok: true, value: { enabled: !disabled } };
    }
    if (disabled) return closed;
    if (endpoint === EMAIL_ENDPOINTS.bindMailbox) {
      try {
        return { ok: true, value: await controller.bindMailbox(payload ?? {}) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, withRpcDetails({
          ok: false,
          error: {
            code: error?.code ?? 'email-bind-failed',
            message: error?.message ?? String(error),
            details: error?.details ?? {},
          },
        }), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.startAuth) {
      try {
        return { ok: true, value: await controller.startAuthorization(payload ?? {}) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, failure('email-auth-failed', error), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.pollAuth) {
      try {
        return { ok: true, value: await controller.pollAuthorization(payload ?? {}) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, failure('email-auth-failed', error), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.getBinding) {
      try {
        return { ok: true, value: await controller.getSessionBinding(payload?.botId) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, failure('email-binding-failed', error), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.setBinding) {
      try {
        return { ok: true, value: await controller.setSessionBinding(payload?.botId, payload ?? {}) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, failure('email-binding-failed', error), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.listSessions) {
      try {
        return { ok: true, value: await controller.listSessions(payload?.botId) };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, failure('email-sessions-failed', error), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    if (endpoint === EMAIL_ENDPOINTS.updateMailbox) {
      try {
        return {
          ok: true,
          // The client sends the mailbox fields flat alongside botId (as every
          // other endpoint here does). Reading a nested `update` silently
          // discarded the whole change: the call succeeded and nothing moved.
          value: await controller.updateMailboxSettings(
            payload?.botId,
            payload?.update ?? stripBotId(payload),
          ),
        };
      } catch (error) {
        return diagnosticRpcResult(diagnostics, error, withRpcDetails({
          ok: false,
          error: {
            code: error?.code ?? 'email-update-failed',
            message: error?.message ?? String(error),
            details: error?.details ?? {},
          },
        }), { operation: endpoint, botId: payload?.botId, untrustedPublicError: true });
      }
    }
    return withRpcDetails(await shared(endpoint, payload, signal));
  };
}

export function installEmailRpc(ctx, controller, authority) {
  return registerManagementRpc(
    ctx,
    EMAIL_RPC_CHANNEL,
    createEmailRpcHandler(controller),
    { authority: resolveRpcAuthority(authority) },
  );
}
