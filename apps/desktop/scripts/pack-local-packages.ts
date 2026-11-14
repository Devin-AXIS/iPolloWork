/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
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
  console.log(`desktop local pack: ${String(packed.length)} tarball(s) in ${destination}`)
}

await main()
