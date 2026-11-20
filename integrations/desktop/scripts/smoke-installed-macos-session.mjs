/** Real signed-app sign-in and returning-profile acceptance, using dedicated synthetic QA accounts. */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createRequire } from 'node:module'

export async function verifyInstalledMacSessions(application, output, home) {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Live account acceptance is restricted to the release CI')
  // Recovery executes this driver beside the immutable source checkout and its installed dependencies.
  const { parse } = createRequire(join(process.cwd(), 'integrations/desktop/package.json'))('yaml')
  const profile = join(home, 'profiles', 'desktop')
  const manifestPath = join(profile, 'package.json')
  const suite = join(profile, 'node_modules', '@ipollo', 'dsh-suite')
  const currentVersion = JSON.parse(await readFile(new URL('../../../plugins/ipollowork-suite/package.json', import.meta.url), 'utf8')).version
  const legacyPatch = '# retained user settings\n- id: ipollowork-application\n  disabled: true\n- id: ipollowork-suite\n  disabled: true\n  config:\n    theme: false\n    account: false\n    accountOrigin: http://localhost:3400\n'
  await writeFile(join(profile, 'cordis.patch.yml'), legacyPatch)
  async function contaminate(version, legacyBundles) {
    await mkdir(suite, { recursive: true })
    await writeFile(join(suite, 'package.json'), JSON.stringify({ name: '@ipollo/dsh-suite', version, type: 'module', exports: './index.js' }))
    await writeFile(join(suite, 'index.js'), 'export const name="obsolete-ipollo-suite"; export function apply() {}\n')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies['@ipollo/dsh-suite'] = version
    if (legacyBundles) manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@ipollo/dsh-suite']
    await writeFile(manifestPath, JSON.stringify(manifest))
  }
  await contaminate('0.1.35', true)
  const email = `mac-release-qa-${process.arch}-${Date.now()}-${randomBytes(4).toString('hex')}@example.invalid`
  const password = randomBytes(24).toString('base64url')
  const registration = await fetch('https://cloud.ipollo.net/api/auth/sign-up/email', {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mac Installer QA', email, password }), signal: AbortSignal.timeout(30000),
  })
  assert.ok(registration.ok, `Synthetic account registration failed (HTTP ${registration.status})`)
  await registration.body?.cancel()

  let processHandle
  let spawnError
  let socket
  let port
  let logs = ''
  let stage = 'legacy-profile-start'
  let sequence = 0
  const environment = { ...process.env, DSH_HOME: home }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  async function start() {
    const server = createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
    await new Promise(resolve => server.close(resolve))
    processHandle = spawn(join(application, 'Contents/MacOS/iPollo'), [`--remote-debugging-port=${port}`], {
      env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    })
    processHandle.stdout.on('data', chunk => { logs += chunk })
    processHandle.stderr.on('data', chunk => { logs += chunk })
    processHandle.on('error', error => { spawnError = error })
  }
  async function stop() {
    socket?.close()
    socket = undefined
    const child = processHandle
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await Promise.race([exited, delay(3000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([exited, delay(2000)]) }
  }
  async function targets() {
    if (spawnError) throw spawnError
    assert.ok(processHandle && processHandle.exitCode === null && processHandle.signalCode === null, 'Installed app exited during account acceptance')
    return (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
  }
  async function waitFor(action, message, timeout = 120000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      try { const value = await action(); if (value) return value } catch (error) {
        if (spawnError || (processHandle && (processHandle.exitCode !== null || processHandle.signalCode !== null))) throw error
      }
      await delay(300)
    }
    throw new Error(message)
  }
  async function connect(target) {
    socket?.close()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Installed app debug connection timed out')), 10000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Installed app debug connection failed')) }
    })
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const connection = socket
    const id = ++sequence
    const timer = setTimeout(() => { connection.removeEventListener('message', receive); reject(new Error(`CDP timed out: ${method}`)) }, 10000)
    function receive(event) {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timer); connection.removeEventListener('message', receive)
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result)
    }
    connection.addEventListener('message', receive)
    connection.send(JSON.stringify({ id, method, params }))
  })
  async function evaluate(expression) { return (await command('Runtime.evaluate', { expression, returnByValue: true })).result.value }
  async function fill(selector, value) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).select()`)
    await command('Input.insertText', { text: value })
  }
  async function capture(name) {
    const image = await command('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(output, name), Buffer.from(image.data, 'base64'))
  }
  async function workspace() {
    const target = await waitFor(async () => {
      const pages = await targets()
      return !pages.some(page => /\/renderer\/welcome\.html/.test(page.url))
        && pages.find(page => page.type === 'page' && page.url.startsWith('dsh-app://app/'))
    }, 'Sign-in did not enter the desktop workspace')
    await connect(target)
    await waitFor(() => evaluate('document.body.hasAttribute("data-ipw-suite") && document.body.innerText.includes("iPolloWork")'),
      'The desktop entered the base DSH page without the iPolloWork interface')
    await waitFor(() => evaluate('document.body.innerText.includes("Mac Installer QA")'),
      'The persisted cloud account did not appear in the iPolloWork workspace')
  }
  try {
    await start()
    const welcome = await waitFor(async () => (await targets()).find(page => page.type === 'page' && /\/renderer\/welcome\.html/.test(page.url)), 'Legacy profile did not reach iPolloWork sign-in')
    await connect(welcome)
    await waitFor(() => evaluate('!!document.querySelector("#sign-in")'), 'Welcome controls did not load')
    await evaluate('document.querySelector("#sign-in").click()')
    await waitFor(() => evaluate('!!document.querySelector("#login-email")'), 'The account form did not open')
    stage = 'incorrect-password'
    await fill('#login-email', email)
    await fill('#login-password', 'intentionally-incorrect-password')
    await evaluate('document.querySelector("button[form=login-form][type=submit]").click()')
    await waitFor(() => evaluate('/Incorrect email or password|邮箱或密码不正确/.test(document.querySelector("#login-form [role=alert]")?.textContent || "")'),
      'Incorrect credentials did not produce the expected account rejection')
    for (const theme of ['light', 'dark']) {
      // Constrain below the fixed 600px welcome window to the desktop's 520px minimum width.
      await command('Emulation.setDeviceMetricsOverride', { width: 520, height: 720, deviceScaleFactor: 1, mobile: false })
      await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
      assert.ok(await evaluate('Array.from(document.querySelectorAll("button,input")).filter(node => node.offsetParent !== null).every(node => { const r=node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 })'), 'The native minimum-width sign-in controls overflowed')
      await capture(`installed-login-error-${theme}-narrow.png`)
    }
    await command('Emulation.clearDeviceMetricsOverride')
    await command('Emulation.setEmulatedMedia', { features: [] })
    stage = 'correct-password'
    await fill('#login-password', password)
    await evaluate('document.querySelector("button[form=login-form][type=submit]").click()')
    await workspace()
    await capture('installed-signed-in.png')
    const upgraded = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.ok(upgraded.dsh.profile.bundles.includes('@ipollo/desktop-host'))
    assert.ok(!upgraded.dsh.profile.bundles.includes('@ipollo/dsh-suite'))
    assert.ok(!upgraded.dependencies['@ipollo/dsh-suite'])
    await stop()
    stage = 'returning-signed-in-profile'
    await contaminate(currentVersion, false)
    await start()
    await workspace()
    await capture('installed-returning-workspace.png')
    const retainedPatch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8')
    assert.ok(retainedPatch.startsWith(legacyPatch), 'Existing user settings or comments were rewritten')
    const entries = parse(retainedPatch)
    assert.deepEqual(entries.slice(0, 2), parse(legacyPatch))
    // Native automatic model selection legitimately appends its own configuration after sign-in.
    assert.ok(entries.length <= 3 && entries.slice(2).every(entry => entry.id === 'agent-default-model'
      && entry.name === '@deepseek-ai/dsh-agent-default-model'
      && typeof entry.config?.provider === 'string' && typeof entry.config?.model === 'string'), 'Unexpected changes to profile settings')
    const backups = await readdir(join(profile, 'runtime-dependency-backups'))
    assert.ok(backups.length >= 3)
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' })
    await writeFile(join(output, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
      installedApplication: application, windowReady: true, coreRepair: 'complete', signature: 'verified', gatekeeper: 'accepted',
      incorrectPassword: 'classified', accountSignIn: 'verified', legacyProfileMigration: 'verified',
      returningSession: 'verified', applicationInterface: 'iPolloWork', sameVersionSuiteRepair: 'verified',
    }, null, 2) + '\n')
    console.log('Installed Mac sign-in, old-profile migration, and returning iPolloWork workspace verified')
  } catch (error) {
    if (socket?.readyState === WebSocket.OPEN) await capture('installed-account-failure.png').catch(() => undefined)
    await writeFile(join(output, 'account-failure.json'), JSON.stringify({ stage, message: error instanceof Error ? error.message : 'Account acceptance failed' }, null, 2) + '\n')
    throw error
  } finally {
    await stop()
    await writeFile(join(output, 'account-application.log'), logs.replace(/([?&]token=)[^\s"']+/g, '$1[redacted]'))
  }
}
