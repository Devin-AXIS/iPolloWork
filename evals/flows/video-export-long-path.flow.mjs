import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const studioUrl = process.env.IPOLLOWORK_EXPORT_STUDIO_URL || "http://127.0.0.1:5540";

export default {
  id: "video-export-long-path", title: "Repeated real exports with Windows long media paths",
  kind: "user-facing", preserveTheme: true, cdpTarget: { urlIncludes: ":5540" },
  steps: [{ name: "Export twice and play the resulting MP4", run: async ctx => {
    const require = createRequire(join(root, "vendor/hyperframes/packages/cli/package.json"));
    const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
    const browser = await puppeteer.connect({ browserURL: process.env.IPOLLOWORK_EXPORT_CDP_URL || "http://127.0.0.1:9948", defaultViewport: null });
    const page = (await browser.pages()).find(page => page.url().startsWith(studioUrl));
    ctx.assert(page, "The real Studio is open");
    const completedBefore = await page.$$eval('button[aria-label^="Open "]', buttons => buttons.length);
    let lastFileUrl;
    let playbackAdvanced = false;
    try {
      for (let run = 1; run <= 2; run++) {
        await ctx.prove(`Export ${run} completes with the transparent avatar and audio`, {
          voiceover: "在真实项目中按 MP4、720p、15 fps、Draft 连续导出，包含长路径的透明数字人素材和声音。",
          action: async () => {
            const button = await page.waitForFunction(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Export" && !b.getAttribute("aria-label") && !b.disabled));
            const responsePromise = page.waitForResponse(r => r.request().method() === "POST" && /\/api\/projects\/[^/]+\/render$/.test(r.url()));
            await button.asElement().click();
            const response = await responsePromise;
            ctx.assert(response.ok(), "The export request was accepted");
            const settings = JSON.parse(response.request().postData());
            ctx.assert(settings.format === "mp4" && settings.fps === 15 && settings.quality === "draft" && settings.outputSize.width === 1280 && settings.outputSize.height === 720, "The screenshot's export settings are used");
            const { jobId } = await response.json();
            const progressResponse = await fetch(`${studioUrl}/api/render/${jobId}/progress`);
            const events = (await progressResponse.text()).split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
            const final = events.at(-1);
            ctx.output(`Export ${run} status`, JSON.stringify(final));
            ctx.assert(final?.status === "complete", `Export completed: ${final?.error || final?.status}`);
            const download = await fetch(`${studioUrl}/api/render/${jobId}/download`);
            ctx.assert(download.ok, "The complete MP4 can be downloaded");
            const output = join(ctx.outDir, `export-${run}.mp4`);
            const data = Buffer.from(await download.arrayBuffer());
            await writeFile(output, data);
            const probe = JSON.parse(execFileSync(process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8", windowsHide: true }));
            const video = probe.streams.find(stream => stream.codec_type === "video");
            ctx.assert(video?.width === 1280 && video?.height === 720 && video?.r_frame_rate === "15/1", "The encoded video has the requested dimensions and frame rate");
            ctx.assert(Number(probe.format.duration) >= 43 && probe.streams.some(stream => stream.codec_type === "audio") && data.length > 100_000, "The complete composition contains both video and audio");
            ctx.output(`Export ${run} media`, JSON.stringify({ bytes: data.length, duration: probe.format.duration, video: video.codec_name, audio: probe.streams.find(stream => stream.codec_type === "audio")?.codec_name }));
          },
          assert: async () => {
            await page.waitForFunction(count => document.querySelectorAll('button[aria-label^="Open "]').length >= count, {}, completedBefore + run);
            lastFileUrl = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Open "]')].at(-1)?.getAttribute("aria-label"));
            ctx.assert(!await page.$('button[aria-label="Cancel render"]'), "The export queue is no longer busy");
          },
          screenshot: { name: `export-${run}-complete`, requireText: ["Export"], rejectText: ["Video extraction failed", "VIDEO_SOURCE_UNRENDERABLE"] },
        });
      }
      await ctx.prove("The exported MP4 opens and plays after both exports", {
        voiceover: "导出结果能够打开播放，画面和声音轨都完整。",
        action: async () => {
          const opened = browser.waitForTarget(target => target.url().includes("/renders/file/")).then(target => target.page());
          await page.locator(`button[aria-label=${JSON.stringify(lastFileUrl)}]`).click();
          const outputPage = await opened;
          await outputPage.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
          const playback = await outputPage.evaluate(async () => {
            const video = document.querySelector("video"); video.muted = true; video.currentTime = 5; await video.play();
            return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
          });
          ctx.assert(playback.duration >= 43 && playback.width === 1280 && playback.height === 720, "The browser decoded the exported MP4");
          await outputPage.waitForFunction(() => document.querySelector("video").currentTime > 5.2);
          playbackAdvanced = true;
          await outputPage.bringToFront();
        },
        assert: async () => { ctx.assert(playbackAdvanced, "Playback advanced beyond the seek time"); },
        screenshot: { name: "exported-video-playing", targetUrlIncludes: "/renders/file/" },
      });
    } finally { await browser.disconnect(); }
  } }],
};
