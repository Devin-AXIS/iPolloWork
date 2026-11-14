/** The bundled package's icon is the single source for its pre-install market image. */
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

export async function catalogArtwork(indexFile, releaseFile, update = false) {
  const index = JSON.parse(await readFile(indexFile, 'utf8'))
  const releases = JSON.parse(await readFile(releaseFile, 'utf8'))
  for (const release of releases.plugins) {
    const archive = join(resolve(releaseFile, '..'), 'packages', release.file)
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1_000_000 }))
    if (manifest.name !== release.name || manifest.version !== release.version || manifest.icon !== './icon.svg') throw Error('Bundled package artwork metadata does not match its release')
    const bytes = execFileSync('tar', ['-xOf', archive, 'package/icon.svg'], { maxBuffer: 32_768 })
    const image = 'data:image/svg+xml;base64,' + bytes.toString('base64')
    const entry = index.plugins.find(item => item.name === release.name)
    if (!entry) throw Error('Bundled plugin is missing from the market')
    if (update) entry.icon = image
    else if (entry.icon !== image) throw Error('Market icon differs from the packaged plugin: ' + release.name)
  }
  if (update) await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes('--write')
  await catalogArtwork('catalog/index.json', 'catalog/bundled-releases.json', update)
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const releases = JSON.parse(await readFile('catalog/bundled-releases.json', 'utf8'))
  const current = ['catalog/index.json', 'catalog/bundled-releases.json', ...releases.plugins.map(item => 'catalog/packages/' + item.file)]
  if (update) {
    manifest.files = [...manifest.files.filter(file => file !== 'catalog' && !file.startsWith('catalog/')), ...current]
    await writeFile('package.json', JSON.stringify(manifest, null, 2) + '\n')
  } else if (JSON.stringify(manifest.files.filter(file => file === 'catalog' || file.startsWith('catalog/')).sort()) !== JSON.stringify(current.sort())) {
    throw Error('Only the current catalog releases may be included in the suite package')
  }
  console.log('Market and bundled plugin icons match')
}
