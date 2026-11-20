/** Generate the Desktop-owned entry list from the public suite's composition. */
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load, dump } from 'js-yaml'
import { root } from './upstream.mjs'

const patches = load(await readFile(join(root, 'plugins/ipollowork-suite/cordis.patch.yml'), 'utf8'))
const stage = load(await readFile(join(root, 'plugins/stage/cordis.patch.yml'), 'utf8'))
const entries = [...patches, ...stage].flatMap(patch => patch.insert ?? [])
if (!entries.some(entry => entry.id === 'ipollowork-suite')) throw new Error('Desktop composition requires the suite entry')
const application = entries.map(entry => {
  if (entry.id === 'ipollowork-suite') return { ...entry, config: { ...entry.config, dedicatedDesktop: true } }
  // The generated document lives beside the suite in the packaged @ipollo scope.
  if (entry.name?.startsWith('./lib/subplugins/')) return { ...entry, name: '../dsh-suite/' + entry.name.slice(2) }
  return entry
})
await writeFile(join(root, 'integrations/desktop-host/application.yml'), dump(application, { lineWidth: -1, noRefs: true }))
await mkdir(join(root, 'integrations/desktop-host/assets'), { recursive: true })
await copyFile(join(root, 'plugins/ipollowork-suite/assets/mark.svg'), join(root, 'integrations/desktop-host/assets/mark.svg'))
