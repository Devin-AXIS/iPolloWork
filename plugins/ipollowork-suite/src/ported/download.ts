import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function publicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^(?:2001:(?:db8|0):|2002:)/i.test(address)
  if (isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a !== undefined && b !== undefined && ![0, 10, 127].includes(a) && a < 224
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 198 && (b === 18 || b === 19))
}
/** Pin each request to validated public DNS results and revalidate every redirect. */
export async function downloadMedia(source: string, signal: AbortSignal): Promise<Buffer> {
  let url = new URL(source)
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid media URL')
    const addresses = await lookup(url.hostname, { all: true })
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Media endpoint is not public')
    const address = addresses[0]!
    const result = await new Promise<{ redirect?: string; bytes?: Buffer }>((resolve, reject) => {
      const req = request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        lookup: (_host, options, done) => options.all ? done(null, [{ address: address.address, family: address.family }]) : done(null, address.address, address.family),
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) { res.resume(); resolve({ redirect: res.headers.location }); return }
        if (res.statusCode !== 200) { res.resume(); reject(new Error('Media download failed')); return }
        const chunks: Buffer[] = []; let size = 0
        res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024 * 1024) res.destroy(new Error('Media is too large')); else chunks.push(chunk) })
        res.on('end', () => resolve({ bytes: Buffer.concat(chunks) })); res.on('error', reject)
      })
      req.on('error', reject); req.end()
    })
    if (result.bytes) return result.bytes
    if (!result.redirect) throw new Error('Invalid media response')
    url = new URL(result.redirect, url)
  }
  throw new Error('Too many media redirects')
}
