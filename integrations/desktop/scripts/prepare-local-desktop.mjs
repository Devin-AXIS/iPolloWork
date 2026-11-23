/** Build a coherent product shell outside legacy directories in the user's checkout. */
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pnpm, run, verifySource } from '../../tooling/upstream.mjs'
import { desktopApplicationEntries, desktopApplicationPatches } from '../../tooling/desktop-composition.mjs'
import { resolveDesktopAccountOrigin } from '../../tooling/account-service.mjs'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const upstream = join(root, '.upstream/dsh')
const omitted = new Set(['node_modules', 'lib', '.desktop-build', 'tsconfig.host.tsbuildinfo', 'tsconfig.client.tsbuildinfo'])
const included = name => !omitted.has(name) && !name.startsWith('.env') && !name.endsWith('.env') && !name.endsWith('.tsbuildinfo') && !/\.(?:p12|pfx|key|pem)$/.test(name)

export async function localDesktopFingerprint(repository = root) {
  const hash = createHash('sha256')
  async function visit(path, label) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!included(entry.name) || entry.isSymbolicLink()) continue
      const child = join(path, entry.name), relative = label + '/' + entry.name
      if (entry.isDirectory()) await visit(child, relative)
      else if (entry.isFile()) hash.update(relative).update('\0').update(await readFile(child)).update('\0')
    }
  }
  for (const name of ['desktop', 'desktop-host']) await visit(join(repository, 'integrations', name), name)
  for (const name of ['package.json', 'integrations/runtime/upstream.json', 'integrations/tooling/account-service.mjs', 'integrations/tooling/desktop-composition.mjs', 'plugins/ipollowork-suite/package.json', 'plugins/ipollowork-suite/cordis.patch.yml', 'plugins/ipollowork-suite/deployment.json']) hash.update(name).update('\0').update(await readFile(join(repository, name))).update('\0')
  hash.update(resolveDesktopAccountOrigin())
  return hash.digest('hex')
}

async function link(from, to, directory = true) {
  await mkdir(resolve(to, '..'), { recursive: true })
  if (!directory) await cp(from, to)
  else await symlink(await realpath(from), to, process.platform === 'win32' ? 'junction' : undefined)
}

export async function prepareLocalDesktop() {
  await verifySource()
  const fingerprint = await localDesktopFingerprint()
  const home = join(root, '.ipollowork-dev/jovan-electron')
  await mkdir(home, { recursive: true })
  try {
    const prior = (await readFile(join(home, 'stage-path.txt'), 'utf8')).trim()
    const within = relative(home, prior)
    if (within && within !== '..' && !within.startsWith('..\\') && !within.startsWith('../') && !isAbsolute(within)) {
      const saved = JSON.parse(await readFile(join(prior, 'source-build.json'), 'utf8'))
      if (saved.fingerprint === fingerprint) {
        for (const name of ['integrations/desktop/lib/main.js', 'integrations/desktop/lib/welcome/welcome.js', 'integrations/desktop-host/lib/index.js']) await readFile(join(prior, name))
        return prior
      }
    }
  } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError)) throw error }
  const stage = await mkdtemp(join(home, 'source-' + fingerprint.slice(0, 12) + '-'))
  for (const name of ['desktop', 'desktop-host']) {
    await cp(join(root, 'integrations', name), join(stage, 'integrations', name), { recursive: true, filter: path => included(path.split(/[\\/]/).at(-1)) })
    await link(join(upstream, 'apps', name, 'node_modules'), join(stage, 'integrations', name, 'node_modules'))
  }
  for (const name of ['apps', 'packages', 'scripts', 'vendor', 'native', 'node_modules']) await link(join(upstream, name), join(stage, name))
  for (const name of ['tsconfig.base.json', 'tsconfig.base.client.json', 'tsconfig.node.base.json', 'vitest.shared.ts']) await link(join(upstream, name), join(stage, name), false)
  await link(upstream, join(stage, '.upstream/dsh'))
  await link(join(root, 'integrations/publisher'), join(stage, 'integrations/publisher'))
  await link(join(upstream, 'packages/boot/plugin-manager/node_modules/yaml'), join(stage, 'integrations/node_modules/yaml'))
  await link(join(root, 'plugins/ipollowork-suite'), join(stage, 'plugins/ipollowork-suite'))
  await cp(join(root, 'package.json'), join(stage, 'package.json'))
  await pnpm(['exec', 'tsc', '-b', 'integrations/desktop', 'integrations/desktop-host'], stage)
  for (const name of ['desktop', 'desktop-host']) await pnpm(['exec', 'tsdown', '--config-loader', 'native', '--config', `integrations/${name}/tsdown.config.ts`], stage)
  const { load, dump } = createRequire(join(root, 'plugins/ipollowork-suite/package.json'))('js-yaml')
  const accountOrigin = resolveDesktopAccountOrigin()
  const applicationEntries = desktopApplicationEntries(load(await readFile(join(root, 'plugins/ipollowork-suite/cordis.patch.yml'), 'utf8')), accountOrigin)
  await writeFile(join(stage, 'integrations/desktop-host/application.yml'), dump(applicationEntries, { lineWidth: -1, noRefs: true }))
  await writeFile(join(stage, 'integrations/desktop-host/cordis.patch.yml'), dump(desktopApplicationPatches(applicationEntries), { lineWidth: -1, noRefs: true }))
  await mkdir(join(stage, 'integrations/desktop-host/assets'), { recursive: true })
  await cp(join(root, 'plugins/ipollowork-suite/assets/mark.svg'), join(stage, 'integrations/desktop-host/assets/mark.svg'))
  const project = join(stage, 'runtime-project')
  // Use the existing native development-project builder, not a second runtime.
  await writeFile(join(stage, 'prepare-project.mjs'), `import {prepareDevelopmentProject} from './integrations/desktop/scripts/development-project.ts';
import {DESKTOP_HOST_PROTOCOL_VERSION} from './integrations/desktop/src/host-protocol.ts';
import {readFileSync,writeFileSync} from 'node:fs';
const version=JSON.parse(readFileSync('./apps/cli/package.json','utf8')).version;
prepareDevelopmentProject({projectDir:${JSON.stringify(project)},cliDir:${JSON.stringify(join(upstream, 'apps/cli'))},hostDir:${JSON.stringify(join(stage, 'integrations/desktop-host'))},suiteDir:${JSON.stringify(join(root, 'plugins/ipollowork-suite'))},dependencyDir:${JSON.stringify(join(upstream, 'node_modules/.pnpm/node_modules'))},release:{schemaVersion:1,version,hostProtocolVersion:DESKTOP_HOST_PROTOCOL_VERSION,nodeVersion:process.versions.node,pnpmVersion:'11.28.5'},target:'win-x64'});
const path=${JSON.stringify(join(project, 'package.json'))};const manifest=JSON.parse(readFileSync(path,'utf8'));manifest.ipolloworkAccountOrigin=${JSON.stringify(accountOrigin)};writeFileSync(path,JSON.stringify(manifest,null,2));`)
  await run(process.execPath, ['--import', 'tsx/esm', 'prepare-project.mjs'], { cwd: stage })
  await writeFile(join(stage, 'source-build.json'), JSON.stringify({ fingerprint, accountOrigin, desktopVersion: JSON.parse(await readFile(join(root, 'integrations/desktop/package.json'), 'utf8')).version }))
  await writeFile(join(home, 'stage-path.txt'), stage)
  return stage
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log('Current desktop source ready: ' + await prepareLocalDesktop())
