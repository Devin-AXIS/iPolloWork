import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertVideoBinaryTarget, assertVideoPackageMetadata, resolveVideoResourceTarget } from "../scripts/package-video-resources.mjs";
import test from "node:test";

const prepareRuntimeSource = await readFile(
  new URL("../scripts/prepare-hyperframes-runtime.mjs", import.meta.url),
  "utf8",
);
const buildCopySource = await readFile(
  new URL("../../../vendor/hyperframes/packages/cli/scripts/build-copy.mjs", import.meta.url),
  "utf8",
);
const electronMainSource = await readFile(new URL("./main.mjs", import.meta.url), "utf8");
const electronDevSource = await readFile(new URL("../scripts/electron-dev.mjs", import.meta.url), "utf8");
const electronBuildSource = await readFile(new URL("../scripts/electron-build.mjs", import.meta.url), "utf8");
const electronBuilderSource = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
const studioViteSource = await readFile(
  new URL("../../../vendor/hyperframes/packages/studio/vite.config.ts", import.meta.url),
  "utf8",
);

test("stages HyperFrames dependencies in an electron-builder-safe layout", () => {
  assert.match(prepareRuntimeSource, /"--linker", "hoisted"/);
  assert.match(prepareRuntimeSource, /import\("fontkit"\)/);
  assert.match(prepareRuntimeSource, /import\("onnxruntime-node"\)/);
});

test("migrates an existing isolated Bun runtime without downloading it again", () => {
  assert.match(prepareRuntimeSource, /cachedRuntimeMatches\(expectedRuntimePackage\)/);
  assert.match(prepareRuntimeSource, /materializeBunPackages\(resolve\(runtimeRoot, "node_modules"\)\)/);
  assert.match(prepareRuntimeSource, /dereference: true/);
  assert.match(prepareRuntimeSource, /rmSync\(bunRoot, \{ recursive: true, force: true \}\)/);
  assert.match(prepareRuntimeSource, /runtimeFormatVersion = 7/);
  assert.match(prepareRuntimeSource, /pruneOnnxRuntimeBinaries/);
  assert.match(prepareRuntimeSource, /process\.platform, process\.arch/);
});

test("repairs stamped runtime resources and rejects broken cached imports without reinstalling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-hyperframes-runtime-cache-"));
  const script = path.join(root, "apps/desktop/scripts/prepare-hyperframes-runtime.mjs");
  const runtime = path.join(root, "apps/desktop/hyperframes-runtime");
  const writeFixture = async (relativePath, body) => {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);
  };
  const dependencies = { fontkit: "1.0.0", "onnxruntime-node": "1.0.0" };
  const resources = {
    "bin/hyperframes.mjs": 'import "../dist/cli.js";\n',
    "dist/cli.js": "export const fixture = true;\n",
    "dist/runtimeVersion.js": "export const runtimeVersionError = () => null;\n",
    "dist/studio/index.html": "<!doctype html><title>Current Studio</title>\n",
  };
  const prepare = () => spawnSync(process.execPath, [script], {
    cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path")), PATH: "" },
  });
  try {
    await writeFixture("apps/desktop/scripts/prepare-hyperframes-runtime.mjs", prepareRuntimeSource);
    await writeFixture("vendor/hyperframes/package.json", JSON.stringify({ private: true, resolutions: {}, overrides: {} }));
    await writeFixture("vendor/hyperframes/bun.lock", "fixture-lock\n");
    await writeFixture("vendor/hyperframes/LICENSE", "fixture-license\n");
    await writeFixture("vendor/hyperframes/packages/cli/package.json", JSON.stringify({ type: "module", dependencies }));
    for (const [relativePath, body] of Object.entries(resources)) {
      await writeFixture(`vendor/hyperframes/packages/cli/${relativePath}`, body);
    }
    await writeFixture("apps/desktop/hyperframes-runtime/package.json", JSON.stringify({
      name: "ipollowork-hyperframes-runtime", private: true, type: "module", dependencies,
    }));
    for (const packageName of Object.keys(dependencies)) {
      await writeFixture(`apps/desktop/hyperframes-runtime/node_modules/${packageName}/package.json`, JSON.stringify({
        name: packageName, type: "module", exports: "./index.js",
      }));
      await writeFixture(`apps/desktop/hyperframes-runtime/node_modules/${packageName}/index.js`, 'import "./dependency.js";\n');
      await writeFixture(`apps/desktop/hyperframes-runtime/node_modules/${packageName}/dependency.js`, "export const ready = true;\n");
    }
    const initial = prepare();
    assert.equal(initial.status, 0, initial.stderr);
    assert.match(initial.stdout, /cached runtime migrated/);
    const cached = prepare();
    assert.equal(cached.status, 0, cached.stderr);
    assert.match(cached.stdout, /up to date; skipping staging/);

    await rm(path.join(runtime, "packages/cli/dist/runtimeVersion.js"));
    await rm(path.join(runtime, "packages/cli/dist/studio/index.html"));
    const repaired = prepare();
    assert.equal(repaired.status, 0, repaired.stderr);
    for (const [relativePath, body] of Object.entries(resources)) {
      assert.equal(await readFile(path.join(runtime, "packages/cli", relativePath), "utf8"), body);
    }
    assert.match(repaired.stdout, /cached runtime migrated/);
    assert.doesNotMatch(repaired.stdout, /Preparing slim/);

    const stamp = await readFile(path.join(runtime, ".runtime-stamp.json"), "utf8");
    await rm(path.join(runtime, "node_modules/fontkit/dependency.js"));
    const broken = prepare();
    assert.notEqual(broken.status, 0, "a stamped runtime with a broken import must fail the build");
    assert.match(broken.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.doesNotMatch(broken.stdout, /up to date; skipping staging/);
    assert.equal(await readFile(path.join(runtime, ".runtime-stamp.json"), "utf8"), stamp);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("keeps the separately packaged registry out of the cached runtime", () => {
  const cleanupIndex = prepareRuntimeSource.indexOf(
    'rmSync(resolve(runtimeRoot, "registry"), { recursive: true, force: true })',
  );
  const cacheSkipIndex = prepareRuntimeSource.indexOf(
    'console.log("HyperFrames packaged runtime is up to date; skipping staging.")',
  );
  assert.ok(cleanupIndex >= 0);
  assert.ok(cleanupIndex < cacheSkipIndex);
});

test("bundles one codec resource set alongside HyperFrames runtime and registry", () => {
  assert.match(electronBuildSource, /prepare-hyperframes-runtime\.mjs/);
  assert.match(electronBuilderSource, /from: hyperframes-runtime[\s\S]*to: hyperframes/);
  assert.match(electronBuilderSource, /from: \.\.\/\.\.\/vendor\/hyperframes\/registry[\s\S]*to: hyperframes\/registry/);
  assert.match(electronBuilderSource, /from: video-codecs\s+to: video-codecs/);
  assert.match(electronBuildSource, /package-video-resources\.mjs.*--bundled/);
  assert.match(prepareRuntimeSource, /pruneStaticMediaBinaries/);
  assert.match(prepareRuntimeSource, /\["ffmpeg-static", "ffprobe-static"\]/);
});

test("cleans stale hashed Studio assets before copying a new build", () => {
  assert.match(buildCopySource, /rmSync\(join\(DIST, sub\), \{ recursive: true, force: true \}\)/);
  assert.ok(
    buildCopySource.indexOf("rmSync(join(DIST, sub)") <
      buildCopySource.indexOf('for (const entry of ["index.html", "assets", "icons", "favicon.svg"])'),
  );
});

test("ships only the Studio browser application", () => {
  assert.match(buildCopySource, /\["index\.html", "assets", "icons", "favicon\.svg"\]/);
  assert.doesNotMatch(buildCopySource, /copyDirContents\(studioDist/);
});

test("rebuilds the dev Studio when shared HyperFrames source changes", () => {
  assert.match(electronDevSource, /const hyperframesDevBuildInputRoots = \[/);
  assert.match(electronDevSource, /"core"/);
  assert.match(electronDevSource, /"studio"/);
  assert.match(electronDevSource, /"studio-server"/);
  assert.match(electronDevSource, /newestBuildInputTime > studioBuildTime/);
});

test("builds Studio against the current iPolloWork runtime contracts", () => {
  assert.match(studioViteSource, /"@ipollowork\/types\/hyperframes": resolve\(/);
  assert.match(studioViteSource, /packages\/types\/src\/hyperframes\.ts/);
  assert.match(studioViteSource, /"@ipollowork\/types\/video-image-workbench": resolve\(/);
});

test("keeps a recently closed Studio process warm for a bounded same-session reopen", () => {
  assert.match(electronMainSource, /HYPERFRAMES_IDLE_STOP_DELAY_MS = 60_000/);
  assert.match(electronMainSource, /scheduleHyperframesStopForKey/);
  assert.match(electronMainSource, /current\.projectPath === projectPath/);
  assert.match(electronMainSource, /clearTimeout\(current\.idleTimeout\)/);
});

async function waitForPreview(predicate) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate(), "preview lifecycle did not reach the expected state");
}

function previewLifecycleFixture(init = async () => {}) {
  const spawned = [];
  const processes = new Map();
  const starts = new Map();
  const readiness = new Map();
  let nextPort = 3659;
  const dependencies = {
    hyperframesProcesses: processes, hyperframesStarts: starts, hyperframesExportLeases: new Map(),
    videoResourceManager: { applyEnvironment: async () => true }, path,
    hyperframesKey: (sender, session) => `${sender}:${session}`,
    resolveWorkspaceChild: (root, project) => ({ workspaceRoot: root, projectPath: path.resolve(root, project), projectDirectory: project }),
    ensureProcessCleanupForWebContents() {}, runHyperframesInit: init,
    reserveHyperframesPort: async () => nextPort++, releaseHyperframesPortReservation() {},
    HYPERFRAMES_START_TIMEOUT_MS: 1000,
    spawnLocalHyperframes(args) {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null,
      });
      const port = Number(args[args.indexOf("--port") + 1]);
      let ready;
      const promise = new Promise(resolve => { ready = resolve; });
      readiness.set(port, promise);
      spawned.push({ child, args, port, ready });
      return child;
    },
    waitForHyperframesServer: port => readiness.get(port),
    killProcessTree(child) {
      if (child.exitCode !== null) return;
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0));
    },
  };
  const stop = electronMainSource.slice(electronMainSource.indexOf("function stopHyperframesForKey("), electronMainSource.indexOf("function scheduleHyperframesStopForKey("));
  const start = electronMainSource.slice(electronMainSource.indexOf("async function startHyperframesPreview("), electronMainSource.indexOf("// Production Electron shares"));
  const lifecycle = new Function(...Object.keys(dependencies), `${stop}\n${start}\nreturn { start: startHyperframesPreview, stop: stopHyperframesForKey };`)(...Object.values(dependencies));
  const options = { workspaceRoot: os.tmpdir(), sessionId: "reopen", projectDirectory: "video/reopen", port: 3659 };
  const event = { sender: { id: 7 } };
  return { ...lifecycle, spawned, processes, starts, open: changes => lifecycle.start(event, { ...options, ...changes }), close: () => lifecycle.stop("7:reopen") };
}

test("owns an official foreground preview across readiness, reuse, close and reopen", async () => {
  const fixture = previewLifecycleFixture();
  const first = fixture.open();
  const concurrent = fixture.open();
  await waitForPreview(() => fixture.spawned.length > 0);
  const initial = fixture.spawned[0];
  initial.ready({ isHyperframes: true });
  try {
    assert.equal((await first).port, 3659);
    assert.equal((await concurrent).port, 3659);
    assert.ok(initial.args.includes("--foreground"), "a non-interactive preview must remain attached to the owned child");
    assert.ok(initial.args.includes("--force-new"), "the reserved port must not silently reuse a detached preview on a different port");
    assert.equal((await fixture.open()).reused, true);
    assert.equal(fixture.spawned.length, 1);
    fixture.close();
    assert.equal(initial.child.exitCode, 0);
    const reopened = fixture.open();
    await waitForPreview(() => fixture.spawned.length === 2);
    fixture.spawned[1].ready({ isHyperframes: true });
    assert.equal((await reopened).port, 3660);
    assert.equal(fixture.processes.get("7:reopen").process, fixture.spawned[1].child);
  } finally { fixture.close(); }
});

test("replacing the same session's project stops the previous child without cancelling its own start", async () => {
  const fixture = previewLifecycleFixture();
  const first = fixture.open();
  await waitForPreview(() => fixture.spawned.length > 0);
  fixture.spawned[0].ready({ isHyperframes: true });
  await first;
  const replaced = fixture.open({ projectDirectory: "video/recovered-project" });
  await waitForPreview(() => fixture.spawned.length === 2);
  fixture.spawned[1].ready({ isHyperframes: true });
  try {
    assert.equal((await replaced).port, 3660);
    assert.equal(fixture.spawned[0].child.exitCode, 0);
    assert.equal(fixture.processes.get("7:reopen").process, fixture.spawned[1].child);
  } finally { fixture.close(); }
});

test("closing during init cancels the old start without blocking or spawning after reopen", async () => {
  let releaseInit = () => {};
  let calls = 0;
  const blocked = new Promise(resolve => { releaseInit = () => resolve(undefined); });
  const fixture = previewLifecycleFixture(() => ++calls === 1 ? blocked : Promise.resolve());
  const cancelled = fixture.open().then(() => { throw new Error("cancelled start resolved"); }, error => error);
  await waitForPreview(() => calls > 0);
  fixture.close();
  const reopened = fixture.open();
  releaseInit();
  await waitForPreview(() => fixture.spawned.length > 0);
  fixture.spawned[0].ready({ isHyperframes: true });
  try {
    assert.match((await cancelled).message, /cancelled/i);
    assert.equal((await reopened).port, 3660);
    assert.equal(fixture.spawned.length, 1, "the closed init must never launch a server");
    assert.equal(fixture.starts.size, 0);
  } finally { fixture.close(); }
});

test("closing during readiness rejects promptly and stale completion cannot replace the reopened child", async () => {
  const fixture = previewLifecycleFixture();
  const cancelled = fixture.open().then(() => { throw new Error("cancelled start resolved"); }, error => error);
  await waitForPreview(() => fixture.spawned.length > 0);
  const old = fixture.spawned[0];
  fixture.close();
  const reopened = fixture.open();
  await waitForPreview(() => fixture.spawned.length === 2);
  const next = fixture.spawned[1];
  old.ready({ isHyperframes: true });
  next.ready({ isHyperframes: true });
  try {
    assert.match((await cancelled).message, /cancelled|stopped/i);
    assert.equal((await reopened).port, 3660);
    assert.equal(old.child.exitCode, 0);
    assert.equal(next.child.exitCode, null);
    assert.equal(fixture.processes.get("7:reopen").process, next.child);
  } finally { fixture.close(); }
});

test("recovers a missing Studio entry without overwriting a non-empty project", () => {
  assert.match(electronMainSource, /existingEntries\.length === 0/);
  assert.match(electronMainSource, /await mkdtemp\(path\.join\(path\.dirname\(projectPath\)/);
  assert.match(electronMainSource, /path\.join\(recoveryRoot, path\.basename\(projectPath\)\)/);
  assert.match(electronMainSource, /force: false/);
  assert.match(electronMainSource, /errorOnExist: false/);
  assert.match(electronMainSource, /project recovery did not restore index\.html/);
});


test("selects all six explicit release targets independently of the build host", () => {
  for (const [triple, platform, arch] of [
    ["x86_64-apple-darwin", "darwin", "x64"], ["aarch64-apple-darwin", "darwin", "arm64"],
    ["x86_64-unknown-linux-gnu", "linux", "x64"], ["aarch64-unknown-linux-gnu", "linux", "arm64"],
    ["x86_64-pc-windows-msvc", "win32", "x64"], ["aarch64-pc-windows-msvc", "win32", "arm64"],
  ]) assert.deepEqual(resolveVideoResourceTarget(triple, "darwin", "arm64"), { platform, arch });
  assert.deepEqual(resolveVideoResourceTarget("", "linux", "x64"), { platform: "linux", arch: "x64" });
  for (const target of ["unknown", "__proto__", "i686-pc-windows-msvc"]) assert.throws(() => resolveVideoResourceTarget(target), /Unsupported video resource target/);
  assert.throws(() => resolveVideoResourceTarget("", "win32", "ia32"), /Unsupported video resource target/);
});

test("rejects installer package metadata that disagrees with the pinned target", () => {
  const expected = { name: "@ffmpeg-installer/darwin-x64", version: "4.1.0", platform: "darwin", arch: "x64" };
  const metadata = { name: expected.name, version: expected.version, os: ["darwin"], cpu: ["x64"] };
  assert.doesNotThrow(() => assertVideoPackageMetadata(metadata, expected));
  for (const override of [{ name: "@ffmpeg-installer/darwin-arm64" }, { version: "4.1.5" }, { os: ["linux"] }, { cpu: ["arm64"] }, { os: "darwin" }, { cpu: "x64" }]) {
    assert.throws(() => assertVideoPackageMetadata({ ...metadata, ...override }, expected), /does not match/);
  }
});

test("checks actual Mach-O, ELF and PE CPU headers rather than trusting package names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codec-header-test-"));
  try {
    for (const { platform, arch, machine } of [
      { platform: "darwin", arch: "x64", machine: 0x01000007 }, { platform: "darwin", arch: "arm64", machine: 0x0100000c },
      { platform: "linux", arch: "x64", machine: 62 }, { platform: "linux", arch: "arm64", machine: 183 },
      { platform: "win32", arch: "x64", machine: 0x8664 }, { platform: "win32", arch: "arm64", machine: 0xaa64 },
    ]) {
      const bytes = Buffer.alloc(134);
      if (platform === "darwin") { bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(machine, 4); }
      else if (platform === "linux") { bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0); bytes.writeUInt16LE(machine, 18); }
      else { bytes.write("MZ"); bytes.writeUInt32LE(128, 60); bytes.writeUInt32LE(0x00004550, 128); bytes.writeUInt16LE(machine, 132); }
      const binary = path.join(root, `${platform}-${arch}`);
      await writeFile(binary, bytes);
      await assertVideoBinaryTarget(binary, { platform, arch });
      await assert.rejects(assertVideoBinaryTarget(binary, { platform, arch: arch === "x64" ? "arm64" : "x64" }), /architecture mismatch/);
      await assert.rejects(assertVideoBinaryTarget(binary, { platform: platform === "linux" ? "darwin" : "linux", arch }), /architecture mismatch/);
    }
    const invalid = path.join(root, "invalid");
    await writeFile(invalid, "not an executable");
    await assert.rejects(assertVideoBinaryTarget(invalid, { platform: "darwin", arch: "arm64" }), /architecture mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("packages the existing native codecs for an explicit target without host fallbacks", { skip: process.platform === "win32" && process.arch === "arm64" ? "Windows ARM64 uses the separately verified upstream release rather than npm installer binaries" : false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ipollowork-codec-package-test-"));
  const script = fileURLToPath(new URL("../scripts/package-video-resources.mjs", import.meta.url));
  const require = createRequire(import.meta.url);
  const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${({ darwin: "apple-darwin", linux: "unknown-linux-gnu", win32: "pc-windows-msvc" })[process.platform]}`;
  try {
    const result = spawnSync(process.execPath, [script, "--bundled", "--outdir", root], { encoding: "utf8", env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: undefined, CARGO_CFG_TARGET_TRIPLE: undefined, TARGET: triple }, timeout: 30_000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const target = resolveVideoResourceTarget(triple);
    for (const id of ["ffmpeg", "ffprobe"]) {
      const directory = path.join(root, id);
      const binary = path.join(directory, process.platform === "win32" ? `${id}.exe` : id);
      await assertVideoBinaryTarget(binary, target);
      const metadata = JSON.parse(await readFile(path.join(directory, "BINARY-PACKAGE.json"), "utf8"));
      const installer = require(`@${id}-installer/${id}/package.json`);
      assertVideoPackageMetadata(metadata, { name: `@${id}-installer/${target.platform}-${target.arch}`, version: installer.optionalDependencies[`@${id}-installer/${target.platform}-${target.arch}`], ...target });
      assert.ok((await readFile(path.join(directory, "LICENSE-GPL-3.0.txt"), "utf8")).includes("GNU GENERAL PUBLIC LICENSE"));
      assert.equal((await readdir(directory)).filter(name => name === "ffmpeg.exe" || name === "ffprobe.exe").length, process.platform === "win32" ? 1 : 0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
