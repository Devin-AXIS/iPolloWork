/** Public account deployment settings shared by desktop build entry points. */
import { readFileSync } from 'node:fs'

export function resolveDesktopAccountOrigin(environment = process.env) {
  let value = environment.DSH_DESKTOP_ACCOUNT_ORIGIN
  if (value === undefined || value === '') {
    let settings
    try { settings = JSON.parse(readFileSync(new URL('../../plugins/ipollowork-suite/deployment.json', import.meta.url), 'utf8')) }
    catch { throw new Error('Cannot read plugins/ipollowork-suite/deployment.json') }
    value = settings?.accountOrigin
  }
  let url
  try { url = new URL(value) } catch { throw new Error('Account service requires a valid origin in deployment.json or DSH_DESKTOP_ACCOUNT_ORIGIN') }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(
    url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )) throw new Error('Account service requires HTTPS, or loopback HTTP for development, without credentials, path, query or fragment')
  return url.origin
}
