import { z } from 'zod'
import type { RelationGraph } from './contracts'

// A query, never a second copy of business data or a persisted inferred relationship.
export const explorationInput = z
  .object({
    recordIds: z.array(z.uuid()).min(1).max(10),
    depth: z.number().int().min(1).max(3).default(1),
    direction: z.enum(['both', 'outgoing', 'incoming']).default('both'),
    relationIds: z.array(z.uuid()).max(64).optional(),
    tableIds: z.array(z.uuid()).max(64).optional(),
    nodeLimit: z.number().int().min(10).max(200).default(100),
    edgeLimit: z.number().int().min(10).max(400).default(200),
  })
  .strict()
export type ExplorationQuery = z.infer<typeof explorationInput>
export interface GraphExploration extends RelationGraph {
  query: ExplorationQuery
  observedAt: string
  evidence: 'stored-relations'
  reachedDepth: number
  navigation: { href: string; requiresView: 'relations' }
}

export function explorationHref(projectId: string, tableId: string, query: ExplorationQuery) {
  return (
    '/#' +
    new URLSearchParams({
      project: projectId,
      table: tableId,
      view: 'relations',
      explore: JSON.stringify(explorationInput.parse(query)),
    }).toString()
  )
}

export function explorationFromHash(hash: string): ExplorationQuery | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const raw = params.get('explore')
  if (params.get('view') !== 'relations' || !raw || raw.length > 10000) return
  try {
    const result = explorationInput.safeParse(JSON.parse(raw))
    return result.success ? result.data : undefined
  } catch {
    return
  }
}
