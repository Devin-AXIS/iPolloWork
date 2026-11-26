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

// Product-authored plugins use their existing glyphs. Connectors with published
// brand artwork keep the package image supplied by their manifest.
const badgeColors = {
  'acme-research': ['#138368', '#116049'],
  'conversation-export': ['#7651c9', '#5633a1'],
  'data-annotation': ['#68862c', '#49621a'],
  'decision-intelligence': ['#4174d8', '#2a51af'],
  'deepseek-harness': ['#6366de', '#4144b8'],
  'deepseek-idesign': ['#9553da', '#6730ae'],
  'deepseek-ivideo': ['#e35768', '#b82c50'],
  'douyin-ops': ['#c24573', '#9e2f58'],
  'excel-editor': ['#258c53', '#17673b'],
  'ipollo-onto': ['#0d83a4', '#09627b'],
  'jev-decision-model': ['#9754ce', '#7035ad'],
  'legacy-workspace-import': ['#b76939', '#8b4726'],
  'markdown-editor': ['#3577ce', '#2458a6'],
  'media-studio': ['#2b83c9', '#1c629e'],
  'operation-recorder': ['#cc613c', '#a44124'],
  'plugin-workshop': ['#536bd1', '#3b4da6'],
  'reference-context': ['#aa772e', '#80551a'],
  'reference-preparation': ['#936140', '#714629'],
  'short-video-studio': ['#bc4c95', '#963471'],
  'task-templates': ['#5b64bc', '#424b97'],
  'wechat-channels-ops': ['#bd6822', '#924b18'],
  'wechat-official': ['#14845d', '#0f6646'],
  'workspace-canvas': ['#167e85', '#0c6068'],
  'xiaohongshu-ops': ['#cd4459', '#a72d45'],
}

function glyphMarkup(Icon, foreground) {
  return renderToStaticMarkup(createElement(Icon, { size: 26, color: foreground, strokeWidth: 1.7 }))
    .replace('<svg ', '<svg x="11" y="11" ').replace(/\sclass="[^"]*"/g, '')
}

export function featureArtwork(id) {
  const Icon = portedIcons[id]
  if (!Icon) return undefined
  const [background, foreground] = colors[id] ?? ['#edf0f5', '#4c607b']
  const glyph = glyphMarkup(Icon, foreground)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${background}"/>${glyph}</svg>\n`
}

/** Render the same artwork in the market and the native card/detail frames, including older installs. */
export function pluginArtworkStyles() {
  const frame = 'span[aria-hidden="true"]:first-child'
  return Object.entries(badgeColors).map(([id, [top, bottom]]) => {
    const name = JSON.stringify(id.startsWith('deepseek-i') ? id : '@ipollo/dsh-' + id)
    const selectors = [
      `[data-ipw-plugin-artwork=${name}]`,
      `[data-plugin-package=${name}] > div:first-child > ${frame}`,
      `[data-plugin-detail=${name}] > [data-window-drag]:first-child > div > ${frame}`,
    ]
    const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="color" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="48" height="48" rx="11" fill="url(#color)"/>${glyphMarkup(portedIcons[id], '#fff')}</svg>`
    const url = 'data:image/svg+xml;base64,' + Buffer.from(badge).toString('base64')
    const scope = `:is(${selectors.join(', ')})`
    return `${scope} { background: url("${url}") center / 36px 36px no-repeat; }\n${scope} > :is(img, svg) { visibility: hidden; }`
  }).join('\n')
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
