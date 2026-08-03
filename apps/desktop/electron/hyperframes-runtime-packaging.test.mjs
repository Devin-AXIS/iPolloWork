import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const prepareRuntimeSource = await readFile(
  new URL("../scripts/prepare-hyperframes-runtime.mjs", import.meta.url),
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
