/** Verify identical release bytes before exposing a mirrored release. No credentials are written here. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function releasePath(tag, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error('Unsafe release tag or asset filename')
  }
  return `releases/${tag}/${name}`
}

export async function digest(stream) {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of stream) { hash.update(chunk); size += chunk.length }
  return { sha256: hash.digest('hex'), size }
}

export async function createManifest(release, directory) {
  if (!release.assets?.length) throw new Error('Release has no assets')
  const assets = []
  const names = new Set()
  for (const asset of release.assets) {
    releasePath(release.tag_name, asset.name)
    if (names.has(asset.name)) throw new Error('Duplicate release asset')
    names.add(asset.name)
    const actual = await digest(createReadStream(join(directory, asset.name)))
    if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') || asset.digest !== `sha256:${actual.sha256}` || asset.size !== actual.size) {
      throw new Error(`GitHub digest/size mismatch: ${asset.name}`)
    }
    assets.push({ name: asset.name, ...actual, globalUrl: asset.browser_download_url })
  }
  return { tag: release.tag_name, sourceCommit: release.target_commitish, assets }
}

export async function verifyMirror(manifest, origin, fetcher = fetch) {
  const base = new URL(origin)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Mirror URL must use HTTPS without credentials, query or fragment')
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`
  for (const asset of manifest.assets) {
    const url = new URL(releasePath(manifest.tag, asset.name), base)
    const response = await fetcher(url, { signal: AbortSignal.timeout(15 * 60 * 1000), redirect: 'error' })
    if (!response.ok || !response.body) throw new Error(`Mirror unavailable: ${asset.name} (${response.status})`)
    const actual = await digest(response.body)
    if (actual.size !== asset.size || actual.sha256 !== asset.sha256) throw new Error(`Mirror digest/size mismatch: ${asset.name}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file, location] = process.argv.slice(2)
  if (mode === 'manifest') {
    const manifest = await createManifest(JSON.parse(await readFile(file, 'utf8')), location)
    await writeFile(join(location, 'mirror-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  } else if (mode === 'verify') {
    await verifyMirror(JSON.parse(await readFile(file, 'utf8')), location)
  } else throw new Error('Usage: release-mirror.mjs manifest release.json directory | verify manifest.json https://mirror/')
}
