/** Stable website names, derived only from already verified release payloads. */
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { numericReleaseVersion, windowsUpdateFilename } from './release-update-feed.mjs'

export function websiteDownloadSources(version) {
  numericReleaseVersion(version)
  return {
    [`ipollowork-win-x64-${version}.exe`]: windowsUpdateFilename(version),
    'ipollowork-win-x64-latest.exe': windowsUpdateFilename(version),
    'ipollowork-mac-arm64-latest.dmg': `ipollowork-mac-arm64-${version}.dmg`,
    'ipollowork-mac-x64-latest.dmg': `ipollowork-mac-x64-${version}.dmg`,
    'ipollowork-linux-x86_64-latest.AppImage': `ipollowork-linux-x86_64-${version}.AppImage`,
  }
}

export async function stageWebsiteDownloads(version, directory) {
  for (const [name, source] of Object.entries(websiteDownloadSources(version))) {
    await copyFile(join(directory, source), join(directory, name))
  }
}
