const VIDEO_ROW = '[data-testid="engine-package-row"][data-engine-id="video-codecs"]';

export default {
  id: "video-codecs-cloud-boundary",
  title: "Video codecs download without downloading HyperFrames",
  kind: "user-facing",
  steps: [
    {
      name: "Video resource boundary is clear in settings",
      run: async (ctx) => {
        await ctx.prove("The video download contains only FFmpeg and FFprobe", {
          voiceover: "The video tools row now says HyperFrames is already installed with the app, while the optional download contains only FFmpeg and FFprobe.",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 30_000,
              label: "desktop control bridge",
            });
            await ctx.navigateHash("/settings/engines");
            await ctx.waitFor(`(() => {
              const row = document.querySelector(${JSON.stringify(VIDEO_ROW)});
              return Boolean(row)
                && document.querySelectorAll('[data-testid="engine-package-row"]').length >= 3
                && document.body.innerText.includes('FFmpeg / FFprobe 视频编解码组件')
                && document.body.innerText.includes('HyperFrames 运行时和组件库已随软件安装')
                && !document.body.innerText.includes('正在检查引擎包');
            })()`, {
              timeoutMs: 30_000,
              label: "settled engine list with video codecs resource row",
            });
            await ctx.waitFor(
              `!document.querySelector('[data-testid="startup-logo-animation"]')`,
              { timeoutMs: 30_000, label: "startup overlay dismissed" },
            );
          },
          assert: async () => {
            const text = await ctx.eval(`document.querySelector(${JSON.stringify(VIDEO_ROW)})?.innerText ?? ""`);
            ctx.assert(text.includes("FFmpeg / FFprobe 视频编解码组件"), "The video resource row must name FFmpeg and FFprobe.");
            ctx.assert(text.includes("HyperFrames 运行时和组件库已随软件安装"), "The row must explain that HyperFrames is bundled with the app.");
            ctx.assert(!text.includes("包含 HyperFrames 运行时"), "The row must not describe HyperFrames as part of the download.");
          },
          screenshot: {
            name: "video-codecs-cloud-boundary",
            requireText: ["FFmpeg / FFprobe 视频编解码组件", "HyperFrames 运行时和组件库已随软件安装"],
            rejectText: ["包含 HyperFrames 运行时、组件库、FFmpeg 和 FFprobe"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
  ],
};
