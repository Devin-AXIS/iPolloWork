/** Verify the official dependency pin and reject tracked upstream source. */
import { execFileSync } from 'node:child_process'
import { prepareSource, verifySource, root } from './upstream.mjs'
import {verifyRuntimeContract,verifyBundledRuntimeContract} from './runtime-contract.mjs'
await prepareSource()
await verifySource()
verifyRuntimeContract(root)
verifyBundledRuntimeContract(root)
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
const forbidden = tracked.filter(path => /^(?:packages|apps|vendor|native|python|benchmarks|snapshots|website|scripts)\//.test(path))
if (forbidden.length) throw new Error(`Upstream source is still tracked (${forbidden.length} paths): ${forbidden.slice(0, 3).join(', ')}`)
console.log('Pinned DSH verified; no upstream implementation is tracked')
