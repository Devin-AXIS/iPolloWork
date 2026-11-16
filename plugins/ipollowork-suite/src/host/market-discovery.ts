import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import semver from 'semver'
import { SuiteError } from './errors.ts'
import type { MarketEntry } from '../shared/types.ts'
const run = promisify(execFile)

/** Limit interactive discovery to public GitHub repositories and names on the public npm registry. */
export function marketSource(value: string): string {
  const input = value.trim()
  if (/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(input) && input.length <= 214) return input
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error()
    if (url.hostname === 'www.npmjs.com' || url.hostname === 'npmjs.com') {
      const name = decodeURIComponent(url.pathname.replace(/^\/package\//, '').replace(/\/$/, ''))
      if (url.pathname.startsWith('/package/') && /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name) && name.length <= 214) return name
    }
    if (url.hostname === 'github.com' && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) return 'https://github.com' + url.pathname.replace(/\/$/, '').replace(/\.git$/, '')
  } catch { /* Return a stable, credential-free error. */ }
  throw new SuiteError('MARKET_INVALID_SOURCE', 400)
}
const localize = (value: string | Readonly<Record<string, string>> | undefined, language: string, fallback: string) =>
  typeof value === 'string' ? value : value?.[language] ?? value?.en ?? fallback

/** Reuse DSH's format and version selection; the administrator chooses the resulting package. */
export function discoveryEntries(value: unknown, language: string, runtime: string): MarketEntry[] {
  const plugins = Array.isArray(value) ? value.map(plugin => ({ ...plugin, metadata: undefined })) : value
  const index = parseMarketIndex({ format: 1, title: 'Import', plugins }, 'https://catalog.ipollowork.invalid/index.json')
  return index.plugins.slice(0, 50).flatMap(plugin => {
    const compatible = plugin.versions.filter(version => !version.engines.dsh || semver.satisfies(runtime, version.engines.dsh, { includePrerelease: true }))
    const version = compatible.find(version => !semver.prerelease(version.version)) ?? compatible[0]
    if (!version) return []
    return [{
      name: plugin.name, title: localize(plugin.title, language, plugin.name).slice(0, 100),
      ...(plugin.description ? { description: localize(plugin.description, language, '').slice(0, 2000) } : {}),
      ...(plugin.author ? { author: plugin.author.slice(0, 100) } : {}),
      ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
      ...(plugin.icon?.startsWith('data:') ? { icon: plugin.icon } : {}),
      metadata: { category: 'productivity' as const },
      versions: [{ version: version.version, publishTimestamp: version.publishTimestamp, source: version.source,
        ...(version.engines.dsh ? { engines: { dsh: version.engines.dsh } } : {}) }],
    }]
  })
}
/** Subprocess cancellation bounds slow Git repositories without altering the official generator. */
export async function discoverMarket(source: string, cacheDir: string, language: string, runtime: string, signal: AbortSignal): Promise<MarketEntry[]> {
  const normalized = marketSource(source)
  let stdout: string
  try {
    const result = await run(process.execPath, [fileURLToPath(new URL('./market-generator.js', import.meta.url)), normalized, cacheDir], {
      timeout: 45000, maxBuffer: 4 * 1024 * 1024, signal,
      env: { ...process.env, GITHUB_TOKEN: '', ELECTRON_RUN_AS_NODE: '1' },
    })
    stdout = result.stdout
  } catch { throw new SuiteError('MARKET_LOOKUP_FAILED', 502) }
  const entries = discoveryEntries(JSON.parse(stdout), language, runtime)
  if (!entries.length) throw new SuiteError('MARKET_NO_COMPATIBLE_PLUGIN', 422)
  return entries
}
