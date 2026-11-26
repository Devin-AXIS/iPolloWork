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
async function providerResultAddresses(host: string, signal: AbortSignal): Promise<{ address: string; family: number }[]> {
  // Keep synthetic VPN addresses unusable. Only known Bailian result buckets
  // can use the provider's public DNS endpoint before the normal IP validation.
  const regionalBucket = /^dashscope-result(?:-[a-z0-9]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(host)
  const acceleratedBucket = /^dashscope-[a-f0-9]{4,16}\.oss-accelerate\.aliyuncs\.com$/i.test(host)
  if (!regionalBucket && !acceleratedBucket) return []
  const endpoint = new URL('https://dns.alidns.com/resolve')
  endpoint.search = new URLSearchParams({ name: host, type: 'A' }).toString()
  const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) })
  if (!response.ok) return []
  const dns: unknown = await response.json()
  if (!dns || typeof dns !== 'object' || !('Answer' in dns) || !Array.isArray(dns.Answer)) return []
  return dns.Answer.flatMap((record: unknown) =>
    record && typeof record === 'object' && 'type' in record && record.type === 1
      && 'data' in record && typeof record.data === 'string' && isIP(record.data) === 4
      ? [{ address: record.data, family: 4 }] : [])
}

/** Verify the public destination and authenticate each HTTPS connection, including redirects. */
export async function downloadMedia(source: string, signal: AbortSignal): Promise<Buffer> {
  let url = new URL(source)
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid media URL')
    const addresses = await lookup(url.hostname, { all: true })
    const usesVpnRouting = addresses.length > 0 && addresses.every(item => /^198\.(?:18|19)\./.test(item.address))
    const verified = usesVpnRouting ? await providerResultAddresses(url.hostname, signal) : addresses
    if (!verified.length || verified.some(item => !publicAddress(item.address))) throw new Error(`图片或视频域名未解析到公网地址（${url.hostname}）`)
    // Preserve a VPN's routing for the independently verified provider bucket.
    // TLS below authenticates the original HTTPS hostname on this connection.
    const address = addresses[0]!
    const result = await new Promise<{ redirect?: string; bytes?: Buffer }>((resolve, reject) => {
      const req = request(url, { rejectUnauthorized: true, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
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
