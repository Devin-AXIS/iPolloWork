/** Local Web document and authenticated HTTP forwarding for the application window. */
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
}
const BOOT = '<script>globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()</script>'
/** iPolloWork's mark, as a mask image for the boot page. */
const MARK = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 281 296'><path d='M149.4 0H130.52C120.17 0 111.78 8.39 111.78 18.74V43.35C111.78 53.7 120.17 62.09 130.52 62.09H149.4C159.75 62.09 168.14 53.7 168.14 43.35V18.74C168.14 8.39 159.75 0 149.4 0Z'/><path d='M278.06 89.81L259.66 57.93C256.86 53.08 250.66 51.42 245.81 54.22L139.8 115.43L34.15 54.44C29.3 51.64 23.1 53.3 20.3 58.15L2.3 89.31C-0.5 94.16 1.16 100.36 6.01 103.16L116.9 167.18C121.75 169.98 127.95 168.32 130.75 163.47L140.03 147.4L149.6 163.97C152.4 168.82 158.6 170.48 163.45 167.68L274.34 103.66C279.19 100.86 280.85 94.66 278.06 89.81Z'/><path d='M273.55 192.14L146.77 118.94C144.97 117.9 142.99 117.48 141.06 117.6C138.76 117.16 136.29 117.51 134.1 118.77L6.57 192.41C1.72 195.21 0.06 201.41 2.86 206.26L20.86 237.44C23.66 242.29 29.86 243.95 34.71 241.15L112.03 196.51V285.58C112.03 291.18 116.57 295.72 122.17 295.72H158.18C163.78 295.72 168.32 291.18 168.32 285.58V196.64L245.28 241.07C250.13 243.87 256.33 242.21 259.13 237.36L277.24 205.99C280.04 201.14 278.38 194.94 273.55 192.14Z'/></svg>\")"
/**
 * DSH's framework-free boot page shows while the Host starts, before any plugin loads; it carries iPolloWork's name
 * and mark instead of DSH's wordmark. The page exposes only data attributes: the wordmark is its card's first child.
 */
const BRAND = '<style>'
  + '[data-dsh-boot]>div>div:first-child{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:0;line-height:0;letter-spacing:0}'
  + `[data-dsh-boot]>div>div:first-child::before{content:'';width:34px;height:36px;background:currentColor;-webkit-mask:${MARK} center/contain no-repeat;mask:${MARK} center/contain no-repeat}`
  + "[data-dsh-boot]>div>div:first-child::after{content:'iPolloWork';font-size:17px;line-height:24px;font-weight:600;letter-spacing:-.01em}"
  + '[data-dsh-boot] [data-dsh-boot-spinner]+div{display:none}'
  + '</style>'
const TITLE = /<title>[^<]*<\/title>/

/**
 * Read an application-owned static asset; the index waits for asynchronous Host injections.
 * @param request - Local application request.
 * @param root - Packaged Web dist directory.
 * @returns Static response, or a missing/invalid path response.
 */
export async function serveWebDocument(request: Request, root: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  const url = new URL(request.url)
  let pathname: string
  try { pathname = decodeURIComponent(url.pathname) } catch { return new Response(null, { status: 400 }) }
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const directory = resolve(root)
  if (!target.startsWith(directory + sep)) return new Response(null, { status: 403 })
  let body: Buffer
  try { body = await readFile(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw error
  }
  const content = pathname === '/' || pathname === '/index.html'
    ? body.toString().replace('<head>', '<head>' + BOOT + BRAND).replace(TITLE, '<title>iPolloWork</title>') : new Uint8Array(body)
  return new Response(request.method === 'HEAD' ? null : content, {
    headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' },
  })
}

/** Cookie store operations used to remove legacy Host authentication cookies. */
export interface HostCookieStore {
  get(filter: { url: string }): Promise<readonly { readonly name: string }[]>
  remove(url: string, name: string): Promise<void>
}

/**
 * Remove every `dsh-auth-*` cookie that earlier releases left in a cookie store for the Host's hostname.
 * Cookies ignore ports, so cookies from earlier random-port Hosts would otherwise travel with every
 * request to that hostname until they expire.
 * @param cookies - Electron session cookie store.
 * @param url - Host URL; cookies for its hostname on every port are removed.
 */
export async function removeLegacyHostCookies(cookies: HostCookieStore, url: string): Promise<void> {
  const origin = new URL(url).origin
  for (const { name } of await cookies.get({ url: origin })) {
    if (name.startsWith('dsh-auth-')) await cookies.remove(origin, name)
  }
}

/**
 * Response headers not relayed to the renderer. `set-cookie` would hand the
 * Host's authentication cookie to the page's cookie jar, which the shell owns
 * instead; the rest describe the Node `fetch` connection (its encoding, length,
 * and hop-by-hop transport), which Chromium never sees.
 */
const WITHHELD_RESPONSE_HEADERS = [
  'set-cookie',
  // This HTTP-origin opt-in cannot be carried onto dsh-app://. Chromium's
  // OriginAgentCluster registration rejects the custom-scheme navigation and
  // terminates the browser process when an embedded workbench sends ?1.
  'origin-agent-cluster',
  'content-encoding', 'content-length',
  'transfer-encoding', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade', 'proxy-authenticate', 'proxy-authorization',
]

/** Host routes whose responses carry immutable cache headers keyed by a per-process revision. */
const PLUGIN_BUNDLE_PATH = /^\/plugins\//u
const SHARE_AUTHORIZATION_PATHS = new Set([
  '/api/liveshare.ownerLoginStart',
  '/api/liveshare.ownerLoginRedeem',
])

/**
 * Forward local application requests to its authenticated Host, preserving streaming and cancellation.
 * Plugin bundle responses lose their `cache-control` for `no-store`: the Host marks them immutable
 * under a revision that changes every launch, so Chromium's disk cache would only accumulate bundles
 * no later launch can reuse.
 * @param request - Request from the application origin.
 * @param host - Owned Host URL.
 * @param cookie - Desktop-private credential carried in the Cookie header for the owned Host.
 * @returns Host response without connection-level headers.
 */
export async function forwardWebRequest(request: Request, host: string, cookie: string): Promise<Response> {
  const source = new URL(request.url)
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== 'dsh-app://app') return new Response(null, { status: 403 })
  const shareAuthorization = request.method === 'POST' && SHARE_AUTHORIZATION_PATHS.has(source.pathname)
  // Chromium may omit Origin on the application scheme. Require JSON so a cross-origin form cannot start or redeem authorization.
  if (shareAuthorization && request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return new Response(null, { status: 415 })
  }
  const target = new URL(host)
  target.pathname = source.pathname
  target.search = source.search
  const headers = new Headers(request.headers)
  for (const name of ['host', 'origin', 'cookie', 'sec-fetch-site']) headers.delete(name)
  // LiveShare binds both steps to the same web origin. The Host accepts its own origin on the authenticated local connection.
  if (shareAuthorization) headers.set('origin', target.origin)
  headers.set('cookie', cookie)
  const init = { method: request.method, headers, body: request.body, signal: request.signal, duplex: 'half', redirect: 'manual' as const }
  const response = await fetch(target, init)
  const outgoing = new Headers(response.headers)
  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  if (PLUGIN_BUNDLE_PATH.test(source.pathname)) outgoing.set('cache-control', 'no-store')
  return new Response(response.body, { status: response.status, headers: outgoing })
}
