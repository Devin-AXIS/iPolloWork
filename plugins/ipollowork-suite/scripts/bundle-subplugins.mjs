import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('../..')
const nodePaths = [resolve('node_modules')]
const sharedClient = ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives']

for (const feature of ['notification-center', 'collaboration-board']) {
  const source = resolve(root, 'plugins', feature)
  const destination = resolve('lib', 'subplugins', feature)
  const { name, version, license, engines, dsh } = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
  await mkdir(destination, { recursive: true })
  await build({
    entryPoints: [resolve(source, 'src/host.ts')], outfile: resolve(destination, 'host.js'),
    nodePaths, bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['@deepseek-ai/*'],
  })
  const browser = await build({
    entryPoints: [resolve(source, 'src/client.tsx')], outfile: resolve(destination, 'client.js'),
    nodePaths, bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
    external: sharedClient, loader: { '.css': 'text' }, write: false,
  })
  await writeFile(resolve(destination, 'client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory(require){
const module={exports:{}};const exports=module.exports;
${browser.outputFiles[0].text}
return module.exports;}});
`)
  // DSH discovers the browser entry from the closest package manifest to this Host entry.
  await writeFile(resolve(destination, 'package.json'), JSON.stringify({
    name, version, license, engines, type: 'module', exports: { '.': './host.js', './client': './client.js' },
    dsh: { client: dsh.client },
  }, null, 2) + '\n')
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(resolve(source, file), resolve(destination, file))
}
