import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("keeps a recently closed Studio process warm for a bounded same-session reopen", () => {
  assert.match(electronMainSource, /HYPERFRAMES_IDLE_STOP_DELAY_MS = 60_000/);
  assert.match(electronMainSource, /scheduleHyperframesStopForKey/);
  assert.match(electronMainSource, /current\.projectPath === projectPath/);
  assert.match(electronMainSource, /clearTimeout\(current\.idleTimeout\)/);
});
