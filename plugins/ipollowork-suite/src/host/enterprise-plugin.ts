import semver from 'semver'
import { z } from 'zod'
import { SuiteError } from './errors.ts'

const npmName = z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/)
const version = z.string().max(64).refine(value => !value.includes('+') && semver.valid(value) === value)
const reference = z.object({ format: z.literal(1), name: npmName, version }).strict()

export function pinnedPlugin(spec: string) {
  const at = spec.lastIndexOf('@')
  if (at <= 0) throw new SuiteError('IPW_DSH_PINNED_PLUGIN_REQUIRED', 400)
  const result = reference.safeParse({ format: 1, name: spec.slice(0, at), version: spec.slice(at + 1) })
  if (!result.success) throw new SuiteError('IPW_DSH_PINNED_PLUGIN_REQUIRED', 400)
  return result.data
}
