import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "chokidar";
import type { ViteDevServer } from "vite";
import type { ProjectHistory } from "@hyperframes/studio-server";

const PROJECT = resolve("/projects/demo");

/** A compute that changes every call, so a stale read is visible as a repeat. */
function countingCompute() {
  let calls = 0;
  return {
    compute: () => `sig-${++calls}`,
    get calls() {
      return calls;
    },
  };
}

describe("createProjectSignatureCache", () => {
  it("memoises a project's signature", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    expect(cache.get(PROJECT)).toBe("sig-1");
    expect(cache.get(PROJECT)).toBe("sig-1");
    expect(source.calls).toBe(1);
  });

  it("recomputes after a file inside the project changes", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    expect(cache.get(PROJECT)).toBe("sig-1");
    cache.invalidate(resolve(PROJECT, "index.html"));

    // The preview ETag is this string. Serving "sig-1" again answers the
    // browser's revalidation with a 304 and the pre-edit composition is what
    // renders — which is how a thumbnail taken after an edit showed the old frame.
    expect(cache.get(PROJECT)).toBe("sig-2");
  });

  it("recomputes for an asset added or removed, not only one edited", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    cache.get(PROJECT);
    cache.invalidate(resolve(PROJECT, "assets/new-clip.mp4"));
    expect(cache.get(PROJECT)).toBe("sig-2");

    cache.invalidate(resolve(PROJECT, "compositions/scene.html"));
    expect(cache.get(PROJECT)).toBe("sig-3");
  });

  it("leaves other projects alone", () => {
    const signatures = new Map([
      [PROJECT, "demo"],
      [resolve("/projects/other"), "other"],
    ]);
    let bumped = 0;
    const cache = createProjectSignatureCache({
      compute: (dir) => `${signatures.get(dir)}-${bumped}`,
    });

    expect(cache.get(PROJECT)).toBe("demo-0");
    expect(cache.get(resolve("/projects/other"))).toBe("other-0");

    bumped = 1;
    cache.invalidate(resolve(PROJECT, "index.html"));

    expect(cache.get(PROJECT)).toBe("demo-1");
    expect(cache.get(resolve("/projects/other"))).toBe("other-0");
  });

  it("asks for a project directory to be watched once, on first use", () => {
    const watched: string[] = [];
    const cache = createProjectSignatureCache({
      compute: () => "sig",
      watch: (dir) => watched.push(dir),
    });

    cache.get(PROJECT);
    cache.get(PROJECT);
    cache.invalidate(resolve(PROJECT, "index.html"));
    cache.get(PROJECT);

    // Re-registering on every recompute would stack duplicate chokidar entries.
    expect(watched).toEqual([PROJECT]);
  });

  it("normalises the directory it is asked about", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    expect(cache.get(PROJECT)).toBe("sig-1");
    expect(cache.get(`${PROJECT}/`)).toBe("sig-1");
    expect(cache.get(resolve(PROJECT, "nested/.."))).toBe("sig-1");
    expect(source.calls).toBe(1);
  });

  it("does not invalidate on a write the signature cannot see", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    cache.get(PROJECT);
    // Each thumbnail capture writes here and then reads the preview, so an
    // unfiltered watcher discards the memo on roughly every request of the one
    // workload the memo exists for.
    cache.invalidate(resolve(PROJECT, ".thumbnails/frame-0.jpg"));

    expect(cache.get(PROJECT)).toBe("sig-1");
    expect(source.calls).toBe(1);
  });

  it("invalidates on a motion-state save, which lives under an otherwise-skipped dir", () => {
    const source = countingCompute();
    const cache = createProjectSignatureCache({ compute: source.compute });

    cache.get(PROJECT);
    cache.invalidate(resolve(PROJECT, ".hyperframes/studio-motion.json"));

    expect(cache.get(PROJECT)).toBe("sig-2");
  });
});


it("independent project writes update preview signatures and history without Vite events", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-independent-watch-"));
  const projectDir = join(root, "demo");
  mkdirSync(projectDir);
  const indexPath = join(projectDir, "index.html");
  writeFileSync(indexPath, "<html><body>Before</body></html>");
  const watcher = watch(root, { ignoreInitial: true });
  const viteWatcher = new EventEmitter();
  const httpServer = new EventEmitter();
  const noteChange = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const source = countingCompute();
  const cache = createProjectSignatureCache({ compute: source.compute });
  const adapter = createViteAdapter(
    root,
    { watcher: viteWatcher, httpServer } as unknown as ViteDevServer,
    cache,
    {
      projectWatcher: watcher,
      openHistory: async () => ({ noteChange, close, replacedAtPath: () => false }) as unknown as ProjectHistory,
    },
  );
  try {
    await new Promise<void>((done) => watcher.once("ready", done));
    const project = adapter.resolveProject("demo")!;
    await adapter.history!(project);
    expect(cache.get(project.dir)).toBe("sig-1");
    writeFileSync(indexPath, "<html><body>After</body></html>");
    await vi.waitFor(() => expect(noteChange).toHaveBeenCalledWith(indexPath));
    expect(cache.get(project.dir)).toBe("sig-2");
    const asset = join(projectDir, "new.css");
    writeFileSync(asset, "body { color: red; }");
    await vi.waitFor(() => expect(noteChange).toHaveBeenCalledWith(asset));
    expect(cache.get(project.dir)).toBe("sig-3");
    noteChange.mockClear();
    unlinkSync(asset);
    await vi.waitFor(() => expect(noteChange).toHaveBeenCalledWith(asset));
    expect(cache.get(project.dir)).toBe("sig-4");
    expect(viteWatcher.listenerCount("all")).toBe(0);
  } finally {
    httpServer.emit("close");
    await watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});
