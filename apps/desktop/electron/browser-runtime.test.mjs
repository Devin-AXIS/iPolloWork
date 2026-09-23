import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { it } from "node:test";
import os from "node:os";
import path from "node:path";

import { createBrowserRuntime } from "./browser-runtime.mjs";

function axNode({ nodeId, role, name, backendDOMNodeId = undefined, childIds = [], value = undefined, properties = [] }) {
  return {
    nodeId,
    role: { value: role },
    name: { value: name },
    ...(value === undefined ? {} : { value: { value } }),
    ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
    childIds,
    properties,
  };
}

function createFixture({ workspacePath = null, userDataPath = "/tmp", workspaces = null, fileChooserOnClick = false, platform = process.platform, selectedFileSizes = null } = {}) {
  const commands = [];
  const inputEvents = [];
  const flattenedNodes = [];
  const frameNodes = [];
  let attached = false;
  let selectedOption = "writer";
  let fileChooserIntercepted = false;
  let nativeDialogs = 0;
  let url = "https://example.test/form";
  const nodes = [
    axNode({ nodeId: "root", role: "RootWebArea", name: "Fixture", childIds: ["heading", "title", "publish", "password"] }),
    axNode({ nodeId: "heading", role: "heading", name: "Create post", properties: [{ name: "level", value: { value: 1 } }] }),
    axNode({ nodeId: "title", role: "textbox", name: "Title", backendDOMNodeId: 11 }),
    axNode({ nodeId: "publish", role: "button", name: "Publish", backendDOMNodeId: 12, childIds: ["publish-text"] }),
    axNode({ nodeId: "publish-text", role: "StaticText", name: "Publish" }),
    axNode({
      nodeId: "password",
      role: "textbox",
      name: "Password",
      backendDOMNodeId: 13,
      value: "never-return-this",
      properties: [{ name: "protected", value: { value: true } }],
    }),
  ];
  const debuggerApi = Object.assign(new EventEmitter(), {
    attach() { attached = true; },
    detach() { attached = false; },
    isAttached() { return attached; },
    async sendCommand(method, params = {}) {
      commands.push({ method, params });
      if (method === "Page.setInterceptFileChooserDialog") fileChooserIntercepted = params.enabled;
      if (method === "Page.getFrameTree") {
        return {
          frameTree: {
            frame: { id: "top-frame" },
            childFrames: frameNodes.length > 0 ? [{ frame: { id: "child-frame" } }] : [],
          },
        };
      }
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: params.frameId === "child-frame" ? frameNodes : nodes };
      }
      if (method === "DOM.getFlattenedDocument") return { nodes: flattenedNodes };
      if (method === "Accessibility.getPartialAXTree") {
        return { nodes: [...nodes, ...frameNodes].filter((node) => node.backendDOMNodeId === params.backendNodeId) };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: `node-${params.backendNodeId}` } };
      if (method === "Runtime.callFunctionOn") {
        if (String(params.functionDeclaration).includes("Array.from(this.files")) return { result: { value: selectedFileSizes } };
        const backendNodeId = Number(String(params.objectId).replace("node-", ""));
        if (String(params.functionDeclaration).includes("selectExactOption")) {
          const option = params.arguments?.[0]?.value;
          if (!["Writer", "Reviewer", "writer", "reviewer"].includes(option)) {
            return { result: { value: { ok: false, reason: "not_found" } } };
          }
          const value = String(option).toLowerCase();
          const changed = selectedOption !== value;
          selectedOption = value;
          return { result: { value: { ok: true, changed, label: value === "writer" ? "Writer" : "Reviewer", value } } };
        }
        return {
          result: {
            value: {
              buttonLike: [12, 15, 17, 18].includes(backendNodeId),
              checkable: backendNodeId === 17,
              disabled: false,
              fileInput: backendNodeId === 14,
              nativeSelect: backendNodeId === 16,
              unobstructed: true,
              text: backendNodeId === 15 ? "发布图文笔记" : "",
              visible: backendNodeId !== 14,
              writable: backendNodeId === 11 || backendNodeId === 13,
              x: 120,
              y: 80,
            },
          },
        };
      }
      if (method === "Runtime.evaluate") return { result: { value: "complete" } };
      return {};
    },
  });
  const webContents = {
    debugger: debuggerApi,
    focus() {},
    selectAll() { commands.push({ method: 'selectAll' }); },
    getTitle() { return "Fixture"; },
    getURL() { return url; },
    isDestroyed() { return false; },
    sendInputEvent(event) {
      inputEvents.push(event);
      if (fileChooserOnClick && event.type === "mouseUp") {
        if (fileChooserIntercepted) debuggerApi.emit("message", {}, "Page.fileChooserOpened", { backendNodeId: 14, mode: "selectSingle" });
        else nativeDialogs += 1;
      }
    },
  };
  const tab = { tabId: "tab-1", view: { getBounds: () => ({ width: 640, height: 480 }), webContents } };
  const runtime = createBrowserRuntime({
    getTab: (tabId) => tabId === tab.tabId ? tab : null,
    selectTab() {},
    focusWindow() {},
    listLocalWorkspaces: async () => workspaces ?? (workspacePath ? [{ id: "workspace-1", path: workspacePath }] : []),
    getUserDataPath: () => userDataPath,
    platform,
  });
  return { commands, flattenedNodes, frameNodes, inputEvents, nodes, runtime, nativeDialogs: () => nativeDialogs, selectedOption: () => selectedOption, setUrl(value) { url = value; } };
}

function addSemanticControls(fixture) {
  fixture.nodes[0].childIds.push("role", "notifications", "hover");
  fixture.nodes.push(
    axNode({ nodeId: "role", role: "combobox", name: "Role", backendDOMNodeId: 16, value: "Writer", childIds: ["writer", "reviewer"] }),
    axNode({ nodeId: "writer", role: "option", name: "Writer", backendDOMNodeId: 19, properties: [{ name: "selected", value: { value: true } }] }),
    axNode({ nodeId: "reviewer", role: "option", name: "Reviewer", backendDOMNodeId: 20 }),
    axNode({ nodeId: "notifications", role: "checkbox", name: "Enable notifications", backendDOMNodeId: 17, properties: [{ name: "checked", value: { value: false } }] }),
    axNode({ nodeId: "hover", role: "button", name: "Open actions", backendDOMNodeId: 18 }),
  );
}

it("creates bounded semantic snapshots with stable refs and protected-value redaction", async () => {
  const fixture = createFixture();
  const first = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const second = await fixture.runtime.snapshot({ tabId: "tab-1" });

  assert.match(first.tree, /heading "Create post" level=1/);
  assert.match(first.tree, /\[@e1\] textbox "Title"/);
  assert.match(first.tree, /\[@e2\] button "Publish"/);
  assert.match(first.tree, /\[@e3\] textbox "Password"/);
  assert.doesNotMatch(first.tree, /never-return-this/);
  assert.match(second.tree, /\[@e1\] textbox "Title"/);
  assert.notEqual(first.snapshotId, second.snapshotId);
});

it("retains complete accessible link destinations without activating cards or exposing non-navigation values", async () => {
  const fixture = createFixture();
  const href = 'https://www.xiaohongshu.com/search_result/real-note?xsec_token=visible&xsec_source=pc_search';
  const urls = [href, 'javascript:alert(1)', 'https://name:password@example.test/', 'not-a-url', 'https://example.test/' + 'x'.repeat(2048)];
  for (const [index, url] of urls.entries()) fixture.nodes.push(axNode({
    nodeId: `link-${index}`, role: 'link', name: `Candidate ${index}`, backendDOMNodeId: 30 + index,
    properties: [{ name: 'url', value: { value: url } }],
  }));
  fixture.nodes.push(axNode({nodeId:'non-link',role:'textbox',name:'Other',backendDOMNodeId:40,properties:[{name:'url',value:{value:'https://private.example/'}}]}));
  const snapshot = await fixture.runtime.snapshot({tabId:'tab-1'});
  assert.ok(snapshot.tree.includes(`link "Candidate 0" url=${JSON.stringify(href)}`));
  assert.equal((snapshot.tree.match(/ url=/g) ?? []).length, 1);
  assert.doesNotMatch(snapshot.tree, /javascript:|name:password|private\.example|not-a-url/);
  assert.deepEqual(fixture.inputEvents, []);
});

it("promotes visible pointer controls without ARIA roles into safe named refs", async () => {
  const fixture = createFixture();
  fixture.nodes[0].childIds.push("publish-card");
  fixture.nodes.push(
    axNode({ nodeId: "publish-card", role: "generic", name: "", backendDOMNodeId: 15, childIds: ["publish-card-text"] }),
    axNode({ nodeId: "publish-card-text", role: "StaticText", name: "发布图文笔记" }),
  );
  const originalSnapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });

  assert.match(originalSnapshot.tree, /\[@e4\] button "发布图文笔记"/);
  assert.deepEqual(
    fixture.commands.find((command) => command.method === "Runtime.callFunctionOn")?.params.arguments,
    [{ value: false }],
  );
  await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: originalSnapshot.snapshotId,
    actions: [{ type: "click", ref: "e4", expectedName: "发布图文笔记" }],
  });
  assert.deepEqual(fixture.inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
  assert.deepEqual(
    fixture.commands.filter((command) => command.method === "Runtime.callFunctionOn").at(-1)?.params.arguments,
    [{ value: true }],
  );
  assert.deepEqual(
    fixture.commands.filter((command) => command.method === "Page.setInterceptFileChooserDialog").map((command) => command.params.enabled),
    [true, false],
  );
});

it("includes actionable controls from child frames in the same semantic snapshot", async () => {
  const fixture = createFixture();
  fixture.frameNodes.push(
    axNode({ nodeId: "frame-root", role: "RootWebArea", name: "Embedded editor", childIds: ["frame-button"] }),
    axNode({ nodeId: "frame-button", role: "button", name: "Frame action", backendDOMNodeId: 21 }),
  );

  const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });

  assert.match(snapshot.tree, /\[@e4\] button "Frame action"/);
  assert.ok(fixture.commands.some((command) => (
    command.method === "Accessibility.getFullAXTree" && command.params.frameId === "child-frame"
  )));
});

it("executes a bounded batch with real text and pointer input", async () => {
  const fixture = createFixture();
  const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const result = await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: snapshot.snapshotId,
    actions: [
      { type: "fill", ref: "@e1", value: "A modern browser runtime" },
      { type: "click", ref: "@e2", expectedName: "Publish" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.ok(fixture.commands.some((command) => (
    command.method === "selectAll"
  )));
  assert.deepEqual(
    fixture.commands.find((command) => command.method === "Input.insertText")?.params,
    { text: "A modern browser runtime" },
  );
  assert.deepEqual(fixture.inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
  assert.equal(result.snapshotRequired, true);
});

it("supports verified hover, native select, check, and bounded scroll actions", async () => {
  const fixture = createFixture();
  addSemanticControls(fixture);

  let snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const hover = await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: snapshot.snapshotId,
    actions: [{ type: "hover", ref: "@e8", expectedName: "Open actions" }],
  });
  assert.deepEqual(hover.results[0], { type: "hover", ref: "@e8", name: "Open actions" });
  assert.equal(hover.snapshotRequired, true);

  snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const select = await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: snapshot.snapshotId,
    actions: [{ type: "select", ref: "@e4", expectedName: "Role", option: "Reviewer" }],
  });
  assert.deepEqual(select.results[0], {
    type: "select",
    ref: "@e4",
    name: "Role",
    option: "Reviewer",
    value: "reviewer",
    changed: true,
  });
  assert.equal(fixture.selectedOption(), "reviewer");

  snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const check = await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: snapshot.snapshotId,
    actions: [{ type: "check", ref: "@e7", expectedName: "Enable notifications", checked: true }],
  });
  assert.deepEqual(check.results[0], {
    type: "check",
    ref: "@e7",
    name: "Enable notifications",
    checked: true,
    changed: true,
  });

  snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const scroll = await fixture.runtime.act({
    tabId: "tab-1",
    snapshotId: snapshot.snapshotId,
    actions: [{ type: "scroll", direction: "down", amount: "small" }],
  });
  assert.deepEqual(scroll.results[0], { type: "scroll", direction: "down", amount: "small" });
  assert.deepEqual(fixture.inputEvents.at(-1), {
    type: "mouseWheel",
    x: 320,
    y: 240,
    deltaX: 0,
    deltaY: 320,
  });
});

it("waits for bounded URL, text, ref, and document readiness conditions", async () => {
  const fixture = createFixture();
  const cases = [
    { type: "waitFor", condition: "url", value: "https://example.test/form", match: "equals", timeoutMs: 100 },
    { type: "waitFor", condition: "text", value: "Create post", timeoutMs: 100 },
    { type: "waitFor", condition: "ref", ref: "@e2", state: "visible", timeoutMs: 100 },
    { type: "waitFor", condition: "load", state: "complete", timeoutMs: 100 },
  ];

  for (const action of cases) {
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    const result = await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [action],
    });
    assert.equal(result.results[0].type, "waitFor");
    assert.equal(result.results[0].condition, action.condition);
    assert.equal(result.snapshotRequired, true);
  }

  const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "waitFor", condition: "text", value: "Never appears", timeoutMs: 100 }],
    }),
    /timed out/i,
  );
});

it("rejects stale snapshots and changed accessible names before input", async () => {
  const fixture = createFixture();
  const first = await fixture.runtime.snapshot({ tabId: "tab-1" });
  await fixture.runtime.snapshot({ tabId: "tab-1" });
  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: first.snapshotId,
      actions: [{ type: "click", ref: "@e2", expectedName: "Publish" }],
    }),
    /snapshot is stale/i,
  );

  const latest = await fixture.runtime.snapshot({ tabId: "tab-1" });
  const publishNode = fixture.nodes.find((node) => node.nodeId === "publish");
  publishNode.name.value = "Published";
  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: latest.snapshotId,
      actions: [{ type: "click", ref: "@e2", expectedName: "Publish" }],
    }),
    /name changed/i,
  );
  assert.equal(fixture.inputEvents.length, 0);
});

it("invalidates refs when the host reports navigation", async () => {
  const fixture = createFixture();
  const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
  fixture.runtime.invalidate("tab-1");
  fixture.setUrl("https://example.test/next");

  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "fill", ref: "@e1", value: "stale" }],
    }),
    /snapshot is stale/i,
  );
});

it("requires stable named refs for Enter and Space activation keys", async () => {
  const fixture = createFixture();
  let snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });

  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "press", key: "Enter" }],
    }),
    /require a stable ref/i,
  );

  for (const key of ["Enter", "Space"]) {
    snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    const result = await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "press", key, ref: "@e2", expectedName: "Publish" }],
    });
    assert.deepEqual(result.results[0], { type: "press", key, ref: "@e2", name: "Publish" });
  }
  assert.ok(fixture.commands.some((command) => (
    command.method === "Input.dispatchKeyEvent" && command.params.code === "Enter"
  )));
  assert.ok(fixture.commands.some((command) => (
    command.method === "Input.dispatchKeyEvent" && command.params.code === "Space"
  )));
});

it("supplements hidden file inputs and uploads only registered-workspace files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-runtime-"));
  const workspacePath = path.join(root, "workspace");
  const userDataPath = path.join(root, "user-data");
  const uploadPath = path.join(workspacePath, "image.png");
  await mkdir(workspacePath, { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await writeFile(uploadPath, "fixture");
  try {
    const fixture = createFixture({ workspacePath, userDataPath });
    fixture.flattenedNodes.push({
      nodeName: "INPUT",
      backendNodeId: 14,
      attributes: ["type", "file", "aria-label", "Choose media"],
    });
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    assert.match(snapshot.tree, /\[@e4\] fileinput "Choose media"/);

    await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", filePaths: [path.relative(workspacePath, uploadPath)] }],
    });
    const upload = fixture.commands.find((command) => command.method === "DOM.setFileInputFiles");
    assert.deepEqual(upload?.params.files, [await realpath(uploadPath)]);
    assert.equal(upload?.params.backendNodeId, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("uploads a generated video through a visible button without opening a native file picker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-button-upload-"));
  const workspacePath = path.join(root, "workspace");
  const videoPath = path.join(workspacePath, "video.mp4");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(videoPath, "fixture");
  try {
    const fixture = createFixture({ workspacePath, fileChooserOnClick: true });
    fixture.nodes[0].childIds.push("upload-video");
    fixture.nodes.push(axNode({ nodeId: "upload-video", role: "button", name: "上传视频", backendDOMNodeId: 15 }));
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    assert.match(snapshot.tree, /\[@e4\] button "上传视频"/);
    const result = await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", expectedName: "上传视频", filePaths: [videoPath] }],
    });
    assert.deepEqual(result.results, [{ type: "upload", ref: "@e4", count: 1 }]);
    assert.equal(fixture.nativeDialogs(), 0);
    assert.deepEqual(fixture.commands.find((command) => command.method === "DOM.setFileInputFiles")?.params, {
      files: [await realpath(videoPath)], backendNodeId: 14,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("stages long Windows upload paths under a short private path until the tab closes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-long-upload-"));
  const workspacePath = path.join(root, "workspace");
  const videoPath = path.join(workspacePath, "video", "s".repeat(100), "renders", `${"v".repeat(100)}.mp4`);
  await mkdir(path.dirname(videoPath), { recursive: true });
  await writeFile(videoPath, "real video bytes");
  try {
    assert.ok(videoPath.length >= 240);
    const fixture = createFixture({ workspacePath, platform: "win32" });
    fixture.flattenedNodes.push({ nodeName: "INPUT", backendNodeId: 14, attributes: ["type", "file"] });
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    await fixture.runtime.act({
      tabId: "tab-1", snapshotId: snapshot.snapshotId, workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", filePaths: [videoPath] }],
    });
    const staged = fixture.commands.find((command) => command.method === "DOM.setFileInputFiles")?.params.files[0];
    assert.ok(staged.length < 240);
    assert.equal((await stat(staged)).size, (await stat(videoPath)).size);
    fixture.runtime.forget("tab-1");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await stat(staged).then(() => true, () => false))) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await stat(staged).then(() => true, () => false), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not report upload success when Chromium selects a zero-byte file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-zero-upload-"));
  const workspacePath = path.join(root, "workspace");
  const videoPath = path.join(workspacePath, "video.mp4");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(videoPath, "nonempty video");
  try {
    const fixture = createFixture({ workspacePath, selectedFileSizes: [0] });
    fixture.flattenedNodes.push({ nodeName: "INPUT", backendNodeId: 14, attributes: ["type", "file"] });
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    await assert.rejects(fixture.runtime.act({
      tabId: "tab-1", snapshotId: snapshot.snapshotId, workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", filePaths: [videoPath] }],
    }), /incomplete upload file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("intercepts an accidental upload-button click and offers a file-input ref", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-click-upload-"));
  const workspacePath = path.join(root, "workspace");
  const videoPath = path.join(workspacePath, "video.mp4");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(videoPath, "fixture");
  try {
    const fixture = createFixture({ workspacePath, fileChooserOnClick: true });
    fixture.nodes[0].childIds.push("upload-video");
    fixture.nodes.push(axNode({ nodeId: "upload-video", role: "button", name: "上传视频", backendDOMNodeId: 15 }));
    const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    const clicked = await fixture.runtime.act({
      tabId: "tab-1", snapshotId: snapshot.snapshotId, workspaceRoot: workspacePath,
      actions: [{ type: "click", ref: "@e4", expectedName: "上传视频" }],
    });
    assert.equal(clicked.snapshotRequired, false);
    assert.equal(clicked.results[0]?.type, "fileChooser");
    assert.equal(fixture.nativeDialogs(), 0);
    const uploaded = await fixture.runtime.act({
      tabId: "tab-1", snapshotId: snapshot.snapshotId, workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: clicked.results[0].uploadRef, filePaths: [videoPath] }],
    });
    assert.equal(uploaded.results[0]?.type, "upload");
    assert.equal(fixture.commands.find((command) => command.method === "DOM.setFileInputFiles")?.params.backendNodeId, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("uploads only the named plugin's file from its registered runtime storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-browser-plugin-upload-"));
  const workspacePath = path.join(root, "workspace");
  const userDataPath = path.join(root, "desktop-data");
  const runtimeStorageRoot = path.join(root, "server-data");
  const allowedPath = path.join(runtimeStorageRoot, "plugin-data", "workspace-1", "douyin-ops", "assets", "video.mp4");
  const globalAllowedPath = path.join(runtimeStorageRoot, "plugin-data", "douyin-ops", "assets", "global-video.mp4");
  const otherPluginPath = path.join(runtimeStorageRoot, "plugin-data", "workspace-1", "other-plugin", "assets", "video.mp4");
  await mkdir(workspacePath, { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await mkdir(path.dirname(allowedPath), { recursive: true });
  await mkdir(path.dirname(globalAllowedPath), { recursive: true });
  await mkdir(path.dirname(otherPluginPath), { recursive: true });
  await writeFile(allowedPath, "fixture");
  await writeFile(globalAllowedPath, "fixture");
  await writeFile(otherPluginPath, "fixture");
  try {
    const fixture = createFixture({
      userDataPath,
      workspaces: [{ id: "workspace-1", path: workspacePath, runtimeStorageRoot }],
    });
    fixture.flattenedNodes.push({
      nodeName: "INPUT",
      backendNodeId: 14,
      attributes: ["type", "file", "aria-label", "Choose video"],
    });
    let snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", filePaths: [allowedPath], extensionId: "douyin-ops" }],
    });
    assert.deepEqual(
      fixture.commands.find((command) => command.method === "DOM.setFileInputFiles")?.params.files,
      [await realpath(allowedPath)],
    );

    snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    await fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      workspaceRoot: workspacePath,
      actions: [{ type: "upload", ref: "@e4", filePaths: [globalAllowedPath], extensionId: "douyin-ops" }],
    });
    assert.deepEqual(
      fixture.commands.filter((command) => command.method === "DOM.setFileInputFiles").at(-1)?.params.files,
      [await realpath(globalAllowedPath)],
    );

    snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });
    await assert.rejects(
      fixture.runtime.act({
        tabId: "tab-1",
        snapshotId: snapshot.snapshotId,
        workspaceRoot: workspacePath,
        actions: [{ type: "upload", ref: "@e4", filePaths: [otherPluginPath], extensionId: "douyin-ops" }],
      }),
      /active workspace or the named plugin's private data/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
