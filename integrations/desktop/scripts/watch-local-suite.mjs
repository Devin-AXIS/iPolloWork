/** Rebuild the linked Work bundle; DSH owns the Host and browser reloads. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, watch } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '../../..')
const suite = join(repo, 'plugins/ipollowork-suite')
const [action, argument, pidFile] = process.argv.slice(2)
const startBuild = () => spawn(process.execPath, ['scripts/build.mjs'], { cwd: suite, stdio: 'inherit', windowsHide: true })

if (action === 'configure') {
  const { load } = createRequire(join(suite, 'package.json'))('js-yaml')
  const filename = resolve(argument)
  const content = readFileSync(filename, 'utf8')
  const config = load(content)
  if (config != null && !Array.isArray(config)) throw new Error('The development profile patch must be a YAML list.')
  const base = pathToFileURL(suite + sep).href
  const begin = '# BEGIN iPolloWork local development reload'
  const end = '# END iPolloWork local development reload'
  const start = content.indexOf(begin)
  const stop = content.indexOf(end)
  if ((start < 0) !== (stop < 0) || (start >= 0 && stop < start)) throw new Error('The local reload block is incomplete.')
  const prior = start < 0 ? content : content.slice(0, start) + content.slice(stop + end.length).replace(/^\r?\n/, '')
  const old = load(prior)
  if (Array.isArray(old) && old.some(item => item?.id === 'hmr')) throw new Error('The development profile already configures hmr; merge the Work lib directory into that entry.')
  // Keep the profile's existing text and comments. An empty inline list must become block YAML.
  const prefix = prior.replace(/^\s*\[\][ \t]*\r?$/m, '').trimEnd()
  const next = `${prefix ? prefix + '\n\n' : ''}${begin}\n- id: hmr\n  disabled: false\n  config:\n    base: ${JSON.stringify(base)}\n    root: ["lib/host"]\n    debounce: 700\n    awaitWriteFinish: true\n${end}\n`
  load(next)
  if (next !== content) writeFileSync(filename, next)
} else if (action === 'build') {
  const child = startBuild()
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', code => { process.exitCode = code ?? 1 })
} else if (action === 'watch' && /^\d+$/.test(argument ?? '') && pidFile) {
  const mainPid = Number(argument)
  let builder, handoff
  let dirty = false
  let stopped = false
  const watchers = []
  const stillRunning = () => {
    try {
      if (Number(readFileSync(pidFile, 'utf8').trim()) !== mainPid) return false
      process.kill(mainPid, 0)
      return true
    } catch { return false }
  }
  const schedule = () => {
    dirty = true
    clearTimeout(handoff)
    handoff = setTimeout(rebuild, 450)
  }
  const rebuild = () => {
    if (!dirty || builder || stopped || !stillRunning()) return
    dirty = false
    console.log('iPolloWork: source saved; rebuilding the Work bundle')
    const task = builder = startBuild()
    task.once('error', error => { console.error(error.message); finish() })
    task.once('exit', code => {
      if (code === 0) console.log('iPolloWork: build ready for native DSH HMR; verify changed Host endpoints before claiming they reloaded (restart the development app if needed)')
      else console.error('iPolloWork: build failed; save a correction to rebuild')
      finish()
    })
    function finish() { if (builder === task) builder = undefined; if (dirty && !stopped) schedule() }
  }
  const attach = (directory, filter, recursive = false) => {
    const watcher = watch(directory, { recursive }, (_event, filename) => {
      if (filename && filter(filename.replaceAll('\\', '/'))) schedule()
    })
    watcher.on('error', error => { console.error(error.message); stop() })
    watchers.push(watcher)
  }
  const code = path => /\.(?:[cm]?[jt]sx?|css|json|svg|webp)$/.test(path)
  attach(join(suite, 'src'), code, true)
  attach(join(suite, 'locale'), code, true)
  attach(join(suite, 'scripts'), path => path === 'build.mjs')
  attach(suite, path => path === 'package.json')
  const heartbeat = setInterval(() => { if (!stillRunning()) stop() }, 1500)
  function stop() {
    stopped = true
    clearInterval(heartbeat)
    clearTimeout(handoff)
    for (const watcher of watchers) watcher.close()
    builder?.kill()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log(`iPolloWork: waiting for local source changes (desktop ${mainPid})`)
} else {
  throw new Error('Usage: watch-local-suite.mjs configure <profile-patch> | build | watch <electron-pid> <pid-file>')
}
