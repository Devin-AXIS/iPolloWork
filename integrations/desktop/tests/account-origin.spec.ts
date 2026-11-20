import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDesktopPackageEnvironment, localUnsignedPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

describe('distribution-owned account address', () => {
  it.each(['win32', 'darwin'])('loads %s file settings, ignores ambient release values, and accepts explicit build overrides', async platform => {
    const root = await mkdtemp(join(tmpdir(), 'ipw-account-env-'))
    try {
      await writeFile(join(root, platform === 'win32' ? '.env.windows' : '.env.macos'), 'DSH_DESKTOP_ACCOUNT_ORIGIN=https://accounts.example.com/\n')
      const ambient = { DSH_DESKTOP_ACCOUNT_ORIGIN: 'https://unselected.example.com' }
      expect(loadDesktopPackageEnvironment(platform, ambient, root).DSH_DESKTOP_ACCOUNT_ORIGIN).toBe('https://accounts.example.com')
      expect(loadDesktopPackageEnvironment(platform, { ...ambient, PACKAGE_ACCOUNT_ORIGIN: 'https://enterprise.example.com' }, root).DSH_DESKTOP_ACCOUNT_ORIGIN).toBe('https://enterprise.example.com')
      expect(() => loadDesktopPackageEnvironment(platform, { PACKAGE_ACCOUNT_ORIGIN: 'http://remote.example.com' }, root)).toThrow(/HTTPS/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it.each(['test', 'production'])('retains the selected account in the %s packaging preset', async preset => {
    const root = await mkdtemp(join(tmpdir(), 'ipw-account-preset-'))
    try {
      await mkdir(join(root, 'presets'))
      await writeFile(join(root, 'presets', preset + '.env'), `DSH_DESKTOP_AUTO_UPDATE_ENV=${preset}\nDSH_DESKTOP_ACCOUNT_ORIGIN=https://accounts.example.com\n`)
      expect(loadDesktopPackageEnvironment('win32', { DSH_PACKAGING_PRESET: preset, DSH_PACKAGING_CONFIG_DIR: root }, root, { unsigned: true }).DSH_DESKTOP_ACCOUNT_ORIGIN).toBe('https://accounts.example.com')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps explicit Linux/unsigned account selection independent of signing settings', () => {
    expect(localUnsignedPackageEnvironment({ PACKAGE_ACCOUNT_ORIGIN: 'http://localhost:4796', CSC_LINK: 'unused-secret' }).DSH_DESKTOP_ACCOUNT_ORIGIN).toBe('http://localhost:4796')
    expect(localUnsignedPackageEnvironment({}).DSH_DESKTOP_ACCOUNT_ORIGIN).toBeUndefined()
  })
})
