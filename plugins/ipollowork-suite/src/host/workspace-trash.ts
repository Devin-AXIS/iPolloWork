import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { resolve } from 'node:path'
import { SuiteError } from './errors.ts'

/** Archive the conversations when the native workspace registration is deleted. */
export function mountWorkspaceTrash(ctx: Context, profileHome: string) {
  const registry = ctx.workspaceRegistry
  const directory = resolve(profileHome, 'workspaces', 'recycle-bin')
  const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
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
    })
  })
  ctx.effect(() => () => pending, 'ipollowork: finish archiving deleted workspaces')
  const archived = (input: unknown) => {
    if (typeof input !== 'object' || input === null || !('sessionId' in input) ||
        typeof input.sessionId !== 'string' || input.sessionId.length > 128 || !input.sessionId)
      throw new SuiteError('IPW_INVALID_INPUT', 400)
    const id = registry.archivedSessionIds.find(sessionId => sessionId === input.sessionId)
    if (!id) throw new SuiteError('IPW_ARCHIVED_SESSION_NOT_FOUND', 404)
    return id
  }
  const restore = async (input: unknown) => {
    const id = archived(input)
    const { session } = await ctx.sessionQuery.readTitleSnapshot(id)
    if (session.cwd !== undefined) {
      const workspace = registry.list().find(item => item.path === session.cwd) ?? await registry.create(session.cwd)
      await workspace.attachSession(id)
    }
    await registry.unarchiveSession(id)
  }
  return {
    // Old versions inserted an empty synthetic Workspace. Hide only that entry; preserve real sessions and files.
    state: () => ({ workspaceId: registry.list().find(row => normalized(row.path) === normalized(directory) && row.sessionIds.length === 0)?.id ?? null }),
    reveal: async (input: unknown) => {
      const id = archived(input)
      const location = (await ctx.sessionPersistence.stat(id))?.location
      if (!location?.path) throw new SuiteError('IPW_ARCHIVED_SESSION_NOT_FOUND', 404)
      return { path: location.path }
    },
    restore,
  }
}
