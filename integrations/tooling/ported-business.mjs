/** Compile plugin-owned services and workbenches without importing the former host. */
import { createRequire, isBuiltin } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, join, dirname, basename } from 'node:path'
import { mkdir, readFile, writeFile, cp, access, readdir, realpath } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dependencyNotices } from './ported-licenses.mjs'
import {pnpm} from './upstream.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url))
const suite = join(root, 'plugins/ipollowork-suite')
const require = createRequire(join(suite, 'package.json'))
const { build } = require('esbuild')
const exists = path => access(path).then(() => true, () => false)

export async function buildBusiness(slug, directory) {
  const business = join(directory, 'business')
  // Native owners already provide these features; the old delegated runtime is retired.
  if (slug === 'deepseek-harness') {
    const manifestPath = join(business, 'ipollowork.plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.resources = manifest.resources.filter(item => item.type === 'skill')
    manifest.description = '使用 iPolloWork 的 Agent、子任务和会话完成开发、审查与研究。'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(join(business, 'skills/deepseek-harness/SKILL.md'), '---\nname: deepseek-harness\ndescription: Use the current native DSH Agent and its available subagent tools for development, review and research.\n---\n\nUse this existing DSH session, workspace and model. Discover the native subagent tool when independent parallel work is authorized. Keep results in the selected workspace. Do not install or launch a second Harness, use the removed extension service, or move credentials into prompts.\n')
  }
  if (slug === 'plugin-workshop') {
    const manifestPath = join(business, 'ipollowork.plugin.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.description = '在原生会话中制作、检查和打包 iPolloWork 插件，通过原生插件管理器安装与验证。'
    if (manifest.localization?.translations?.en) manifest.localization.translations.en.description = 'Author, check and package iPolloWork plugins in conversation, then install and verify them with the native Plugin Manager.'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(join(business, 'skills/plugin-workshop/SKILL.md'), '---\nname: plugin-workshop\ndescription: Build, preview and package installable native DSH plugins for iPolloWork.\n---\n\nRead the current repository AGENTS.md and docs/plugin-development.zh.md. Create a native ESM DSH Bundle with package.json exports, engines.dsh and dsh.bundle.patch. Register tools, Skills, authenticated routes and client slots through the native lifecycle. Never copy the old host or Agent loop. Keep credentials in the Host provider, enforce workspace and read-only permissions, and release registrations on disable. Build and check the package, inspect npm pack --dry-run, and test its actual .tgz in a disposable DSH_HOME. Deliver the package for installation in the native Plugin Manager. Publishing or deploying requires the user\'s request.\n')
  }
  if (slug === 'short-video-studio') {
    await mkdir(join(business, 'ui'), { recursive: true }); await mkdir(join(business, 'service'), { recursive: true })
    await build({ entryPoints: [join(business, 'src/service.mjs')], outfile: join(business, 'service/studio.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24' })
    const browser = await build({ entryPoints: [join(business, 'src/ui.mjs')], outfile: join(business, 'ui/studio.js'), bundle: true, write: false, format: 'esm', target: 'es2022',
      alias: { '@ipollowork/ui/runtime-contract': join(suite, 'src/ported/frame-runtime.ts') } })
    const js = browser.outputFiles.find(file => file.path.endsWith('.js')).text
    const css = browser.outputFiles.find(file => file.path.endsWith('.css')).text
    await writeFile(join(business, 'ui/studio.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>短片创作工作台</title><style>${css}</style></head><body><script type="module">${js.replaceAll('</script', '<\\/script')}</script></body></html>`)
  }
  if (slug === 'ipollo-onto' || slug === 'xiaohongshu-ops') {
    // Build dependencies may be supplied from an existing locked checkout, but only
    // current source files are compiled. No prebuilt old host artifacts are copied.
    const dependencyRoot = process.env.IPW_PORT_BUILD_DEPENDENCIES
    const legacy = dependencyRoot ? resolve(dependencyRoot, 'examples/plugin-packages', slug) : business
    const dependencyDirectory = slug === 'ipollo-onto' ? legacy : join(legacy, 'skills/xhs-ops-worker/app')
    if (!await exists(join(dependencyDirectory, 'node_modules'))) {
      if (slug === 'ipollo-onto') await cp(join(business, 'source-package.json'), join(business, 'package.json'))
      const args = ['install', '--ignore-workspace', '--frozen-lockfile', '--ignore-scripts']
      await pnpm(args,dependencyDirectory)
    }
    if (slug === 'ipollo-onto') {
      const dependency = createRequire(join(legacy, 'package.json'))
      const metadata = JSON.parse(await readFile(join(business, 'source-package.json'), 'utf8'))
      await writeFile(join(business, 'THIRD-PARTY-LICENSES.txt'), await dependencyNotices(dependency, [...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.devDependencies ?? {})]))
      const vite = await import(pathToFileURL(dependency.resolve('vite')).href)
      await access(join(business, 'index.html'))
      // Vite resolves imports from the current source tree; create only ignored local links.
      const { symlink } = await import('node:fs/promises')
      if (!await exists(join(directory, 'node_modules'))) await symlink(join(legacy, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      const react = (await import(pathToFileURL(dependency.resolve('@vitejs/plugin-react')).href)).default
      await vite.build({ configFile: false, root: business, base: './', plugins: [react()], build: { outDir: 'runtime/dist', emptyOutDir: false, sourcemap: false } })
      await mkdir(join(business, 'runtime/src/server'), { recursive: true })
      await build({ entryPoints: [join(business, 'src/server/index.ts')], outfile: join(business, 'runtime/src/server/index.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node24',
        nodePaths: [join(legacy, 'node_modules')], external: ['bun:sqlite', 'pg-native'], alias: { 'node:sqlite': join(business, 'scripts/sqlite-runtime.mjs') },
        banner: { js: "import { createRequire as ipwCreateRequire } from 'node:module'; const require = ipwCreateRequire(import.meta.url);" } })
      execFileSync(process.execPath, ['--check', join(business, 'runtime/src/server/index.mjs')])
      await cp(join(business, 'extensions'), join(business, 'runtime/extensions'), { recursive: true })
    } else {
      const app = join(business, 'skills/xhs-ops-worker/app')
      const legacyApp = join(legacy, 'skills/xhs-ops-worker/app')
      const dependency = createRequire(join(legacyApp, 'package.json'))
      const dependencyMetadata = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
      await writeFile(join(business, 'THIRD-PARTY-LICENSES.txt'), await dependencyNotices(dependency, [...Object.keys(dependencyMetadata.dependencies ?? {}), ...Object.keys(dependencyMetadata.devDependencies ?? {})]))
      await mkdir(join(business, 'runtime/dist'), { recursive: true })
      await build({ entryPoints: [join(app, 'src/server.ts')], outfile: join(business, 'runtime/dist/server.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'node24',
        nodePaths: [join(legacyApp, 'node_modules')], external: ['sharp', 'bun:sqlite'], alias: { 'node:sqlite': join(business, 'scripts/sqlite-runtime.mjs') } })
      await cp(join(app, 'public'), join(business, 'runtime/public'), { recursive: true })
      // npm pack excludes nested node_modules even when the parent directory is in files.
      const vendor = join(business, 'runtime/vendor')
      const copied = new Set()
      async function copyDependency(name, resolver, optional = false) {
        if (isBuiltin(name)) return
        if (copied.has(name)) return
        if (name.startsWith('@img/sharp-') && !name.includes(process.platform + '-' + process.arch)) return
        let source
        for (const directory of resolver.resolve.paths(name) ?? []) if (await exists(join(directory, name, 'package.json'))) { source = await realpath(join(directory, name)); break }
        if (!source) { if (optional) return; throw Error('Missing build dependency: ' + name) }
        copied.add(name)
        const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
        await cp(source, join(vendor, name), { recursive: true, dereference: true, filter: path => basename(path) !== 'node_modules' })
        const child = createRequire(join(source, 'package.json'))
        for (const key of Object.keys(metadata.dependencies ?? {})) await copyDependency(key, child)
        for (const key of Object.keys(metadata.optionalDependencies ?? {})) await copyDependency(key, child, true)
      }
      await copyDependency('sharp', dependency)
      await access(join(vendor, '@img', `sharp-${process.platform}-${process.arch}`, 'lib', `sharp-${process.platform}-${process.arch}.node`))
      let iconRoot
      for (const directory of dependency.resolve.paths('@tabler/icons-webfont') ?? []) if (await exists(join(directory, '@tabler/icons-webfont/package.json'))) { iconRoot = await realpath(join(directory, '@tabler/icons-webfont')); break }
      if (!iconRoot) throw Error('Missing locked webfont dependency')
      const iconTarget = join(vendor, '@tabler/icons-webfont')
      for (const file of ['package.json', 'LICENSE', 'dist/tabler-icons.min.css', 'dist/fonts/tabler-icons.woff2']) { await mkdir(dirname(join(iconTarget, file)), { recursive: true }); await cp(join(iconRoot, file), join(iconTarget, file)) }
      await writeFile(join(business, 'runtime/package.json'), '{"type":"module"}\n')
      execFileSync(process.execPath, ['--check', join(business, 'runtime/dist/server.mjs')])
      const metadataPath = join(directory, 'package.json'), metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
      metadata.os = [process.platform]; metadata.cpu = [process.arch]
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n')
    }
  }
}
