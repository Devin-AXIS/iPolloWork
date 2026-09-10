import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (!process.versions.electron) {
  const { default: test } = await import("node:test");
  test("real browser profiles isolate cookies and storage, retain logins and reuse login tabs", { timeout: 45_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ipollowork-browser-test-"));
    try {
      const { default: electron } = await import("electron");
      const env = { ...process.env, IPOLLOWORK_BROWSER_TEST_DATA: directory, ELECTRON_RUN_AS_NODE: undefined };
      const result = await promisify(execFile)(String(electron), [fileURLToPath(import.meta.url)], { env, windowsHide: true, timeout: 40_000 });
      assert.match(result.stdout, /browser-profile-checks-passed/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
} else {
  // Let Electron finish loading the entry module before waiting for app readiness.
  void (async () => {
  const { app, BrowserWindow, webContents } = await import("electron");
  const { createBrowserPanel } = await import("./browser-panel.mjs");
  app.setPath("userData", process.env.IPOLLOWORK_BROWSER_TEST_DATA);
  await app.whenReady();
  const server = createServer((_request, response) => {
    if (_request.url === '/avatar.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>');
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><title>Account login</title><img class="avatar" src="/avatar.svg" width="64" height="64"><img id="hidden-avatar" src="/avatar.svg" style="display:none"><p>短信登录</p><button id="qr">显示二维码</button><label>标题<input id="title" value="Previous title"></label><label>正文<textarea id="body">Previous body</textarea></label><script>document.querySelector("#qr").onclick=()=>{document.querySelector("p").textContent="扫码登录"}</script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/login`;
  const window = new BrowserWindow({ show: false });
  const panel = createBrowserPanel({ getWindow: () => window, onDeepLink() {}, listLocalWorkspaces: () => [] });
  const handlers = new Map();
  panel.registerIpc({ handle: (name, fn) => handlers.set(name, fn), on() {} });
  const call = (method, ...args) => handlers.get(`ipollowork:browser:${method}`)(null, ...args);
  const contents = () => webContents.getAllWebContents().find(item => item !== window.webContents && item.getURL() === url && !item.isDestroyed());
  try {
    const shared = await call("openUrl", url);
    const sharedView = contents();
    assert.ok(sharedView, JSON.stringify({ url, tabs: await call("state"), contents: webContents.getAllWebContents().map(item => ({ id: item.id, url: item.getURL() })) }));
    await sharedView.executeJavaScript("document.cookie='login=old'; localStorage.setItem('account','old')");
    const first = await call("openUrl", url, { profileId: "plugin:account-a", loginUi: { origin: new URL(url).origin, path: "/login", whenText: "短信登录", selector: "#qr" } });
    const firstView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item.getURL() === url);
    assert.deepEqual(await firstView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["", null]);
    assert.equal(await firstView.executeJavaScript("document.querySelector('p').textContent"), "扫码登录");
    await call('show', { x: 0, y: 0, width: 800, height: 600 });
    const avatar = await call('snapshot', { tabId: first.tabId, imageSelector: 'img.avatar' });
    assert.equal(avatar.imageUrl, new URL('/avatar.svg', url).href);
    assert.match(avatar.tree, /扫码登录/);
    const fieldRef = name => avatar.tree.split('\n').find(line => line.includes(`textbox "${name}"`))?.match(/\[(@e\d+)\]/)?.[1];
    await call('act', { tabId: first.tabId, snapshotId: avatar.snapshotId, actions: [
      { type: 'fill', ref: fieldRef('标题'), value: '真实填写标题' },
      { type: 'fill', ref: fieldRef('正文'), value: '真实填写正文。' },
    ] });
    assert.deepEqual(await firstView.executeJavaScript("[document.querySelector('#title').value,document.querySelector('#body').value]"), ['真实填写标题', '真实填写正文。']);
    for (const imageSelector of ['#hidden-avatar', 'img', '#qr', '.missing']) {
      assert.equal((await call('snapshot', { tabId: first.tabId, imageSelector })).imageUrl, null);
    }
    await assert.rejects(call('snapshot', { tabId: first.tabId, imageSelector: 'x'.repeat(201) }), /selector is invalid/);
    assert.equal(await sharedView.executeJavaScript("document.querySelector('p').textContent"), "短信登录");
    assert.equal((await call("openUrl", url, { profileId: "plugin:account-a" })).tabId, first.tabId);
    await firstView.executeJavaScript("document.cookie='login=a'; localStorage.setItem('account','a')");
    const second = await call("openUrl", url, { profileId: "plugin:account-b" });
    const secondView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item !== firstView && item.getURL() === url);
    assert.deepEqual(await secondView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["", null]);
    assert.deepEqual(await sharedView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=old", "old"]);
    assert.equal((await call("state")).tabs.find(tab => tab.id === second.tabId).profileId, "plugin:account-b");
    await call("closeTab", first.tabId);
    const reopened = await call("openUrl", url, { profileId: "plugin:account-a" });
    assert.notEqual(reopened.tabId, first.tabId);
    const reopenedView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item !== secondView && item.getURL() === url);
    assert.deepEqual(await reopenedView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=a", "a"]);
    const postUrl = new URL('/note/test-post', url).href;
    const openedPost = await call('openUrl', postUrl, { profileId: 'plugin:account-a' });
    assert.equal(openedPost.tabId, reopened.tabId);
    assert.equal(openedPost.url, postUrl);
    assert.equal(reopenedView.getURL(), postUrl);
    assert.deepEqual(await reopenedView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=a", "a"]);
    const loginReopen = await call('openUrl', url, { profileId: 'plugin:account-a', loginUi: { origin: new URL(url).origin, path: '/login', whenText: '短信登录', selector: '#qr' } });
    assert.equal(loginReopen.tabId, reopened.tabId);
    assert.equal(loginReopen.url, postUrl);
    window.minimize();
    assert.equal(window.isMinimized(), true);
    await call('openUrl', postUrl, { profileId: 'plugin:account-a' });
    assert.equal(window.isMinimized(), false);
    await assert.rejects(call("openUrl", url, { profileId: "../shared" }), /Invalid browser profile/);
    assert.equal((await call("state")).tabs.some(tab => tab.id === shared.tabId), true);
    process.stdout.write("browser-profile-checks-passed\n");
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    panel.destroy();
    window.destroy();
    server.close();
    app.exit(Number(process.exitCode) || 0);
  }
  })().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
}
