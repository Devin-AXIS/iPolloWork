/** Add native display metadata to the immutable first-party decision plugin release. */
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { featureArtwork } from './ported-artwork.mjs'
import { officialSdkVersions } from './runtime-contract.mjs'
const root = resolve('.'), directory = resolve(process.argv[2] ?? '.ipollowork-dev/plugin-unify-decision-intelligence')
const product=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const pin = JSON.parse(await readFile(join(root, 'integrations/runtime/upstream.json'), 'utf8'))
const suiteManifest = JSON.parse(await readFile(join(root, 'plugins/ipollowork-suite/package.json'), 'utf8'))
const sdkVersions = officialSdkVersions(join(root, '.upstream/dsh'))
const revision = 'f95aaa5e185f69489b3bf8cebb87aa9cec8b3b1e'
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim() !== revision) throw Error('Decision plugin source revision changed')
const file = join(directory, 'package.json'), pkg = JSON.parse(await readFile(file, 'utf8'))
if (pkg.name !== '@ipollo/dsh-decision-intelligence') throw Error('Unexpected package identity')
pkg.version = '1.0.3'; pkg.icon = './icon.svg'
pkg.engines = { ...pkg.engines, node: suiteManifest.engines.node, dsh: pin.npmVersion }
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) for (const name of Object.keys(pkg[section] ?? {})) {
  const version = sdkVersions.get(name)
  if (name.startsWith('@deepseek-ai/') && version) pkg[section][name] = version
}
pkg.exports['./package.json'] = './package.json'; pkg.exports['./locale/*.json'] = './locale/*.json'
pkg.files = [...new Set([...pkg.files, 'icon.svg', 'locale'])]
pkg.peerDependencies['@deepseek-ai/dsh-client-ui-primitives'] = pin.npmVersion
pkg.dsh.client.inject = [...new Set([...pkg.dsh.client.inject, '@deepseek-ai/dsh-client-ui-primitives'])]
await writeFile(file, JSON.stringify(pkg, null, 2) + '\n')
await writeFile(join(directory, 'icon.svg'), featureArtwork('decision-intelligence'))
await mkdir(join(directory, 'locale'), { recursive: true })
for (const [language, title, description] of [
  ['zh', 'iPollo 决策情报', '整理产业关系、关键指标和证据，生成可展开的决策图谱。'],
  ['en', 'iPollo Decision Intelligence', pkg.description],
]) await writeFile(join(directory, 'locale', language + '.json'), JSON.stringify({ meta: { title, description } }, null, 2) + '\n')
let client = await readFile(join(directory, 'src/client.js'), 'utf8')
if (!client.includes('IconGaugeOutlineRegular')) {
  client = client.replace("const React = require('react');", "const React = require('react');\n    const { IconGaugeOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');")
  client = client.replace('order: 13, title, description:', 'order: 13, title, icon: IconGaugeOutlineRegular, description:')
  await writeFile(join(directory, 'src/client.js'), client)
}
await cp(join(directory, 'src/client.js'), join(directory, 'dist/client.js'))
const note = '\nNative display metadata and guide icon adapted by iPolloWork from ' + revision + '. Host and editor behavior remain at that immutable source revision.\n'
const notice = await readFile(join(directory, 'NOTICE.txt'), 'utf8')
if (!notice.includes('Native display metadata and guide icon')) await writeFile(join(directory, 'NOTICE.txt'), notice + note)
if (process.argv.includes('--prepare-only')) process.exit(0)
const npm = process.env.npm_execpath
if (!npm) throw Error('The current npm CLI must be supplied')
const destination = join(root, 'dist/ported-plugins'); await mkdir(destination, { recursive: true })
const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: directory, encoding: 'utf8', maxBuffer: 8_000_000 }))[0]
const bytes = await readFile(join(destination, packed.filename)), sha256 = createHash('sha256').update(bytes).digest('hex')
const archive = packed.filename.replace(/\.tgz$/, '-' + sha256.slice(0, 12) + '.tgz')
const suite = join(root, 'plugins/ipollowork-suite')
await cp(join(destination, packed.filename), join(suite, 'catalog/packages', archive))
const releaseFile = join(suite, 'catalog/bundled-releases.json'), releases = JSON.parse(await readFile(releaseFile, 'utf8'))
releases.plugins = [...releases.plugins.filter(item => item.name !== pkg.name), { name: pkg.name, version: pkg.version, file: archive, sha256,tag:`v${product.version}` }]
await writeFile(releaseFile, JSON.stringify(releases, null, 2) + '\n')
const catalogFile = join(suite, 'catalog/index.json'), catalog = JSON.parse(await readFile(catalogFile, 'utf8'))
catalog.plugins = [...catalog.plugins.filter(item => item.name !== pkg.name), {
  name: pkg.name, title: { zh: 'iPollo 决策情报', en: 'iPollo Decision Intelligence' }, author: 'iPolloWork',
  description: { zh: '整理产业关系、关键指标和证据，生成可展开的决策图谱。', en: pkg.description },
  homepage: pkg.homepage, metadata: { category: 'productivity', keywords: ['decision', 'atlas', 'research'] },
  icon: 'data:image/svg+xml;base64,' + (await readFile(join(directory, 'icon.svg'))).toString('base64'),
  versions: [{ version: pkg.version, publishTimestamp: 1795382400, source: { type: 'npm' }, engines: { dsh: pkg.engines.dsh } }],
}]
const titles = catalog.plugins.find(item => item.name === '@deepseek-ai/dsh-experimental-session-titles-bundle')
titles.versions[0].version = pin.npmVersion
titles.versions[0].engines.dsh = pin.npmVersion
titles.icon = 'data:image/svg+xml;base64,' + (await readFile(join(root, '.upstream/dsh/packages/experimental/session-titles-bundle/icon.svg'))).toString('base64')
await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
const suiteFile = join(suite, 'package.json'), manifest = JSON.parse(await readFile(suiteFile, 'utf8'))
manifest.files = [...manifest.files.filter(item => !item.startsWith('catalog/packages/')), ...releases.plugins.map(item => 'catalog/packages/' + item.file)]
await writeFile(suiteFile, JSON.stringify(manifest, null, 2) + '\n')
console.log('Packaged Decision Intelligence ' + pkg.version + ' with native metadata, package artwork and guide icon')
