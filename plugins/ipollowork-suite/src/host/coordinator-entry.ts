/** Resolve the web main-assistant entry through native Workspace and Session records. */
import { mkdir, realpath } from 'node:fs/promises'
import type { AgentContext } from './agent-native.ts'
import { COORDINATOR_PRESET } from '../shared/coordinator.ts'

/** Open the latest coordinator conversation, or explicitly start a new one.
 * @param ctx - Native workspace and session services.
 * @param directory - Dedicated web entry directory; IM connections keep their own workspaces.
 * @param fresh - Create a new conversation instead of reopening the newest one.
 * @param signal - Suite lifetime cancellation.
 * @returns Native session identity and its fixed preset.
 */
export async function openCoordinator(ctx: AgentContext, directory: string, fresh: boolean, signal: AbortSignal): Promise<{ sessionId: string; agentPreset: string }> {
  await mkdir(directory, { recursive: true })
  const path = await realpath(directory)
  signal.throwIfAborted()
  const workspace = await ctx.workspaceRegistry.create(path, '总助手 · Main assistant')
  if (!fresh) {
    const listed = await ctx.sessionController.list({}, signal)
    const allowed = new Map(listed.items.filter(item => !item.parentSessionId && item.projections?.values.agentPreset === COORDINATOR_PRESET).map(item => [item.sessionId, item]))
    const previous = workspace.sessionIds.find(id => allowed.has(id) && !ctx.workspaceRegistry.archivedSessionIds.includes(id))
    if (previous) return { sessionId: previous, agentPreset: COORDINATOR_PRESET }
  }
  signal.throwIfAborted()
  const created = await ctx.sessionController.create({ workspaceId: workspace.id, agentPreset: COORDINATOR_PRESET })
  return { sessionId: created.sessionId, agentPreset: COORDINATOR_PRESET }
}
