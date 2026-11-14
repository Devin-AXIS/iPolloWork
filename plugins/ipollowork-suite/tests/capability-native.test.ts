/** Recorded native Session projection: discovery, schema lookup, invocation and receipt lookup. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.env.IPOLLO_CAPABILITY_QA_URL
test('a native Agent discovers and calls HTTP capabilities without writing request code', { skip: !url, timeout: 60000 }, async () => {
  const login = await fetch(url!, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const origin = new URL(url!).origin
  const call = async (path: string, body: unknown) => {
    const response = await fetch(origin + path, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    assert(response.ok, JSON.stringify(value))
    return value
  }
  const folder = await mkdtemp(join(tmpdir(), 'ipw-capability-native-'))
  try {
    const workspace = await call('/ipollo-fixture/project', { path: folder, title: 'Capability verification' })
    const run = await call('/ipollo-fixture/run', { projectId: workspace.id, agentPreset: 'standard', prompt: 'CAPABILITY_FLOW' })
    const snapshot = new URL('./expected/capability-native.json', import.meta.url)
    if (process.env.UPDATE_CAPABILITY_SNAPSHOT === '1') await writeFile(snapshot, JSON.stringify(run.capabilityTrace, null, 2) + '\n')
    assert.deepEqual(run.capabilityTrace, JSON.parse(await readFile(snapshot, 'utf8')))
    const turns = run.requests.filter((request: { tools: string[] }) => request.tools.includes('ipollo_capabilities'))
    assert.equal(turns.length, 5)
  } finally { await rm(folder, { recursive: true, force: true }) }
})
