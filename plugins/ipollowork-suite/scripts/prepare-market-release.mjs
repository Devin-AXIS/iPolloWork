/** Build the independent market manifest and content-addressed archives for publishing. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'

const [tag, output, ...archives] = process.argv.slice(2)
if (!tag || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(tag) || !output || !archives.length)
  throw new Error('Usage: node scripts/prepare-market-release.mjs GITHUB_RELEASE_TAG OUTPUT_DIRECTORY ARCHIVE [ARCHIVE…]')
const pinned = JSON.parse(await readFile(new URL('../catalog/bundled-releases.json', import.meta.url), 'utf8'))
const names = new Set(pinned.plugins.map(plugin => plugin.name))
const filename = join(output, 'ipollowork-plugin-releases.json')
const previous = await readFile(filename, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '{"format":1,"plugins":[]}'
  throw error
})
const manifest = JSON.parse(previous)
if (manifest.format !== 1 || !Array.isArray(manifest.plugins)) throw new Error('Invalid existing market manifest')
await mkdir(output, { recursive: true })
for (const archive of archives) {
  const { name, version, engines, dsh } = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
  if (!names.has(name) || !semver.valid(version) || typeof engines?.dsh !== 'string'
    || !engines.dsh.trim() || !semver.validRange(engines.dsh) || !dsh?.bundle?.patch)
    throw new Error(`Invalid market bundle ${archive}`)
  const bytes = await readFile(archive)
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error(`Archive exceeds the market size limit ${archive}`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const file = `${name}-${version}-${sha256.slice(0, 12)}.tgz`
  const recorded = manifest.plugins.find(release => release.name === name && release.version === version)
  if (recorded && recorded.sha256 !== sha256) throw new Error(`${name}@${version} is already pinned to another archive`)
  if (recorded) continue
  manifest.plugins.push({ name, version, file, sha256, tag, dsh: engines.dsh })
  await writeFile(join(output, file), bytes)
}
const data = JSON.stringify(manifest, null, 2) + '\n'
if (manifest.plugins.length > 100 || Buffer.byteLength(data) > 65536) throw new Error('Market manifest exceeds its size limit')
await writeFile(filename, data)
