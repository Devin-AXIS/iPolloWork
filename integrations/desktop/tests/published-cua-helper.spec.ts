import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c } from 'tar'
import { afterEach, expect, it } from 'vitest'
import { cuaApplicationDigest } from '../../../.upstream/dsh/scripts/cua-helper/payload.ts'
import { withPublishedCuaHelper } from '../scripts/published-cua-helper.ts'

const roots: string[] = []
const version = '0.2.3-alpha.2', sourceDigest = 'a'.repeat(64)
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function archive(options: { version?: string; source?: string; applications?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-published-cua-')); roots.push(root)
  const provider = join(root, 'package'); await mkdir(provider)
  await writeFile(join(provider, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-cua-macos', version: options.version ?? version }))
  const applications = []
  for (const architecture of ['arm64', 'x64'] as const) {
    let bundle = 'd'.repeat(64)
    if (options.applications) {
      const application = join(root, `app-${architecture}`)
      for (const file of ['Contents/Info.plist', 'Contents/MacOS/dsh-cua-native', 'Contents/Resources/DSHComputerUse.icns', 'Contents/_CodeSignature/CodeResources']) {
        const path = join(application, file); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'fixture ' + file)
      }
      await chmod(join(application, 'Contents/MacOS/dsh-cua-native'), 0o755)
      bundle = cuaApplicationDigest(application)
      const directory = join(provider, 'native/bin', `darwin-${architecture}`)
      await mkdir(join(directory, bundle), { recursive: true })
      await rename(application, join(directory, bundle, 'DSH Computer Use.app'))
      await writeFile(join(directory, 'current.json'), JSON.stringify({ bundle }))
    }
    applications.push({ architecture, bundle })
  }
  await writeFile(join(provider, 'cua-helper.json'), JSON.stringify({ schemaVersion: 2, sourceDigest: options.source ?? sourceDigest,
    buildKey: 'b'.repeat(64), version, commit: 'c'.repeat(40), teamId: 'ABCDEF1234', applications }))
  const file = join(root, 'provider.tgz'); await c({ file, cwd: root, gzip: true }, ['package'])
  const bytes = await readFile(file), integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  return { root, bytes, pin: { version, sourceDigest, integrity }, output: join(root, 'output') }
}

const response = (bytes: Buffer): typeof fetch => async () => new Response(new Uint8Array(bytes))

it('rejects archive tampering before reading or publishing a helper', async () => {
  const fixture = await archive()
  let used = false
  await expect(withPublishedCuaHelper(fixture.output, fixture.pin, async () => { used = true }, response(Buffer.from('changed')))).rejects.toThrow('integrity mismatch')
  expect(used).toBe(false)
})

it('rejects a package from a different SDK version', async () => {
  const fixture = await archive({ version: '0.2.2-rc.3' })
  await expect(withPublishedCuaHelper(fixture.output, fixture.pin, async () => {}, response(fixture.bytes))).rejects.toThrow('identity mismatch')
  expect(await readdir(fixture.output)).toEqual([])
})

it('rejects helper bytes whose producer source differs from the pinned source', async () => {
  const fixture = await archive({ source: 'e'.repeat(64) })
  await expect(withPublishedCuaHelper(fixture.output, fixture.pin, async () => {}, response(fixture.bytes))).rejects.toThrow('current helper source bytes')
  expect(await readdir(fixture.output)).toEqual([])
})

it.skipIf(process.platform === 'win32')('checks both executable application generations and always removes staging', async () => {
  const fixture = await archive({ applications: true })
  let staged = ''
  const value = await withPublishedCuaHelper(fixture.output, fixture.pin, async provider => { staged = provider; return 'verified' }, response(fixture.bytes))
  expect(value).toBe('verified')
  expect(existsSync(staged)).toBe(false)
  expect(await readdir(fixture.output)).toEqual([])
})
