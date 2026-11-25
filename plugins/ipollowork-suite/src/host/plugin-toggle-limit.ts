import type { IncomingMessage, ServerResponse } from 'node:http'

/** Admit one native enable/disable RPC per Host before it enters the DSH profile lock. */
export function createPluginToggleLimit() {
  let pending = false
  return async (request: IncomingMessage, response: ServerResponse, next: () => Promise<void>): Promise<void> => {
    const path = URL.parse(request.url ?? '/', 'http://dsh.internal')?.pathname
    if (request.method !== 'POST' || (path !== '/api/pluginManager/setBundleEnabled' && path !== '/api/pluginManager/setPluginEnabled')) {
      await next()
      return
    }
    if (pending) {
      response.writeHead(409)
      response.end()
      return
    }
    pending = true
    try {
      await next()
    } finally {
      pending = false
    }
  }
}
