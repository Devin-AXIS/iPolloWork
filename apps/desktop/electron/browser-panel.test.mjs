import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      assert.match(result.stdout, /web-login-no-client-launch-passed/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
} else {
  // Let Electron finish loading the entry module before waiting for app readiness.
  void (async () => {
  const { app, BrowserWindow, webContents, shell } = await import("electron");
  const { createBrowserPanel } = await import("./browser-panel.mjs");
  app.setPath("userData", process.env.IPOLLOWORK_BROWSER_TEST_DATA);
  await app.whenReady();
  const server = createServer((_request, response) => {
    if (_request.url === '/login-with-cookie') {
      response.setHeader('Set-Cookie', 'sessionid=scanned-session; Path=/; HttpOnly; SameSite=Lax');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Scanned login</title><p>扫码确认完成，正在刷新</p>');
      return;
    }
    if (_request.url === '/platform/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Creator dashboard</title><h1>视频号助手后台</h1>');
      return;
    }
    if (_request.url === '/comment-editor') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Lazy comment editor</title>' + '<p>推荐内容</p>'.repeat(270) + '<div id="entry" onclick="this.outerHTML=\'<div contenteditable=true data-placeholder=评论内容></div>\'"><span>留下你的精彩评论吧</span></div><button onclick="window.submitted=true">发送</button><article><strong>原作者</strong><p>原评论内容</p><div><div><div><div><span onclick="window.replyTarget=\'原作者\'">回复</span></div></div></div></div></article>');
      return;
    }
    if (_request.url === '/app-redirect') {
      response.writeHead(302, { Location: 'snssdk1128://login' });
      response.end();
      return;
    }
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
    const externalCalls = [];
    const openExternal = shell.openExternal;
    shell.openExternal = async target => { externalCalls.push(target); };
    try {
      const login = await call('openUrl', url, { profileId: 'douyin-ops:web-login-test' });
      const loginView = contents();
      assert.equal(loginView.isAudioMuted(), true);
      const blocked = [];
      loginView.on('will-frame-navigate', event => {
        if (event.defaultPrevented) blocked.push(event.url);
      });
      loginView.on('will-redirect', (event, target) => {
        if (event.defaultPrevented) blocked.push(target);
      });
      for (const scheme of ['snssdk1128://login', 'douyin://login']) {
        await loginView.executeJavaScript(`window.open(${JSON.stringify(scheme)}); null`, true);
        await loginView.executeJavaScript(`location.href=${JSON.stringify(scheme)}; null`, true);
        await loginView.executeJavaScript(`{ const f=document.createElement('iframe'); f.src=${JSON.stringify(scheme)}; document.body.append(f); } null`, true);
      }
      await loginView.executeJavaScript(`location.href=${JSON.stringify(new URL('/app-redirect', url).href)}; null`, true);
      const deadline = Date.now() + 5000;
      while (blocked.length < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(blocked.length, 5, JSON.stringify(blocked));
      assert.deepEqual(externalCalls, []);
      assert.equal(loginView.getURL(), url);
      await loginView.executeJavaScript(`document.querySelector('#qr').click(); window.open(${JSON.stringify(new URL('/web-login', url).href)}); null`, true);
      const until = Date.now() + 5000;
      while (!(await call('state')).tabs.some(tab => tab.url.endsWith('/web-login')) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
      const popup = (await call('state')).tabs.find(tab => tab.url.endsWith('/web-login'));
      assert.equal(popup?.profileId, 'douyin-ops:web-login-test');
      const popupView = webContents.getAllWebContents().find(item => item.getURL().endsWith('/web-login'));
      assert.equal(popupView.isAudioMuted(), true);
      assert.equal(await loginView.executeJavaScript("document.querySelector('p').textContent"), '扫码登录');
      assert.deepEqual(externalCalls, []);
      await call('closeTab', popup.id);
      if (process.env.IPOLLOWORK_BROWSER_TEST_PROOF_FILE) {
        await window.loadURL('about:blank');
        window.showInactive();
        await call('selectTab', login.tabId);
        await call('show', { x: 0, y: 0, width: 800, height: 600 });
        await new Promise(resolve => setTimeout(resolve, 150));
        loginView.debugger.attach('1.3');
        const image = await loginView.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        loginView.debugger.detach();
        assert.ok(image.data);
        await writeFile(process.env.IPOLLOWORK_BROWSER_TEST_PROOF_FILE, Buffer.from(image.data, 'base64'));
      }
      await call('closeTab', login.tabId);
      process.stdout.write('web-login-no-client-launch-passed\n');
    } finally { shell.openExternal = openExternal; }
    const editor = await call('openUrl', new URL('/comment-editor', url).href, { profileId: 'douyin-ops:editor-test' });
    await call('show', { x: 0, y: 0, width: 800, height: 600 });
    const editorView = webContents.getAllWebContents().find(item => item.getURL().endsWith('/comment-editor'));
    const entry = await call('snapshot', { tabId: editor.tabId });
    const entryRef = entry.tree.split('\n').find(line => line.includes('button "留下你的精彩评论吧"'))?.match(/\[(@e\d+)\]/)?.[1];
    assert.ok(entryRef, 'Lazy input remains actionable after long content, even below the fold');
    assert.match(entry.tree, /button "回复" context="[^"\n]*原作者[^"\n]*原评论内容/, 'Reply carries original author and text through nested wrappers');
    await call('act', { tabId: editor.tabId, snapshotId: entry.snapshotId, actions: [{ type: 'click', ref: entryRef, expectedName: '留下你的精彩评论吧' }] });
    const expanded = await call('snapshot', { tabId: editor.tabId });
    const editRef = expanded.tree.split('\n').find(line => line.includes('textbox "评论内容"'))?.match(/\[(@e\d+)\]/)?.[1];
    assert.ok(editRef, 'Expanded input can be addressed');
    await call('act', { tabId: editor.tabId, snapshotId: expanded.snapshotId, actions: [{ type: 'fill', ref: editRef, value: '测试评论，不发送' }] });
    assert.equal(await editorView.executeJavaScript("document.querySelector('[contenteditable]').textContent"), '测试评论，不发送');
    await call('act', { tabId: editor.tabId, snapshotId: expanded.snapshotId, actions: [{ type: 'fill', ref: editRef, value: '' }] });
    assert.equal(await editorView.executeJavaScript("document.querySelector('[contenteditable]').textContent"), '');
    assert.equal(await editorView.executeJavaScript('Boolean(window.submitted)'), false);
    await editorView.executeJavaScript(`{ const field = document.querySelector('[contenteditable]'); field.removeAttribute('aria-label'); field.setAttribute('role', 'combobox'); field.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();window.submitted=field.textContent}}; } null`);
    const unlabeled = await call('snapshot', { tabId: editor.tabId });
    const unlabeledRef = unlabeled.tree.split('\n').find(line => line.includes('combobox'))?.match(/\[(@e\d+)\]/)?.[1];
    await call('act', { tabId: editor.tabId, snapshotId: unlabeled.snapshotId, actions: [{ type: 'fill', ref: unlabeledRef, value: '本地模拟发送' }, { type: 'press', key: 'Enter', ref: unlabeledRef, expectedName: 'Unnamed combobox' }] });
    assert.equal(await editorView.executeJavaScript('window.submitted'), '本地模拟发送');
    await editorView.executeJavaScript(`{ const field = document.querySelector('[contenteditable]'); field.style.height='0px'; field.style.overflow='hidden'; const reply=document.createElement('div'); reply.contentEditable='true'; reply.setAttribute('role','textbox'); reply.setAttribute('aria-label','回复内容'); reply.textContent=' '; document.body.append(reply); } null`);
    const replying = await call('snapshot', { tabId: editor.tabId });
    assert.doesNotMatch(replying.tree, /combobox "Unnamed combobox"/, 'Collapsed original input does not shadow inline reply');
    assert.match(replying.tree, /textbox "回复内容"/);
    await call('closeTab', editor.tabId);
    const shared = await call("openUrl", url);
    const sharedView = contents();
    assert.ok(sharedView, JSON.stringify({ url, tabs: await call("state"), contents: webContents.getAllWebContents().map(item => ({ id: item.id, url: item.getURL() })) }));
    await sharedView.executeJavaScript("document.cookie='login=old'; localStorage.setItem('account','old')");
    const first = await call("openUrl", url, { profileId: "plugin:account-a", loginUi: { origin: new URL(url).origin, path: "/login", whenText: "短信登录", selector: "#qr" } });
    const firstView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item.getURL() === url);
    assert.deepEqual(await firstView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["", null]);
    assert.equal(await firstView.executeJavaScript("document.querySelector('p').textContent"), "扫码登录");
    assert.deepEqual(await firstView.executeJavaScript("[innerWidth,innerHeight]"), [1280, 900]);
    await call('show', { x: 0, y: 0, width: 800, height: 600 });
    const avatar = await call('snapshot', { tabId: first.tabId, imageSelector: 'img.avatar' });
    assert.equal(avatar.imageUrl, new URL('/avatar.svg', url).href);
    assert.match(avatar.tree, /扫码登录/);
    const compactRead = await call('read', { tabId: first.tabId, mode: 'page', maxChars: 4000 });
    assert.match(compactRead.content, /短信登录|扫码登录/);
    assert.match(compactRead.content, /标题/);
    const annotated = await call('screenshot', {
      tabId: first.tabId,
      snapshotId: avatar.snapshotId,
      target: 'viewport',
      mode: 'annotated',
    });
    assert.equal((await readFile(annotated.imagePath)).subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(annotated.metrics.annotations > 0);
    const fieldRef = name => avatar.tree.split('\n').find(line => line.includes(`textbox "${name}"`))?.match(/\[(@e\d+)\]/)?.[1];
    await call('act', { tabId: first.tabId, snapshotId: avatar.snapshotId, actions: [
      { type: 'fill', ref: fieldRef('标题'), value: '真实填写标题' },
      { type: 'fill', ref: fieldRef('正文'), value: '真实填写正文。' },
    ] });
    assert.deepEqual(await firstView.executeJavaScript("[document.querySelector('#title').value,document.querySelector('#body').value]"), ['真实填写标题', '真实填写正文。']);
    await firstView.executeJavaScript("window.activations=0; document.querySelector('#qr').onclick=()=>{window.activations++}; null");
    let activations = 0;
    for (const action of [{ type: 'press', key: 'Enter' }, { type: 'click' }]) {
      const before = await call('snapshot', { tabId: first.tabId });
      const ref = before.tree.split('\n').find(line => line.includes('button "显示二维码"'))?.match(/\[(@e\d+)\]/)?.[1];
      await call('act', { tabId: first.tabId, snapshotId: before.snapshotId, actions: [{ ...action, ref, expectedName: '显示二维码' }] });
      assert.equal(await firstView.executeJavaScript('window.activations'), ++activations, action.type);
    }
    assert.equal(await firstView.executeJavaScript('window.activations'), 2);
    for (const imageSelector of ['#hidden-avatar', 'img', '#qr', '.missing']) {
      assert.equal((await call('snapshot', { tabId: first.tabId, imageSelector })).imageUrl, null);
    }
    await assert.rejects(call('snapshot', { tabId: first.tabId, imageSelector: 'x'.repeat(201) }), /selector is invalid/);
    assert.equal(await sharedView.executeJavaScript("document.querySelector('p').textContent"), "短信登录");
    assert.equal((await call("openUrl", url, { profileId: "plugin:account-a" })).tabId, first.tabId);
    await firstView.executeJavaScript("document.cookie='login=a'; localStorage.setItem('account','a')");
    const concurrent = await call("openUrl", url, { profileId: "plugin:account-a", taskId: "session-2" });
    assert.notEqual(concurrent.tabId, first.tabId);
    const concurrentView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item !== firstView && item.getURL() === url);
    assert.deepEqual(await concurrentView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=a", "a"]);
    assert.equal((await call("openUrl", url, { profileId: "plugin:account-a", taskId: "session-2" })).tabId, concurrent.tabId);
    await call("closeTab", concurrent.tabId);
    const second = await call("openUrl", url, { profileId: "plugin:account-b" });
    const secondView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item !== firstView && item.getURL() === url);
    const browserUserAgent = await secondView.executeJavaScript("navigator.userAgent");
    assert.match(browserUserAgent, /Chrome\//);
    assert.doesNotMatch(browserUserAgent, /Electron|iPollo/i);
    assert.deepEqual(await secondView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["", null]);
    assert.deepEqual(await sharedView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=old", "old"]);
    assert.equal((await call("state")).tabs.find(tab => tab.id === second.tabId).profileId, "plugin:account-b");
    const recoveryOrigin = new URL(url).origin;
    const recovered = await call("openUrl", new URL('/login-with-cookie', url).href, {
      profileId: "wechat-channels-ops:session-recovery-test",
      sessionRecovery: {
        origin: recoveryOrigin,
        loginPath: "/login-with-cookie",
        authenticatedPath: "/platform/",
        cookieNames: ["sessionid"],
      },
    });
    const recoveredView = webContents.getAllWebContents().find(item => item.getURL() === new URL('/platform/', url).href);
    assert.equal(recovered.url, new URL('/platform/', url).href);
    assert.ok(recoveredView);
    assert.equal(await recoveredView.executeJavaScript("document.body.innerText"), "视频号助手后台");
    await call("closeTab", recovered.tabId);
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
    await assert.rejects(call("openUrl", url, { profileId: "plugin:account-a", taskId: "../shared" }), /Invalid browser task/);
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
