import { z } from 'zod'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { BusinessRuntime } from './contracts.ts'

const accounts = z.object({
  accounts: z.array(z.object({ methodId: z.string(), accountId: z.string(), values: z.record(z.string(), z.string()) })).max(200),
  active: z.record(z.string(), z.string()),
})
type Accounts = z.infer<typeof accounts>
/** One plugin-owned native credential record. Values never cross the client or model boundary. */
export function bundleAuthorization(provider: Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>, id: string): BusinessRuntime['authorization'] {
  const key = credentialKey('ipollo-' + id, 'accounts')
  const parse = (record: Awaited<ReturnType<CredentialProvider['readRecord']>>): Accounts => {
    if (!record) return { accounts: [], active: {} }
    if (record.kind !== 'grant') throw new Error('Invalid plugin credential record')
    return accounts.parse(record.payload)
  }
  const load = async () => parse(await provider.readRecord(key))
  const mutate = async (change: (state: Accounts) => void) => {
    await provider.modifyRecord(key, async current => { const state = parse(current); change(state); return { kind: 'grant', payload: state } })
  }
  const read = async (method: string, account?: string) => {
    const state = await load()
    return state.accounts.find(item => item.methodId === method && item.accountId === (account ?? state.active[method] ?? state.accounts.find(item => item.methodId === method)?.accountId))?.values ?? null
  }
  return {
    getCredential: read, readCredential: (account, method) => read(method, account),
    listConnections: async () => { const state = await load(); return state.accounts.map(({ methodId, accountId }) => ({ methodId, accountId, status: 'connected', active: state.active[methodId] === accountId })) },
    async saveCredential(methodId, accountId, values) {
      z.string().min(1).max(200).parse(accountId)
      z.record(z.string().max(100), z.string().max(16_384)).parse(values)
      await mutate(state => { state.accounts = state.accounts.filter(item => item.methodId !== methodId || item.accountId !== accountId); state.accounts.push({ methodId, accountId, values }); state.active[methodId] ??= accountId })
    },
    async revokeAccount(accountId) {
      let changed = false
      await mutate(state => { changed = state.accounts.some(item => item.accountId === accountId); state.accounts = state.accounts.filter(item => item.accountId !== accountId); for (const [method, active] of Object.entries(state.active)) if (active === accountId) delete state.active[method] })
      return changed
    },
    async setActiveAccount(method, accountId) {
      let changed = false
      await mutate(state => { if (state.accounts.some(item => item.methodId === method && item.accountId === accountId)) { state.active[method] = accountId; changed = true } })
      return changed
    },
  }
}
