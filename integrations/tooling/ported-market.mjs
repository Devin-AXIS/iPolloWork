/** Package checked native ports (optionally selected slugs) and update the format-1 catalog. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../..', import.meta.url))
const suite = join(root, 'plugins/ipollowork-suite')
const indexPath = join(suite, 'catalog/index.json'), releasePath = join(suite, 'catalog/bundled-releases.json')
const index = JSON.parse(await readFile(indexPath, 'utf8')), releases = JSON.parse(await readFile(releasePath, 'utf8'))
const inventory = JSON.parse(await readFile(join(root, 'integrations/runtime/ported-plugins.json'), 'utf8'))
const selected = new Set(process.argv.slice(2))
for (const id of selected) if (!inventory.plugins.some(item => item.id === id && !['design-agent', 'video-agent'].includes(id))) throw Error('Unknown packaged plugin: ' + id)
const npm = process.env.npm_execpath
if (!npm) throw Error('Run this command through npm run package:ported-market so the current npm CLI is used')
const output = join(root, 'dist/ported-plugins'); await mkdir(output, { recursive: true })
const directoryFor = item => item.id === 'labelu-data-annotation' ? 'data-annotation' : item.id
for (const item of inventory.plugins) {
  if (['design-agent', 'video-agent'].includes(item.id)) continue
  if (selected.size && !selected.has(item.id)) continue
  const directory = join(root, 'plugins', directoryFor(item))
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (item.id === 'xiaohongshu-ops') {
    for (const file of ['app.js', 'app.css']) {
      const source = await readFile(join(directory, 'business/skills/xhs-ops-worker/app/public', file))
      const shipped = await readFile(join(directory, 'business/runtime/public', file))
      if (!source.equals(shipped)) throw Error(`Stale xiaohongshu-ops runtime/${file}; rebuild business assets before packaging`)
    }
  }
  const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: directory, encoding: 'utf8', maxBuffer: 8_000_000 }))[0]
  const bytes = await readFile(join(output, packed.filename)), sha256 = createHash('sha256').update(bytes).digest('hex')
  const file = packed.filename.replace(/\.tgz$/, '-' + sha256.slice(0, 12) + '.tgz')
  await cp(join(output, packed.filename), join(suite, 'catalog/packages', file))
  const release = { name: manifest.name, version: manifest.version, file, sha256 }
  releases.plugins = [...releases.plugins.filter(value => value.name !== manifest.name), release]
  const source = item.kind === 'existing-native'
    ? JSON.parse(execFileSync('git', ['show', `${inventory.sourceRevision}:${item.source}/ipollowork.plugin.json`], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 }))
    : JSON.parse(await readFile(join(directory, 'business/ipollowork.plugin.json'), 'utf8'))
  const creative = ['media-studio', 'short-video-studio', 'workspace-canvas'].includes(item.id)
  const communication = /(?:xiaohongshu|douyin|wechat)/.test(item.id)
  const title = source.name
  const entry = { name: manifest.name, title: { zh: title, en: source.localization?.translations?.en?.name ?? title },
    author: source.package.publisher?.name ?? 'iPolloWork', description: { zh: source.description, en: source.localization?.translations?.en?.description ?? source.description },
    homepage: 'https://github.com/Devin-AXIS/iPolloWork',
    metadata: { category: creative ? 'creative' : communication ? 'communication' : 'productivity', keywords: [item.id, 'dsh', 'ipollowork'] },
    versions: [{ version: manifest.version, publishTimestamp: 1795382400, source: { type: 'npm' }, engines: { dsh: manifest.engines.dsh } }],
    icon: 'data:image/svg+xml;base64,' + (await readFile(join(directory, manifest.icon))).toString('base64'),
  }
  const existing = index.plugins.findIndex(value => value.name === manifest.name)
  if (existing >= 0) index.plugins[existing] = entry
  else index.plugins.push(entry)
  console.log(`${item.id}: ${manifest.version} ${sha256.slice(0, 12)}`)
}
await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n')
await writeFile(releasePath, JSON.stringify(releases, null, 2) + '\n')
const packagePath = join(suite, 'package.json'), manifest = JSON.parse(await readFile(packagePath, 'utf8'))
manifest.files = [...manifest.files.filter(value => !value.startsWith('catalog/packages/')), ...releases.plugins.map(release => 'catalog/packages/' + release.file)]
await writeFile(packagePath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Market: ${index.plugins.length} native entries; all ${inventory.plugins.length} former identities accounted for`)
