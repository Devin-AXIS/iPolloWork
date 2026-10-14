import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { LiveActivity } from '../core/live-data'

// Invalidation only: no records, model messages, credentials or durable event store.
// This local, single-process service only retains listeners while a page is open.
const listeners = new Map<string, Set<(activity?: LiveActivity) => void>>()

export function publishProjectChange(projectId: string) {
  for (const changed of listeners.get(projectId) ?? []) changed()
}

export function publishProjectActivity(projectId: string, activity: LiveActivity) {
  for (const changed of listeners.get(projectId) ?? []) changed(activity)
}

export function projectChanges(c: Context, projectId: string, workbenchId?: string) {
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    let pending = true
    let writing = false
    const activities: LiveActivity[] = []
    const write = async () => {
      if (writing || stream.aborted) return
      writing = true
      try {
        // Coalesce writes while a slow client is draining. One pending bit per client.
        while ((pending || activities.length) && !stream.aborted) {
          const activity = activities.shift()
          if (activity) await stream.writeSSE({ event: 'activity', data: JSON.stringify(activity) })
          else {
            pending = false
            await stream.writeSSE({ event: 'change', data: '{}', retry: 2000 })
          }
        }
      } finally {
        writing = false
      }
    }
    const changed = (activity?: LiveActivity) => {
      if (activity) {
        if (activity.workbenchId && activity.workbenchId !== workbenchId) return
        activities.push(activity)
        if (activities.length > 16) activities.shift()
      } else pending = true
      void write()
    }
    const group = listeners.get(projectId) ?? new Set<(activity?: LiveActivity) => void>()
    listeners.set(projectId, group)
    group.add(changed)
    const heartbeat = setInterval(() => {
      if (!writing && !stream.aborted) {
        writing = true
        void stream.writeSSE({ event: 'heartbeat', data: '{}' }).finally(() => {
          writing = false
          if (pending || activities.length) void write()
        })
      }
    }, 15_000)
    await new Promise<void>((resolve) => {
      stream.onAbort(resolve)
      // Catch writes made while disconnected by refreshing once on every connection.
      changed()
    })
    clearInterval(heartbeat)
    group.delete(changed)
    if (!group.size) listeners.delete(projectId)
  })
}
