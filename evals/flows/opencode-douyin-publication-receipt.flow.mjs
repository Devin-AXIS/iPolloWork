import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const WORKSPACE_ID = "ws_716c09b39562";
const SESSION_ID = "ses_f31c91000ffePVeFbU8n3Dajax";
const TITLE = "iPolloWork：让项目协作更简单";

async function targetText(ctx, predicate) {
  const targets = await listTargets(ctx.cdpBaseUrl);
  const target = targets.find((entry) => entry.webSocketDebuggerUrl && predicate(entry));
  ctx.assert(target, "Expected browser target was not available");
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    return await evaluate(client, "document.body.innerText", { awaitPromise: true });
  } finally {
    client.close();
  }
}

export default {
  id: "opencode-douyin-publication-receipt",
  title: "OpenCode one-shot Douyin publication has a durable accepted receipt",
  kind: "internal",
  cdpTarget: { urlIncludes: "localhost:" },
  steps: [{
    name: "The plugin and Douyin agree that the one-shot publication was accepted",
    run: async (ctx) => {
      await ctx.navigateHash(`/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`);
      await ctx.waitFor(`location.hash.includes(${JSON.stringify(SESSION_ID)})`, {
        timeoutMs: 30_000,
        label: "OpenCode publication task",
      });

      await ctx.prove("The OpenCode task completed publication without leaving a pending browser job", {
        voiceover: "OpenCode 已经自动完成视频、导出、上传和发布；抖音插件将这次提交记为已完成，不再停留在执行中。",
        action: async () => {
          const selected = await ctx.eval(`(() => {
            const existing = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('aria-label') === 'Select tab: 抖音运营台');
            if (existing) { existing.click(); return 'selected'; }
            document.querySelector('button[aria-label="添加侧面板入口"]')?.click();
            return 'launcher';
          })()`);
          if (selected === "launcher") {
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="side-panel-launcher-workspace-app:douyin-ops:workspace-app:workbench"]'))`, {
              label: "Douyin launcher",
            });
            await ctx.eval(`document.querySelector('[data-testid="side-panel-launcher-workspace-app:douyin-ops:workspace-app:workbench"]')?.click()`);
          }
          await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Select tab: 抖音运营台'))`, {
            timeoutMs: 30_000,
            label: "Douyin workbench tab",
          });
        },
        assert: async () => {
          const workbench = await targetText(ctx, (entry) => entry.type === "iframe" && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(entry.url));
          ctx.assert(workbench.includes(TITLE), "The completed draft is missing from the Douyin workbench");
          ctx.assert(workbench.includes("已完成"), "The published draft is not marked complete");
          ctx.assert(workbench.includes("ACTION\n0"), "A browser publication is still pending or uncertain");

          const creator = await targetText(ctx, (entry) => entry.type === "page" && entry.url.includes("creator.douyin.com/creator-micro/content/manage"));
          ctx.assert(creator.includes(TITLE), "Douyin content management does not show the submitted work");
          ctx.assert(creator.includes("2026年09月23日 20:26"), "The accepted work timestamp does not match this submission");
          ctx.assert(creator.includes("审核中"), "Douyin no longer reports the accepted review state");
          ctx.output("OpenCode Douyin publication receipt", JSON.stringify({
            title: TITLE,
            duration: "00:16",
            submittedAt: "2026-09-23 20:26",
            platformStatus: "under_review",
            pluginStatus: "succeeded",
            pendingActions: 0,
          }, null, 2));
        },
        screenshot: {
          name: "opencode-douyin-publication-complete",
          requireText: ["抖音运营台"],
          hashIncludes: `/workspace/${WORKSPACE_ID}/session/${SESSION_ID}`,
        },
      });
    },
  }],
};
