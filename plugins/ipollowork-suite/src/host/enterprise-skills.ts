/** Enterprise skills granted to the signed-in member are registered in the native skill registry. */
import { z } from 'zod'
import type { AccountService } from './account.ts'

/** The native registry surface this module uses; registration returns its disposer. */
export interface EnterpriseSkillScope {
  skills: { register(skill: { name: string; description: string; content: string; source: 'runtime' }): () => void }
  effect(setup: () => void | (() => void), label?: string): unknown
}
const granted = z.object({
  items: z.array(z.object({
    id: z.string(), name: z.string().regex(/^[a-z][a-z0-9-]*[a-z0-9]$/).max(64), title: z.string().max(200),
    description: z.string().max(2000), enterpriseName: z.string().max(200), content: z.string().max(200_000),
  })).max(100),
})

/**
 * Mount the registration and return its refresh. Each refresh replaces the registered set with the account's current grants;
 * signing out or losing a grant removes the skill. Same-name skills from different enterprises receive numeric suffixes.
 * @param scope - the Cordis scope that owns the registrations.
 * @param account - the suite account used to read grants.
 * @returns a coalesced refresh for the current account and its active grants.
 */
export function mountEnterpriseSkills(scope: EnterpriseSkillScope, account: AccountService): () => Promise<void> {
  const lifetime = new AbortController()
  let disposers: (() => void)[] = [], facts = '', generation = -1
  let pending: Promise<void> | undefined
  const release = () => { for (const dispose of disposers) dispose(); disposers = []; facts = '' }
  const refresh = (): Promise<void> => {
    const current = account.generation
    if (generation !== current) { release(); generation = current }
    if (pending) return pending
    const load = async () => {
      try {
        const state = await account.state()
        const items = state.status === 'signed-in'
          ? granted.parse(await account.request('/api/v1/me/enterprise-skills', undefined, 'GET', lifetime.signal)).items : []
        if (lifetime.signal.aborted || account.generation !== current) return
        const next = JSON.stringify(items.map(item => [item.id, item.name, item.title, item.enterpriseName, item.description, item.content]))
        if (next === facts) return
        release()
        const used = new Set<string>()
        for (const item of items) {
          let name = item.name
          for (let suffix = 2; used.has(name); suffix++) name = `${item.name}-${suffix}`
          used.add(name)
          disposers.push(scope.skills.register({ name, description: `${item.enterpriseName} · ${item.title}: ${item.description}`, content: item.content, source: 'runtime' }))
        }
        facts = next
      } catch (error) {
        if (account.generation === current) release()
        throw error
      }
    }
    pending = load().finally(() => {
      pending = undefined
      if (!lifetime.signal.aborted && account.generation !== current) void refresh().catch(() => {})
    })
    return pending
  }
  scope.effect(() => {
    const timer = setInterval(() => void refresh().catch(() => {}), 60_000)
    timer.unref()
    return () => { clearInterval(timer); lifetime.abort(); release() }
  }, 'ipollowork-suite: enterprise skills')
  return refresh
}
