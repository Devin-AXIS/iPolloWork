import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import semver from 'semver'
import { z } from 'zod'
import { readJson } from './account.ts'
import { SuiteError } from './errors.ts'

const releaseBase = 'https://github.com/Devin-AXIS/iPolloWork/releases/download/'
const feedUrl = releaseBase + 'plugin-market/ipollowork-plugin-releases.json'
const maxArchiveBytes = 128 * 1024 * 1024
const tag = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
const archive = z.object({
  name: z.string().min(1).max(214),
  version: z.string().max(100).refine(version => semver.valid(version) !== null),
  file: z.string().regex(/^[a-z0-9][a-zA-Z0-9.+-]*\.tgz$/).max(255),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  tag,
}).strict()
export const bundledReleases = z.object({ format: z.literal(1), plugins: z.array(archive).max(100) }).strict()
const publishedRelease = archive.extend({
  dsh: z.string().max(120).refine(range => Boolean(range.trim()) && semver.validRange(range) !== null),
}).refine(release => release.file === `${release.name}-${release.version}-${release.sha256.slice(0, 12)}.tgz`)
const publishedReleases = z.object({ format: z.literal(1), plugins: z.array(publishedRelease).max(100) }).strict()
export type PublishedRelease = z.infer<typeof publishedRelease>

export function githubArchive(release: z.infer<typeof archive>) {
  return { spec: `${releaseBase}${release.tag}/${release.file}`, archiveSha256: release.sha256 }
}

/** One bounded check across list refreshes and installation requests. The bundled catalog works offline. */
export function createReleaseFeed(lifetime: AbortSignal) {
  let snapshot: { expires: number; releases: Promise<PublishedRelease[]> } | undefined
  return () => {
    if (snapshot && snapshot.expires > Date.now()) return snapshot.releases
    const releases = (async () => {
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(2500)])
      const response = await fetch(feedUrl, { signal })
      if (!response.ok) {
        await response.body?.cancel()
        return []
      }
      const { plugins } = publishedReleases.parse(await readJson(response, 65536))
      const identities = new Set(plugins.map(plugin => `${plugin.name}@${plugin.version}`))
      if (identities.size !== plugins.length) return []
      return plugins.sort((left, right) => semver.rcompare(left.version, right.version))
    })().catch(() => [])
    snapshot = { expires: Date.now() + 30_000, releases }
    return releases
  }
}

export function verifyArchive(bytes: Uint8Array, sha256: string) {
  if (!hasDigest(bytes, sha256)) throw new Error('Archive checksum mismatch')
}

function hasDigest(bytes: Uint8Array, sha256: string): boolean {
  return createHash('sha256').update(bytes).digest('hex') === sha256
}

/** Download a Host-selected asset and expose it to DSH only after verifying its digest. */
export async function cacheGithubArchive(target: { spec: string; archiveSha256: string }, directory: string, lifetime: AbortSignal) {
  const { spec, archiveSha256 } = target
  const destination = join(directory, `${archiveSha256}.tgz`)
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    const cached = await readFile(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (cached && hasDigest(cached, archiveSha256)) return `file:${destination}`
    await mkdir(directory, { recursive: true })
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(120_000)])
    const response = await fetch(spec, { signal })
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxArchiveBytes) {
      await response.body?.cancel()
      throw new Error('Release asset unavailable')
    }
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    async function* verifiedBytes() {
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxArchiveBytes) throw new Error('Release asset too large')
          hash.update(value)
          yield value
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
    await pipeline(verifiedBytes(), createWriteStream(temporary, { flags: 'wx' }), { signal })
    if (hash.digest('hex') !== archiveSha256) throw new Error('Archive checksum mismatch')
    await rename(temporary, destination)
    return `file:${destination}`
  } catch (cause) {
    throw new SuiteError('IPW_MARKET_ARCHIVE_UNAVAILABLE', 502, { cause })
  } finally {
    await rm(temporary, { force: true })
  }
}
