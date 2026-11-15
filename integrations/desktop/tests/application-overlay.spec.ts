import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { writeApplicationOverlay } from '../../desktop-host/src/application-overlay.ts'

it('passes the installed application file to the official launcher without rewriting profile settings', () => {
  const profile = mkdtempSync(join(tmpdir(), 'ipollo-application-'))
  try {
    const runtime = join(profile, 'runtime with spaces')
    const overlay = writeApplicationOverlay(runtime, profile)
    expect(JSON.parse(readFileSync(overlay, 'utf8'))).toEqual([
      { id: 'ipollowork-application', config: { path: pathToFileURL(join(runtime, 'node_modules/@ipollo/desktop-host/application.yml')).href } },
    ])
  } finally { rmSync(profile, { recursive: true, force: true }) }
})
