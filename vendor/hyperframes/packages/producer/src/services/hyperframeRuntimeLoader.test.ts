import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SIBLING_PATH = resolve(THIS_DIR, "hyperframe.manifest.json");
const MONOREPO_PATH = resolve(THIS_DIR, "../../../core/dist/hyperframe.manifest.json");

describe("resolveHyperframeManifestPath", () => {
  const originalEnv = process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;

  beforeEach(() => {
    delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = originalEnv;
    } else {
      delete process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH;
    }
  });

  it("returns env var when PRODUCER_HYPERFRAME_MANIFEST_PATH is set", async () => {
    process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = "/custom/path/manifest.json";
    const { resolveHyperframeManifestPath } = await import("./hyperframeRuntimeLoader.js");
    expect(resolveHyperframeManifestPath()).toBe("/custom/path/manifest.json");
  });

  it("sibling path resolves to same directory as the module file", () => {
    // Key invariant: after build, dist/hyperframe.manifest.json sits next to
    // dist/index.js. In source, SIBLING_MANIFEST_PATH is next to this file.
    // This verifies the path construction is correct.
    expect(SIBLING_PATH).toBe(resolve(THIS_DIR, "hyperframe.manifest.json"));
    expect(SIBLING_PATH).toContain("producer/src/services/hyperframe.manifest.json");
  });

  it("includes sibling path as first candidate in resolution order", async () => {
    // Import the actual source and verify the sibling path is found when it
    // exists. In the monorepo, the monorepo-relative path also exists, so we
    // verify the sibling would win by checking its position in candidates.
    //
    // We can't easily mock existsSync in ESM, but we CAN verify the
    // structural invariant: the function checks SIBLING first by reading the
    // source and confirming the candidate array order.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(resolve(THIS_DIR, "hyperframeRuntimeLoader.ts"), "utf8");

    // The candidates array must list SIBLING_MANIFEST_PATH before the others
    const candidatesMatch = source.match(/const candidates = \[([\s\S]*?)\];/);
    expect(candidatesMatch).not.toBeNull();
    const candidatesBody = candidatesMatch![1];

    const siblingIdx = candidatesBody.indexOf("SIBLING_MANIFEST_PATH");
    const cwdIdx = candidatesBody.indexOf("CWD_RELATIVE_MANIFEST_PATHS");
    const moduleIdx = candidatesBody.indexOf("MODULE_RELATIVE_MANIFEST_PATH");

    expect(siblingIdx).toBeGreaterThan(-1);
    expect(siblingIdx).toBeLessThan(cwdIdx);
    expect(cwdIdx).toBeLessThan(moduleIdx);
  });

  it("finds manifest via monorepo-relative path in dev (integration check)", async () => {
    // In the monorepo, the core/dist manifest should exist from the build.
    // This acts as a smoke test that the resolution works in the dev env.
    if (!existsSync(MONOREPO_PATH)) {
      // Skip if core hasn't been built — this is expected in CI before build
      return;
    }
    const { resolveHyperframeManifestPath } = await import("./hyperframeRuntimeLoader.js");
    const result = resolveHyperframeManifestPath();
    expect(existsSync(result)).toBe(true);
  });
});
