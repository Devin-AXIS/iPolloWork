/** Import business sources from the frozen multi-engine branch and package native DSH bundles. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, join, basename, sep } from 'node:path'
import { mkdir, readFile, writeFile, cp, readdir, access, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { buildBusiness } from './ported-business.mjs'
import { dependencyNotices } from './ported-licenses.mjs'
import { featureArtwork } from './ported-artwork.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const suite = join(root, 'plugins/ipollowork-suite')
const require = createRequire(join(suite, 'package.json'))
const { build } = require('esbuild')
const sourceRevision = '05f917145cd320a93e514dbd01178133891bc4c6'
const mapped = { 'design-agent': 'deepseek-idesign', 'video-agent': 'deepseek-ivideo', 'operation-recorder': '@ipollo/dsh-operation-recorder', 'labelu-data-annotation': '@ipollo/dsh-data-annotation' }
const recordFile = join(root, 'integrations/runtime/ported-plugins.json')
const command = process.argv[2] ?? 'build'
const only = process.argv[3]
const exists = path => access(path).then(() => true, () => false)
const iconTile = svg => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#fff"/>${svg.replace(/<svg\b([^>]*)>/, (_match, attributes) => '<svg x="8" y="8" width="32" height="32"' + attributes.replace(/\s(?:width|height)="[^"]*"/g, '') + '>')}</svg>\n`

if (command === 'import') {
  const source = resolve(process.argv[3] ?? join(root, 'outputs/multi-engine-source-20261123/examples/plugin-packages'))
  const records = []
  for (const directory of await readdir(source, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const slug = directory.name
    const from = join(source, slug)
    const manifest = JSON.parse(await readFile(join(from, 'ipollowork.plugin.json'), 'utf8'))
    const name = mapped[slug] ?? `@ipollo/dsh-${slug}`
    records.push({ id: slug, name, sourceVersion: manifest.package.version, kind: mapped[slug] ? 'existing-native' : slug === 'deepseek-harness' ? 'native-harness' : 'ported', source: `examples/plugin-packages/${slug}` })
    if (mapped[slug]) continue
    const destination = join(root, 'plugins', slug)
    if (await exists(join(destination, 'package.json'))) throw Error(`Refusing to overwrite ${destination}`)
    await mkdir(join(destination, 'business'), { recursive: true })
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (!['service', 'skills', 'ui', 'mcp', 'src', 'extensions', 'scripts', 'index.html', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json'].includes(entry.name) && !/^(LICENSE|NOTICE|THIRD.PARTY)/i.test(entry.name)) continue
      // DSH itself is the current host; never carry the old delegated Agent runtime.
      if (slug === 'deepseek-harness' && entry.name !== 'skills') continue
      await cp(join(from, entry.name), join(destination, 'business', entry.name), { recursive: true,
        filter: path => !['node_modules', 'dist', '.git', 'AGENTS.md'].includes(basename(path)) })
    }
    for (const resource of manifest.resources ?? []) {
      if (!['file', 'command', 'agent'].includes(resource.type) || slug === 'deepseek-harness') continue
      const input = resolve(from, resource.path), target = resolve(destination, 'business', resource.path)
      if (!input.startsWith(from + sep) || !target.startsWith(join(destination, 'business') + sep)) throw Error('Invalid plugin resource path')
      if (['runtime', 'THIRD-PARTY-LICENSES.txt'].includes(resource.path) && !await exists(input)) continue
      if (!await exists(target)) await cp(input, target, { recursive: true })
    }
    await writeFile(join(destination, 'business/ipollowork.plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
    const oldPackage = await readFile(join(from, 'package.json'), 'utf8').catch(() => undefined)
    if (oldPackage) await writeFile(join(destination, 'business/source-package.json'), oldPackage)
    await writeFile(join(destination, '.gitignore'), 'lib/\n*.tgz\nnode_modules/\nbusiness/runtime/\nbusiness/service/*.js\n')
    await writeFile(join(destination, 'package.json'), JSON.stringify({
      name, version: '0.1.0', description: manifest.description, type: 'module', license: 'SEE LICENSE IN LICENSE', icon: './icon.svg',
      engines: { node: '>=24.9.0', dsh: '>=0.2.2-rc.3 <0.2.3-0' },
      exports: { '.': './lib/host.js', './client': './lib/client.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
      files: ['lib', 'business', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'NOTICE.md', 'icon.svg', 'locale'],
      peerDependencies: { '@deepseek-ai/cordis': '^4.1.0', '@deepseek-ai/dsh-tools': '0.2.2-rc.3', '@deepseek-ai/dsh-credentials': '0.2.2-rc.3' },
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-workspace', '@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-primitives'] } },
      scripts: { build: `node ../../integrations/tooling/ported-plugins.mjs build ${slug}`, check: `node ../../integrations/tooling/ported-plugins.mjs check ${slug}`, 'pack:check': 'npm pack --dry-run' },
    }, null, 2) + '\n')
    await writeFile(join(destination, 'cordis.patch.yml'), `- insert:\n    - id: ipollo-${slug}\n      name: ${JSON.stringify(name)}\n`)
    await cp(join(root, 'LICENSE'), join(destination, 'LICENSE'))
    await writeFile(join(destination, 'icon.svg'), featureArtwork(slug) ?? iconTile(await readFile(join(suite, 'assets/mark.svg'), 'utf8')))
    await mkdir(join(destination, 'locale'), { recursive: true })
    for (const language of ['en', 'zh']) {
      const text = language === 'en' ? manifest.localization?.translations?.en : manifest
      await writeFile(join(destination, 'locale', language + '.json'), JSON.stringify({ meta: { title: text?.name ?? manifest.name, description: text?.description ?? manifest.description } }, null, 2) + '\n')
    }
    await writeFile(join(destination, 'NOTICE.md'), `Business sources: iPolloWork ${sourceRevision}, examples/plugin-packages/${slug} (${manifest.package.version}). Original license and third-party notices are retained in business/. Native DSH integration is owned by iPolloWork. No old host runtime is included.\n`)
    await writeFile(join(destination, 'README.md'), `# ${manifest.localization?.translations?.en?.name ?? manifest.name}\n\nNative DSH bundle migrated from \`${slug}\` ${manifest.package.version}. Install its .tgz through iPolloWork Market or the native DSH Plugin Manager. Choose a registered workspace before opening the workbench. Credentials use the native Host credential store; existing local business data is retained. Disable/uninstall releases tools, Skills, routes and child services while retaining data.\n\nBuild with \`npm run build\`; run \`npm run check\` and \`npm run pack:check\` before packaging. See the repository migration inventory for capability-specific verification and limitations.\n`)
    await writeFile(join(destination, 'README.zh.md'), `# ${manifest.name}\n\n从多引擎分支 \`${slug}\` ${manifest.package.version} 移植的 DSH 原生插件。通过 iPolloWork 市场或原生插件管理器安装 .tgz，选择已有工作区后打开工作台。凭据由原生 Host 凭据提供方保存，保留旧版本地业务数据。停用或卸载释放工具、Skill、路由和子服务，保留用户文件。\n\n运行 \`npm run build\`、\`npm run check\`、\`npm run pack:check\`。各能力的验收与限制见仓库迁移清单。\n`)
  }
  await writeFile(recordFile, JSON.stringify({ format: 1, sourceBranch: 'ipollowork-multi-engine', sourceRevision, plugins: records }, null, 2) + '\n')
  console.log(`Imported ${records.length} plugin identities from ${sourceRevision}`)
} else {
  const inventory = JSON.parse(await readFile(recordFile, 'utf8'))
  console.log('Checking native package dependencies')
  const licenses = await dependencyNotices(require, ['ajv', 'zod', 'react-dom', 'lucide-react'])
  for (const entry of inventory.plugins.filter(item => item.kind !== 'existing-native' && (!only || only === item.id))) {
    console.log('Building native bridge: ' + entry.id)
    const directory = join(root, 'plugins', entry.id)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (!manifest.files.includes('NOTICE.dependencies.txt')) {
      manifest.files.push('NOTICE.dependencies.txt')
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    }
    await writeFile(join(directory, 'NOTICE.dependencies.txt'), licenses)
    const ignored = await readFile(join(directory, '.gitignore'), 'utf8')
    if (!ignored.includes('NOTICE.dependencies.txt')) await writeFile(join(directory, '.gitignore'), ignored + 'NOTICE.dependencies.txt\nbusiness/THIRD-PARTY-LICENSES.txt\n')
    if (!['pack', 'compile'].includes(command) || !await exists(join(directory, 'lib/host.js'))) await buildBusiness(entry.id, directory)
    await mkdir(join(directory, 'lib'), { recursive: true })
    const common = { bundle: true, nodePaths: [join(suite, 'node_modules')], target: 'node24', legalComments: 'eof' }
    await build({ ...common, stdin: { contents: `import { applyBundle } from './src/ported/host.ts'; import manifest from ${JSON.stringify(join(directory, 'business/ipollowork.plugin.json'))} with { type: 'json' }; import { fileURLToPath } from 'node:url'; export const name = ${JSON.stringify('ipollo-' + entry.id)}; export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry', 'tools', 'skills', 'credentials', 'sandboxPolicy']; export function apply(ctx) { return applyBundle(ctx, manifest, fileURLToPath(new URL('../business/', import.meta.url))); }`, resolveDir: suite },
      outfile: join(directory, 'lib/host.js'), platform: 'node', format: 'esm', external: ['@deepseek-ai/*'] })
    const needsUiRuntime = ['short-video-studio', 'media-studio', 'douyin-ops', 'wechat-channels-ops', 'wechat-official', 'xiaohongshu-ops'].includes(entry.id)
    const uiRuntime = needsUiRuntime ? `import { installFrameUi } from './src/ported/native-ui.tsx';` : ''
    const client = await build({ ...common, target: 'es2022', stdin: { contents: `import { mountBundle } from './src/ported/client.tsx'; ${uiRuntime} import manifest from ${JSON.stringify(join(directory, 'business/ipollowork.plugin.json'))}; export const inject = ['slots','locale','layout','theme','uiWorkspace']; export function apply(ctx) { ${needsUiRuntime ? 'ctx.effect(installFrameUi);' : ''} return mountBundle(ctx, manifest, ${JSON.stringify(manifest.name)}); }`, resolveDir: suite },
      outfile: join(directory, 'lib/client.js'), platform: 'browser', format: 'cjs', define: { 'process.env.NODE_ENV': '"production"' }, external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], write: false })
    const clientFile = join(directory, 'lib/client.js'), temporary = clientFile + '.build-' + process.pid
    await writeFile(temporary, `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`)
    await rename(temporary, clientFile)
    for (const resource of JSON.parse(await readFile(join(directory, 'business/ipollowork.plugin.json'), 'utf8')).resources ?? []) {
      if (resource.type !== 'local-service' || !resource.path.endsWith('.ts')) continue
      const source = join(directory, 'business', resource.path)
      await build({ ...common, entryPoints: [source], outfile: source.replace(/\.ts$/, '.js'), platform: 'node', format: 'esm', external: ['@deepseek-ai/*'] })
    }
    if (command === 'check') {
      execFileSync(process.execPath, ['--check', join(directory, 'lib/host.js')])
      execFileSync(process.execPath, ['--check', join(directory, 'lib/client.js')])
    }
    if (command === 'pack') {
      const output = join(root, 'dist/ported-plugins')
      await mkdir(output, { recursive: true })
      const npm = process.env.npm_execpath ?? (process.platform === 'win32' ? 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' : '/usr/local/lib/node_modules/npm/bin/npm-cli.js')
      const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: directory, encoding: 'utf8', maxBuffer: 4_000_000 }))[0]
      const bytes = await readFile(join(output, packed.filename))
      console.log(JSON.stringify({ name: manifest.name, version: manifest.version, file: packed.filename, sha256: createHash('sha256').update(bytes).digest('hex') }))
    } else console.log(`${command}: ${entry.id}`)
  }
}
