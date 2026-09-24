import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { videoRenderAction } from "./video-render.js";

test("built-in export starts Studio once, resumes progress, verifies output and rejects bad paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipw-export-"));
  const nativeFetch = globalThis.fetch;
  const previous = process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY;
  const sourcePath = "video/ses_export/index.html";
  const workspace = { id: "ws_export", path: root };
  let starts = 0;
  let readyCalls = 0;
  let status = "rendering";
  const discovery = join(root, "bridge.json");
  await mkdir(join(root, "video/ses_export/renders"), { recursive: true });
  await writeFile(join(root, sourcePath), "<html></html>");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://127.0.0.1:54321", token: "test-token" }));
  process.env.IPOLLOWORK_UI_CONTROL_DISCOVERY = discovery;
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/video/ensure-studio")) { readyCalls++; return Response.json({ ok: true }); }
    if (url.endsWith("/render")) { starts++; return Response.json({ jobId: `ses_export_job${starts}` }); }
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
