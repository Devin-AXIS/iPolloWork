import { test, expect, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderedSceneWindows, reviewRenderedPixels, reviewRenderedAudio, videoProjectFingerprint, videoRenderAction } from "./video-render.js";

test("render review reads standard timed HTML attributes and skips incomplete or invalid scene windows", () => {
  for (const timing of ['data-start="0" data-duration="3"', "data-start = 0 data-duration=3", 'data-start="&#48;" data-duration="&#x33;"']) {
    expect(renderedSceneWindows(`<section class="scene clip" id=" proof " ${timing}></section>`)).toEqual([
      { sceneId: "proof", start: 0, duration: 3, motion: [], transitionDuration: 0 },
    ]);
  }
  for (const timing of ["data-duration=3", "data-start=0", 'data-start=" " data-duration=3', "data-start=NaN data-duration=3", "data-start=0 data-duration=Infinity", "data-start=0 data-duration=0"]) {
    expect(renderedSceneWindows(`<section class="scene" ${timing}></section>`)).toEqual([]);
  }
});

test("project fingerprint invalidates nested media, CSS and composition edits but excludes generated evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-review-fingerprint-"));
  try {
    await mkdir(join(root, "compositions"));
    await mkdir(join(root, "assets"));
    await mkdir(join(root, "renders"));
    await writeFile(join(root, "index.html"), "<html></html>");
    let previous = await videoProjectFingerprint(root);
    for (const path of ["compositions/recipe.html", "design-tokens.css", "assets/narration.mp3", "assets/.texture.png", "STORYBOARD.md"]) {
      await writeFile(join(root, path), "first");
      const created = await videoProjectFingerprint(root);
      expect(created).not.toBe(previous);
      await writeFile(join(root, path), "edited");
      previous = await videoProjectFingerprint(root);
      expect(previous).not.toBe(created);
    }
    await writeFile(join(root, "renders/proof.png"), "generated evidence");
    expect(await videoProjectFingerprint(root)).toBe(previous);
    try {
      await symlink(join(root, "index.html"), join(root, "assets/unsafe.html"), "file");
    } catch (error) {
      if (process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM") return;
      throw error;
    }
    await expect(videoProjectFingerprint(root)).rejects.toThrow("symlinks");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("output mix review decodes actual audio and distinguishes silence from unverified audible synchronization", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-mix-review-"));
  const exec = promisify(execFile), ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  const html = '<audio src="assets/voice.mp3" data-ipw-voiceover="true" data-volume="1"></audio>';
  try {
    const missing = join(root, "missing.mp4"), silent = join(root, "silent.mp4"), audible = join(root, "audible.mp4");
    await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=gray:size=192x108:rate=30:duration=1", "-c:v", "libx264", missing]);
    for (const [path, source] of [[silent, "anullsrc=r=24000:cl=mono"], [audible, "sine=frequency=440:sample_rate=24000"]]) {
      await exec(ffmpeg, ["-v", "error", "-i", missing, "-f", "lavfi", "-i", source, "-t", "1", "-c:v", "copy", "-c:a", "aac", path]);
    }
    expect((await reviewRenderedAudio(missing, html)).issues).toEqual(["required-output-audio-unavailable"]);
    expect((await reviewRenderedAudio(silent, html)).valid).toBe(false);
    const result = await reviewRenderedAudio(audible, html);
    expect(result.valid).toBe(true);
    expect(result.peakDb).toBeLessThan(0);
    expect(result.scope).toBe("decoded-mix-health-not-audible-sync-approval");
    expect((await reviewRenderedAudio(missing, "<html></html>")).required).toBe(false);
    expect((await reviewRenderedAudio(missing, `<!-- ${html} --><script>const demo=${JSON.stringify(html)};</script><template>${html}</template>`)).required).toBe(false);
    expect((await reviewRenderedAudio(missing, html.replace('data-volume="1"', 'data-volume="0"'))).valid).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test("real rendered review rejects declared static motion and blank transitions but permits reading holds", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-pixel-review-"));
  const exec = promisify(execFile);
  const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
  const beats = JSON.stringify([{ animation: "custom:evidence", motion: { start: .5, end: 1.5 } }]);
  const html = `<section id="evidence" class="scene clip" data-start="0" data-duration="3" data-ipw-beats='${beats}'></section>`;
  try {
    const still = join(root, "still.mp4"), moving = join(root, "moving.mp4"), transition = join(root, "transition.mp4");
    await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=gray:size=192x108:rate=30:duration=3", "-vf", "drawbox=x=40:y=20:w=60:h=60:color=white:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", still]);
    await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=192x108:rate=30:duration=3", "-c:v", "libx264", moving]);
    await exec(ffmpeg, ["-v", "error", "-i", moving, "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,0.5)'", "-c:v", "libx264", transition]);
    const failed = await reviewRenderedPixels(still, html);
    expect(failed.valid).toBe(false);
    expect(failed.blankSceneIds).toEqual([]);
    expect(failed.issues?.[0]?.code).toBe("declared-motion-not-visible");
    expect((await reviewRenderedPixels(still, html.replace("custom:evidence", "hold:read-evidence"))).valid).toBe(true);
    expect((await reviewRenderedPixels(moving, html)).valid).toBe(true);
    expect((await reviewRenderedPixels(transition, html.replace('data-duration="3"', 'data-duration="3" data-ipw-transition-duration="0.6"'))).issues?.some(issue => issue.code === "blank-transition-sample")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test("built-in export starts Studio once, resumes progress, verifies output and rejects bad paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-export-"));
  const nativeFetch = globalThis.fetch;
  const previous = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  const sourcePath = "video/ses_export/index.html";
  const workspace = { id: "ws_export", path: root };
  let starts = 0;
  let readyCalls = 0;
  const renderUrls: string[] = [];
  let status = "rendering";
  const discovery = join(root, "bridge.json");
  await mkdir(join(root, "video/ses_export/renders"), { recursive: true });
  await writeFile(join(root, sourcePath), "<html></html>");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://127.0.0.1:54321", token: "test-token" }));
  process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = discovery;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/video/ensure-studio")) { readyCalls++; return Response.json({ ok: true, port: 3456 }); }
    if (url.endsWith("/render")) { renderUrls.push(url); starts++; return Response.json({ jobId: `ses_export_job${starts}` }); }
    if (url.endsWith("/progress")) return new Response(`event: progress\ndata: ${JSON.stringify({ status, progress: status === "complete" ? 100 : 35, stage: "rendering", ...(status === "failed" ? { error: "encoder failed" } : {}) })}\n\n`);
    throw new Error(`Unexpected URL ${url}`);
  }, nativeFetch);
  const args = { sourcePath, operationKey: "publish-1" };
  async function settle(input = args) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await videoRenderAction(workspace, "video_render_status", input);
      if (result.status !== "preparing") return result;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error("preparing did not settle");
  }
  try {
    expect((await videoRenderAction(workspace, "video_render_start", args)).status).toBe("preparing");
    expect((await settle()).status).toBe("rendering");
    expect(renderUrls[0]).toBe("http://127.0.0.1:3456/api/projects/ses_export/render");
    await videoRenderAction(workspace, "video_render_start", args);
    expect(starts).toBe(1);
    expect(readyCalls).toBe(1);
    status = "complete";
    await writeFile(join(root, "video/ses_export/renders/ses_export_job1.mp4"), "test mp4");
    const completed = await settle();
    expect(completed.status).toBe("complete");
    expect(completed.outputPath).toBe("video/ses_export/renders/ses_export_job1.mp4");
    await videoRenderAction(workspace, "video_render_start", args);
    expect(starts).toBe(1);
    status = "failed";
    const failedArgs = { sourcePath, operationKey: "publish-2" };
    await videoRenderAction(workspace, "video_render_start", failedArgs);
    const failed = await settle(failedArgs);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("encoder failed");
    expect(failed.outputPath).toBeUndefined();
    await expect(videoRenderAction(workspace, "video_render_start", { ...args, sourcePath: "../other/index.html" })).rejects.toThrow();
    await expect(videoRenderAction(workspace, "video_render_status", { ...args, operationKey: "unknown" })).rejects.toThrow("No export exists");
  } finally {
    globalThis.fetch = nativeFetch;
    if (previous === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY; else process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a delayed preparing snapshot cannot overwrite the committed Studio job or its encoder failure", async () => {
  const root = await fs.realpath(await mkdtemp(join(tmpdir(), "ipw-export-race-")));
  const sourcePath = "video/ses_race/index.html", operationKey = "delayed-status";
  const workspace = { id: "ws_race", path: root }, args = { sourcePath, operationKey };
  const renders = join(root, "video/ses_race/renders");
  const receiptPath = join(renders, `.export-${createHash("sha256").update(operationKey).digest("hex")}.json`);
  const nativeFetch = globalThis.fetch, previous = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  const nativeRealpath = fs.realpath, nativeRead = fs.readFile, nativeRm = fs.rm;
  let releaseLookup = () => {}, lookupStarted = () => {}, releaseSnapshot = () => {}, snapshotRead = () => {}, releaseStudio = () => {};
  const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
  const lookupPending = new Promise<void>(resolve => { lookupStarted = resolve; });
  const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  const snapshotPending = new Promise<void>(resolve => { snapshotRead = resolve; });
  const studioGate = new Promise<void>(resolve => { releaseStudio = resolve; });
  let firstLookup = true, firstRead = true, firstSave = true, starts = 0;
  await mkdir(renders, { recursive: true });
  await writeFile(join(root, sourcePath), "<html></html>");
  const discovery = join(root, "bridge.json");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://127.0.0.1:54321", token: "test-token" }));
  process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = discovery;
  // Bun's spies require every fs overload; forwarding preserves encoding/results.
  const lookup = spyOn(fs, "realpath").mockImplementation((async (...args: Parameters<typeof fs.realpath>) => {
    if (args[0] === receiptPath && firstLookup) { firstLookup = false; lookupStarted(); await lookupGate; }
    return nativeRealpath(...args);
  }) as typeof fs.realpath);
  const read = spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
    const text = await nativeRead(...args);
    if (args[0] === receiptPath && firstRead) { firstRead = false; snapshotRead(); await snapshotGate; }
    return text;
  }) as typeof fs.readFile);
  const remove = spyOn(fs, "rm").mockImplementation(async (path, options) => {
    await nativeRm(path, options);
    if (String(path).startsWith(`${receiptPath}.`) && firstSave) {
      firstSave = false;
      // Release the captured read after save() and the owner's finally cleanup.
      setImmediate(releaseSnapshot);
    }
  });
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/video/ensure-studio")) { await studioGate; return Response.json({ ok: true, port: 3456 }); }
    if (url.endsWith("/render")) { starts++; return Response.json({ jobId: "race_job" }); }
    if (url.endsWith("/progress")) return new Response('data: {"status":"failed","error":"encoder failed"}\n\n');
    throw new Error(`Unexpected URL ${url}`);
  }, nativeFetch);
  const delayedStatus = videoRenderAction(workspace, "video_render_status", args);
  try {
    await lookupPending;
    expect((await videoRenderAction(workspace, "video_render_start", args)).status).toBe("preparing");
    releaseLookup();
    await snapshotPending;
    releaseStudio();
    const result = await delayedStatus;
    expect(result.status).toBe("failed");
    expect(result.error).toBe("encoder failed");
    expect(result.jobId).toBe("race_job");
    expect(JSON.parse(await nativeRead(receiptPath, "utf8")).error).toBe("encoder failed");
    expect((await videoRenderAction(workspace, "video_render_start", args)).jobId).toBe("race_job");
    expect(starts).toBe(1);
    const orphan = { sourcePath, operationKey: "persisted-before-restart" };
    await writeFile(join(renders, `.export-${createHash("sha256").update(orphan.operationKey).digest("hex")}.json`), JSON.stringify({ status: "preparing", startedAt: Date.now() }));
    const interrupted = await videoRenderAction(workspace, "video_render_status", orphan);
    expect(interrupted.status).toBe("failed");
    expect(interrupted.error).toContain("service restart");
    expect((await videoRenderAction(workspace, "video_render_start", orphan)).error).toBe(interrupted.error);
    expect(starts).toBe(1);
  } finally {
    releaseLookup(); releaseSnapshot(); releaseStudio();
    await delayedStatus.catch(() => {});
    lookup.mockRestore(); read.mockRestore(); remove.mockRestore();
    globalThis.fetch = nativeFetch;
    if (previous === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY; else process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("export reservations reuse partial initial receipts, enforce the preparation cap and release failed claims", async () => {
  const root = await fs.realpath(await mkdtemp(join(tmpdir(), "ipw-export-reservation-")));
  const sourcePath = "video/ses_reservation/index.html", workspace = { id: "ws_reservation", path: root };
  const renders = join(root, "video/ses_reservation/renders");
  const receiptPath = (key: string) => join(renders, `.export-${createHash("sha256").update(key).digest("hex")}.json`);
  const nativeWrite = fs.writeFile, nativeRm = fs.rm, nativeFetch = globalThis.fetch;
  const previous = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  let releaseWrites = () => {}, allReserved = () => {}, allCommitted = () => {}, retryCommitted = () => {};
  const writeGate = new Promise<void>(resolve => { releaseWrites = resolve; });
  const reserved = new Promise<void>(resolve => { allReserved = resolve; });
  const committed = new Promise<void>(resolve => { allCommitted = resolve; });
  const retrySaved = new Promise<void>(resolve => { retryCommitted = resolve; });
  let writes = 0, commits = 0, starts = 0, denied = false, retried = false;
  await mkdir(renders, { recursive: true });
  await writeFile(join(root, sourcePath), "<html></html>");
  const discovery = join(root, "bridge.json");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://127.0.0.1:54321", token: "test-token" }));
  process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = discovery;
  const write = spyOn(fs, "writeFile").mockImplementation(async (path, data, options) => {
    if (path === receiptPath("denied") && !denied) { denied = true; throw Object.assign(new Error("write denied"), { code: "EACCES" }); }
    if (path === receiptPath("external")) {
      await nativeWrite(path, JSON.stringify({ status: "failed", startedAt: Date.now(), error: "existing external receipt" }));
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    }
    if (String(path).endsWith(".json") && String(path).includes(".export-") && path !== receiptPath("denied")) {
      await nativeWrite(path, "{", options);
      if (++writes === 16) allReserved();
      await writeGate;
      return nativeWrite(path, data, "utf8");
    }
    return nativeWrite(path, data, options);
  });
  const remove = spyOn(fs, "rm").mockImplementation(async (path, options) => {
    await nativeRm(path, options);
    if (String(path).endsWith(".tmp") && ++commits === 16) setImmediate(allCommitted);
    if (String(path).startsWith(`${receiptPath("denied")}.`)) setImmediate(retryCommitted);
  });
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/video/ensure-studio")) return Response.json({ ok: true, port: 3456 });
    if (url.endsWith("/render")) return Response.json({ jobId: `reservation_job${++starts}` });
    if (url.endsWith("/progress")) return new Response('data: {"status":"failed","error":"encoder failed"}\n\n');
    throw new Error(`Unexpected URL ${url}`);
  }, nativeFetch);
  const pending: ReturnType<typeof videoRenderAction>[] = [];
  try {
    await expect(videoRenderAction(workspace, "video_render_start", { sourcePath, operationKey: "denied" })).rejects.toThrow("write denied");
    expect((await videoRenderAction(workspace, "video_render_start", { sourcePath, operationKey: "external" })).error).toBe("existing external receipt");
    for (let i = 0; i < 16; i++) pending.push(videoRenderAction(workspace, "video_render_start", { sourcePath, operationKey: `reserved-${i}` }));
    await reserved;
    const args = { sourcePath, operationKey: "reserved-0" };
    for (const action of ["video_render_start", "video_render_status"]) {
      const reused = await Promise.all(Array.from({ length: 8 }, () => videoRenderAction(workspace, action, args)));
      expect(reused.every(receipt => receipt.status === "preparing")).toBe(true);
    }
    expect(starts).toBe(0);
    await expect(videoRenderAction(workspace, "video_render_start", { sourcePath, operationKey: "over-cap" })).rejects.toThrow("Too many exports");
    releaseWrites();
    expect((await Promise.all(pending)).every(receipt => receipt.status === "preparing")).toBe(true);
    await committed;
    expect(starts).toBe(16);
    expect((await videoRenderAction(workspace, "video_render_status", args)).error).toBe("encoder failed");
    const retry = await videoRenderAction(workspace, "video_render_start", { sourcePath, operationKey: "denied" });
    retried = true;
    expect(retry.status).toBe("preparing");
  } finally {
    releaseWrites();
    await Promise.allSettled(pending);
    if (writes === 16) await committed;
    if (retried) await retrySaved;
    write.mockRestore(); remove.mockRestore();
    globalThis.fetch = nativeFetch;
    if (previous === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY; else process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime acceptance failures and changed source cannot become completed deliveries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-runtime-delivery-"));
  const nativeFetch = globalThis.fetch, previous = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  const sourcePath = "video/ses_review/index.html", directory = join(root, "video/ses_review");
  const html = '<section id="proof" class="scene clip" data-start="0" data-duration="3"></section>';
  let valid = false, starts = 0;
  await mkdir(join(directory, "renders"), { recursive: true });
  await writeFile(join(root, sourcePath), html);
  const discovery = join(root, "bridge.json");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://127.0.0.1:54321", token: "test-token" }));
  process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = discovery;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/video/ensure-studio")) return Response.json({ ok: true });
    if (url.endsWith("/render")) return Response.json({ jobId: `review_job${++starts}` });
    if (url.includes("?review=runtime")) return Response.json({ valid, sampledFrameCount: 3, scope: "runtime-timing-and-layout-not-semantic-approval", issues: valid ? [] : [{ sceneId: "proof", code: "executed-event-time-mismatch", time: 1, detail: "custom:heat" }] });
    if (url.endsWith("/progress")) return new Response('data: {"status":"complete","progress":100}\n\n');
    throw new Error(`Unexpected URL ${url}`);
  }, nativeFetch);
  const workspace = { id: "ws_review", path: root };
  try {
    for (const mode of ["failed-runtime", "valid-runtime", "valid-runtime-metadata", "review-only", "changed-dependency", "changed-source"]) {
      const validRuntime = mode.startsWith("valid-runtime");
      valid = mode !== "failed-runtime";
      const args = { sourcePath, operationKey: mode, review: true, reviewOnly: mode === "review-only" };
      await videoRenderAction(workspace, "video_render_start", args);
      for (let attempt = 0; attempt < 100; attempt++) {
        const receipt = JSON.parse(await readFile(join(directory, "renders", `.export-${createHash("sha256").update(mode).digest("hex")}.json`), "utf8"));
        if (receipt.status === "rendering") break;
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      await promisify(execFile)(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=192x108:rate=30:duration=3", "-c:v", "libx264", join(directory, "renders", `review_job${starts}.mp4`)]);
      if (mode === "failed-runtime" || mode === "valid-runtime-metadata") await writeFile(join(directory, "renders", `review_job${starts}.meta.json`), '{"status":"complete"}');
      if (mode === "changed-source") await writeFile(join(root, sourcePath), html + "<!-- edited during rendering -->");
      if (mode === "changed-dependency") await writeFile(join(directory, "design-tokens.css"), "body{color:red}");
      const result = await videoRenderAction(workspace, "video_render_status", args);
      expect(result.status).toBe(validRuntime || mode === "review-only" ? "complete" : "failed");
      if (!validRuntime) expect(result.outputPath).toBeUndefined();
      if (mode === "failed-runtime") expect(result.pixelReview?.runtimeReview?.issues[0]?.code).toBe("executed-event-time-mismatch");
      if (mode === "changed-source") expect(result.error).toContain("source changed");
      if (mode === "changed-dependency") expect(result.error).toContain("dependencies");
      if (mode === "review-only") {
        expect(result.pixelReview?.evidence?.resolution).toBe("draft");
        expect(await readFile(join(root, result.pixelReview!.evidence!.videoPath))).not.toBeEmpty();
      }
      if (validRuntime) {
        expect(result.pixelReview?.evidence?.expression).toBe("unverified");
        expect(result.pixelReview?.evidence?.audibleSync).toBe("unverified");
        expect(result.pixelReview?.evidence?.frames.length).toBeGreaterThan(1);
        for (const sample of result.pixelReview?.evidence?.frames ?? []) {
          const png = await readFile(join(root, sample.path));
          expect(png.subarray(1, 4).toString()).toBe("PNG");
          expect(png.readUInt32BE(16)).toBe(192);
        }
        await writeFile(join(directory, "design-tokens.css"), `body{color:blue}/* ${mode} */`);
        const completedStarts = starts;
        const stale = await videoRenderAction(workspace, "video_render_status", args);
        expect(stale.status).toBe("failed");
        expect(stale.outputPath).toBeUndefined();
        expect(starts).toBe(completedStarts);
      }
    }
  } finally {
    globalThis.fetch = nativeFetch;
    if (previous === undefined) delete process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY; else process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
