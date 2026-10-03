import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { stat } from "node:fs/promises";

// A real Studio instance and a disposable composition are required. This flow
// exports locally; it deliberately never submits a social publication.
export default {
  id: "video-auto-export",
  title: "Export MP4 through Studio without clicking Export",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "The existing Studio renderer produces a decodable local MP4",
    run: async (ctx) => {
      const { IPOLLOWORK_EVAL_STUDIO_API: api, IPOLLOWORK_EVAL_VIDEO_PROJECT: project,
        IPOLLOWORK_EVAL_VIDEO_DIR: directory, IPOLLOWORK_EVAL_FFMPEG: ffmpeg } = process.env;
      ctx.assert(api && project && directory && ffmpeg, "Set Studio API, project ID, project directory and FFmpeg path for a disposable test project.");
      let jobId;
      let outputPath;
      await ctx.prove("A background export produces a usable MP4 without a manual export step", {
        voiceover: "The existing Studio exports the test video in the background and the resulting MP4 decodes successfully, without clicking Export or publishing a post.",
        action: async () => {
          const response = await fetch(`${api}/projects/${encodeURIComponent(project)}/render`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ format: "mp4", quality: "high", fps: 30 }),
            signal: AbortSignal.timeout(15000),
          });
          ctx.assert(response.ok, `Render start failed: ${response.status}`);
          jobId = (await response.json()).jobId;
          ctx.assert(typeof jobId === "string", "Render did not return a job ID.");
          ctx.output("Render job", jobId);
          const deadline = Date.now() + 180000;
          let status = "rendering";
          while (status === "rendering" && Date.now() < deadline) {
            try {
              const progress = await fetch(`${api}/render/${encodeURIComponent(jobId)}/progress`, { signal: AbortSignal.timeout(30000) });
              ctx.assert(progress.ok, `Progress failed: ${progress.status}`);
              const events = (await progress.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
              ctx.assert(events.length > 0, "No progress events.");
              status = events.at(-1).status;
              ctx.output("Render progress", JSON.stringify(events.at(-1)));
            } catch (error) {
              if (error.name !== "TimeoutError" && error.name !== "AbortError") throw error;
              // Reconnect to this job; never repeat the render POST.
            }
          }
          ctx.assert(status === "complete", `Render did not complete: ${status}`);
        },
        assert: async () => {
          const response = await fetch(`${api}/projects/${encodeURIComponent(project)}/renders`, { signal: AbortSignal.timeout(15000) });
          ctx.assert(response.ok, "Could not list completed exports.");
          const entry = (await response.json()).renders.find(item => item.id === jobId);
          ctx.assert(entry?.status === "complete" && entry.size > 0, "Exact job has no completed non-empty export.");
          outputPath = join(directory, "renders", entry.filename);
          ctx.assert((await stat(outputPath)).size === entry.size, "Local export does not match Studio's receipt.");
          const decoded = spawnSync(ffmpeg, ["-v", "error", "-i", outputPath, "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
          ctx.assert(decoded.status === 0, `MP4 decode failed: ${decoded.stderr}`);
          ctx.output("Verified local MP4", `${outputPath}\n${entry.size} bytes; full decode passed; no publication submitted.`);
        },
      });
    },
  }],
};
