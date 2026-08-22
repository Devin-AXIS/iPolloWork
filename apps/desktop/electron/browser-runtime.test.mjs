import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

function createFixture({ workspacePath = null, userDataPath = "/tmp" } = {}) {
  const commands = [];
  const inputEvents = [];
  const flattenedNodes = [];
  const frameNodes = [];
  let attached = false;
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
  const debuggerApi = {
    attach() { attached = true; },
    detach() { attached = false; },
    isAttached() { return attached; },
    async sendCommand(method, params = {}) {
      commands.push({ method, params });
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
        const backendNodeId = Number(String(params.objectId).replace("node-", ""));
        return {
          result: {
            value: {
              buttonLike: backendNodeId === 12 || backendNodeId === 15,
              disabled: false,
              fileInput: backendNodeId === 14,
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
      return {};
    },
  };
  const webContents = {
    debugger: debuggerApi,
    focus() {},
    getTitle() { return "Fixture"; },
    getURL() { return url; },
    isDestroyed() { return false; },
    sendInputEvent(event) { inputEvents.push(event); },
  };
  const tab = { tabId: "tab-1", view: { webContents } };
  const runtime = createBrowserRuntime({
    getTab: (tabId) => tabId === tab.tabId ? tab : null,
    selectTab() {},
    focusWindow() {},
    listLocalWorkspaces: async () => workspacePath ? [{ id: "workspace-1", path: workspacePath }] : [],
    getUserDataPath: () => userDataPath,
    platform: "darwin",
  });
  return { commands, flattenedNodes, frameNodes, inputEvents, nodes, runtime, setUrl(value) { url = value; } };
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
  assert.ok(!fixture.commands.some((command) => command.method === "Page.setInterceptFileChooserDialog"));
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
    command.method === "Input.dispatchKeyEvent"
      && command.params.type === "rawKeyDown"
      && command.params.code === "KeyA"
  )));
  assert.deepEqual(
    fixture.commands.find((command) => command.method === "Input.insertText")?.params,
    { text: "A modern browser runtime" },
  );
  assert.deepEqual(fixture.inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
  assert.equal(result.snapshotRequired, true);
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

it("does not allow unscoped activation keys to bypass named clicks", async () => {
  const fixture = createFixture();
  const snapshot = await fixture.runtime.snapshot({ tabId: "tab-1" });

  await assert.rejects(
    fixture.runtime.act({
      tabId: "tab-1",
      snapshotId: snapshot.snapshotId,
      actions: [{ type: "press", key: "Enter" }],
    }),
    /unsupported browser key/i,
  );
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
      actions: [{ type: "upload", ref: "@e4", filePaths: [uploadPath] }],
    });
    const upload = fixture.commands.find((command) => command.method === "DOM.setFileInputFiles");
    assert.deepEqual(upload?.params.files, [await realpath(uploadPath)]);
    assert.equal(upload?.params.backendNodeId, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
