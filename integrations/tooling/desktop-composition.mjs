/** Generate the Desktop-owned entry list from the public suite's composition. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { root } from './upstream.mjs'
import { resolveDesktopAccountOrigin } from './account-service.mjs'
import { pathToFileURL } from 'node:url'

export function desktopApplicationEntries(patches, accountOrigin, extraEntries = []) {
  const entries = patches.flatMap(patch => patch.insert ?? [])
  if (!entries.some(entry => entry.id === 'ipollowork-suite')) throw new Error('Desktop composition requires the suite entry')
  const ids = new Set([...entries.map(entry => entry.id), 'ui-settings-account', 'ui-account-notifications', 'ipollowork-desktop-management'])
  for (const entry of extraEntries) {
    if (ids.has(entry.id)) throw new Error(`Desktop composition: duplicate entry ID ${entry.id}`)
    ids.add(entry.id)
  }
  return [...entries.map(entry => {
    if (entry.id === 'ipollowork-suite') return { ...entry, config: { ...entry.config, accountOrigin, dedicatedDesktop: true } }
    if (entry.name?.startsWith('./lib/subplugins/')) return { ...entry, name: '../dsh-suite/' + entry.name.slice(2) }
    return entry
  }), ...extraEntries]
}

/** Editable product entries belong to the native profile tree, preserving Settings ownership. */
export function desktopApplicationPatches(entries) {
  // A native Include boundary makes the application Bundle management-required.
  // Its empty tree keeps product preferences in the editable profile root.
  const management = { id: 'ipollowork-desktop-management', name: '@deepseek-ai/cordis-plugin-include', config: { path: './ipollowork-desktop-management.yml', initial: [] } }
  return [{ id: 'ui-settings-account', disabled: true }, { id: 'ui-account-notifications', disabled: true }, { insert: [management, ...entries] }]
}

export async function writeDesktopComposition(outputDir, accountOrigin, extraEntries = []) {
  const { load, dump } = createRequire(new URL('../../.upstream/dsh/package.json', import.meta.url))('js-yaml')
  const patches = load(await readFile(join(root, 'plugins/ipollowork-suite/cordis.patch.yml'), 'utf8'))
  const entries = desktopApplicationEntries(patches, accountOrigin, extraEntries)
  await writeFile(join(outputDir, 'application.yml'), dump(entries, { lineWidth: -1, noRefs: true }))
  await writeFile(join(outputDir, 'cordis.patch.yml'), dump(desktopApplicationPatches(entries), { lineWidth: -1, noRefs: true }))
  await mkdir(join(outputDir, 'assets'), { recursive: true })
  await copyFile(join(root, 'plugins/ipollowork-suite/assets/mark.svg'), join(outputDir, 'assets/mark.svg'))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await writeDesktopComposition(join(root, 'integrations/desktop-host'), resolveDesktopAccountOrigin())
}
