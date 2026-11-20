/** Launch the installed, unmodified Mac application with a contaminated private test profile. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(process.platform, 'darwin', 'Installed Mac verification requires macOS')
const app = resolve(process.argv[2])
const output = resolve(process.argv[3])
await mkdir(output, { recursive: true })
const home = await mkdtemp(join(tmpdir(), 'ipollo-installed-profile-'))
const profile = join(home, 'profiles', 'desktop')
const oldCore = join(profile, 'node_modules', '@deepseek-ai', 'dsh-llm')
await mkdir(oldCore, { recursive: true })
await writeFile(join(oldCore, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm', version: '0.2.0-rc.1', type: 'module', exports: './index.js' }))
await writeFile(join(oldCore, 'index.js'), 'throw new Error("obsolete profile core must not activate")\n')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const executable = join(app, 'Contents', 'MacOS', 'iPollo')
const environment = { ...process.env, DSH_HOME: home }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.NODE_OPTIONS
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app], { stdio: 'inherit' })
const child = spawn(executable, [`--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
let logs = ''
child.stdout.on('data', chunk => { logs += chunk })
child.stderr.on('data', chunk => { logs += chunk })
let spawnError
child.on('error', error => { spawnError = error })
let socket
try {
  const deadline = Date.now() + 120000
  let target
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Installed application exited before its window was ready')
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
      target = targets.find(item => item.type === 'page' && /\/renderer\/welcome\.html/.test(item.url))
      if (target) break
    } catch { /* The debug endpoint is unavailable while Electron starts. */ }
    await delay(500)
  }
  assert.ok(target, 'Installed application did not open its welcome window within 120 seconds')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Installed application debug connection timed out')), 10000)
    socket.onopen = () => { clearTimeout(timer); resolve() }
    socket.onerror = error => { clearTimeout(timer); reject(error) }
  })
  let nextId = 0
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error(`CDP timed out: ${method}`)) }, 10000)
    function receive(event) {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', receive)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    socket.addEventListener('message', receive)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const result = await command('Runtime.evaluate', {
    expression: '({ready:document.readyState,text:document.body.innerText,buttons:document.querySelectorAll("button").length})', returnByValue: true,
  })
  const view = result.result.value
  assert.equal(view.ready, 'complete')
  assert.ok(view.buttons > 0 && /iPollo/i.test(view.text), 'Welcome renderer is blank or missing its controls')
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(output, 'installed-welcome.png'), Buffer.from(screenshot.data, 'base64'))
  const backups = await readdir(join(profile, 'runtime-dependency-backups'))
  assert.equal(backups.length, 1, 'Legacy core dependency was not backed up')
  const repair = JSON.parse(await readFile(join(profile, 'runtime-dependency-backups', backups[0], 'repair.json'), 'utf8'))
  assert.equal(repair.status, 'complete')
  assert.ok(repair.moved.includes('@deepseek-ai/dsh-llm'))
  await writeFile(join(output, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
    installedApplication: app, windowReady: true, coreRepair: repair.status, signature: 'verified', gatekeeper: 'accepted' }, null, 2) + '\n')
  console.log('Installed Mac application opened with legacy core dependencies repaired')
} finally {
  socket?.close()
  socket?.close()
  child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await writeFile(join(output, 'application.log'), logs)
}
