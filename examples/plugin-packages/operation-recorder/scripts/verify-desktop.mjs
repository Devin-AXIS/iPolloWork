import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listTargets } from '../../../../evals/runner/cdp.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(pluginRoot, '../../..');
const hostRoot = resolve(process.env.IPOLLOWORK_PLUGIN_HOST_ROOT || repository);
const require = createRequire(join(hostRoot, 'apps/desktop/package.json'));
const electron = require('electron');
const directory = await mkdtemp(join(tmpdir(), 'ipollowork-node-recorder-proof-'));
const { default: createService } = await import('../dist/package/service/recorder.js');
const manifest = JSON.parse(await readFile(join(pluginRoot, 'ipollowork.plugin.json'), 'utf8'));
const service = await createService({ plugin: { id: manifest.id, version: manifest.package.version }, storage: { dataDir: join(directory, 'data') }, workspace: { root: directory } });
let app;
try {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Cannot allocate a validation CDP port.');
  const port = address.port;
  await new Promise(resolve => probe.close(resolve));
  const { url } = await service.actions['open-workbench']({});
  const mainFile = join(directory, 'desktop.cjs');
  const preloadFile = join(directory, 'preload.cjs');
  await writeFile(preloadFile, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('recorderProof', { focus: () => ipcRenderer.invoke('recorder-proof-focus') });`);
  // An isolated real Electron renderer supplies native accessibility controls.
  // It never opens the user's browser profile or workspaces.
  await writeFile(mainFile, `
const { app, BrowserWindow, ipcMain } = require('electron');
app.commandLine.appendSwitch('force-renderer-accessibility');
app.commandLine.appendSwitch('remote-debugging-port', process.env.RECORDER_PROOF_CDP_PORT);
app.whenReady().then(async () => {
  const workbench = new BrowserWindow({ width: 780, height: 850, x: 100, y: 50 });
  await workbench.loadURL(process.env.RECORDER_PROOF_WORKBENCH_URL);
  const fixture = new BrowserWindow({ width: 1000, height: 720, x: 0, y: 0, frame: false, webPreferences: { preload: ${JSON.stringify(preloadFile)} } });
  ipcMain.handle('recorder-proof-focus', event => { if (event.sender !== fixture.webContents) throw new Error('Unknown validation renderer'); fixture.setAlwaysOnTop(true); app.focus({ steal: true }); fixture.show(); fixture.focus(); return fixture.isFocused(); });
  await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>项目列表 · Node.js 录制验证</title>' +
    '<style>body{font:18px system-ui;margin:40px;background:#f5f7fb}header{display:flex;justify-content:space-between;align-items:center}button{font:inherit;background:#244fd0;color:white;border:0;border-radius:8px;padding:14px 22px}section{background:white;border-radius:12px;padding:28px;margin-top:30px}input{font:inherit;padding:12px;margin:15px 20px}#editor[hidden]{display:none}</style>' +
    '<header><h1>项目列表</h1><div role="toolbar" aria-label="项目操作"><button id="create">新建项目</button></div></header>' +
    '<section id="editor" role="dialog" aria-label="新建项目" hidden><h2>新建项目</h2><label for="name">项目名称</label><input id="name" aria-label="项目名称"><button id="save">保存项目</button></section>' +
    '<section><p id="saved" role="status">暂无项目</p></section>' +
    '<script>document.getElementById("create").onclick=()=>{document.getElementById("editor").hidden=false;document.getElementById("name").focus()};document.getElementById("save").onclick=()=>{document.getElementById("saved").textContent="项目已保存"}</script></html>'
  ));
});
app.on('window-all-closed', () => app.quit());
`);
  app = spawn(electron, [mainFile], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, RECORDER_PROOF_WORKBENCH_URL: url, RECORDER_PROOF_CDP_PORT: String(port) } });
  let startupError = '';
  app.stderr.on('data', bytes => { startupError = bytes.toString().slice(-1000); });
  app.once('error', error => { startupError = error.message; });
  const cdp = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline && app.exitCode === null) {
    try { const targets = await listTargets(cdp); if (targets.some(target => target.title === '项目列表 · Node.js 录制验证') && targets.some(target => target.title === '操作录制 · iPolloWork')) { ready = true; break; } }
    catch { /* Only poll this owned process until its bounded startup deadline. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Validation renderer did not start: ${startupError}`);
  const flows = join(directory, 'flows');
  await mkdir(flows);
  await writeFile(join(flows, 'operation-recorder-nodejs.flow.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(join(repository, 'evals/flows/operation-recorder-nodejs.flow.mjs')).href)};\n`);
  const result = await new Promise((resolveRun, reject) => {
    const runner = spawn(process.execPath, [join(repository, 'evals/runner/run.mjs'), '--flow', 'operation-recorder-nodejs', '--cdp-url', cdp], { cwd: repository, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, IPOLLOWORK_EVAL_FLOWS_DIR: flows } });
    runner.once('error', reject); runner.once('exit', code => resolveRun(code));
  });
  await mkdir(join(pluginRoot, 'dist/verification'), { recursive: true });
  const recordings = await service.actions.status({});
  await writeFile(join(pluginRoot, 'dist/verification/desktop-recording.json'), JSON.stringify(recordings, null, 2));
  process.exitCode = result;
} finally {
  await service.dispose();
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise(resolve => { const timer = setTimeout(resolve, 2000); app.once('close', () => { clearTimeout(timer); resolve(); }); });
  }
  await rm(directory, { recursive: true, force: true });
}
