import { createRequire } from "node:module";

const requireStudio = createRequire(new URL("../../vendor/hyperframes/packages/studio/package.json", import.meta.url));

export default {
  id: "streaming-transcript-reconcile",
  title: "Provider parts reconcile once without repeating streamed text",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "5173" },
  steps: [{
    name: "Verify reconciliation in the live client without sending or interrupting a task",
    async run(ctx) {
      const browser = await requireStudio("puppeteer-core").connect({ browserURL: ctx.cdpBaseUrl, defaultViewport: null });
      try {
        const page = (await browser.pages()).find(page => page.url().includes("5173"));
        ctx.assert(Boolean(page), "The development client is open");
        await ctx.prove("Completed provider text has one authoritative copy, while new stream content survives", {
          voiceover: "同一分段按标识合并，完成的文本不再重复，真正的新流式内容仍保留。",
          assert: async () => {
            const state = await page.evaluate(async () => {
              const { reconcileTranscriptMessages } = await import("/src/react-app/domains/session/sync/transcript-reconcile.ts");
              const { getPartMetadataId } = await import("/src/react-app/domains/session/sync/message-merge.ts");
              const { getReactQueryClient } = await import("/src/react-app/infra/query-client.ts");
              const part = (id, text, state) => ({ type: "text", text, state, providerMetadata: { ipollowork: { partId: id } } });
              const snapshot = { id: "proof", role: "assistant", parts: [part("answer", "已保存", "done")] };
              const merged = reconcileTranscriptMessages({
                snapshotMessages: [snapshot],
                currentMessages: [{ id: "proof", role: "assistant", parts: [
                  part("answer", "已保存已保存已保存", "streaming"),
                  part("answer", "已保存已保存已保存", "streaming"),
                  part("next", "正在继续", "streaming"),
                ] }],
              });
              const transcripts = getReactQueryClient().getQueryCache().getAll().filter(q => q.queryKey[0] === "react-session-transcript" && Array.isArray(q.state.data));
              let duplicateIds = 0;
              for (const query of transcripts) {
                for (const message of query.state.data) {
                  const seen = new Set();
                  for (const part of message.parts) {
                    const id = getPartMetadataId(part);
                    if (!id) continue;
                    if (seen.has(id)) duplicateIds++;
                    seen.add(id);
                  }
                }
              }
              return {
                fixtureTexts: merged[0].parts.map(part => part.text),
                duplicateIds, transcripts: transcripts.length,
                uiPresent: document.body.innerText.includes("描述你的任务"),
              };
            });
            ctx.assert(state.fixtureTexts.join("|") === "已保存|正在继续", "Authoritative text replaces duplicate streams without losing a new part");
            ctx.assert(state.transcripts > 0 && state.duplicateIds === 0, "Live transcript caches contain no duplicate provider part IDs");
            ctx.assert(state.uiPresent, "The real client remains visible and usable");
          },
          screenshot: { name: "streaming-transcript-reconciled" },
        });
      } finally {
        await browser.disconnect();
      }
    },
  }],
};
