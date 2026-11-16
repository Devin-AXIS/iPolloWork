/** First-run preferences owned by iPolloWork and persisted through official DSH settings. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { OnboardingSettingsFields, type OnboardingSettings } from '../client/onboarding/settings.ts'

export const name = 'ipollowork-onboarding-settings'
export const inject = ['settings']
export interface Config {
  version: Volatile<1>
  step: Volatile<OnboardingSettings['step']>
  purpose: Volatile<OnboardingSettings['purpose']>
  process: Volatile<OnboardingSettings['process']>
  completion: Volatile<OnboardingSettings['completion']>
  usage: Volatile<OnboardingSettings['usage']>
  developerTools: Volatile<boolean>
}
export const Config = z.object(Object.fromEntries(
  Object.entries(OnboardingSettingsFields).map(([field, schema]) => [field, schema.volatile()]),
))

/** Register live first-run settings without mounting the official account client.
 * @param ctx - DSH settings owner for this profile entry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber))
}
