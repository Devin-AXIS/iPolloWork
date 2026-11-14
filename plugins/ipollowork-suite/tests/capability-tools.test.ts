import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { AccountService } from '../src/host/account.ts'
import { resolveConfig } from '../src/host/config.ts'
import { mountCapabilityTools } from '../src/host/capability-tools.ts'

for (const mode of ['workspace-write', 'read-only'] as const) test(`native capability tools discover inputs, enforce ${mode}, and retract on unload`, async () => {
  const ctx = new Context()
  const requests: { url: string; body: unknown }[] = []
  const account = new AccountService({
    readRecord: async () => ({ kind: 'grant', payload: { version: 1, origin: 'https://account.test', token: 'private-account-token' } }),
    modifyRecord: async () => undefined, deleteRecord: async () => {},
  }, resolveConfig({ accountOrigin: 'https://account.test' }), new AbortController().signal, async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-account-token')
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    requests.push({ url: String(url), body })
    if (String(url).endsWith('/invoke')) return Response.json({ requestId: (body as { requestId: string }).requestId, state: 'pending' })
    return Response.json({ items: [{ id: 'images:image', kind: 'image', modelCount: 1 }], inputSchema: { type: 'object' } })
  })
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SandboxPolicy, { mode })
    const harness = await mountAgentLoopTestHarness(ctx)
    const agent = await harness.create(SessionId(`capability-${mode}`))
    const owner = ctx.plugin({ inject: ['tools', 'sandboxPolicy'], apply(scope: Context) { mountCapabilityTools(scope, account, 300000) } })
    await owner
    const schemas = ctx.tools.schemas().filter(tool => tool.name.startsWith('ipollo_capab'))
    assert.equal(schemas.length, 4)
    assert(!JSON.stringify(schemas).includes('private-account-token'))
    const snapshot = new URL('./expected/capability-tools.schemas.json', import.meta.url)
    if (process.env.UPDATE_CAPABILITY_SNAPSHOT === '1') await writeFile(snapshot, JSON.stringify(schemas, null, 2) + '\n')
    assert.deepEqual(schemas, JSON.parse(await readFile(snapshot, 'utf8')))
    const invoke = (name: string, args: unknown, callId = name) => executeModelToolFixture(ctx, { agent, callId: ToolCallId(callId), name, arguments: args, signal: new AbortController().signal })
    assert.equal((await invoke('ipollo_capabilities', {})).isError, false)
    assert.equal((await invoke('ipollo_capability_describe', { capability: 'images:image', model: 'test', offset: 25 })).isError, false)
    assert.match(requests[1]!.url, /model=test&offset=25$/)
    const args = { capability: 'images:image', input: { prompt: 'A mountain' } }
    const first = await invoke('ipollo_capability_invoke', args, 'same-call')
    if (mode === 'read-only') {
      assert.equal(first.isError, true)
      assert.equal(first.error?.info?.code, 'IPW_CAPABILITY_READ_ONLY')
      assert.equal(requests.length, 2)
    } else {
      assert.equal(first.isError, false)
      const again = await invoke('ipollo_capability_invoke', args, 'same-call')
      assert.deepEqual(again.value, first.value)
      const submitted = requests.filter(request => request.url.endsWith('/invoke')).map(request => request.body as { requestId: string })
      assert.equal(submitted[0]!.requestId, submitted[1]!.requestId)
      assert.match(submitted[0]!.requestId, /^[a-f0-9-]{36}$/)
      assert.equal((await invoke('ipollo_capability_task', { requestId: submitted[0]!.requestId })).isError, false)
    }
    const invalid = await invoke('ipollo_capability_describe', { capability: '' })
    assert.equal(invalid.error?.info?.code, 'INVALID_ARGS')
    await owner.dispose()
    assert(!ctx.tools.schemas().some(tool => tool.name.startsWith('ipollo_capab')))
  } finally { await ctx.fiber.dispose() }
})
