import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectWatcher, shouldWatchProjectFile } from "./fileWatcher";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createProjectWatcher", () => {
  it("ignores generated thumbnails while watching authored compositions", () => {
    expect(shouldWatchProjectFile(".thumbnails/scene.png")).toBe(false);
    expect(shouldWatchProjectFile(".thumbnails/scene.json")).toBe(false);
    expect(shouldWatchProjectFile("compositions/scene/scene.html")).toBe(true);
  });

  it("reports every changed path in one debounced write burst", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hyperframes-watcher-"));
    tempDirs.push(projectDir);
    const changedPaths = new Set<string>();
    const watcher = createProjectWatcher(projectDir);
    watcher.addListener((path) => changedPaths.add(path.replaceAll("\\", "/")));

    writeFileSync(join(projectDir, "index.html"), "final composition");
    writeFileSync(join(projectDir, "brief.json"), "{}");

    await expect
      .poll(() => [...changedPaths].sort(), { timeout: 2_000 })
      .toEqual(["brief.json", "index.html"]);
    watcher.close();
  });
});
