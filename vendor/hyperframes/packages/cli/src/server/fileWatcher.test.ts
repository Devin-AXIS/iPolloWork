import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectWatcher, readWatchedFileVersion, shouldWatchProjectFile } from "./fileWatcher";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createProjectWatcher", () => {
  it("bounds version reads to small text files, skipping media and oversized source", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperframes-event-version-")); tempDirs.push(dir);
    const source = join(dir, "index.html"), media = join(dir, "original.mp4");
    writeFileSync(source, "<html>base</html>"); writeFileSync(media, Buffer.alloc(3_000_000));
    expect(readWatchedFileVersion(source)).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(readWatchedFileVersion(media)).toBeNull();
    writeFileSync(source, Buffer.alloc(2_000_001));
    expect(readWatchedFileVersion(source)).toBeNull();
    expect(readWatchedFileVersion(dir)).toBeNull();
    expect(shouldWatchProjectFile("enhancement/job/.cache/frame-0001.jpg")).toBe(false);
  });
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
