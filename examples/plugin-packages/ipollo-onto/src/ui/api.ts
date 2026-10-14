import { translate as tr } from './i18n'
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`/api${path}`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      })
      const result = await response.json().catch(() => {
        throw new ApiError(tr('数据服务暂时不可用，请稍后重新加载'), response.status)
      })
      if (!response.ok) throw new ApiError(result.error ?? tr('操作未完成'), response.status)
      return result
    } catch (error) {
      // Reads can recover from a brief service restart. Mutations are never replayed.
      const transient =
        error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
      if (method !== 'GET' || !transient || attempt >= 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
    }
  }
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : tr('操作未完成，请重试')
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
