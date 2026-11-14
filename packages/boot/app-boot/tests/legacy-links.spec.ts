import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { physicalModuleDirectory, realModuleDirectory } from '../src/profile-resolution/legacy-links.ts'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-unpacked-package-'))
  roots.push(root)
  const archive = join(root, 'app.asar')
  const relative = join('dsh', 'node_modules', 'studio')
  const unpacked = join(archive + '.unpacked', relative)
  mkdirSync(unpacked, { recursive: true })
  return { archive, unpacked, path: join(archive, relative) }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('resolves complete unpacked ASAR packages to physical paths for workers', () => {
  const f = fixture()
  writeFileSync(f.archive, 'archive')
  writeFileSync(join(f.unpacked, 'package.json'), '{}')
  expect(realModuleDirectory(f.path)).toBe(realpathSync.native(f.unpacked))
  expect(physicalModuleDirectory(f.path)).toBe(realpathSync.native(f.unpacked))
})
it('does not replace an ordinary directory named asar with its sibling', () => {
  const f = fixture()
  mkdirSync(f.path, { recursive: true })
  writeFileSync(join(f.unpacked, 'package.json'), '{}')
  expect(realModuleDirectory(f.path)).toBe(realpathSync.native(f.path))
})
it('does not select a partially unpacked package without its manifest', () => {
  const f = fixture()
  writeFileSync(f.archive, 'archive')
  expect(() => realModuleDirectory(f.path)).toThrow()
  expect(physicalModuleDirectory(f.path)).toBe(f.path)
})
it('retains ordinary package directory resolution', () => {
  const f = fixture()
  expect(realModuleDirectory(f.unpacked)).toBe(realpathSync.native(f.unpacked))
})
it('preserves workspace package links in the import lookup table', () => {
  const f = fixture()
  const link = join(f.unpacked, '..', 'workspace-link')
  symlinkSync(f.unpacked, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(physicalModuleDirectory(link)).toBe(link)
})
