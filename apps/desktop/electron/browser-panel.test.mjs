import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (!process.versions.electron) {
  const { default: test } = await import("node:test");
  test("real browser profiles isolate cookies and storage, retain logins and reuse login tabs", { timeout: 45_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ipollowork-browser-test-"));
    try {
      const appRequire = createRequire(new URL("../../app/package.json", import.meta.url));
      const sidePanel = await readFile(new URL("../../app/src/react-app/domains/session/panel/side-panel.tsx", import.meta.url), "utf8");
      const videoBranch = sidePanel.match(/<VideoPanel\b[\s\S]*?\/>/)?.[0];
      assert.ok(videoBranch, "The fixture must exercise the actual VideoPanel render branch");
      const fixturePath = path.join(directory, "video-panel.tsx");
      await writeFile(fixturePath, `
import React from ${JSON.stringify(appRequire.resolve("react"))};
import { createRoot } from ${JSON.stringify(appRequire.resolve("react-dom/client"))};
import { flushSync } from ${JSON.stringify(appRequire.resolve("react-dom"))};
const host = document.createElement("section"); document.body.append(host);
const root = createRoot(host), events = []; let serial = 0, edit;
function VideoPanel({sessionId}) {
  const [instance] = React.useState(() => ++serial);
  const [scriptSettingsRequest, setScriptSettingsRequest] = React.useState(null);
  const [studioHostPanel, setStudioHostPanel] = React.useState(null);
  const pendingStudioDesignTokensRef = React.useRef(null);
  React.useEffect(() => { events.push(["mount", instance]); return () => events.push(["unmount", instance]); }, [instance]);
  edit = () => { setScriptSettingsRequest({projectId: sessionId}); setStudioHostPanel("style"); pendingStudioDesignTokensRef.current = {"--ipw-accent": "red"}; };
  return React.createElement("output", null, JSON.stringify({instance, scriptSettingsRequest, studioHostPanel, pendingTokens: pendingStudioDesignTokensRef.current}));
}
const state = () => JSON.parse(host.querySelector("output").textContent);
window.__videoPanelTest = {
  events,
  render({activeTab, workspaceId, workspaceRoot, theme = "light", expanded = false}) {
    const sessionId = "conversation", client = null, isRemoteWorkspace = false, aiEditing = false;
    const onSendWorkspaceAppMessage = undefined, onExpandedChange = undefined, onAskAi = undefined;
    const onRegenerateVideoFromStoryboard = undefined, onSaveAsTemplate = undefined;
    document.documentElement.dataset.theme = theme;
    flushSync(() => root.render(${videoBranch})); return state();
  },
  dirty() { flushSync(edit); return state(); },
  dispose() { root.unmount(); host.remove(); },
};
`);
      await promisify(execFile)("bun", ["build", fixturePath, "--target=browser", "--format=iife", "--jsx-runtime=classic", "--outfile", path.join(directory, "video-panel.js")], { timeout: 10_000, windowsHide: true });
      const { default: electron } = await import("electron");
      const env = { ...process.env, IPOLLOWORK_BROWSER_TEST_DATA: directory, ELECTRON_RUN_AS_NODE: undefined };
      const result = await promisify(execFile)(String(electron), [fileURLToPath(import.meta.url)], { env, windowsHide: true, timeout: 40_000, killSignal: "SIGKILL" });
      assert.match(result.stdout, /browser-profile-checks-passed/);
      assert.match(result.stdout, /web-login-no-client-launch-passed/);
      assert.match(result.stdout, /background-control-and-verification-passed/);
      assert.match(result.stdout, /video-panel-project-isolation-passed/);
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
    if (_request.url === '/delayed-redirect') {
      response.writeHead(302, { Location: '/delayed-page' });
      response.end();
      return;
    }
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
  await window.loadURL("about:blank");
  const panel = createBrowserPanel({ getWindow: () => window, onDeepLink() {}, listLocalWorkspaces: () => [] });
  const handlers = new Map();
  panel.registerIpc({ handle: (name, fn) => handlers.set(name, fn), on() {} });
  const call = (method, ...args) => handlers.get(`ipollowork:browser:${method}`)(null, ...args);
  const contents = () => webContents.getAllWebContents().find(item => item !== window.webContents && item.getURL() === url && !item.isDestroyed());
  try {
    await window.webContents.executeJavaScript(await readFile(path.join(process.env.IPOLLOWORK_BROWSER_TEST_DATA, "video-panel.js"), "utf8"));
    const renderVideo = (scope) => window.webContents.executeJavaScript(`window.__videoPanelTest.render(${JSON.stringify(scope)})`);
    const dirtyVideo = () => window.webContents.executeJavaScript("window.__videoPanelTest.dirty()");
    const videoScope = { workspaceId: "ws_a", workspaceRoot: "/workspace/a", activeTab: { id: "video:project-a", sessionId: "project-a", label: "A" } };
    const firstVideo = await renderVideo(videoScope);
    const editedVideo = await dirtyVideo();
    assert.deepEqual(editedVideo.scriptSettingsRequest, { projectId: "project-a" });
    assert.equal(editedVideo.studioHostPanel, "style");
    assert.deepEqual(editedVideo.pendingTokens, { "--ipw-accent": "red" });
    assert.deepEqual(await renderVideo({ ...videoScope, theme: "dark", expanded: true, activeTab: { ...videoScope.activeTab, view: "storyboard" } }), editedVideo,
      "Same-project view and theme changes preserve its mounted state");
    const projectScope = { ...videoScope, activeTab: { id: "video:project-b", sessionId: "project-b", label: "B" } };
    const projectVideo = await renderVideo(projectScope);
    assert.deepEqual(projectVideo, { instance: firstVideo.instance + 1, scriptSettingsRequest: null, studioHostPanel: null, pendingTokens: null });
    await dirtyVideo();
    const workspaceScope = { ...projectScope, workspaceId: "ws_b" };
    const workspaceVideo = await renderVideo(workspaceScope);
    assert.deepEqual(workspaceVideo, { ...projectVideo, instance: projectVideo.instance + 1 });
    await dirtyVideo();
    assert.deepEqual(await renderVideo({ ...workspaceScope, workspaceRoot: "/workspace/b" }), { ...workspaceVideo, instance: workspaceVideo.instance + 1 });
    await window.webContents.executeJavaScript("window.__videoPanelTest.dispose()");
    assert.deepEqual(await window.webContents.executeJavaScript("window.__videoPanelTest.events"), [
      ["mount", 1], ["unmount", 1], ["mount", 2], ["unmount", 2], ["mount", 3], ["unmount", 3], ["mount", 4], ["unmount", 4],
    ]);
    await window.webContents.executeJavaScript("delete window.__videoPanelTest");
    process.stdout.write("video-panel-project-isolation-passed\n");
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
    // A visible panel needs a mapped host window; Linux collapses child layout
    // while this fixture's initially hidden BrowserWindow remains unmapped.
    if (!window.isVisible()) {
      const shown = once(window, "show", { signal: AbortSignal.timeout(5000) });
      window.showInactive();
      await shown;
    }
    await call('show', { x: 0, y: 0, width: 800, height: 600 });
    const editorView = webContents.getAllWebContents().find(item => item.getURL().endsWith('/comment-editor'));
    const layoutDeadline = Date.now() + 5000;
    let viewport;
    do {
      viewport = await editorView.executeJavaScript("[innerWidth,innerHeight]");
      if (viewport[0] === 800 && viewport[1] === 600) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < layoutDeadline);
    assert.deepEqual(viewport, [800, 600], 'Visible browser panel has a real layout viewport before its snapshot');
    const entry = await call('snapshot', { tabId: editor.tabId });
    const entryRef = entry.tree.split('\n').find(line => line.includes('button "留下你的精彩评论吧"'))?.match(/\[(@e\d+)\]/)?.[1];
    if (!entryRef) {
      const metadata = await editorView.executeJavaScript(`(() => { const node = document.querySelector('#entry'); return { html: node?.outerHTML, rect: node?.getBoundingClientRect().toJSON(), onclick: typeof node?.onclick, fonts: document.fonts.status }; })()`);
      process.stderr.write(`Lazy input DOM: ${JSON.stringify(metadata)}\n`);
    }
    assert.ok(entryRef, `Lazy input remains actionable after long content, even below the fold: ${entry.tree}`);
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
    assert.equal((await call("state")).tabs.find(tab => tab.id === concurrent.tabId).sessionId, "session-2");
    const concurrentView = webContents.getAllWebContents().find(item => item !== window.webContents && item !== sharedView && item !== firstView && item.getURL() === url);
    assert.deepEqual(await concurrentView.executeJavaScript("[document.cookie,localStorage.getItem('account')]"), ["login=a", "a"]);
    assert.equal((await call("openUrl", url, { profileId: "plugin:account-a", taskId: "session-2" })).tabId, concurrent.tabId);
    const extra = await call("createTab", new URL("/extra", url).href, { sessionId: "session-2" });
    const beforeReorder = await call("state");
    const sessionTwoIds = beforeReorder.tabs.filter(tab => tab.sessionId === "session-2").map(tab => tab.id);
    assert.deepEqual(sessionTwoIds, [concurrent.tabId, extra.tabId]);
    const reversed = [...sessionTwoIds].reverse();
    await call("reorderTabs", reversed, { sessionId: "session-2" });
    const afterReorder = await call("state");
    assert.deepEqual(afterReorder.tabs.filter(tab => tab.sessionId === "session-2").map(tab => tab.id), reversed);
    assert.equal(afterReorder.tabs.find(tab => tab.id === first.tabId).sessionId, null);
    await call("closeTab", extra.tabId);
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
    const minimized = once(window, "minimize", { signal: AbortSignal.timeout(5000) });
    window.minimize();
    await minimized;
    assert.equal(window.isMinimized(), true);
    const restored = once(window, "restore", { signal: AbortSignal.timeout(5000) });
    await call('openUrl', postUrl, { profileId: 'plugin:account-a' });
    await restored;
    assert.equal(window.isMinimized(), false);
    window.hide();
    await assert.rejects(call("openUrl", url, { profileId: "../shared" }), /Invalid browser profile/);
    await assert.rejects(call("openUrl", url, { profileId: "plugin:account-a", taskId: "../shared" }), /Invalid browser task/);
    assert.equal((await call("state")).tabs.some(tab => tab.id === shared.tabId), true);
    const userUrl = new URL('/human-tab', url).href;
    const user = await call('openUrl', userUrl, { taskId: 'user-task', background: true });
    await call('selectTab', user.tabId);
    await call('setControl', user.tabId, 'human');
    const userView = webContents.getAllWebContents().find(item => item.getURL() === userUrl);
    await userView.executeJavaScript("document.querySelector('#title').focus(); document.querySelector('#title').value='User draft'; true");
    const redirectUrl = new URL('/delayed-page', url).href;
    const existingContents = new Set(webContents.getAllWebContents().map(item => item.id));
    const redirect = await call('createTab', redirectUrl, { sessionId: 'user-task' });
    const redirectView = webContents.getAllWebContents().find(item => !existingContents.has(item.id));
    if (redirectView.isLoading()) await once(redirectView, 'did-finish-load');
    await call('selectTab', user.tabId);
    await redirectView.loadURL(new URL('/delayed-redirect', url).href);
    assert.equal(redirectView.getURL(), new URL('/delayed-page', url).href);
    assert.equal((await call('state')).activeTabId, user.tabId);
    const agentUrl = new URL('/agent-tab', url).href;
    const agent = await call('openUrl', agentUrl, { taskId: 'agent-task', background: true });
    assert.equal((await call('state')).activeTabId, user.tabId);
    const observed = await call('snapshot', { tabId: agent.tabId, taskId: 'agent-task' });
    const completed = await call('act', { tabId: agent.tabId, taskId: 'agent-task', snapshotId: observed.snapshotId, actions: [
      { type: 'fill', target: { role: 'textbox', name: '标题' }, value: '' },
      { type: 'fill', target: { role: 'textbox', name: '标题' }, value: 'Background draft' },
      { type: 'click', target: { role: 'button', name: '显示二维码' } },
    ], expect: { condition: 'text', value: '扫码登录', timeoutMs: 1000 }, observe: { settleMs: 0 } });
    assert.equal(completed.status, 'verified');
    assert.equal(completed.results.length, 3);
    assert.equal((await call('state')).activeTabId, user.tabId);
    assert.deepEqual(await userView.executeJavaScript("[document.activeElement.id,document.querySelector('#title').value]"), ['title', 'User draft']);
    const loginProfile = { profileId: 'plugin:foreground-login', taskId: 'agent-login-task' };
    const loginUrl = new URL('/foreground-login', url).href;
    const foregroundLogin = await call('openUrl', loginUrl, loginProfile);
    const loginContents = webContents.getAllWebContents().find(item => item.getURL() === loginUrl);
    await call('selectTab', user.tabId);
    window.hide();
    const reusedLogin = await call('openUrl', loginUrl, { ...loginProfile, background: true });
    assert.equal(reusedLogin.tabId, foregroundLogin.tabId);
    const loginSnapshot = await call('snapshot', { tabId: reusedLogin.tabId, taskId: loginProfile.taskId });
    await call('act', { tabId: reusedLogin.tabId, taskId: loginProfile.taskId, snapshotId: loginSnapshot.snapshotId, actions: [
      { type: 'fill', target: { role: 'textbox', name: '标题' }, value: 'Reused account draft' },
    ] });
    assert.equal((await call('state')).activeTabId, user.tabId);
    assert.equal(window.isVisible(), false);
    assert.equal(await loginContents.executeJavaScript("document.querySelector('#title').value"), 'Reused account draft');
    await call('openUrl', loginUrl, loginProfile);
    await call('selectTab', user.tabId);
    window.hide();
    const shownSnapshot = await call('snapshot', { tabId: reusedLogin.tabId, taskId: loginProfile.taskId });
    await call('act', { tabId: reusedLogin.tabId, taskId: loginProfile.taskId, snapshotId: shownSnapshot.snapshotId, actions: [
      { type: 'click', target: { role: 'button', name: '显示二维码' } },
    ] });
    assert.equal((await call('state')).activeTabId, user.tabId, 'Showing an agent page preserves its background execution mode');
    assert.equal(window.isVisible(), false);
    await call('setControl', reusedLogin.tabId, 'human');
    await assert.rejects(call('openUrl', new URL('/agent-must-not-navigate', url).href, { ...loginProfile, background: true }), /user control/);
    assert.equal(loginContents.getURL(), loginUrl);
    assert.equal(await loginContents.executeJavaScript("document.querySelector('#title').value"), 'Reused account draft');
    const recoveryProfile = { profileId: 'plugin:recovery-takeover', taskId: 'recovery-task' };
    const recoveryUrl = new URL('/login-with-cookie', url).href;
    const recoveryOptions = { origin: new URL(url).origin, loginPath: '/login-with-cookie', authenticatedPath: '/platform/', cookieNames: ['sessionid'] };
    const recoveryTab = await call('openUrl', recoveryUrl, { ...recoveryProfile, background: true });
    const recoveryContents = webContents.getAllWebContents().find(item => item.getURL() === recoveryUrl);
    const cookies = recoveryContents.session.cookies;
    const originalGetCookies = cookies.get;
    let cookieReadStarted = () => {};
    let releaseCookieRead = () => {};
    let cookieReadFinished = () => {};
    const holdCookies = () => {
      const started = new Promise(resolve => { cookieReadStarted = () => resolve(undefined); });
      const release = new Promise(resolve => { releaseCookieRead = () => resolve(undefined); });
      const finished = new Promise(resolve => { cookieReadFinished = () => resolve(undefined); });
      cookies.get = async filter => {
        const result = await originalGetCookies.call(cookies, filter);
        cookieReadStarted();
        await release;
        cookieReadFinished();
        return result;
      };
      return { started, finished };
    };
    try {
      let held = holdCookies();
      const opening = call('openUrl', recoveryUrl, { ...recoveryProfile, background: true, sessionRecovery: recoveryOptions });
      const cancelled = assert.rejects(opening, /user control/);
      await held.started;
      await call('setControl', recoveryTab.tabId, 'human');
      await call('setControl', recoveryTab.tabId, 'agent');
      releaseCookieRead();
      await cancelled;
      assert.equal(recoveryContents.getURL(), recoveryUrl, 'An old recovery does not resume after a quick takeover and return');
      held = holdCookies();
      await recoveryContents.loadURL(recoveryUrl);
      await held.started;
      await call('setControl', recoveryTab.tabId, 'human');
      await call('setControl', recoveryTab.tabId, 'agent');
      releaseCookieRead();
      await held.finished;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(recoveryContents.getURL(), recoveryUrl, 'Automatic recovery respects the captured control epoch');
    } finally {
      releaseCookieRead();
      cookies.get = originalGetCookies;
    }
    await call('setControl', recoveryTab.tabId, 'human');
    await recoveryContents.loadURL(recoveryUrl);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(recoveryContents.getURL(), recoveryUrl, 'Automatic recovery leaves a human-controlled page in place');
    await assert.rejects(call('openUrl', recoveryUrl, { ...recoveryProfile, background: true, sessionRecovery: recoveryOptions }), /user control/);
    const humanRecovery = await call('openUrl', recoveryUrl, { ...recoveryProfile, sessionRecovery: recoveryOptions });
    assert.equal(humanRecovery.url, new URL('/platform/', url).href, 'An explicit foreground login may recover under human control');
    assert.equal((await call('state')).tabs.find(tab => tab.id === recoveryTab.tabId).controller, 'human');
    const agentView = webContents.getAllWebContents().find(item => item.getURL() === agentUrl);
    assert.equal(await agentView.executeJavaScript("document.querySelector('#title').value"), 'Background draft');
    const current = await call('snapshot', { tabId: agent.tabId });
    const pending = call('act', { tabId: agent.tabId, snapshotId: current.snapshotId, actions: [
      { type: 'waitFor', condition: 'text', value: 'Never arrives', timeoutMs: 5000 },
      { type: 'fill', target: { role: 'textbox', name: '标题' }, value: 'Must not happen' },
    ] });
    const interrupted = assert.rejects(pending, /user control/);
    await new Promise(resolve => setTimeout(resolve, 150));
    await call('setControl', agent.tabId, 'human');
    await interrupted;
    assert.equal(await agentView.executeJavaScript("document.querySelector('#title').value"), 'Background draft');
    await call('setControl', agent.tabId, 'agent');
    await assert.rejects(call('act', { tabId: agent.tabId, snapshotId: current.snapshotId, actions: [{ type: 'fill', target: { role: 'textbox', name: '标题' }, value: 'Stale' }] }), /stale/);
    await assert.rejects(call('snapshot', { tabId: agent.tabId, taskId: 'user-task' }), /another task/);
    let closeCleanupError = null;
    window.once('closed', () => {
      try { panel.destroy(); } catch (error) { closeCleanupError = error; }
    });
    const closed = once(window, 'closed');
    window.destroy();
    await closed;
    assert.equal(closeCleanupError, null, 'Closing the host window safely cleans up background browser tabs');
    assert.deepEqual((await call('state')).tabs, []);
    process.stdout.write("background-control-and-verification-passed\n");
    process.stdout.write("browser-profile-checks-passed\n");
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  } finally {
    const mainContents = window.isDestroyed() ? null : window.webContents;
    const closing = webContents.getAllWebContents()
      .filter(item => item !== mainContents && !item.isDestroyed())
      .map(item => once(item, "destroyed", { signal: AbortSignal.timeout(5000) }));
    panel.destroy();
    await Promise.all(closing);
    if (!window.isDestroyed()) window.destroy();
    server.close();
    app.exit(Number(process.exitCode) || 0);
  }
  })().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
}
