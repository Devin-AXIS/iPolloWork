// Real production server, uploads, extension dispatch, CPU models and FFmpeg.
// Supply a short local speech video via IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO.
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../../apps/server/src/server.js";
import { resolveWithinRoot } from "../../apps/server/src/paths.js";
import type { ServerConfig } from "../../apps/server/src/types.js";
const root = process.env.IPOLLOWORK_ENHANCEMENT_PROOF_ROOT || await mkdtemp(join(tmpdir(), "ipw-enhancement-proof-"));
const source = process.env.IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO;
if (!source) throw new Error("Set IPOLLOWORK_ENHANCEMENT_PROOF_VIDEO to a short local speech video.");
const noAudio = join(root, "missing-audio.mp4");
await promisify(execFile)(process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", source, "-an", "-t", "1", "-c:v", "libx264", "-threads", "1", noAudio], { windowsHide: true, timeout: 30_000 });
await mkdir(join(root, "video/proof/assets"), { recursive: true });
await writeFile(join(root, "video/proof/index.html"), '<!doctype html><html><body style="font:24px Arial;padding:48px">增强前时间轴</body></html>', { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
const config: ServerConfig = { host: "127.0.0.1", port: 5287, token: "local-enhancement-proof", hostToken: "local-enhancement-proof",
  configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: ["http://127.0.0.1:5268"],
  workspaces: [{ id: "proof", name: "Local enhancement proof", path: root, preset: "starter", workspaceType: "local" }],
  authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
await startServer(config);
Bun.serve({ hostname: "127.0.0.1", port: 5288, async fetch(request) {
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
console.log(JSON.stringify({ root, source, api: "http://127.0.0.1:5287", media: "http://127.0.0.1:5288" }));
