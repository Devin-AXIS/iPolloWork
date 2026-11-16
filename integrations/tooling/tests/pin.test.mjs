import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

test('the product repository contains no tracked upstream implementation', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0')
  assert.deepEqual(files.filter(file => /^(packages|apps|vendor|native|python|scripts|snapshots|benchmarks|website)\//.test(file)), [])
})
test('official source uses an immutable revision and archive checksum', () => {
  const pin = JSON.parse(readFileSync('integrations/runtime/upstream.json', 'utf8'))
  assert.match(pin.sourceRevision, /^[a-f0-9]{40}$/)
  assert.match(pin.sourceArchiveSha256, /^[a-f0-9]{64}$/)
  assert.equal(pin.upstreamRepository, 'https://github.com/deepseek-ai/deepseek-harness.git')
})
