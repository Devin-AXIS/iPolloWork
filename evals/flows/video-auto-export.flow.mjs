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
            body: JSON.stringify({ format: "mp4", quality: "high", fps: 30,
              ...(process.env.IPOLLOWORK_EVAL_RENDER_OPTIONS ? JSON.parse(process.env.IPOLLOWORK_EVAL_RENDER_OPTIONS) : {}),
            }),
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
          if (process.env.IPOLLOWORK_EVAL_EXPECT_VIDEO) {
            const expected = JSON.parse(process.env.IPOLLOWORK_EVAL_EXPECT_VIDEO);
            const probe = spawnSync(process.env.IPOLLOWORK_EVAL_FFPROBE || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,nb_frames", "-of", "json", outputPath], { encoding: "utf8", timeout: 30000 });
            ctx.assert(probe.status === 0, `Metadata probe failed: ${probe.stderr}`);
            const stream = JSON.parse(probe.stdout).streams[0];
            for (const [key, value] of Object.entries(expected)) ctx.assert(stream[key] === value, `Actual ${key} ${stream[key]} does not match ${value}.`);
            ctx.output("Actual encoded dimensions and fps", JSON.stringify(stream));
          }
          ctx.output("Verified local MP4", `${outputPath}\n${entry.size} bytes; full decode passed; no publication submitted.`);
        },
      });
      if (process.env.IPOLLOWORK_EVAL_SHUTTER_PROOF) {
        await ctx.prove("Temporal shutter preserves crisp reading holds and cuts and follows seek-safe callbacks", {
          voiceover: "The fast moving subject gains a temporal trail. Reading holds and cuts retain the same lossless pixels, and the callback-driven subject restores exactly when seeking backwards.",
          action: async () => {
            const { readFile } = await import("node:fs/promises");
            const root = process.env.IPOLLOWORK_EVAL_SHUTTER_PROOF;
            const measurement = JSON.parse(await readFile(join(root, "shutter-measurements.json"), "utf8"));
            const lossless = JSON.parse(await readFile(join(root, "lossless-shutter-proof.json"), "utf8"));
            ctx.assert(measurement.passed && lossless.passed, "Production-capture shutter evidence must pass.");
            ctx.assert(measurement.fast.shutter.width >= measurement.fast.crisp.width + 6, "Fast motion gained no visible temporal integration.");
            ctx.assert(lossless.holdPixelsIdentical && lossless.cutPixelsIdentical, "Static typography or cut frames changed.");
            ctx.assert(lossless.exactSubframes.second - lossless.exactSubframes.first > 10 && lossless.exactSubframes.first === lossless.exactSubframes.reversed, "Subframes collapsed or callback state failed to restore.");
            ctx.output("Measured production render and lossless control", JSON.stringify({ measurement, lossless }, null, 2));
          },
          assert: async () => {
            for (const name of ["crisp.mp4", "shutter.mp4"]) {
              const decode = spawnSync(ffmpeg, ["-v", "error", "-i", join(process.env.IPOLLOWORK_EVAL_SHUTTER_PROOF, name), "-f", "null", "-"], { encoding: "utf8", timeout: 30000 });
              ctx.assert(decode.status === 0, `Shutter comparison decode failed: ${decode.stderr}`);
            }
          },
        });
      }
    },
  }],
};
