/** The browser `ipolloData` service: the Host contract over the suite's same-origin routes, for plugin Client modules. */
import { createDataApp, type DataStatement, type IpolloData } from '../shared/app-data.ts'

/** A rejected app data call; `code` is stable and the message explains how to correct the statement. */
export class AppDataError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'AppDataError'
  }
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`/ipollowork-suite/data/apps${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = (await response.json()) as Record<string, unknown>
  if (!response.ok) {
    const code = typeof value.error === 'string' ? value.error : 'IPW_SERVICE_UNAVAILABLE'
    throw new AppDataError(code, typeof value.message === 'string' ? `${code}: ${value.message}` : code)
  }
  return value
}

/**
 * Create the browser service. Each call carries the owner's page session to the suite Host, which remembers the app
 * a name opened; when that app was deleted, the next statement opens it again.
 * @returns the service that plugin Client modules inject as `ipolloData`.
 */
export function createBrowserAppData(): IpolloData {
  return {
    async open(name, options = {}) {
      const open = async () =>
        ((await post('', { name, ...(options.organization ? { organization: options.organization } : {}) })) as { app: { id: string } }).app.id
      let id = await open()
      return createDataApp(id, async (statement: DataStatement | { batch: DataStatement[] }) => {
        try {
          return await post(`/${id}/run`, statement)
        } catch (error) {
          if (!(error instanceof AppDataError) || error.code !== 'DATA_APP_NOT_FOUND') throw error
          id = await open()
          return post(`/${id}/run`, statement)
        }
      })
    },
  }
}
