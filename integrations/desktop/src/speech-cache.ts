/** Reuse verified local speech models when the desktop has its own Harness home. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, link, rm, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'

interface Asset { name: string; bytes: number; sha256: string }

async function matches(path: string, asset: Asset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.bytes) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex') === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Copy only release-verified models into a missing desktop cache; existing files are never overwritten.
 * @param runtime Runtime containing the provider's pinned asset manifest.
 * @param sourceHome Previous shared Harness home.
 * @param targetHome Desktop Harness home.
 * @returns Number of verified model files copied.
 */
export async function reuseSpeechCache(runtime: string, sourceHome: string, targetHome: string): Promise<number> {
  if (sourceHome === targetHome) return 0
  const manifest = JSON.parse(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/runtime/assets.json'), 'utf8')) as {
    models: Record<string, Asset>; tokens: Asset; vad: Asset;
  }
  const assets = [...Object.values(manifest.models).map(asset => ['sensevoice-onnx', asset] as const),
    ['sensevoice-onnx', manifest.tokens] as const, ['silero', manifest.vad] as const]
  let copied = 0
  for (const [directory, asset] of assets) {
    const relative = join('speech-to-text/sensevoice/models', directory, asset.name)
    const source = join(sourceHome, relative), target = join(targetHome, relative)
    try { await stat(target); continue } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!await matches(source, asset)) continue
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await copyFile(source, temporary)
      if (!await matches(temporary, asset)) throw new Error('Speech cache changed during copy')
      try { await link(temporary, target); copied++ } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } finally { await rm(temporary, { force: true }) }
  }
  return copied
}
