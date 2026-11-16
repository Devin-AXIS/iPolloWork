import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { reuseSpeechCache } from '../src/speech-cache.ts'

it('reuses verified models once across restarts without copying invalid or replacing existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'speech-cache-'))
  try {
    const runtime = join(root, 'runtime'), old = join(root, 'old'), current = join(root, 'current')
    const manifest = join(runtime, 'node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/runtime')
    const asset = (name: string) => ({ name, bytes: 5, sha256: createHash('sha256').update('model').digest('hex') })
    await mkdir(manifest, { recursive: true })
    await writeFile(join(manifest, 'assets.json'), JSON.stringify({ models: { int8: asset('int8.onnx'), fp32: asset('fp32.onnx') }, tokens: asset('tokens.txt'), vad: asset('vad.onnx') }))
    for (const [dir, name, content] of [['sensevoice-onnx', 'int8.onnx', 'model'], ['sensevoice-onnx', 'fp32.onnx', 'wrong'], ['sensevoice-onnx', 'tokens.txt', 'model'], ['silero', 'vad.onnx', 'model']]) {
      const path = join(old, 'speech-to-text/sensevoice/models', dir!, name!)
      await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content!)
    }
    expect(await reuseSpeechCache(runtime, old, current)).toBe(3)
    expect(await reuseSpeechCache(runtime, old, current)).toBe(0)
    const path = join(current, 'speech-to-text/sensevoice/models/sensevoice-onnx/int8.onnx')
    await writeFile(path, 'existing')
    expect(await reuseSpeechCache(runtime, old, current)).toBe(0)
    expect(await readFile(path, 'utf8')).toBe('existing')
    await expect(readFile(join(current, 'speech-to-text/sensevoice/models/sensevoice-onnx/fp32.onnx'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
