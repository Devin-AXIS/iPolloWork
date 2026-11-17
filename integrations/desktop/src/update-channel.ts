/** Resolve the update channel sealed into the installed application manifest. */
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import type { DesktopUpdatePreferences } from './settings-file.ts'

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = DesktopUpdatePreferences['channel']

/** The iPolloWork public release directory only publishes stable feeds. */
export async function fixedDesktopUpdateChannel(configPath: string): Promise<DesktopUpdateChannel | undefined> {
  try {
    const config: unknown = parse(await readFile(configPath, 'utf8'))
    if (typeof config !== 'object' || config === null
      || !('provider' in config) || config.provider !== 'generic'
      || !('url' in config) || typeof config.url !== 'string') return undefined
    const url = new URL(config.url)
    if (url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.toLowerCase().replace(/\/$/u, '') === '/devin-axis/ipollowork/releases/latest/download') return 'stable'
  } catch {
    // Missing or invalid configuration is still handled by the existing updater.
  }
  return undefined
}

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'stable') throw new Error('desktop update: invalid packaged channel')
  return channel
}
