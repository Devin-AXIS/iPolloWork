let targetSessionId = null;

export default {
  id: "artifact-followup-ownership",
  title: "Ordinary follow-ups do not repeat an earlier template artifact",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    await ctx.waitFor("window.__ipolloworkControl.listActions().some((item) => item.id === 'session.list_sessions')", {
      timeoutMs: 30_000,
      label: "session list action",
    });
    const sessions = await ctx.control("session.list_sessions");
    const target = sessions.find((session) => session.title.includes("Agent Command Center"));
    targetSessionId = target?.sessionId ?? null;
    return targetSessionId ? null : "No persisted Agent Command Center reproduction session is available.";
  },
  steps: [
    {
      name: "Open the template conversation after its ordinary follow-up",
      run: async (ctx) => {
        await ctx.prove("An ordinary follow-up keeps the earlier template artifact out of the latest response", {
          voiceover: "普通追问现在只得到文字回答，之前生成的视频文件不会被挪到这一轮重复展示。",
          action: async () => {
            ctx.assert(Boolean(targetSessionId), "The reproduction session was not selected.");
            await ctx.control("session.open", { sessionId: targetSessionId });
            await ctx.waitFor("document.body.innerText.includes('你是谁') && document.body.innerText.includes('Project Assistant')", {
              timeoutMs: 45_000,
              label: "persisted ordinary follow-up",
            });
            await ctx.waitFor(`(() => {
              const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
              return messages.length >= 2
                && messages.some((message) => message.querySelector('[aria-label="输出"], [aria-label="Outputs"]'));
            })()`, {
              timeoutMs: 30_000,
              label: "original artifact card",
            });
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
              const firstWithArtifact = messages.find((message) => message.querySelector('[aria-label="输出"], [aria-label="Outputs"]'));
              const latest = messages.at(-1);
              return {
                firstHasArtifact: Boolean(firstWithArtifact),
                latestText: latest?.innerText ?? '',
                latestHasArtifact: Boolean(latest?.querySelector('[aria-label="输出"], [aria-label="Outputs"]')),
                latestArtifactTitle: latest?.innerText.includes('本轮生成的文件') || latest?.innerText.includes('Files created in this turn'),
              };
            })()`);
            ctx.assert(result.firstHasArtifact, "The original template artifact card is missing.");
            ctx.assert(result.latestText.includes("Project Assistant"), `The ordinary follow-up response is missing: ${JSON.stringify(result)}`);
            ctx.assert(!result.latestHasArtifact, `The earlier artifact repeated under the latest response: ${JSON.stringify(result)}`);
            ctx.assert(!result.latestArtifactTitle, `The latest response still claims it created files: ${JSON.stringify(result)}`);
          },
          screenshot: {
            name: "ordinary-follow-up-without-repeated-artifact",
            requireText: ["你是谁", "Project Assistant", "在 Video Studio 中打开"],
            rejectText: ["本轮生成的文件", "Something went wrong"],
          },
        });
      },
    },
  ],
};
