import type { IncomingMessage, ServerResponse } from 'node:http'
import { z as valueSchema } from 'zod'
import type { AgentDefinition, AgentAccount, AgentInput, AgentSkill } from './agent-store.ts'
import type { AgentContext, AgentRef, NativeEntry, NativeFiber, PresetDefinition, Project } from './agent-native.ts'
import type { AgentModelCatalog } from '../shared/agents.ts'
/** Agent module of the existing iPolloWork suite. DSH owns execution, credentials, storage, and preset lifetimes. */
import { fileURLToPath } from 'node:url'
import { parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent'
import z from '@deepseek-ai/schemastery'
import { AgentError, AgentStore, initialState, presetId, stateSchema, agentInputSchema } from './agent-store.ts'
import { COORDINATOR_PRESET } from '../shared/coordinator.ts'
import { openCoordinator } from './coordinator-entry.ts'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const name = 'ipollowork-agents'
export const inject = ['webServer', 'connection', 'connection.authentication', 'credentials', 'storageDomain', 'workspaceRegistry', 'agentPresets', 'sessionController', 'skills', 'tools', 'systemPrompt', 'subagents', 'mcpManager']
const API = '/ipollowork-suite/agents'
const runtime = fileURLToPath(new URL('./agent-runtime.js', import.meta.url))

/** Deployment quotas and MCP startup budget; native settings may override them. */
export const Config = z.object({
  maxAgents: z.natural().min(1).default(100),
  maxMemoryChars: z.natural().min(1).default(12000),
  maxInputBytes: z.natural().min(1024).default(524288),
  mcpStartupTimeoutMs: z.natural().min(1).default(30000),
  coordinatorWorkspace: z.string().default(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'ipollowork', 'assistant')),
})

/** Send JSON without exposing stored credentials to a browser. */
function reply(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Read bounded, object-shaped input from the owner-authenticated HTTP route. */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new AgentError('Request is too large', 'IPOLLO_INVALID_INPUT')
    chunks.push(Buffer.from(chunk))
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
    return value
  } catch (error) {
    throw new AgentError('Enter valid configuration fields', 'IPOLLO_INVALID_INPUT', { cause: error })
  }
}

/** Expand a saved definition into an ordinary native preset without changing the base. */
export function composePreset(base: NativeEntry[], definition: AgentDefinition, accounts: AgentAccount[], mcpStartupTimeoutMs: number): PresetDefinition {
  const plugins = structuredClone(base).filter(row => row.id !== 'persona')
  const { avatar, ...runtimeDefinition } = definition
  plugins.push({ name: runtime, config: { definition: runtimeDefinition } })
  for (const server of definition.mcp) {
    const account = server.accountId ? accounts.find(item => item.id === server.accountId) : undefined
    if (server.accountId && !account) throw new AgentError('MCP account no longer exists', 'IPOLLO_ACCOUNT_NOT_FOUND')
    const config: Record<string, unknown> = {
      serverName: server.serverName, transport: server.transport, expandTemplates: true,
      startupTimeoutMs: mcpStartupTimeoutMs, failOnStartupError: true,
    }
    if (server.transport === 'streamable-http') {
      config.url = server.url
      config.headers = account ? { [server.authField]: `${server.authField.toLowerCase() === 'authorization' ? 'Bearer ' : ''}\${credential:${account.ref}}` } : {}
    } else {
      config.command = server.command
      config.args = server.args
      config.env = account ? { [server.authField]: `\${credential:${account.ref}}` } : {}
    }
    plugins.push({ name: '@deepseek-ai/dsh-mcp-client', config })
  }
  return { id: presetId(definition.id), name: definition.name, description: definition.description, plugins }
}

/** Resolve the original project, independently of a tool changing the current working directory. */
export function projectForAgent(ctx: AgentContext, agent: AgentRef | undefined): Project {
  const root = agent ? ctx.subagents.rootOf(agent) : undefined
  const cwd = root?.session.header.cwd
  const project = ctx.workspaceRegistry.list().find(item => item.path === cwd)
  if (!project) throw new AgentError('Start this agent in an existing project', 'IPOLLO_PROJECT_REQUIRED')
  return project
}

/** Mount the existing suite’s native preset-backed agent catalog. */
export async function apply(ctx: AgentContext, config: Partial<{ maxAgents: number; maxMemoryChars: number; maxInputBytes: number; mcpStartupTimeoutMs: number; coordinatorWorkspace: string }> = {}): Promise<void> {
  const resolvedConfig = Config(config)
  if (!isAbsolute(resolvedConfig.coordinatorWorkspace)) throw new AgentError('The main assistant workspace must be an absolute path', 'IPOLLO_INVALID_INPUT')
  const domain = await ctx.storageDomain.open({
    name: 'ipollo_agents', version: 1,
    global: { schema: stateSchema, initial: initialState }, tables: {},
  })
  ctx.effect(() => () => domain.close(), 'ipollo: agent storage')
  const store = new AgentStore(domain.global, resolvedConfig)
  const mounts = new Map<string, () => Promise<void>>()
  let delegation: NativeFiber | undefined
  let tail: Promise<unknown> = Promise.resolve()
  let closing = false
  const lifetime = new AbortController()
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const operation = tail.then(() => {
      if (closing) throw new AgentError('The iPollo suite is disabled', 'IPOLLO_SUITE_DISABLED')
      return fn()
    })
    tail = operation.catch(error => { /* The request reports the failure; the queue admits independent requests. */ })
    return operation
  }
  const service = { store, coordinatorPreset: COORDINATOR_PRESET, projectFor: (agent: AgentRef | undefined) => projectForAgent(ctx, agent) }
  const baseDocument = await ctx.agentPresets.readDocument('standard')
  const base = valueSchema.array(valueSchema.object({ name: valueSchema.string(), id: valueSchema.string().optional() }).catchall(valueSchema.unknown())).parse(parseEntryYaml(baseDocument.content))
  const releaseCoordinator = await ctx.agentPresets.register({
    id: COORDINATOR_PRESET, name: '总助手 · Main assistant', description: 'Coordinates saved specialists and temporary task workers.',
    plugins: [...structuredClone(base).filter(row => row.id !== 'persona'), { name: fileURLToPath(new URL('./coordinator-runtime.js', import.meta.url)) }],
  })
  ctx.effect(() => releaseCoordinator, 'ipollo: main assistant preset')

  async function mountDefinition(definition: AgentDefinition): Promise<void> {
    const prior = mounts.get(definition.id)
    if (prior) { await prior(); mounts.delete(definition.id) }
    if (!definition.enabled) return
    const dispose = await ctx.agentPresets.register(composePreset(base, definition, store.snapshot().accounts, resolvedConfig.mcpStartupTimeoutMs))
    mounts.set(definition.id, dispose)
  }
  async function refreshDelegation(): Promise<void> {
    if (delegation) { await delegation.dispose(); delegation = undefined }
    const choices = store.snapshot().agents.filter(item => item.enabled).map(item => presetId(item.id))
    if (choices.length) delegation = ctx.plugin(SubagentTool, {
      provider: 'spawn', toolName: 'ipollo_delegate', agentPreset: choices[0]!, allowedAgentPresets: choices,
    })
  }
  ctx.effect(() => async () => {
    closing = true
    lifetime.abort()
    await tail
    if (delegation) await delegation.dispose()
    for (const dispose of mounts.values()) await dispose()
  }, 'ipollo: retained preset definitions')
  for (const definition of store.snapshot().agents) await mountDefinition(definition)
  await refreshDelegation()
  ctx.provide('ipolloAgents', service)

  ctx.tools.register(defineTool({
    name: 'ipollo_list_agents',
    description: 'List reusable iPollo agents and their specialties, including the preset IDs used to delegate a task.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { agents: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', required: true }, description: { type: 'string', required: true }, agentPreset: { type: 'string', required: true },
      } }, required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return { agents: store.snapshot().agents.filter(item => item.enabled).map(item => ({
        name: item.name, description: item.description, agentPreset: presetId(item.id),
      })) }
    },
    presentCall: () => ({ card: 'generic', title: 'List iPollo agents', kind: 'read' }),
  }))
  ctx.systemPrompt.section({
    name: 'ipollo:delegation', order: ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT'), interpolate: false,
    text: () => store.snapshot().agents.some(item => item.enabled)
      ? 'Reusable iPollo specialists are available. Discover their specialties with ipollo_list_agents, then use ipollo_delegate with the selected agent_preset. Children receive their own prompt, skills and MCP connections. Give each child a self-contained task. Use the standard agent messaging tools for follow-up, and collect required results before answering the user.' : '',
  })

  async function catalog() {
    const snapshot = store.snapshot()
    const accounts = await Promise.all(snapshot.accounts.map(async account => ({
      id: account.id, name: account.name, configured: (await ctx.credentials.describe(account.ref)).configured,
    })))
    const agents = await Promise.all(snapshot.agents.map(async definition => {
      const resolved = definition.enabled ? await ctx.agentPresets.resolve(presetId(definition.id)) : {}
      return { ...definition, skills: definition.skills.map(({ name, description }) => ({ name, description })), broken: resolved.broken }
    }))
    const services = ctx.mcpManager.list().filter(item => item.configured).map(({ name, status }) => ({ name, state: status.state, toolCount: status.toolCount ?? 0 }))
    return { agents, accounts, services, projects: ctx.workspaceRegistry.list().map(({ id, title, path }) => ({ id, title, path })) }
  }
  async function availableSkills(projectId: string): Promise<AgentSkill[]> {
    const project = ctx.workspaceRegistry.get(projectId)
    const scope = await ctx.agentPresets.acquireScope('standard')
    try {
      return await ctx.skills.list({ ...(project ? { cwd: project.path } : {}), scope: scope.key })
    } finally { await scope[Symbol.asyncDispose]() }
  }
  async function modelCatalog(): Promise<AgentModelCatalog> {
    const catalog = await ctx.sessionController.modelCatalog()
    return {
      default: catalog.default, unavailable: catalog.failures.length > 0,
      models: catalog.groups.flatMap(group => group.models.map(model => ({ provider: group.id, providerName: group.name, model: model.id, name: model.name }))),
    }
  }
  async function saveDefinition(input: AgentInput) {
    if (input.model) {
      const catalog = await modelCatalog()
      if (!catalog.models.some(model => model.provider === input.model!.provider && model.model === input.model!.model)) {
        throw new AgentError('Choose an available model or follow the default', 'IPOLLO_MODEL_UNAVAILABLE')
      }
    }
    const knownServices = new Set(ctx.mcpManager.list().filter(item => item.configured).map(item => item.name))
    const priorServices = store.snapshot().agents.find(item => item.id === input.id)?.serviceNames ?? []
    if (input.serviceNames?.some(name => !knownServices.has(name) && !priorServices.includes(name))) {
      throw new AgentError('Select an existing service', 'IPOLLO_SERVICE_NOT_FOUND')
    }
    const old = store.snapshot().agents.find(item => item.id === input.id)
    const selected = input.skillNames ?? []
    if (!Array.isArray(selected) || selected.some(item => typeof item !== 'string')) throw new AgentError('Invalid skills', 'IPOLLO_INVALID_INPUT')
    const skills: AgentSkill[] = []
    const project = ctx.workspaceRegistry.get(input.projectId ?? '')
    const scope = await ctx.agentPresets.acquireScope('standard')
    try {
      for (const name of [...new Set(selected)]) {
        const existing = old?.skills.find(item => item.name === name)
        const found = existing ?? await ctx.skills.get(name, { ...(project ? { cwd: project.path } : {}), scope: scope.key })
        if (!found) throw new AgentError(`Skill ${name} is unavailable`, 'IPOLLO_SKILL_NOT_FOUND')
        const { description, content, source, invocation, resourceBase, path } = found
        skills.push({ name, description, content, source, invocation, ...(resourceBase ? { resourceBase } : {}), ...(path ? { path } : {}) })
      }
    } finally { await scope[Symbol.asyncDispose]() }
    const saved = await store.saveAgent(input, skills)
    await mountDefinition(saved)
    await refreshDelegation()
    const resolved = saved.enabled ? await ctx.agentPresets.resolve(presetId(saved.id)) : {}
    return { id: saved.id, revision: saved.revision, broken: resolved.broken }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: API,
    handler: async (request, response) => {
      try {
        const admission = ctx.connection.admit(request)
        if ('rejection' in admission) { reply(response, admission.rejection, { error: 'IPOLLO_UNAUTHORIZED' }); return }
        const url = new URL(request.url ?? '/', 'http://localhost')
        const path = url.pathname.slice(API.length)
        if (!url.pathname.startsWith(`${API}/`)) { reply(response, 404, { error: 'IPOLLO_NOT_FOUND' }); return }
        if (request.method === 'GET') {
          if (path === '/catalog') reply(response, 200, await catalog())
          else if (path === '/models') reply(response, 200, await modelCatalog())
          else if (path === '/skills') reply(response, 200, { skills: await availableSkills(url.searchParams.get('projectId') ?? '') })
          else if (path === '/memory') {
            if (!ctx.workspaceRegistry.get(url.searchParams.get('projectId') ?? '')) throw new AgentError('Choose a project', 'IPOLLO_PROJECT_REQUIRED')
            reply(response, 200, store.readMemory(url.searchParams.get('projectId') ?? '', url.searchParams.get('agentId') ?? ''))
          } else reply(response, 404, { error: 'IPOLLO_NOT_FOUND' })
          return
        }
        if (request.method !== 'POST') { reply(response, 405, { error: 'IPOLLO_METHOD_NOT_ALLOWED' }); return }
        const rawInput = await readBody(request, resolvedConfig.maxInputBytes)
        if (path === '/coordinator') reply(response, 200, await exclusive(() => {
          const input = valueSchema.object({ fresh: valueSchema.boolean().default(false) }).parse(rawInput)
          return openCoordinator(ctx, resolvedConfig.coordinatorWorkspace, input.fresh, lifetime.signal)
        }))
        else if (path === '/agents') reply(response, 200, await exclusive(() => saveDefinition(agentInputSchema.parse(rawInput))))
        else if (path === '/accounts') reply(response, 200, await exclusive(async () => {
          const input = valueSchema.object({ name: valueSchema.string(), secret: valueSchema.string() }).parse(rawInput)
          if (typeof input.secret !== 'string' || !input.secret.trim()) throw new AgentError('Enter an account token', 'IPOLLO_INVALID_ACCOUNT')
          const account = await store.addAccount(input.name, ref => ctx.credentials.set(ref, input.secret))
          return { id: account.id, name: account.name, configured: true }
        }))
        else if (path === '/start') reply(response, 200, await exclusive(async () => {
          const input = valueSchema.object({ agentId: valueSchema.string(), projectId: valueSchema.string() }).parse(rawInput)
          const definition = store.snapshot().agents.find(item => item.id === input.agentId && item.enabled)
          if (!definition && input.agentId !== COORDINATOR_PRESET) throw new AgentError('Enable the agent before starting it', 'IPOLLO_AGENT_NOT_FOUND')
          if (!ctx.workspaceRegistry.get(input.projectId ?? '')) throw new AgentError('Choose a project', 'IPOLLO_PROJECT_REQUIRED')
          return ctx.sessionController.create({ workspaceId: input.projectId, agentPreset: definition ? presetId(definition.id) : COORDINATOR_PRESET })
        }))
        else if (path === '/memory') reply(response, 200, await exclusive(() => {
          const input = valueSchema.object({ agentId: valueSchema.string(), projectId: valueSchema.string(), text: valueSchema.string(), revision: valueSchema.number().int() }).parse(rawInput)
          if (!ctx.workspaceRegistry.get(input.projectId ?? '')) throw new AgentError('Choose a project', 'IPOLLO_PROJECT_REQUIRED')
          return store.saveMemory(input.projectId, input.agentId, input.text, input.revision)
        }))
        else reply(response, 404, { error: 'IPOLLO_NOT_FOUND' })
      } catch (error) {
        ctx.logger.warn('iPollo suite operation failed: %o', error)
        reply(response, error instanceof AgentError || error instanceof valueSchema.ZodError ? 400 : 500, {
          error: error instanceof AgentError ? error.code : error instanceof valueSchema.ZodError ? 'IPOLLO_INVALID_INPUT' : 'IPOLLO_OPERATION_FAILED',
        })
      }
    },
  }), 'ipollo: authenticated management API')
}
