/** Copy one verified installer under the name the public website recognizes. */
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DesktopBuildTarget } from './desktop-build-paths.mjs'

export async function stageWebsiteInstaller(
  artifacts: string,
  target: DesktopBuildTarget,
  version: string,
  unsigned: boolean,
): Promise<string> {
  const extension = target === 'win-x64' ? 'exe' : target === 'linux-x64' ? 'AppImage' : 'dmg'
  const originalSuffix = unsigned ? '-unsigned' : ''
  const websiteSuffix = target === 'win-x64' ? originalSuffix : ''
  const websiteTarget = target === 'linux-x64' ? 'linux-x86_64' : target
  const source = join(artifacts, `iPollo-${version}-${target}${originalSuffix}.${extension}`)
  const output = join(artifacts, 'website-installers')
  const destination = join(output, `ipollowork-${websiteTarget}-${version}${websiteSuffix}.${extension}`)
  const temporary = join(output, `.${randomUUID()}.tmp`)
  await mkdir(output, { recursive: true })
  try {
    await copyFile(source, temporary)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return destination
}
