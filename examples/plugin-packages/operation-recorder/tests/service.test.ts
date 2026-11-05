import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isRecord } from "../service/model.ts";
import { createRecorderService } from "../service/recorder.ts";

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ipollowork-recorder-test-")));
  const dataDir = join(root, "data");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const runtime = { storage: { dataDir }, workspace: { root: workspace }, plugin: { id: "operation-recorder", version: "0.1.0" } };
  return { root, runtime, remove: () => rm(root, { recursive: true, force: true }) };
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function sessionId(value: unknown): string {
  const session = object(object(value).session);
  assert.equal(typeof session.id, "string");
  if (typeof session.id !== "string") throw new Error("Missing session ID");
  return session.id;
}

async function reviewed(service: Awaited<ReturnType<typeof createRecorderService>>) {
  const imported = await service.actions["import-chrome"]({ flow: { title: "Create an item", steps: [
    { type: "navigate", url: "https://example.com/new?token=private-query" },
    { type: "change", selectors: [["aria/Name[role=textbox]"]], value: "private-input" },
    { type: "click", selectors: [["aria/Save[role=button]"]] },
    { type: "waitForElement", selectors: [["text/Saved"]] },
  ] } });
  const id = sessionId(imported);
  const session = object(object(imported).session);
  await service.actions.review({ sessionId: id, steps: session.steps, approved: true });
  return id;
}

test("import-review-export is workspace isolated, portable, redacted and a real archive", async () => {
  const context = await fixture();
  const service = await createRecorderService(context.runtime, { platform: "linux" });
  try {
    const id = await reviewed(service);
    const compiled = object(await service.actions.compile({ sessionId: id, skillName: "create-item" }));
    assert.equal(typeof compiled.archivePath, "string");
    if (typeof compiled.archivePath !== "string" || typeof compiled.skillPath !== "string" || typeof compiled.workflowPath !== "string") throw new Error("Missing export paths");
    assert.ok(compiled.archivePath.startsWith(context.runtime.storage.dataDir));
    assert.equal((await readFile(compiled.archivePath)).readUInt32LE(0), 0x04034b50);
    const skill = await readFile(compiled.skillPath, "utf8");
    const workflow = await readFile(compiled.workflowPath, "utf8");
    assert.ok(!workflow.includes("private-input") && !workflow.includes("private-query"));
    assert.match(skill, /current engine's available/);
    assert.ok((await stat(compiled.skillPath)).isFile());
    if (process.platform !== "win32") assert.equal((await stat(compiled.skillPath)).mode & 0o777, 0o600);
    const manifest = object(compiled.manifest);
    assert.ok(!("engineBindings" in manifest));
    const otherWorkspace = join(context.root, "other-workspace");
    await mkdir(otherWorkspace);
    const other = await createRecorderService({ ...context.runtime, workspace: { root: otherWorkspace } }, { platform: "linux" });
    try { await assert.rejects(other.actions.review({ sessionId: id, approved: true }), /ENOENT/); }
    finally { await other.dispose(); }
  } finally { await service.dispose(); await context.remove(); }
});

test("workbench authenticates token, blocks cross-origin and oversized requests, and opens once", async () => {
  const context = await fixture();
  const service = await createRecorderService(context.runtime, { collectorPath: join(context.root, "missing-collector.mjs"), platform: "linux" });
  try {
    const results = await Promise.all([service.actions["open-workbench"]({}), service.actions["open-workbench"]({})]);
    const first = object(results[0]);
    assert.deepEqual(results[0], results[1]);
    if (typeof first.url !== "string") throw new Error("Missing workbench URL");
    const url = new URL(first.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    assert.ok(token);
    const endpoint = new URL("/api/status", url);
    const base = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" };
    assert.equal((await fetch(endpoint, { ...base, headers: { ...base.headers, authorization: "Bearer invalid" } })).status, 401);
    assert.equal((await fetch(endpoint, { ...base, headers: { ...base.headers, origin: "https://malicious.example" } })).status, 403);
    const result = await fetch(endpoint, { ...base, headers: { ...base.headers, origin: url.origin } });
    assert.equal(result.status, 200);
    assert.equal(object(await result.json()).recording, false);
    assert.equal((await fetch(endpoint, { ...base, body: JSON.stringify({ large: "x".repeat(1_048_576) }) })).status, 413);
    await assert.rejects(service.actions.start({ title: "Desktop" }), /ENOENT|unavailable/);
  } finally { await service.dispose(); await context.remove(); }
  await assert.rejects(service.actions["import-chrome"]({ flow: {} }), /disposed/);
});

test("symlinks under owned storage cannot redirect exports", async () => {
  const context = await fixture();
  const service = await createRecorderService(context.runtime, { platform: "linux" });
  try {
    const id = await reviewed(service);
    const first = object(await service.actions.compile({ sessionId: id, skillName: "safe-item" }));
    if (typeof first.directory !== "string") throw new Error("Missing export directory");
    const exports = join(first.directory, "..");
    await rm(exports, { recursive: true });
    await symlink(context.runtime.workspace.root, exports, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(service.actions.compile({ sessionId: id, skillName: "safe-item" }), /symlink/);
  } finally { await service.dispose(); await context.remove(); }
});

test("edited and concurrent exports reserve increasing immutable package versions", async () => {
  const context = await fixture();
  const service = await createRecorderService(context.runtime, { platform: "linux" });
  const other = await createRecorderService(context.runtime, { platform: "linux" });
  try {
    const id = await reviewed(service);
    const first = object(await service.actions.compile({ sessionId: id, skillName: "editable-flow" }));
    assert.equal(first.version, "1.0.0");
    if (typeof first.skill !== "string") throw new Error("Missing Skill content");
    const second = object(await service.actions.compile({ sessionId: id, skillName: "editable-flow", skillContent: first.skill + "\nReviewed human refinement.\n" }));
    assert.equal(second.version, "1.0.1");
    assert.equal(second.archiveName, "editable-flow-1.0.1.ipollowork-plugin");
    assert.equal(object(object(second.manifest).package).version, "1.0.1");
    if (typeof first.directory !== "string" || typeof second.directory !== "string" || typeof second.archivePath !== "string" || typeof second.skillPath !== "string" || typeof second.manifestPath !== "string") throw new Error("Missing export paths");
    assert.equal(second.directory, join(first.directory, "..", "1.0.1"));
    assert.match(await readFile(second.skillPath, "utf8"), /Reviewed human refinement/);
    assert.equal(object(object(JSON.parse(await readFile(second.manifestPath, "utf8"))).package).version, "1.0.1");
    const archive = await readFile(second.archivePath);
    assert.ok(archive.includes(Buffer.from('"version": "1.0.1"')));
    assert.ok(archive.includes(Buffer.from("Reviewed human refinement")));
    const concurrent = await Promise.all([
      service.actions.compile({ sessionId: id, skillName: "editable-flow" }),
      other.actions.compile({ sessionId: id, skillName: "editable-flow" }),
    ]);
    assert.deepEqual(concurrent.map((value) => object(value).version).sort(), ["1.0.2", "1.0.3"]);
  } finally { await service.dispose(); await other.dispose(); await context.remove(); }
});

for (const platform of ["darwin", "win32", "linux"] satisfies NodeJS.Platform[]) {
test(`Node.js collector lifecycle on ${platform} serializes recording and strips helper input before saving`, async () => {
  const context = await fixture();
  const helper = join(context.root, "helper.cjs");
  await writeFile(helper, `#!${process.execPath}\nconst readline = require('node:readline');\nif(process.argv.includes('--check') || process.argv.includes('--request-permissions')) { console.log(JSON.stringify({supported:true,accessibility:true,inputMonitoring:true})); process.exit(0); }\nconst observedAt=new Date().toISOString();\nconsole.log(JSON.stringify({type:'ready'}));\nconsole.log(JSON.stringify({type:'step',step:{id:'input-1',at:observedAt,action:'input',text:'raw-native-secret',target:{role:'AXSecureTextField',name:'Password'}}}));\nreadline.createInterface({input:process.stdin}).on('line', line => { const command=JSON.parse(line).command; if(command==='pause') console.log(JSON.stringify({type:'step',step:{id:'before-pause',at:observedAt,action:'click',target:{role:'button',name:'Earlier click'}}})); if(command==='stop') process.stdout.write(JSON.stringify({type:'step',step:{id:'final-click',at:new Date().toISOString(),action:'click',target:{role:'button',name:'Final confirmation'}}})+'\\n',()=>process.exit(0)); });\n`, { mode: 0o700 });
  const service = await createRecorderService(context.runtime, { collectorPath: helper, platform });
  const second = await createRecorderService(context.runtime, { collectorPath: helper, platform });
  try {
    await writeFile(join(context.runtime.storage.dataDir, "recording.lock"), JSON.stringify({ pid: 2_147_483_647, workspace: "interrupted-workspace" }), { mode: 0o600 });
    const started = object(object(await service.actions.start({})).session);
    assert.match(String(started.title), /^操作录制 · /);
    const id = String(started.id);
    await assert.rejects(second.actions.start({ title: "Concurrent task" }), /Another desktop recording/);
    await assert.rejects(second.actions.review({ sessionId: id, approved: true }), /Stop the recording/);
    await service.actions.pause({});
    await service.actions.resume({});
    const stopped = object(object(await service.actions.stop({})).session);
    assert.equal(stopped.status, "draft");
    assert.ok(!JSON.stringify(stopped).includes("raw-native-secret"));
    const steps = stopped.steps;
    assert.ok(Array.isArray(steps));
    assert.equal(steps.length, 3);
    assert.equal(object(steps[1]).id, "before-pause");
    assert.equal(object(steps[2]).id, "final-click");
    const step = object(steps[0]);
    assert.equal(step.variable, "input_1");
    assert.equal(step.secret, true);
    assert.equal(sessionId(await service.actions.status({ sessionId: id })), id);
    const compiled = object(await service.actions.compile({ sessionId: id }));
    const workflow = object(compiled.workflow);
    assert.equal(object(workflow.source).reviewed, false);
    assert.equal(object(workflow.source).finalSuccessConditionDefined, false);
    assert.ok(!JSON.stringify(compiled).includes("raw-native-secret"));
    assert.equal(object(object(await service.actions.status({ sessionId: id })).session).status, "draft");
  } finally { await service.dispose(); await second.dispose(); await context.remove(); }
});
}

for (const mode of ["warning", "crash", "protocol-error"]) {
test(`collector stderr warnings do not fail recording; ${mode} preserves its actual outcome`, async () => {
  const context = await fixture();
  const helper = join(context.root, "diagnostic-helper.cjs");
  await writeFile(helper, `
    const readline = require('node:readline');
    if (process.argv.includes('--check')) {
      console.log(JSON.stringify({ supported: true, accessibility: true, inputMonitoring: true }));
      process.exit(0);
    }
    process.emitWarning('EnvHttpProxyAgent is experimental, expect them to change at any time.', { code: 'UNDICI-EHPA' });
    console.log(JSON.stringify({ type: 'ready' }));
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const command = JSON.parse(line).command;
      if (command === 'resume' && ${JSON.stringify(mode)} === 'crash') {
        process.stderr.write('Native capture fatal: input hook disconnected\\n', () => process.exit(7));
      } else if (command === 'resume' && ${JSON.stringify(mode)} === 'protocol-error') {
        console.log(JSON.stringify({ type: 'error', message: 'Native input monitoring permission revoked' }));
      } else if (command === 'pause' || command === 'resume') {
        console.log(JSON.stringify({ type: 'step', step: { id: command, at: new Date().toISOString(), action: 'click', target: { role: 'button', name: 'Save project' } } }));
      } else if (command === 'stop') process.exit(0);
    });
  `);
  const service = await createRecorderService(context.runtime, { collectorPath: helper });
  function stepCount(status: Record<string, unknown>) {
    const steps = object(status.session).steps;
    assert.ok(Array.isArray(steps));
    return steps.length;
  }
  async function until(predicate: (status: Record<string, unknown>) => boolean) {
    const deadline = Date.now() + 5_000;
    do {
      const status = object(await service.actions.status({}));
      if (predicate(status)) return status;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.fail('The collector did not reach its expected state');
  }
  try {
    const id = sessionId(await service.actions.start({}));
    await service.actions.pause({});
    const paused = await until(status => stepCount(status) === 1);
    assert.equal(paused.error, null, 'A real runtime warning must not become a recording error');
    assert.equal(paused.recording, true);
    await service.actions.resume({});
    if (mode === 'warning') {
      await until(status => stepCount(status) === 2);
      await service.actions.stop({});
      const saved = object(await service.actions.status({ sessionId: id }));
      assert.equal(saved.error, null);
      assert.equal(saved.recording, false);
      assert.equal(object(saved.session).status, 'draft');
      assert.equal(stepCount(saved), 2);
      const exported = object(await service.actions.compile({ sessionId: id }));
      assert.ok(typeof exported.archivePath === 'string' && (await stat(exported.archivePath)).size > 0);
    } else {
      const failed = await until(status => status.recording === false && object(status.session).status === 'draft' && typeof status.error === 'string');
      assert.equal(object(failed.session).status, 'draft');
      assert.equal(stepCount(failed), 1);
      assert.match(String(failed.error), mode === 'crash' ? /stopped unexpectedly \(7\).*input hook disconnected/s : /input monitoring permission revoked/);
    }
  } finally { await service.dispose(); await context.remove(); }
});
}

test("collector capability rejection preserves actionable platform reasons", async () => {
  const context = await fixture();
  const helper = join(context.root, "unsupported-helper.cjs");
  await writeFile(helper, `#!${process.execPath}\nconsole.log(JSON.stringify({supported:false,accessibility:false,inputMonitoring:false,backend:'x11-atspi',sessionType:'wayland',reason:'Wayland does not provide passive desktop input capture',permissionHelp:'Import a Chrome Recorder flow'}));\n`, { mode: 0o700 });
  const service = await createRecorderService(context.runtime, { collectorPath: helper, platform: "linux" });
  try {
    const capabilities = object(await service.actions.capabilities({}));
    const desktop = object(capabilities.desktop);
    assert.equal(desktop.supported, false);
    assert.equal(desktop.sessionType, "wayland");
    assert.equal(desktop.backend, "x11-atspi");
    await assert.rejects(service.actions.start({ title: "Must not capture" }), /Wayland/);
    const refreshed = object(await service.actions["request-permissions"]({}));
    assert.equal(object(refreshed.desktop).supported, false);
    assert.equal(object(await service.actions.status({})).recording, false);
  } finally { await service.dispose(); await context.remove(); }
});

test("Node.js collector runs from its package without an executable cache and rejects oversized files", async () => {
  const context = await fixture();
  const helper = join(context.root, "helper.cjs");
  const script = Buffer.from(`#!${process.execPath}\nconsole.log(JSON.stringify({supported:true,accessibility:true,inputMonitoring:true}));\n`);
  await writeFile(helper, script);
  const service = await createRecorderService(context.runtime, { collectorPath: helper, platform: "linux" });
  try {
    const desktop = object(object(await service.actions.capabilities({})).desktop);
    assert.equal(desktop.supported, true);
    assert.ok(!(await readdir(context.runtime.storage.dataDir)).includes("binaries"));
    assert.deepEqual(await readFile(helper), script);
    await writeFile(helper, Buffer.alloc(1_048_577));
    const oversized = object(object(await service.actions.capabilities({})).desktop);
    assert.equal(oversized.supported, false);
    assert.match(String(oversized.reason), /bounded regular file/);
  } finally { await service.dispose(); await context.remove(); }
});
