import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { validateOptions } from '@deepseek-ai/cordis-plugin-loader'
import { writeApplicationOverlay } from '../../desktop-host/src/application-overlay.ts'

it('ships valid profile-owned entries so native settings can address onboarding and notification preferences', () => {
  const { load } = createRequire(import.meta.url)('js-yaml')
  const patches = load(readFileSync(new URL('../../desktop-host/cordis.patch.yml', import.meta.url), 'utf8'))
  const { data: entries } = applyEntryPatches([], patches)
  expect(entries.some(entry => entry.id === 'ipollowork-onboarding')).toBe(true)
  expect(entries.filter(entry => entry.id === 'ipollowork-suite')).toHaveLength(1)
  expect(entries.some(entry => entry.id === 'ipollo-notification-center')).toBe(true)
  for (const entry of entries) expect(validateOptions(entry, ':', true)).toEqual([])
  expect(entries.some(entry => entry.name === '@deepseek-ai/cordis-plugin-include')).toBe(false)
})

it('keeps the Suite enabled while preserving saved account, onboarding and unrelated preferences', () => {
  const profile = mkdtempSync(join(tmpdir(), 'ipollo-application-'))
  try {
    const overlay = JSON.parse(readFileSync(writeApplicationOverlay(join(profile, 'runtime with spaces'), profile), 'utf8'))
    const previous = [
      { id: 'ipollowork-suite', name: '@ipollo/dsh-suite', disabled: true, config: { market: false } },
      { id: 'ipollowork-onboarding', name: '@ipollo/dsh-suite/onboarding', config: { purpose: 'both', tutorialStep: 3 } },
      { id: 'unrelated-plugin', name: 'custom-plugin', config: { enabled: false } },
    ]
    const { data: entries } = applyEntryPatches(previous, overlay)
    expect(entries[0]).toEqual({ ...previous[0], disabled: false })
    expect(entries.slice(1)).toEqual(previous.slice(1))
  } finally { rmSync(profile, { recursive: true, force: true }) }
})
