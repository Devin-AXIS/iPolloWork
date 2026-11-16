/** Native AI tools over the account service's capability discovery and execution APIs. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { defineTool, ToolArgsError, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { z } from 'zod'
import type { AccountService } from './account.ts'
import { SuiteError } from './errors.ts'

const identifier = z.string().min(1).max(200)
const kind = z.enum(['chat', 'image', 'video', 'speech', 'transcription', 'embedding', 'rerank'])
const listInput = z.object({ kind: kind.optional() }).strict()
const describeInput = z.object({ capability: identifier, model: identifier.optional(), offset: z.number().int().nonnegative().optional() }).strict()
const invokeInput = z.object({ capability: identifier, model: identifier.optional(), input: z.record(z.string(), z.unknown()) }).strict()
const taskInput = z.object({ requestId: z.uuid() }).strict()
const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ToolArgsError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`))
  return result.data
}

/** Stable per-session tool-call receipt: native retries cannot create a second billable request. */
function receiptId(session: string, call: string): string {
  const digest = createHash('sha256').update(session).update('\0').update(call).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}
/** Register account tools with the plugin lifetime; invocation requires a writable native Session.
 * @param ctx Scope owning the tool registry and sandbox policy.
 * @param account Host-owned account credentials and HTTP access.
 * @param timeoutMs Configured deadline for a provider invocation.
 */
export function mountCapabilityTools(ctx: Context, account: AccountService, timeoutMs: number): void {
  const call = async (path: string, body: unknown, signal: AbortSignal) => z.json().parse(await account.capability(path, body, signal))
  const register = (tool: ToolDefinition) => ctx.effect(() => ctx.tools.register(tool), `ipollo: ${tool.name}`)
  register(defineTool({
    name: 'ipollo_capabilities',
    description: 'List account-authorized AI capabilities, including image generation, video, speech, transcription, embeddings and reranking. Returns capability IDs; use ipollo_capability_describe to read inputs and models.',
    isConcurrencySafe: () => true,
    parameters: { kind: { type: 'string', enum: kind.options } }, output,
    async execute(raw, exec) {
      const value = parse(listInput, raw)
      return call('/api/v1/capabilities' + (value.kind ? `?kind=${value.kind}` : ''), undefined, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'List AI capabilities', kind: 'read' }),
  }))
  register(defineTool({
    name: 'ipollo_capability_describe',
    description: 'Read one capability’s input JSON schema, authorized models, limits and next model-page offset before invoking it.',
    isConcurrencySafe: () => true,
    parameters: { capability: { type: 'string', required: true }, model: { type: 'string' }, offset: { type: 'integer', description: 'Nonnegative model-page offset returned by the previous result.' } }, output,
    async execute(raw, exec) {
      const value = parse(describeInput, raw)
      const query = new URLSearchParams()
      if (value.model) query.set('model', value.model)
      if (value.offset !== undefined) query.set('offset', String(value.offset))
      return call(`/api/v1/capabilities/${encodeURIComponent(value.capability)}${query.size ? '?' + query.toString() : ''}`, undefined, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Read capability inputs', kind: 'read' }),
  }))
  register(defineTool({
    name: 'ipollo_capability_invoke',
    description: 'Run an AI capability using inputs from ipollo_capability_describe. Charges actual account usage. Returns a requestId and a result or pending task; query pending or uncertain requests with ipollo_capability_task instead of submitting another call.',
    isConcurrencySafe: () => true,
    parameters: { capability: { type: 'string', required: true }, model: { type: 'string' }, input: { type: 'object', additionalProperties: true, required: true } }, output,
    timeoutMs,
    async execute(raw, exec) {
      const value = parse(invokeInput, raw)
      const session = exec.agent?.session
      if (!session) throw new SuiteError('IPW_CAPABILITY_SESSION_REQUIRED', 400)
      if (ctx.sandboxPolicy.resolve({ session }).mode === 'read-only') throw new SuiteError('IPW_CAPABILITY_READ_ONLY', 403)
      const requestId = receiptId(session.id, exec.callId)
      try {
        return await call(`/api/v1/capabilities/${encodeURIComponent(value.capability)}/invoke`, { requestId, model: value.model, input: value.input }, exec.signal)
      } catch (cause) {
        if (exec.signal.aborted) throw exec.signal.reason
        throw new HarnessError(`Capability request ${requestId} failed. Query ipollo_capability_task with this requestId before retrying.`, cause instanceof SuiteError ? cause.code : 'IPW_CAPABILITY_FAILED', { cause })
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Run AI capability', kind: 'execute' }),
  }))
  register(defineTool({
    name: 'ipollo_capability_task',
    description: 'Read the result or current status of a capability request by requestId. Checks pending provider tasks without submitting another generation request.',
    isConcurrencySafe: () => true,
    parameters: { requestId: { type: 'string', required: true } }, output,
    async execute(raw, exec) {
      const value = parse(taskInput, raw)
      return call(`/api/v1/capability-tasks/${value.requestId}`, undefined, exec.signal)
    },
    presentCall: () => ({ card: 'generic', title: 'Read AI task result', kind: 'read' }),
  }))
}
