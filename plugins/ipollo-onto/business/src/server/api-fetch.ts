import { createHash } from 'node:crypto'
import { DataError } from './errors'
import { decodeStockQuote } from '../plugins/tencent-stock'

interface Credential {
  origin: string
  value: string
  header?: string
  query?: string
}
export function apiOrigins() {
  return [
    ...new Set([
      'https://www.alphavantage.co',
      'https://api.frankfurter.dev',
      'https://api.github.com',
      ...(process.env.DATA_API_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
  ]
}
export function apiCredentials(): Record<string, Credential> {
  try {
    return JSON.parse(process.env.DATA_API_CREDENTIALS ?? '{}')
  } catch {
    throw new DataError('服务端 API 凭据配置格式无效')
  }
}
export function configuredRequest(template: string, value: string, credential?: string) {
  let url: URL
  try {
    url = new URL(template)
  } catch {
    throw new DataError('请输入完整的 API 地址')
  }
  if (url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol))
    throw new DataError('API 地址不支持内嵌账号、片段或非 HTTP 协议')
  if (url.origin.includes('{') || !apiOrigins().includes(url.origin))
    throw new DataError(
      '该 API 来源尚未获准，请在服务端 DATA_API_ALLOWED_ORIGINS 中配置它的 origin',
    )
  if (/\{\{(?!value\}\})/.test(template)) throw new DataError('API 地址仅支持 {{value}} 参数占位符')
  const origin = url.origin
  url = new URL(template.replaceAll('{{value}}', encodeURIComponent(value)))
  if (url.origin !== origin) throw new DataError('参数不能改变 API 来源')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (credential) {
    const item = apiCredentials()[credential]
    if (!item || item.origin !== origin || typeof item.value !== 'string')
      throw new DataError('API 凭据未配置或与来源不匹配')
    if (item.query && !item.header) url.searchParams.set(item.query, item.value)
    else if (
      item.header &&
      !item.query &&
      /^(Authorization|X-[A-Za-z0-9-]+|Api-Key)$/i.test(item.header)
    )
      headers[item.header] = item.value
    else throw new DataError('API 凭据需要配置查询参数或授权请求头')
  }
  return { url: url.toString(), headers, origin }
}
interface Cached {
  data?: unknown
  fetchedAt?: number
  attemptedAt: number
  error?: string
  pending?: Promise<Cached>
}
const cache = new Map<string, Cached>()
const MAX_ENTRIES = 1000,
  MAX_BYTES = 1_000_000
let active = 0
const waiters = new Set<() => void>()
async function acquire(signal: AbortSignal) {
  while (active >= 8) {
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        waiters.delete(done)
        signal.removeEventListener('abort', cancel)
        resolve()
      }
      const cancel = () => {
        waiters.delete(done)
        reject(new DataError('API 获取超时，请稍后刷新'))
      }
      waiters.add(done)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
  }
  signal.throwIfAborted()
  active++
  return () => {
    active--
    for (const wake of [...waiters]) wake()
  }
}
async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  format?: 'tencent-stock',
) {
  const release = await acquire(signal)
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal })
    if (!response.ok) {
      await response.body?.cancel()
      throw new DataError(`API 返回 HTTP ${response.status}`)
    }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
      await response.body?.cancel()
      throw new DataError('API 响应超过 1 MB')
    }
    if (!response.body) throw new DataError('API 返回为空')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > MAX_BYTES) throw new DataError('API 响应超过 1 MB')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (format === 'tencent-stock') return decodeStockQuote(Buffer.concat(chunks), url)
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new DataError('API 返回的内容不是有效 JSON')
    }
  } finally {
    release()
  }
}
export async function readApiJson(
  request: { url: string; headers: Record<string, string>; format?: 'tencent-stock' },
  ttlSeconds: number,
  signal: AbortSignal,
  refresh = false,
): Promise<Cached> {
  const key = createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    now = Date.now()
  let entry = cache.get(key)
  if (entry?.pending) return entry.pending
  if (entry && now - entry.attemptedAt < 2000) return entry
  if (entry?.fetchedAt && !entry.error && !refresh && now - entry.fetchedAt < ttlSeconds * 1000)
    return entry
  if (entry?.error && now - entry.attemptedAt < 5000) return entry
  if (!entry && cache.size >= MAX_ENTRIES) {
    const oldest = [...cache].find(([, v]) => !v.pending)
    if (oldest) cache.delete(oldest[0])
    else throw new DataError('API 请求较多，请稍后刷新')
  }
  if (!entry) {
    entry = { attemptedAt: 0 }
    cache.set(key, entry)
  }
  if (entry.fetchedAt && now - entry.fetchedAt > 3_600_000) {
    entry.data = undefined
    entry.fetchedAt = undefined
  }
  const target = entry
  target.attemptedAt = now
  target.pending = (async () => {
    try {
      target.data = await fetchJson(request.url, request.headers, signal, request.format)
      target.fetchedAt = Date.now()
      target.error = undefined
    } catch (e) {
      target.error =
        e instanceof DataError ? e.message : 'API 暂时无法读取，请检查服务、超时或网络连接'
    } finally {
      target.pending = undefined
    }
    return target
  })()
  return target.pending
}
export function clearApiCache() {
  cache.clear()
}
export function jsonPointer(value: unknown, path: string): unknown {
  if (path === '') return value
  if (!path.startsWith('/')) throw new DataError('取值路径使用 /price 这样的 JSON Pointer')
  for (const part of path.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (
      value === null ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, key)
    )
      throw new DataError('API 响应缺少配置的取值路径')
    value = (value as Record<string, unknown>)[key]
  }
  return value
}
