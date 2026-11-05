const VIDEO_ROW = '[data-testid="engine-package-row"][data-engine-id="video-codecs"]';

export default {
  id: "video-codecs-cloud-boundary",
  title: "Video codecs install only from the first Video Studio launch",
  kind: "user-facing",
  steps: [
    {
      name: "Engine Management contains engines only",
      run: async (ctx) => {
        await ctx.prove("FFmpeg and FFprobe are not manually managed as engines", {
          voiceover: "Engine Management stays focused on agent engines. FFmpeg and FFprobe no longer appear here with install or uninstall actions; Video Studio owns their automatic first-launch setup.",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
              timeoutMs: 30_000,
              label: "desktop control bridge",
            });
            await ctx.navigateHash("/settings/engines");
            await ctx.waitFor(`(() => {
              return !document.querySelector(${JSON.stringify(VIDEO_ROW)})
                && document.querySelectorAll('[data-testid="engine-package-row"]').length === 3
                && !document.body.innerText.includes('正在检查引擎包');
            })()`, {
              timeoutMs: 30_000,
              label: "settled engine-only package list",
            });
            await ctx.waitFor(
              `!document.querySelector('[data-testid="startup-logo-animation"]')`,
              { timeoutMs: 30_000, label: "startup overlay dismissed" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              count: document.querySelectorAll('[data-testid="engine-package-row"]').length,
              hasVideoRow: Boolean(document.querySelector(${JSON.stringify(VIDEO_ROW)})),
              mentionsCodecs: /FFmpeg|FFprobe/.test(document.body.innerText),
              cloudResourceError: document.body.innerText.includes('Cloud resource manifest returned HTTP 404'),
            }))()`);
            ctx.assert(state.count === 3, `Expected exactly three engine rows, got ${JSON.stringify(state)}.`);
            ctx.assert(!state.hasVideoRow && !state.mentionsCodecs, "Video codecs must not be exposed as an engine package.");
            ctx.assert(!state.cloudResourceError, "The engine manager must not retain a stale cloud resource 404.");
          },
          screenshot: {
            name: "engine-management-without-video-codecs",
            requireText: ["OpenCode", "Codex Harness", "DeepSeek Harness"],
            rejectText: ["FFmpeg", "FFprobe", "Cloud resource manifest returned HTTP 404"],
            hashIncludes: "/settings/engines",
          },
        });
      },
    },
  ],
};
