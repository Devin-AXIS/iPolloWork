// Real production server, uploads, extension dispatch, CPU models and FFmpeg.
// Supply a short local speech video via IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO.
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { startServer } from "../../apps/server/src/server.js";
import { resolveWithinRoot } from "../../apps/server/src/paths.js";
import type { ServerConfig } from "../../apps/server/src/types.js";
import { videoEnhancementJobSchema, videoEnhancementLayoutSchema, videoEnhancementResultSchema, type VideoEnhancementGesture } from "../../packages/types/src/video-enhancement.js";
import { buildEnhancementCues, placeEnhancementCues } from "../../apps/server/src/extensions/video-enhancement-layout.js";
// Match desktop codecs by default; a newer PATH binary can hide incompatibilities.
const desktopRequire = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
process.env.HYPERFRAMES_FFMPEG_PATH ??= desktopRequire("@ffmpeg-installer/ffmpeg").path;
process.env.HYPERFRAMES_FFPROBE_PATH ??= desktopRequire("@ffprobe-installer/ffprobe").path;
const root = process.env.IPOLLOWORK_ENHANCEMENT_PROOF_ROOT || await mkdtemp(join(tmpdir(), "ipw-enhancement-proof-"));
const source = process.env.IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO;
const port = Number(process.env.IPOLLOWORK_ENHANCEMENT_PROOF_PORT || 5287);
const mediaPort = Number(process.env.IPOLLOWORK_ENHANCEMENT_PROOF_MEDIA_PORT || 5288);
const appOrigin = process.env.IPOLLOWORK_ENHANCEMENT_PROOF_ORIGIN || "http://127.0.0.1:5268";
if (!source) throw new Error("Set IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO to a short local speech video.");
const noAudio = join(root, "missing-audio.mp4");
await promisify(execFile)(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", source, "-an", "-t", "1", "-c:v", "libx264", "-threads", "1", noAudio], { windowsHide: true, timeout: 30_000 });
await mkdir(join(root, "video/proof/assets"), { recursive: true });
await writeFile(join(root, "video/proof/index.html"), '<!doctype html><html><body style="font:24px Arial;padding:48px">增强前时间轴</body></html>', { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
// Controlled evidence isolates timing/placement/rendering from detector accuracy.
// The native model is validated separately; this fixture never claims recognition accuracy.
const nativeAnalysis = process.env.IPOLLOWORK_ENHANCEMENT_ANALYSIS_RESULT;
if (nativeAnalysis || process.env.IPOLLOWORK_ENHANCEMENT_GESTURE_PROOF === "1") {
  const id = randomUUID(), directory = join(root, "video/proof/enhancement", id);
  await mkdir(directory, { recursive: true });
  await copyFile(source, join(directory, "original.mp4"));
  const before = await readFile(join(root, "video/proof/index.html"), "utf8");
  await writeFile(join(directory, "before.html"), before);
  const segments = [
    { start: .3, end: 1.8, text: "这里放一个数据图。" }, { start: 2, end: 3.8, text: "掌心托着重点内容。" },
    { start: 4, end: 5.8, text: "向右展开流程。" }, { start: 6, end: 8, text: "双手展示对比。" },
  ];
  const gestures: VideoEnhancementGesture[] = [
    { id: "gesture-1", kind: "point", start: .2, end: 1.7, confidence: .98, target: { x: .35, y: .4 }, handId: "hand-1", motion: "hold", path: [{ time: .3, x: .3, y: .4 }, { time: 1.5, x: .35, y: .4 }] },
    { id: "gesture-2", kind: "open_palm", start: 1.9, end: 3.5, confidence: .98, target: { x: .6, y: .6 }, handId: "hand-2", motion: "support", path: [{ time: 2, x: .45, y: .65 }, { time: 2.75, x: .55, y: .6 }, { time: 3.5, x: .6, y: .6 }] },
    { id: "gesture-3", kind: "open_palm", start: 3.9, end: 5.6, confidence: .98, target: { x: .7, y: .4 }, handId: "hand-3", motion: "guide", path: [{ time: 4, x: .3, y: .4 }, { time: 5.6, x: .7, y: .4 }] },
    ...[.2, .8].map((x, i) => ({ id: `gesture-${i + 4}`, kind: "open_palm", start: 5.9, end: 8, confidence: .98, target: { x, y: .65 }, handId: `hand-${i + 4}`, motion: "hold", path: [{ time: 6, x, y: .65 }, { time: 8, x, y: .65 }] } satisfies VideoEnhancementGesture)),
  ];
  const base = { duration: 8, width: 1280, height: 720, layout: videoEnhancementLayoutSchema.parse({ mode: "background", aspectRatio: "source" }), segments, words: segments, people: [], hands: [], masks: [], gestures };
  const result = nativeAnalysis ? videoEnhancementResultSchema.parse(JSON.parse(await readFile(nativeAnalysis, "utf8")))
    : { ...base, cues: placeEnhancementCues(buildEnhancementCues(segments, 8, segments), base), warnings: ["验证使用受控轨迹与词语时间；不代表真实视频的识别准确率。"] };
  const job = videoEnhancementJobSchema.parse({ id, sessionId: "proof", sourcePath: "video/proof/assets/source.mp4", status: "ready", progress: 100, message: nativeAnalysis ? "原视频本地分析验证" : "受控手势轨迹验证", createdAt: Date.now(), baseRevision: createHash("sha256").update(before).digest("hex"), result });
  await writeFile(join(directory, "job.json"), JSON.stringify(job));
  await writeFile(join(root, "video/proof/enhancement/latest.json"), JSON.stringify({ id }));
}
const config: ServerConfig = { host: "127.0.0.1", port, token: "local-enhancement-proof", hostToken: "local-enhancement-proof",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [appOrigin],
  workspaces: [{ id: "proof", name: "Local enhancement proof", path: root, preset: "starter", workspaceType: "local" }],
  authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
await startServer(config);
Bun.serve({ hostname: "127.0.0.1", port: mediaPort, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/setup") return Response.json({ root, source, noAudio }, { headers: { "Access-Control-Allow-Origin": "*" } });
  if (url.pathname === "/witness") {
    const pointer = JSON.parse(await readFile(join(root, "video/proof/enhancement/latest.json"), "utf8"));
    const job = JSON.parse(await readFile(join(root, "video/proof/enhancement", pointer.id, "job.json"), "utf8"));
    const html = await readFile(join(root, "video/proof/index.html"), "utf8");
    return Response.json({ job, html }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (url.pathname.startsWith("/files/")) {
    try {
      const path = await resolveWithinRoot(root, decodeURIComponent(url.pathname.slice(7)));
      return new Response(Bun.file(path), { headers: { "Access-Control-Allow-Origin": "*" } });
    } catch { return new Response("Not found", { status: 404 }); }
  }
  return new Response("Not found", { status: 404 });
} });
console.log(JSON.stringify({ root, source, api: `http://127.0.0.1:${port}`, media: `http://127.0.0.1:${mediaPort}` }));
