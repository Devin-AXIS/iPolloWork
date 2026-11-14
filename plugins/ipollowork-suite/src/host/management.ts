/** Restrict the model-facing manager without changing DSH's normal UI or other plugins. */
export interface ToolCall { name: string; arguments: unknown }
export type Decision = { kind: 'allow' } | { kind: 'cancel' } | { kind: 'ask'; reason?: string }
  | { kind: 'deny'; reason: string; info?: { name: string; code: string } }
const PACKAGE = '@ipollo/dsh-suite'
/** This guards only native plugin_manager calls; it is not filesystem or Host-code isolation. */
export function blocksSuiteManagement(call: ToolCall, entryId: string | undefined): boolean {
  if (call.name !== 'plugin_manager' || !call.arguments || typeof call.arguments !== 'object') return false
  const args = call.arguments as Record<string, unknown>
  if (typeof args.action !== 'string' || args.action.startsWith('list_') || args.action === 'inspect') return false
  const target = args.target
  return typeof target === 'string' && (target === PACKAGE || target.startsWith(`${PACKAGE}@`) || target === entryId)
}
export const MANAGEMENT_DENIAL: Decision = {
  kind: 'deny', reason: 'Manage the iPolloWork suite from application settings. Conversation tools cannot change this system plugin.',
  info: { name: 'SuiteError', code: 'IPW_MANAGED_COMPONENT' },
}
