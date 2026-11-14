import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentCatalog, AgentModelCatalog } from '../src/shared/agents.ts'
import { startHttpMcpFixture } from './mcp-fixture.ts'

interface ProjectResult { id: string }
interface SavedResult { id: string; broken?: string }
interface NativeRun { agentPreset?: string; children: unknown[]; requests: { messages: unknown; tools: string[]; model: string }[] }

const url = process.env.IPOLLO_QA_URL
test('native profile runs different child presets, authenticated MCP, and project-local memory', { skip: !url, timeout: 90000 }, async () => {
  const origin = new URL(url!).origin
  const login = await fetch(url!, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Use the isolated profile launch URL including its token')
  const api = async <T = unknown>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000),
    })
    const value: unknown = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value as T
  }
  const prefix = '/ipollowork-suite/agents'
  const modelCatalog = await api<AgentModelCatalog>(prefix + '/models')
  assert.ok(modelCatalog.models.some(model => model.provider === 'ipollo-fixture' && model.model === 'fixed'))
  const avatar = `data:image/png;base64,${(await readFile(new URL('./fixtures/avatar.png', import.meta.url))).toString('base64')}`
  const rejected = await fetch(origin + prefix + '/catalog')
  assert.equal(rejected.status, 401)
  const invalid = await fetch(origin + prefix + '/agents', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 42 }),
  })
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { error: 'IPOLLO_INVALID_INPUT' })
  const before = await api<AgentCatalog>(prefix + '/catalog')
  for (const agent of before.agents) {
    if (agent.enabled) await api(prefix + '/agents', { ...agent, skillNames: agent.skills.map((skill: {name: string}) => skill.name), enabled: false })
  }
  const folderA = await mkdtemp(join(tmpdir(), 'ipollo-project-a-'))
  const folderB = await mkdtemp(join(tmpdir(), 'ipollo-project-b-'))
  const projectA = await api<ProjectResult>('/ipollo-fixture/project', { path: folderA, title: 'QA Project A' })
  const projectB = await api<ProjectResult>('/ipollo-fixture/project', { path: folderB, title: 'QA Project B' })
  const server = await startHttpMcpFixture()
  try {
    await api('/ipollo-fixture/service', { url: server.url })
    const connected = await api<AgentCatalog>(prefix + '/catalog')
    assert.ok(connected.services.some(service => service.name === 'shared' && service.state === 'connected'))
    const account = await api<SavedResult>(prefix + '/accounts', { name: 'QA MCP account', secret: 'ipollo-test-credential' })
    const alpha = await api<SavedResult>(prefix + '/agents', {
      name: 'QA Alpha', description: 'Research specialist', prompt: 'ALPHA_INSTRUCTIONS',
      avatar,
      projectId: projectA.id, skillNames: ['dsh-doc'],
      serviceNames: ['shared'],
      mcp: [{ serverName: 'qa', transport: 'streamable-http', url: server.url, accountId: account.id, authField: 'Authorization' }],
    })
    assert.equal(alpha.broken, undefined)
    const beta = await api<SavedResult>(prefix + '/agents', { name: 'QA Beta', description: 'Writing specialist', prompt: 'BETA_INSTRUCTIONS', skillNames: [], serviceNames: [], model: { provider: 'ipollo-fixture', model: 'fixed' } })
    assert.equal(beta.broken, undefined)
    await api(prefix + '/memory', { projectId: projectA.id, agentId: alpha.id, text: 'ONLY_PROJECT_A', revision: 0 })
    await api(prefix + '/memory', { projectId: projectB.id, agentId: alpha.id, text: 'ONLY_PROJECT_B', revision: 0 })
    const runA = await api<NativeRun>('/ipollo-fixture/run', { projectId: projectA.id, agentPreset: `ipollo-agent-${alpha.id}`, prompt: 'VERIFY_CHILD' })
    const runB = await api<NativeRun>('/ipollo-fixture/run', { projectId: projectB.id, agentPreset: `ipollo-agent-${alpha.id}`, prompt: 'VERIFY_CHILD' })
    const betaRun = await api<NativeRun>('/ipollo-fixture/run', { projectId: projectA.id, agentPreset: `ipollo-agent-${beta.id}`, prompt: 'VERIFY_CHILD', keepModel: true })
    assert.ok(runA.requests.some(request => request.tools.includes('mcp__shared__ping')))
    assert.ok(betaRun.requests.every(request => !request.tools.includes('mcp__shared__ping')))
    const parent = await api<NativeRun>('/ipollo-fixture/run', { projectId: projectA.id, agentPreset: 'standard', prompt: 'DELEGATE_TWO' })
    const requestA = JSON.stringify(runA.requests)
    const requestB = JSON.stringify(runB.requests)
    const children = parent.requests.filter((request: {messages: unknown}) => JSON.stringify(request.messages).includes('VERIFY_CHILD'))
    const summary = {
      avatarSaved: (await api<AgentCatalog>(prefix + '/catalog')).agents.find(agent => agent.id === alpha.id)?.avatar === avatar,
      avatarAbsentFromModelInput: !JSON.stringify(runA.requests).includes(avatar),
      fixedModelForDirectChat: betaRun.requests.every(request => request.model === 'fixed'),
      fixedModelForDelegation: children.some(request => request.model === 'fixed' && JSON.stringify(request.messages).includes('BETA_INSTRUCTIONS')),
      inheritedModelForDelegation: children.some(request => request.model === 'fixture' && JSON.stringify(request.messages).includes('ALPHA_INSTRUCTIONS')),
      globalDefaultUnchanged: JSON.stringify((await api<AgentModelCatalog>(prefix + '/models')).default) === JSON.stringify(modelCatalog.default),
      instructionsApplied: requestA.includes('ALPHA_INSTRUCTIONS'),
      projectAOnly: requestA.includes('ONLY_PROJECT_A') && !requestA.includes('ONLY_PROJECT_B'),
      projectBOnly: requestB.includes('ONLY_PROJECT_B') && !requestB.includes('ONLY_PROJECT_A'),
      mcpToolsVisible: runA.requests.some((request: {tools: string[]}) => request.tools.includes('mcp__qa__ping')),
      existingServiceSelected: runA.requests.some(request => request.tools.includes('mcp__shared__ping')),
      unselectedServiceHidden: betaRun.requests.every(request => !request.tools.includes('mcp__shared__ping')),
      credentialMatched: server.authorization.includes('Bearer ipollo-test-credential'),
      secretAbsentFromRequests: !requestA.includes('ipollo-test-credential'),
      childCount: parent.children.length,
      alphaChild: children.some((request: {messages: unknown}) => JSON.stringify(request.messages).includes('ALPHA_INSTRUCTIONS')),
      betaChild: children.some((request: {messages: unknown}) => JSON.stringify(request.messages).includes('BETA_INSTRUCTIONS')),
      parentKeepsStandard: parent.agentPreset === 'standard',
    }
    const expected = JSON.parse(await readFile(new URL('./native.expected.json', import.meta.url), 'utf8'))
    assert.deepEqual(summary, expected)
    console.log(JSON.stringify(summary))
  } finally {
    await server.close()
  }
})
