import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";
import { EvalContext } from "../runner/context.mjs";

const DATA_ANNOTATION = '[data-testid="sidebar-data-annotation"]';
const GIG_LINK = '[data-testid="sidebar-gig-link"]';
const HOST_FRAME = 'iframe[title="零工汇"]';

async function ensureWorkspace(ctx) {
  const current = await ctx.eval("(location.hash.match(/\\/workspace\\/([^/]+)/) ?? [])[1] ?? ''");
  if (current) return current;
  const workspacePath = await mkdtemp(join(tmpdir(), "ipollowork-gig-link-fraimz-"));
  await ctx.waitFor(
    "window.__ipolloworkControl?.listActions?.().find((action) => action.id === 'workspace.create')?.disabled === false",
    { timeoutMs: 60_000, label: "workspace.create action" },
  );
  await ctx.control("workspace.create", { path: workspacePath, projectLabel: "零工汇验证" });
  await ctx.waitFor("location.hash.includes('/workspace/')", { timeoutMs: 45_000, label: "created workspace route" });
  return ctx.eval("(location.hash.match(/\\/workspace\\/([^/]+)/) ?? [])[1] ?? ''");
}

async function showSidebar(ctx) {
  await ctx.client.send("Page.bringToFront");
  if (await ctx.eval(`document.querySelector(${JSON.stringify(GIG_LINK)})?.getBoundingClientRect().x < 0`)) {
    await ctx.eval('document.querySelector(\'[data-sidebar="trigger"]\')?.click()');
  }
  await ctx.waitFor(`document.querySelector(${JSON.stringify(GIG_LINK)})?.getBoundingClientRect().x >= 0`);
}

export default {
  id: "data-annotation-gig-link",
  title: "Gig Link opens below Data Annotation in the right iframe panel",
  kind: "user-facing",
  steps: [{
    name: "Open Gig Link from the sidebar",
    async run(ctx) {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 90_000, label: "desktop control API" });
      const workspaceId = await ensureWorkspace(ctx);
      ctx.assert(Boolean(workspaceId), "A workspace must be selected");
      await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(GIG_LINK)} + ':not(:disabled)'))`, {
        timeoutMs: 60_000,
        label: "Gig Link sidebar entry",
      });
      await ctx.prove("Gig Link opens its bundled task page without model or authorization-center setup", {
        voiceover: "点击左侧零工汇后，内置任务页面无需任何模型或授权中心配置，直接显示在右侧属性栏。",
        action: async () => {
          await showSidebar(ctx);
          if (await ctx.eval('Boolean(document.querySelector(\'button[aria-label="Close tab: 零工汇"]\'))')) {
            await ctx.trustedClick('button[aria-label="Close tab: 零工汇"]');
          }
          await ctx.trustedClick(GIG_LINK);
          await ctx.waitFor(`(() => {
            const host = document.querySelector(${JSON.stringify(HOST_FRAME)});
            const frame = host?.contentDocument?.querySelector('#gig-link');
            return frame && !frame.hidden && frame.getAttribute('src')?.startsWith('https://giglink.koocoding.com/tasks');
          })()`, { timeoutMs: 75_000, label: "direct embedded Gig Link page" });

          let target;
          for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
            target = (await listTargets(ctx.cdpBaseUrl)).find((entry) =>
              entry.type === "iframe" && entry.url.startsWith("https://giglink.koocoding.com/tasks"));
            if (!target) await new Promise((resolve) => setTimeout(resolve, 250));
          }
          ctx.assert(Boolean(target), "The third-party task page must load as a nested iframe");
          const child = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
          try {
            const childContext = new EvalContext({ client: child, outDir: ctx.outDir, flowId: ctx.flowId });
            await childContext.waitFor("document.title.includes('零工汇') && document.body.innerText.trim().length > 0", {
              timeoutMs: 30_000,
              label: "Gig Link task application",
            });
            const view = await evaluate(child, "({ title: document.title, text: document.body.innerText.slice(0, 500) })");
            ctx.assert(view.title.includes("零工汇"), "The nested task page title must identify Gig Link");
            ctx.assert(view.text.trim().length > 0, "The nested task application must render visible content");
          } finally {
            child.close();
          }
        },
        assert: async () => {
          const layout = await ctx.eval(`(() => {
            const annotation = document.querySelector(${JSON.stringify(DATA_ANNOTATION)})?.getBoundingClientRect();
            const gig = document.querySelector(${JSON.stringify(GIG_LINK)})?.getBoundingClientRect();
            const frame = document.querySelector(${JSON.stringify(HOST_FRAME)})?.getBoundingClientRect();
            return { annotationY: annotation?.y, gigY: gig?.y, frameWidth: frame?.width, frameHeight: frame?.height };
          })()`);
          ctx.assert(layout.gigY > layout.annotationY, "Gig Link must appear below Data Annotation in the sidebar");
          ctx.assert(layout.frameWidth > 200 && layout.frameHeight > 200, "Gig Link must be visible in the right panel");
          ctx.assert(await ctx.eval('document.querySelectorAll(\'button[aria-label="Select tab: 零工汇"]\').length === 1'), "Opening Gig Link must create one reusable right-panel tab");
          ctx.assert(!(await ctx.eval("document.body.innerText.includes('授权中心')")), "Gig Link must not ask for authorization-center setup");
        },
        screenshot: {
          name: "sidebar-gig-link-right-iframe",
          requireText: ["数据标注", "零工汇"],
          rejectText: ["授权中心", "暂时无法打开", "could not be displayed", "请求超时"],
        },
      });
    },
  }],
};
