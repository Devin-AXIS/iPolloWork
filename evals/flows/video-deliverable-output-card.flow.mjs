let targetSessionId = null;

const outputCardState = `(() => {
  const assistants = [...document.querySelectorAll('[data-message-role="assistant"]')];
  const reportedVideoEntry = assistants.some((message) =>
    /video\\/[^\\s\x60]+\\/index\\.html/i.test(message.innerText || "")
  );
  const outputGrids = [...document.querySelectorAll('[aria-label="输出"], [aria-label="Outputs"]')];
  const titles = outputGrids.flatMap((grid) =>
    [...grid.querySelectorAll('[title]')]
      .map((node) => node.getAttribute('title') || "")
      .filter((title) => /\\.[a-z0-9]{1,10}$/i.test(title))
  );
  return {
    reportedVideoEntry,
    titles,
    htmlCards: titles.filter((title) => /\\.html?$/i.test(title)).length,
    supportCards: titles.filter((title) => /\\.(?:css|js|mjs|cjs|ts|tsx)$/i.test(title)).length,
  };
})()`;

export default {
  id: "video-deliverable-output-card",
  title: "Video turns show the final HTML instead of temporary implementation files",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const sessions = await ctx.control("session.list_sessions");
    for (const session of [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 24)) {
      try {
        await ctx.control("session.open", { sessionId: session.sessionId });
        await ctx.waitFor(`(() => {
          const routeReady = window.__ipolloworkControl.snapshot().route.includes(${JSON.stringify(session.sessionId)});
          return routeReady && document.querySelectorAll('[data-message-role="assistant"]').length > 0;
        })()`, {
          timeoutMs: 8_000,
          label: `loaded conversation ${session.sessionId}`,
        });
        const state = await ctx.eval(outputCardState);
        if (state.reportedVideoEntry && state.htmlCards > 0) {
          targetSessionId = session.sessionId;
          return null;
        }
      } catch {
        // A session from another disconnected workspace can be skipped.
      }
    }
    return "No recent completed video conversation with a reported index.html was available.";
  },
  steps: [{
    name: "The final video entry owns the generated-file card",
    run: async (ctx) => {
      await ctx.prove("A completed video turn shows its HTML deliverable without temporary script cards", {
        voiceover: "视频生成完成后，本轮文件只突出真正可打开的 HTML 成果，中间脚本继续留在右侧完整文件区。",
        action: async () => {
          ctx.assert(Boolean(targetSessionId), "The completed video session was not selected.");
          await ctx.eval(`(() => {
            const grid = document.querySelector('[aria-label="输出"], [aria-label="Outputs"]');
            grid?.scrollIntoView({ block: "center", inline: "nearest" });
          })()`);
        },
        assert: async () => {
          const state = await ctx.eval(outputCardState);
          ctx.assert(state.htmlCards > 0, `The final HTML card is missing: ${JSON.stringify(state)}`);
          ctx.assert(state.supportCards === 0, `Temporary source cards are still visible: ${JSON.stringify(state)}`);
        },
        screenshot: {
          name: "video-final-html-card",
          requireText: ["本轮生成的文件"],
        },
      });
    },
  }],
};
