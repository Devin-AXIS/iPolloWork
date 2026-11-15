import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyWindowsAsarUnpack } from '../scripts/windows-asar-unpack.mjs'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('verifies physical executable bytes and rejects changed or linked copies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipollo-physical-runtime-'))
  roots.push(root)
  const source = join(root, 'source')
  const resources = join(root, 'resources')
  const destination = join(resources, 'dsh')
  await mkdir(source)
  await writeFile(join(source, 'engine.exe'), 'signed-engine-bytes')
  await cp(source, destination, { recursive: true })
  await expect(verifyWindowsAsarUnpack(source, resources, ['engine.exe'])).resolves.toBeUndefined()
  await writeFile(join(destination, 'engine.exe'), 'changed')
  await expect(verifyWindowsAsarUnpack(source, resources, ['engine.exe'])).rejects.toThrow('bytes changed')
  await rm(join(destination, 'engine.exe'))
  await symlink(join(source, 'engine.exe'), join(destination, 'engine.exe'))
  await expect(verifyWindowsAsarUnpack(source, resources, ['engine.exe'])).rejects.toThrow('expected a real executable')
})
