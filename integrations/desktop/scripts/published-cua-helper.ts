/** Consume the official helper only when its archive and complete source identity match the reviewed SDK. */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { x } from 'tar'
import { verifyCuaHelperPayload } from '../../../.upstream/dsh/scripts/cua-helper/payload.ts'

interface PublishedCuaPin { version: string; integrity: string; sourceDigest: string }

export async function withPublishedCuaHelper<T>(output: string, pin: PublishedCuaPin,
  operation: (provider: string) => Promise<T>, fetcher: typeof fetch = fetch,
): Promise<T> {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pin.version)
    || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pin.integrity) || !/^[a-f0-9]{64}$/.test(pin.sourceDigest)) {
    throw new Error('Published CUA helper requires an exact reviewed version, integrity and source digest')
  }
  const response = await fetcher(`https://registry.npmjs.org/@deepseek-ai/dsh-cua-macos/-/dsh-cua-macos-${pin.version}.tgz`, {
    signal: AbortSignal.timeout(120_000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`Published CUA helper download failed: HTTP ${response.status}`)
  const limit = 32 * 1024 * 1024
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Published CUA helper exceeds the archive size limit')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) throw new Error('Published CUA helper exceeds the archive size limit')
  if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pin.integrity) {
    throw new Error('Published CUA helper archive integrity mismatch')
  }
  const parent = resolve(output)
  mkdirSync(parent, { recursive: true })
  const temporary = mkdtempSync(join(parent, 'published-cua-'))
  try {
    const archive = join(temporary, 'provider.tgz')
    writeFileSync(archive, bytes)
    await x({ file: archive, cwd: temporary, strict: true })
    const provider = join(temporary, 'package')
    const manifest = JSON.parse(readFileSync(join(provider, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (manifest.name !== '@deepseek-ai/dsh-cua-macos' || manifest.version !== pin.version) {
      throw new Error('Published CUA helper package identity mismatch')
    }
    verifyCuaHelperPayload(provider, { sourceDigest: pin.sourceDigest })
    return await operation(provider)
  } finally {
    if (dirname(temporary) !== parent) throw new Error('Refusing unexpected published CUA staging cleanup')
    rmSync(temporary, { recursive: true, force: true })
  }
}
