/** Reuse the native PKCE sign-in with the suite's current account. */
import { z } from 'zod'
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Owner-authenticated calls used while preparing one share dialog. */
export interface SharingConnection {
  /** Call an account-backed suite endpoint. */
  suite(path: string, body: unknown, signal: AbortSignal): Promise<unknown>
  /** Call the native Host's owner sign-in endpoint. */
  native(path: string, body: unknown, signal: AbortSignal): Promise<unknown>
}

/**
 * Bind the native share host to the signed-in account without exposing a credential.
 * @param connection - Same-origin transports for the suite and native Host.
 * @param signal - Cancels preparation before any remaining sign-in step.
 * @returns Completes only after the native Host reports a verified owner.
 */
export async function prepareSharingConnection(connection: SharingConnection, signal: AbortSignal): Promise<void> {
  const configured = z.object({ ready: z.boolean() }).parse(await connection.suite('/enterprise/native-sharing/configure', {}, signal))
  signal.throwIfAborted()
  if (configured.ready) return
  const ticket = z.object({ state: z.string().min(1), authorizeUrl: z.url() }).parse(await connection.native('ownerLoginStart', {}, signal))
  let redeemed = false
  try {
    signal.throwIfAborted()
    const grant = z.object({ code: z.string().min(1) }).parse(await connection.suite('/enterprise/native-sharing/authorize', { authorizeUrl: ticket.authorizeUrl }, signal))
    signal.throwIfAborted()
    z.object({ state: z.literal('verified') }).parse(await connection.native('ownerLoginRedeem', { state: ticket.state, code: grant.code }, signal))
    redeemed = true
  } finally {
    if (!redeemed) {
      try {
        await connection.native('ownerLoginCancel', { state: ticket.state }, AbortSignal.timeout(5_000))
      } catch (_error) {
        // The native Host also expires pending authorizations; preserve the preparation failure.
      }
    }
  }
}

/**
 * Call a native owner sign-in endpoint using the document's mounted application base.
 * @param path - Native owner endpoint suffix, supplied by the preparation flow.
 * @param body - PKCE transaction input; never an account or storage credential.
 * @param signal - Cancels this request.
 * @returns The native Host's JSON response.
 */
export async function callNativeSharing(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL('api/liveshare.' + path, document.baseURI), {
    method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new HarnessError('IPW_SHARING_CONNECTION_FAILED', 'Native sharing sign-in request failed')
  return response.json()
}
