import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { stageCuaHelper } from '../scripts/stage-cua-helper.ts'

it('rejects missing Computer Use helpers before rewriting any package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-stage-'))
  try {
    await expect(stageCuaHelper(join(root, 'provider.tgz'), root)).rejects.toThrow('Desktop CUA helper missing for arm64')
  } finally { await rm(root, { recursive: true, force: true }) }
})
