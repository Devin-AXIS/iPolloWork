import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const producerRoot = resolve(sourceDir, "..");
const repoRoot = resolve(producerRoot, "../..");
const runtimePath = resolve(repoRoot, "packages/core/dist/hyperframe.runtime.iife.js");
const fixturesDir = resolve(producerRoot, "tests/parity/fixtures");
const fixtureRuntimePath = resolve(fixturesDir, "hyperframe.runtime.iife.js");

if (!existsSync(runtimePath)) {
  throw new Error(
    `Missing preview runtime at ${runtimePath}. Run "bun run --cwd packages/core build:hyperframes-runtime" first.`,
  );
}

mkdirSync(fixturesDir, { recursive: true });
copyFileSync(runtimePath, fixtureRuntimePath);

console.log(`[ParityFixtures] copied ${runtimePath} -> ${fixtureRuntimePath}`);
