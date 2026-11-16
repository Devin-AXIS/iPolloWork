import { resolve } from 'node:path'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { larkSdkHandshakePatch } from '../vendor/dsh-im/plugin-src/host/lark-sdk-handshake-patch.mjs'

await mkdir('lib', { recursive: true })
await rm('lib/host/sandbox', { recursive: true, force: true })
await writeFile('lib/services.d.ts', await readFile('src/shared/services.ts', 'utf8'))
await writeFile('lib/connections.d.ts', await readFile('src/shared/connections.ts', 'utf8'))
// Only declared runtime packages stay external. DSH maps every package name in a bundle's dependency closure to one
// directory per process, so third-party libraries are bundled: a name shared with another bundle would otherwise move
// directories when this suite is disabled and force a restart.
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const runtimePackages = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })
const external = runtimePackages.flatMap(name => [name, `${name}/*`])
await build({ entryPoints: ['src/host/index.ts', 'src/host/agents.ts', 'src/host/agent-runtime.ts', 'src/host/coordinator-runtime.ts', 'src/host/onboarding.ts', 'src/host/app-data-plugin.ts', 'src/host/sandbox/aliyun/index.ts', 'src/host/cloud/index.ts', 'src/host/cloud/server.ts', 'src/host/cloud/bootstrap.ts'], outdir: 'lib/host', bundle: true, platform: 'node', format: 'esm', external: ['@deepseek-ai/*', ...external], target: 'node24', sourcemap: true })
await build({
  entryPoints: ['src/host/im.ts'], outfile: 'lib/host/im.js', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  mainFields: ['module', 'main'], plugins: [larkSdkHandshakePatch],
  external: ['@deepseek-ai/*', ...external],
  banner: { js: "import { createRequire as __imRequire } from 'node:module'; import { fileURLToPath as __imPath } from 'node:url'; import { dirname as __imDirname } from 'node:path'; const require = __imRequire(import.meta.url); const __filename = __imPath(import.meta.url); const __dirname = __imDirname(__filename);" },
  minify: true, legalComments: 'eof',
})
// Bundle the pinned official generator unchanged; keep it out of the Host and browser entrypoints.
await build({ entryPoints: ['src/host/market-generator.ts'], outfile: 'lib/host/market-generator.js', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  alias: { '#dsh-market-generator': resolve('../../.upstream/dsh/apps/plugin-market-generator/src/generate.ts') },
  external: ['@deepseek-ai/*'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
const browser = await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/browser.cjs', bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', loader: { '.webp': 'dataurl', '.svg': 'dataurl' }, external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'], write: false })
const js = browser.outputFiles.find(file => file.path.endsWith('.cjs'))
const css = browser.outputFiles.find(file => file.path.endsWith('.css'))
if (!js || !css) throw new Error('The client build must produce JavaScript and CSS')
await writeFile('lib/client.js', `window.__ModuleLoader__.load({id:'@ipollo/dsh-suite',factory(require){const module={exports:{}};const exports=module.exports;\n${js.text}\nreturn module.exports;}});\n`)
await writeFile('lib/client.css', css.contents)
JSON.parse(await readFile('catalog/index.json', 'utf8'))
