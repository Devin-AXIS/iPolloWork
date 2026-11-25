/** Resolve a public electron-updater directory without exposing credentials in the installer. */
export const DESKTOP_RELEASE_UPDATE_FEED = 'IPOLLOWORK_DESKTOP_UPDATE_FEED'

export function resolveDesktopReleaseFeedUrl(value, target) {
  if (value === undefined) return undefined
  const address = value.replaceAll('${target}', target)
  const url = URL.parse(address)
  if (!url || url.protocol !== 'https:' || !url.hostname || url.username || url.password || /[?#]/u.test(url.href)
    || address.includes('${')) {
    throw new Error('desktop.update.feedUrl must be an HTTPS URL without credentials, query or fragment')
  }
  if (/\.(?:exe|msi|zip|dmg|appimage|ya?ml|blockmap)\/*$/iu.test(url.pathname)) {
    throw new Error('desktop.update.feedUrl must point to the update directory containing channel metadata')
  }
  return url.href.replace(/\/+$/u, '') + '/'
}
