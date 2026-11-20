import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { writeApplicationOverlay } from '../../desktop-host/src/application-overlay.ts'

it('passes the installed application file to the official launcher without rewriting profile settings', () => {
  const profile = mkdtempSync(join(tmpdir(), 'ipollo-application-'))
  try {
    const runtime = join(profile, 'runtime with spaces')
    const overlay = writeApplicationOverlay(runtime, profile)
    expect(JSON.parse(readFileSync(overlay, 'utf8'))).toEqual([
      { id: 'ipollowork-application', name: '@deepseek-ai/cordis-plugin-include', group: true, disabled: false,
        config: {
          path: pathToFileURL(join(runtime, 'node_modules/@ipollo/desktop-host/application.yml')).href,
          patches: [{ id: 'ipollowork-suite', disabled: false }],
        } },
    ])
  } finally { rmSync(profile, { recursive: true, force: true }) }
})

it('restores the owned include and account destination after legacy profile overrides', () => {
  const profile = mkdtempSync(join(tmpdir(), 'ipollo-legacy-application-'))
  try {
    const overlay = JSON.parse(readFileSync(writeApplicationOverlay(join(profile, 'runtime'), profile), 'utf8'))
    const root = applyEntryPatches([
      { id: 'ipollowork-application', name: '@deepseek-ai/cordis-plugin-include', disabled: true, config: { path: 'obsolete.yml' } },
      { id: 'unrelated-plugin', name: 'custom-plugin', config: { enabled: false } },
    ], overlay)
    expect(root[0]).toMatchObject({ name: '@deepseek-ai/cordis-plugin-include', disabled: false })
    expect(root[1]).toEqual({ id: 'unrelated-plugin', name: 'custom-plugin', config: { enabled: false } })
    const entries = applyEntryPatches([
      { id: 'ipollowork-suite', name: '@ipollo/dsh-suite', disabled: true,
        config: { dedicatedDesktop: false, theme: false, account: false, accountOrigin: 'http://localhost:3400', market: false } },
    ], overlay[0].config.patches)
    expect(entries[0]).toMatchObject({ disabled: false, config: {
      dedicatedDesktop: false, theme: false, account: false, accountOrigin: 'http://localhost:3400', market: false,
    } })
  } finally { rmSync(profile, { recursive: true, force: true }) }
})
