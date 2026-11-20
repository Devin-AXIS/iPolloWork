/** Resolve the installation-owned application entries for the official profile launcher. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Write the native Include configuration after the profile's editable layers.
 * @param runtimeDir Physical installed runtime directory.
 * @param profileDir Profile owned by this Desktop application.
 * @returns Overlay path accepted by the official DSH launcher.
 */
export function writeApplicationOverlay(runtimeDir: string, profileDir: string): string {
  const path = join(profileDir, 'ipollowork-application.overlay.json')
  writeFileSync(path, JSON.stringify([
    { id: 'ipollowork-application', name: '@deepseek-ai/cordis-plugin-include', group: true, disabled: false,
      config: {
        path: pathToFileURL(join(runtimeDir, 'node_modules', '@ipollo', 'desktop-host', 'application.yml')).href,
        patches: [{ id: 'ipollowork-suite', disabled: false }],
      } },
  ]) + '\n', { mode: 0o600 })
  return path
}
