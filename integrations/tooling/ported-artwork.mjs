/** Replace the former shared Work mark with existing feature-specific icon artwork. */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { portedIcons } from '../../plugins/ipollowork-suite/src/ported/icons.ts'
const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(join(root, 'plugins/ipollowork-suite/package.json'))
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const colors = {
  'acme-research': ['#e6f4ef', '#247556'], 'deepseek-harness': ['#e9edfa', '#425bc0'],
  'ipollo-onto': ['#e5f3f8', '#217b94'], 'jev-decision-model': ['#eeebfa', '#7050ad'],
  'media-studio': ['#e5f1ff', '#356cb5'], 'reference-context': ['#fff1df', '#99612d'],
  'short-video-studio': ['#fcebf2', '#b34270'], 'workspace-canvas': ['#e4f5f2', '#247b6b'],
  'data-annotation': ['#edf4df', '#5d772c'], 'operation-recorder': ['#fff0e7', '#af5d30'],
  'markdown-editor': ['#e2efff', '#3c629e'], 'excel-editor': ['#e4f4e9', '#277554'],
  'conversation-export': ['#efeafa', '#7259a7'], 'task-templates': ['#e8effa', '#3a598d'],
  'reference-preparation': ['#fff1df', '#99612d'], 'legacy-workspace-import': ['#f9edeb', '#a34d46'],
}
export function featureArtwork(id) {
  const Icon = portedIcons[id]
  if (!Icon) return undefined
  const [background, foreground] = colors[id] ?? ['#edf0f5', '#4c607b']
  const glyph = renderToStaticMarkup(createElement(Icon, { size: 26, color: foreground, strokeWidth: 1.7 }))
    .replace('<svg ', '<svg x="11" y="11" ').replace(/\sclass="[^"]*"/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${background}"/>${glyph}</svg>\n`
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const inventory = JSON.parse(await readFile(join(root, 'integrations/runtime/ported-plugins.json'), 'utf8'))
for (const item of inventory.plugins) {
  if (['design-agent', 'video-agent'].includes(item.id)) continue
  const id = item.id === 'labelu-data-annotation' ? 'data-annotation' : item.id
  const file = join(root, 'plugins', id, 'icon.svg')
  const current = await readFile(file, 'utf8')
  if (!current.includes('281 298')) continue // Keep already distinct brand artwork.
  const svg = featureArtwork(id)
  if (!svg) throw Error('Missing feature artwork for ' + id)
  await writeFile(file, svg)
  console.log('Feature artwork: ' + id)
}
}
