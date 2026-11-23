import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { cacheGithubArchive, createReleaseFeed, githubArchive } from '../src/host/market-releases.ts'

const name = 'deepseek-ivideo'
const version = '1.0.0-beta.25'
const bytes = Buffer.from('QA release archive')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const release = { name, version, tag: 'video-1.0.0-beta.25', file: `${name}-${version}-${sha256.slice(0, 12)}.tgz`, sha256, dsh: '>=0.2.2-rc.3 <0.2.3-0' }

test('the fixed release index is checked once and rejects duplicate version pins', async t => {
  let entries = [release]
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://github.com/Devin-AXIS/iPolloWork/releases/download/plugin-market/ipollowork-plugin-releases.json')
    return Response.json({ format: 1, plugins: entries })
  })
  const signal = new AbortController().signal
  const list = createReleaseFeed(signal)
  assert.deepEqual(await Promise.all([list(), list()]), [[release], [release]])
  assert.equal(fetch.mock.callCount(), 1)
  entries = [release, release]
  assert.deepEqual(await createReleaseFeed(signal)(), [])
})

test('a failed download leaves no installable file and a verified download stays in the cache', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ipw-market-archive-'))
  const target = githubArchive(release)
  const signal = new AbortController().signal
  let body = Buffer.from('wrong archive')
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, target.spec)
    return new Response(new Uint8Array(body))
  })
  try {
    await assert.rejects(cacheGithubArchive(target, directory, signal), { code: 'IPW_MARKET_ARCHIVE_UNAVAILABLE' })
    assert.deepEqual(await readdir(directory), [])
    body = bytes
    const spec = await cacheGithubArchive(target, directory, signal)
    assert.equal(spec, `file:${join(directory, sha256 + '.tgz')}`)
    assert.deepEqual(await readFile(spec.slice(5)), bytes)
    assert.equal(await cacheGithubArchive(target, directory, signal), spec)
    assert.equal(fetch.mock.callCount(), 2)
    await writeFile(spec.slice(5), 'corrupt cache')
    assert.equal(await cacheGithubArchive(target, directory, signal), spec)
    assert.deepEqual(await readFile(spec.slice(5)), bytes)
    assert.equal(fetch.mock.callCount(), 3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('scoped native plugin archives use npm filenames in the same verified release feed',async t=>{
  const scoped={...release,name:'@ipollo/dsh-media-studio',version:'0.1.7',tag:'v1.0.16',file:`ipollo-dsh-media-studio-0.1.7-${sha256.slice(0,12)}.tgz`,dsh:'0.2.3-alpha.2'}
  t.mock.method(globalThis,'fetch',async()=>Response.json({format:1,plugins:[release,scoped]}))
  assert.deepEqual(await createReleaseFeed(new AbortController().signal)(),[release,scoped])
})
