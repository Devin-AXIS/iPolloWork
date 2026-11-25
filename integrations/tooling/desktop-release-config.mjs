import { basename, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReleaseConfig, releaseConfigVariable, releaseFile, releaseObject, releaseString } from '../../services/ipollowork/deploy/release-config.mjs'
import { DESKTOP_RELEASE_UPDATE_FEED, resolveDesktopReleaseFeedUrl } from '../publisher/src/desktop-update-feed-url.mjs'
import { resolveDesktopAccountOrigin } from './account-service.mjs'

export const DEFAULT_DESKTOP_NAME = 'iPollo'
export const DEFAULT_DESKTOP_DATA = 'iPolloWork Desktop'
export const DEFAULT_DESKTOP_PROTOCOL = 'dsh'
const defaultPath = fileURLToPath(new URL('../../ipollowork.release.json', import.meta.url))
const packageName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

function leaf(value, field) {
  const name = releaseString(value, field)
  if (name !== undefined && (/[<>:"/\\|?*$]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name))) {
    throw new Error(`release configuration: ${field} must be a portable file or directory name`)
  }
  return name
}

export function readDesktopReleaseConfig(environment = process.env) {
  const selected = readReleaseConfig(environment, defaultPath)
  const value = releaseObject(selected?.desktop,
    ['appId', 'name', 'dataDirectoryName', 'protocol', 'installerName', 'icons', 'accountOrigin', 'plugins', 'update'], 'desktop')
  const directory = selected?.directory ?? dirname(defaultPath)
  const name = leaf(value.name, 'desktop.name')
  const dataDirectoryName = leaf(value.dataDirectoryName, 'desktop.dataDirectoryName')
  const appId = releaseString(value.appId, 'desktop.appId')
  const protocol = releaseString(value.protocol, 'desktop.protocol')
  if (protocol !== undefined && (!/^[a-z][a-z\d+.-]*$/u.test(protocol) || ['http', 'https', 'file', 'dsh-app'].includes(protocol))) {
    throw new Error('release configuration: desktop.protocol must be an application URL scheme')
  }
  const installerName = releaseString(value.installerName, 'desktop.installerName')
  const artifactTokens = /\$\{(?:version|os|arch|ext)\}/gu
  if (installerName !== undefined) {
    leaf(installerName.replace(artifactTokens, 'value'), 'desktop.installerName')
    if (!installerName.endsWith('.${ext}')) throw new Error('release configuration: desktop.installerName must end in .${ext}')
  }
  const spec = releaseObject(value.icons, ['windows', 'macos', 'linux', 'tray'], 'desktop.icons')
  const icons = Object.fromEntries(Object.entries(spec).map(([target, raw]) => {
    const field = `desktop.icons.${target}`
    const file = releaseFile(raw, directory, field)
    const formats = { windows: ['.png', '.ico'], macos: ['.png', '.icns'], linux: ['.png'], tray: ['.png', '.ico'] }[target]
    if (!formats.includes(extname(file).toLowerCase())) throw new Error(`release configuration: unsupported format for ${field}`)
    return [target, file]
  }))
  if (value.plugins !== undefined && !Array.isArray(value.plugins)) {
    throw new Error('release configuration: desktop.plugins must be an array')
  }
  const plugins = (value.plugins ?? []).map((raw, index) => {
    const field = `desktop.plugins[${index}]`
    const entry = releaseObject(raw, ['package', 'version', 'archive', 'patch'], field)
    const packageId = releaseString(entry.package, `${field}.package`)
    const version = releaseString(entry.version, `${field}.version`)
    const archive = releaseFile(entry.archive, directory, `${field}.archive`)
    if ((packageId !== undefined && !packageName.test(packageId)) || (version !== undefined && !exactVersion.test(version))
      || (archive === undefined && (!packageId || !version)) || (archive && !basename(archive).endsWith('.tgz'))) {
      throw new Error(`release configuration: ${field} requires a package and exact version, or a local .tgz archive`)
    }
    return { package: packageId, version, archive, patch: releaseFile(entry.patch, directory, `${field}.patch`) }
  })
  const update = releaseObject(value.update, ['feedUrl', 'channel'], 'desktop.update')
  const feedUrl = releaseString(update.feedUrl, 'desktop.update.feedUrl')
  resolveDesktopReleaseFeedUrl(feedUrl, 'win-x64')
  const channel = releaseString(update.channel, 'desktop.update.channel')
  if (channel !== undefined && !['nightly', 'stable'].includes(channel)) {
    throw new Error('desktop.update.channel must be nightly or stable')
  }
  const origin = releaseString(value.accountOrigin ?? selected?.server?.origin, 'desktop.accountOrigin or server.origin')
  return {
    path: selected?.path, name, appId, dataDirectoryName, protocol, installerName, icons, plugins, update: { feedUrl, channel },
    accountOrigin: origin === undefined ? undefined : resolveDesktopAccountOrigin({ DSH_DESKTOP_ACCOUNT_ORIGIN: origin }),
  }
}

export function applyDesktopReleaseConfig(environment) {
  const release = readDesktopReleaseConfig(environment)
  return {
    ...environment,
    ...(environment[releaseConfigVariable] === undefined ? {} : { [releaseConfigVariable]: release.path }),
    ...(release.appId === undefined ? {} : { DSH_DESKTOP_APP_ID: release.appId }),
    ...(release.update.feedUrl === undefined ? {} : { [DESKTOP_RELEASE_UPDATE_FEED]: release.update.feedUrl }),
    ...(release.update.channel === undefined ? {} : { DSH_DESKTOP_UPDATE_CHANNEL: release.update.channel }),
    ...(release.accountOrigin === undefined || environment.PACKAGE_ACCOUNT_ORIGIN !== undefined
      ? {} : { DSH_DESKTOP_ACCOUNT_ORIGIN: release.accountOrigin }),
  }
}

export function desktopProductName(environment) {
  return readDesktopReleaseConfig(environment).name ?? DEFAULT_DESKTOP_NAME
}

export function desktopArtifactName(environment, { version, os, arch, ext, suffix = '' }) {
  const template = readDesktopReleaseConfig(environment).installerName
  if (!template) {
    return os === 'linux' ? `iPollo-${version}-linux-${arch}-unsigned.${ext}` : `iPollo-${version}-${os}-${arch}${suffix}.${ext}`
  }
  const values = { version, os, arch, ext }
  return desktopArtifactTemplate(template, suffix).replace(/\$\{(version|os|arch|ext)\}/gu, (_, key) => values[key])
}

export function desktopArtifactTemplate(template, suffix = '') {
  return template.slice(0, -7) + suffix + '.${ext}'
}
