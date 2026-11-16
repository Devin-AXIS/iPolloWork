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
 * @returns a serialized refresh; failures leave the previous registrations in place and reject.
 */
export function mountEnterpriseSkills(scope: EnterpriseSkillScope, account: AccountService): () => Promise<void> {
  let disposers: (() => void)[] = [], facts = '', serial = Promise.resolve()
  const release = () => { for (const dispose of disposers) dispose(); disposers = [] }
  scope.effect(() => release, 'ipollowork-suite: enterprise skills')
  return () => {
    serial = serial.catch(() => {}).then(async () => {
      const state = await account.state()
      const items = state.status === 'signed-in' ? granted.parse(await account.request('/api/v1/me/enterprise-skills')).items : []
      const next = JSON.stringify(items.map(item => [item.id, item.name, item.description, item.content]))
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
    })
    return serial
  }
}
