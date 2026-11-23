/** Resolve the installation-owned application entries for the official profile launcher. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Keep the installation's Suite enabled after the profile's editable layers.
 * @param runtimeDir Physical installed runtime directory.
 * @param profileDir Profile owned by this Desktop application.
 * @returns Overlay path accepted by the official DSH launcher.
 */
export function writeApplicationOverlay(_runtimeDir: string, profileDir: string): string {
  const path = join(profileDir, 'ipollowork-application.overlay.json')
  writeFileSync(path, JSON.stringify([
    // Product entries share the native profile tree, retaining their stable patch ids.
    { id: 'ipollowork-suite', disabled: false },
  ]) + '\n', { mode: 0o600 })
  return path
}
