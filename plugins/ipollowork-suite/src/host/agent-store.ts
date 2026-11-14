/** iPollo agent definitions and project memory, stored by the native domain service. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { validAvatar } from './agent-avatar.ts'
import { AVATAR_MAX_DATA_URL_LENGTH } from '../shared/avatar.ts'

/** Expected validation, revision and lifecycle failures exposed by the suite. */
export class AgentError extends HarnessError {}

const text = z.string().trim().min(1)
const skill = z.object({
  name: text, description: z.string(), content: z.string(), source: z.string(),
  invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }),
  resourceBase: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('directory'), path: text }),
    z.object({ kind: z.literal('url'), url: text }),
    z.object({ kind: z.literal('opaque'), description: text }),
  ]).optional(), path: z.string().optional(),
})
const mcp = z.object({
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  transport: z.enum(['streamable-http', 'stdio']),
  url: z.string().default(''), command: z.string().default(''), args: z.array(z.string()).default([]),
  accountId: z.string().default(''), authField: z.string().default('Authorization'),
}).superRefine((value, ctx) => {
  if (value.transport === 'streamable-http') {
    try {
      const url = new URL(value.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('url')
    } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Use an HTTP(S) MCP URL without embedded credentials' })
    }
  } else if (!value.command.trim()) ctx.addIssue({ code: 'custom', path: ['command'], message: 'Command is required' })
  if (value.accountId && !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value.authField)) {
    ctx.addIssue({ code: 'custom', path: ['authField'], message: 'Invalid credential destination' })
  }
})
const definition = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), name: text.max(100),
  description: z.string().max(1000), prompt: z.string().max(32000),
  skills: z.array(skill).max(100), mcp: z.array(mcp).max(30),
  serviceNames: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).max(100).optional(),
  avatar: z.string().max(AVATAR_MAX_DATA_URL_LENGTH).refine(validAvatar, 'Use a square PNG, JPEG or WebP avatar up to 256 pixels').optional(),
  model: z.object({ provider: text.max(200), model: text.max(200) }).nullable().optional(),
  enabled: z.boolean(), updatedAt: z.string(),
}).refine(value => new Set(value.mcp.map(server => server.serverName)).size === value.mcp.length, 'Duplicate MCP server name')
const account = z.object({ id: z.string().uuid(), name: text.max(100), ref: text })
const memory = z.object({ projectId: text, agentId: z.string().uuid(), revision: z.number().int().nonnegative(), text: z.string() })

/** Version-one suite data contains references to secrets, never secret values. */
export const stateSchema = z.object({
  agents: z.array(definition), accounts: z.array(account), memories: z.array(memory),
})

export type AgentSkill = z.infer<typeof skill>
export type AgentDefinition = z.infer<typeof definition>
export type AgentAccount = z.infer<typeof account>
export type AgentMemory = z.infer<typeof memory>
export type AgentState = z.infer<typeof stateSchema>
export interface AgentGlobal { get(): AgentState; set(value: AgentState): Promise<void> }
export const agentInputSchema = z.object(definition.shape).omit({ id: true, revision: true, updatedAt: true, skills: true }).extend({
  id: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
  description: z.string().max(1000).default(''), prompt: z.string().max(32000).default(''),
  enabled: z.boolean().default(true), mcp: z.array(mcp).default([]),
  projectId: z.string().optional(), skillNames: z.array(z.string()).max(100).default([]),
})
export type AgentInput = z.input<typeof agentInputSchema>

/** Domain defaults; deleting a definition is deliberately not part of this API. */
export const initialState: AgentState = { agents: [], accounts: [], memories: [] }
/** Stable native preset identity; revisions are managed by DSH's retained preset scopes. */
export function presetId(id: string): string { return `ipollo-agent-${id}` }

/** Serialize mutations and publish only values confirmed by native durable storage. */
export class AgentStore {
  private readonly global: AgentGlobal
  private readonly limits: { maxAgents: number; maxMemoryChars: number }
  private tail: Promise<unknown>
  constructor(global: AgentGlobal, limits: Partial<{ maxAgents: number; maxMemoryChars: number }> = {}) {
    this.global = global
    this.limits = { maxAgents: 100, maxMemoryChars: 12000, ...limits }
    this.tail = Promise.resolve()
    stateSchema.parse(global.get())
  }
  snapshot(): AgentState { return structuredClone(this.global.get()) }
  mutate<T>(fn: (state: AgentState) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = this.snapshot()
      const result = fn(next)
      stateSchema.parse(next)
      await this.global.set(next)
      return result
    })
    this.tail = operation.catch(error => { /* The caller receives the failure; later independent writes remain admissible. */ })
    return operation
  }
  async saveAgent(input: Partial<AgentInput> & { name: string }, skills: AgentSkill[]): Promise<AgentDefinition> {
    return this.mutate(state => {
      const previous = input.id ? state.agents.find(item => item.id === input.id) : undefined
      if (input.id && !previous) throw new AgentError('Agent no longer exists', 'IPOLLO_AGENT_NOT_FOUND')
      if (previous && previous.revision !== input.revision) throw new AgentError('Reload before saving a newer revision', 'IPOLLO_STALE_REVISION')
      if (!previous && state.agents.length >= this.limits.maxAgents) throw new AgentError('Agent limit reached', 'IPOLLO_AGENT_LIMIT')
      const avatar = input.avatar ?? previous?.avatar
      const model = input.model === undefined ? previous?.model : input.model
      const parsed = definition.safeParse({
        id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1,
        name: input.name, description: input.description ?? '', prompt: input.prompt ?? '',
        enabled: input.enabled !== false, skills, mcp: input.mcp ?? [], updatedAt: new Date().toISOString(),
        ...(input.serviceNames === undefined ? {} : { serviceNames: [...new Set(input.serviceNames)] }),
        ...(avatar === undefined ? {} : { avatar }),
        ...(model === undefined ? {} : { model }),
      })
      if (!parsed.success) throw new AgentError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 'IPOLLO_INVALID_AGENT')
      for (const server of parsed.data.mcp) {
        if (server.accountId && !state.accounts.some(item => item.id === server.accountId)) {
          throw new AgentError('Select an existing account connection', 'IPOLLO_ACCOUNT_NOT_FOUND')
        }
      }
      if (previous) state.agents[state.agents.indexOf(previous)] = parsed.data
      else state.agents.push(parsed.data)
      return parsed.data
    })
  }
  async addAccount(name: string, writeSecret: (ref: string) => Promise<unknown>): Promise<AgentAccount> {
    const id = randomUUID()
    const value = account.safeParse({ id, name, ref: `IPOLLO_ACCOUNT_${id.replaceAll('-', '_')}` })
    if (!value.success) throw new AgentError('Account name is required', 'IPOLLO_INVALID_ACCOUNT')
    await writeSecret(value.data.ref)
    return this.mutate(state => { state.accounts.push(value.data); return value.data })
  }
  readMemory(projectId: string, agentId: string): AgentMemory {
    return this.snapshot().memories.find(item => item.projectId === projectId && item.agentId === agentId)
      ?? { projectId, agentId, revision: 0, text: '' }
  }
  saveMemory(projectId: string, agentId: string, value: string, revision: number): Promise<AgentMemory> {
    return this.mutate(state => {
      if (!state.agents.some(item => item.id === agentId)) throw new AgentError('Unknown agent', 'IPOLLO_AGENT_NOT_FOUND')
      if (typeof value !== 'string' || value.length > this.limits.maxMemoryChars) throw new AgentError('Memory exceeds the configured limit', 'IPOLLO_INVALID_MEMORY')
      const index = state.memories.findIndex(item => item.projectId === projectId && item.agentId === agentId)
      const old = index < 0 ? 0 : state.memories[index]!.revision
      if (revision !== old) throw new AgentError('Read the latest memory before saving', 'IPOLLO_STALE_REVISION')
      const next = { projectId, agentId, text: value, revision: old + 1 }
      if (index < 0) state.memories.push(next)
      else state.memories[index] = next
      return next
    })
  }
}
