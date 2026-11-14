/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseArgs } from 'node:util'
import {
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
} from '../../../scripts/client-build-environment.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const environment = resolveClientBuildEnvironment(repositoryClientBuildEnvironment(root), 'local')
  readClientBuildRecord(root, environment)
  const destination = resolve(root, values.out)
  const packed = await packFamilyMembers(root, releaseFamily('dsh'), destination, concurrency)
  execFileSync('npm', ['run', 'build'], { cwd: resolve(root, 'plugins/ipollowork-suite'), stdio: 'inherit' })
  execFileSync('npm', ['pack', '--pack-destination', destination], { cwd: resolve(root, 'plugins/ipollowork-suite'), stdio: 'inherit' })
  const catalog = resolve(root, 'plugins/ipollowork-suite/catalog')
  const releases = z.object({ format: z.literal(1), plugins: z.array(z.object({
    name: z.enum(['deepseek-idesign', 'deepseek-ivideo']),
    file: z.string().regex(/^[a-z0-9][a-z0-9.-]+\.tgz$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })) }).parse(JSON.parse(readFileSync(resolve(catalog, 'bundled-releases.json'), 'utf8')))
  for (const release of releases.plugins) {
    const path = resolve(catalog, 'packages', release.file)
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== release.sha256) {
      throw new Error(`desktop local pack: checksum mismatch for ${release.name}`)
    }
    copyFileSync(path, resolve(destination, release.file))
  }
  console.log(`desktop local pack: ${String(packed.length)} tarball(s) in ${destination}`)
}

await main()
