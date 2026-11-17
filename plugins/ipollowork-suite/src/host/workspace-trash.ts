import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SuiteError } from './errors.ts'

/** Archive the conversations when the native workspace registration is deleted. */
export function mountWorkspaceTrash(ctx: Context, profileHome: string) {
  const registry = ctx.workspaceRegistry
  const directory = join(profileHome, 'workspaces', 'recycle-bin')
  let binId: string | undefined
  let creating: Promise<string> | undefined
  const ensureWorkspace = () => creating ??= (async () => {
    const existing = registry.list().find(row => row.id === binId || row.path === directory)
    if (existing) return binId = existing.id
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return binId = (await registry.create(directory, '回收站')).id
  })().finally(() => { creating = undefined })
  const sessions = new Map<string, readonly SessionId[]>(registry.list().map(workspace => [workspace.id, [...workspace.sessionIds]]))
  let pending = Promise.resolve()
  ctx.on('domain/changed', change => {
    if (change.domain !== 'workspace' || change.table !== 'workspaces') return
    if (change.operation === 'put') {
      const record = change.value
      if (typeof record === 'object' && record !== null && 'sessionIds' in record && Array.isArray(record.sessionIds))
        sessions.set(change.key, record.sessionIds.filter((id): id is SessionId => typeof id === 'string'))
      return
    }
    const deleted = sessions.get(change.key) ?? []
    sessions.delete(change.key)
    pending = pending.then(async () => {
      for (const id of deleted) {
        if (registry.list().some(workspace => workspace.sessionIds.includes(id))) continue
        try {
          await registry.archiveSession(id, { stopActivity: true })
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'WorkspaceUnknownSessionError')
            ctx.logger.warn('Could not archive a session from a deleted workspace', error)
        }
      }
      if (change.key === binId || registry.archivedSessionIds.length > 0) {
        await ensureWorkspace().catch(error => ctx.logger.warn('Could not recreate the Recycle Bin workspace', error))
      }
    })
  })
  ctx.effect(() => () => pending, 'ipollowork: finish archiving deleted workspaces')
  const restore = async (input: unknown) => {
    if (typeof input !== 'object' || input === null || !('sessionId' in input) ||
        typeof input.sessionId !== 'string' || input.sessionId.length > 128 || !input.sessionId)
      throw new SuiteError('IPW_INVALID_INPUT', 400)
    const id = registry.archivedSessionIds.find(sessionId => sessionId === input.sessionId)
    if (!id) return
    const { session } = await ctx.sessionQuery.readTitleSnapshot(id)
    if (session.cwd !== undefined) {
      const workspace = registry.list().find(item => item.path === session.cwd) ?? await registry.create(session.cwd)
      await workspace.attachSession(id)
    }
    await registry.unarchiveSession(id)
  }
  return {
    state: async () => ({ workspaceId: registry.list().find(row => row.id === binId || row.path === directory)?.id
      ?? (registry.archivedSessionIds.length > 0 ? await ensureWorkspace() : null) }),
    restore,
  }
}
