import { activityInput, type LiveActivity } from '../core/live-data'

// Subscribe only while this Onto project is visible. Data still comes from the
// existing paginated APIs; events never carry business records or change selection.
export function watchProjectChanges(
  projectId: string,
  refresh: () => Promise<void>,
  editing: () => boolean,
  activity?: (event: LiveActivity | undefined) => void,
  workbenchId?: string,
) {
  let source: EventSource | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  let running = false
  let disposed = false
  const schedule = () => {
    if (!timer && !disposed && !document.hidden) timer = setTimeout(flush, 300)
  }
  const flush = async () => {
    timer = undefined
    if (disposed || document.hidden || !pending || running) return
    const input = document.activeElement?.closest('input,textarea,select,[contenteditable="true"]')
    if (editing() || input) {
      schedule()
      return
    }
    pending = false
    running = true
    try {
      await refresh()
    } catch {
      // A reconnect or the next write retries through normal reads; never replay writes.
      pending = true
    } finally {
      running = false
      if (pending) schedule()
    }
  }
  const changed = () => {
    pending = true
    schedule()
  }
  const visibility = () => {
    if (document.hidden) {
      source?.close()
      source = undefined
      clearTimeout(timer)
      timer = undefined
    } else if (!source && !disposed) {
      source = new EventSource(
        `/api/projects/${encodeURIComponent(projectId)}/changes${workbenchId ? `?workbenchId=${encodeURIComponent(workbenchId)}` : ''}`,
      )
      source.addEventListener('open', () => activity?.(undefined))
      source.addEventListener('error', () => activity?.(undefined))
      source.addEventListener('change', changed)
      source.addEventListener('activity', (event) => {
        if (disposed) return
        try {
          const parsed = activityInput.safeParse(JSON.parse((event as MessageEvent).data))
          if (parsed.success) activity?.(parsed.data)
        } catch {
          /* Ignore invalid progress messages; they cannot update business data. */
        }
      })
    }
  }
  document.addEventListener('visibilitychange', visibility)
  visibility()
  return () => {
    disposed = true
    source?.close()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', visibility)
  }
}
