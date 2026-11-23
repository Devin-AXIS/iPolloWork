/** Generate the Desktop-owned entry list from the public suite's composition. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { root } from './upstream.mjs'
import { resolveDesktopAccountOrigin } from './account-service.mjs'
import { pathToFileURL } from 'node:url'

export function desktopApplicationEntries(patches, accountOrigin) {
  const entries = patches.flatMap(patch => patch.insert ?? [])
  if (!entries.some(entry => entry.id === 'ipollowork-suite')) throw new Error('Desktop composition requires the suite entry')
  return entries.map(entry => {
    if (entry.id === 'ipollowork-suite') return { ...entry, config: { ...entry.config, accountOrigin, dedicatedDesktop: true } }
    if (entry.name?.startsWith('./lib/subplugins/')) return { ...entry, name: '../dsh-suite/' + entry.name.slice(2) }
    return entry
  })
}

/** Editable product entries belong to the native profile tree, preserving Settings ownership. */
export function desktopApplicationPatches(entries) {
  // A native Include boundary makes the application Bundle management-required.
  // Its empty tree keeps product preferences in the editable profile root.
  const management = { id: 'ipollowork-desktop-management', name: '@deepseek-ai/cordis-plugin-include', config: { path: './ipollowork-desktop-management.yml', initial: [] } }
  return [{ id: 'ui-settings-account', disabled: true }, { id: 'ui-account-notifications', disabled: true }, { insert: [management, ...entries] }]
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { load, dump } = createRequire(new URL('../../.upstream/dsh/package.json', import.meta.url))('js-yaml')
  const patches = load(await readFile(join(root, 'plugins/ipollowork-suite/cordis.patch.yml'), 'utf8'))
  const entries = desktopApplicationEntries(patches, resolveDesktopAccountOrigin())
  await writeFile(join(root, 'integrations/desktop-host/application.yml'), dump(entries, { lineWidth: -1, noRefs: true }))
  await writeFile(join(root, 'integrations/desktop-host/cordis.patch.yml'), dump(desktopApplicationPatches(entries), { lineWidth: -1, noRefs: true }))
  await mkdir(join(root, 'integrations/desktop-host/assets'), { recursive: true })
  await copyFile(join(root, 'plugins/ipollowork-suite/assets/mark.svg'), join(root, 'integrations/desktop-host/assets/mark.svg'))
}
