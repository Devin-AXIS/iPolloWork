import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const plugins = [
  { id: "xiaohongshu-ops", title: "小红书运营台", header: ".app-topbar", controls: [".account-switcher", ".add-account-link", "[data-account-settings]"], logos: ".brand-mark, .app-identity > span" },
  { id: "douyin-ops", title: "抖音运营台", header: ".topbar", controls: ["#account", "#add-account", "#manage-account"], logos: ".brand-mark" },
];

async function waitForFrame(client, expression, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate(client, expression).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function ensureWorkbench(ctx, plugin) {
  const tab = `[aria-label="Select tab: ${plugin.title}"]`;
  const frame = `iframe[title="${plugin.title}"]`;
  const launcher = `[data-testid="side-panel-launcher-workspace-app:${plugin.id}:workspace-app:workbench"]`;
  if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(tab)}))`)) {
    if (!await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(launcher)}))`)) {
      await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]')?.click()`);
      await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(launcher)}))`);
    }
    await ctx.eval(`document.querySelector(${JSON.stringify(launcher)}).click()`);
  }
  await ctx.eval(`document.querySelector(${JSON.stringify(tab)})?.click()`);
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(frame)})?.src)`, { timeoutMs: 60_000 });
  const origin = new URL(await ctx.eval(`document.querySelector(${JSON.stringify(frame)}).src`)).origin;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const target = (await listTargets(ctx.cdpBaseUrl)).find(entry => entry.type === "iframe" && entry.url.startsWith(`${origin}/`));
    if (target) return { client: await connect(debuggerUrlFor(ctx.cdpBaseUrl, target)), target, frame };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${plugin.title} did not expose an iframe target`);
}

export default {
  id: "social-plugin-account-header",
  title: "小红书与抖音标题栏适配可拖拽面板",
  kind: "user-facing",
  preserveTheme: true,
  steps: plugins.map(plugin => ({
    name: `${plugin.title}标题栏宽度适配`,
    run: async ctx => {
      const { client, target, frame } = await ensureWorkbench(ctx, plugin);
      const panel = `document.querySelector(${JSON.stringify(frame)}).closest('aside')`;
      const originalStyle = await ctx.eval(`${panel}.getAttribute('style')`);
      try {
        await waitForFrame(client, `Boolean(document.querySelector('${plugin.header}'))`, plugin.title);
        await ctx.prove(`${plugin.title}在窄面板中保持账号操作对齐`, {
          voiceover: "改变右侧面板宽度，标题和账号区自动重排，添加和更多按钮保持同行。小红书宽屏显示侧栏标志，窄屏只保留标题栏标志。",
          action: async () => {
            const measurements = [];
            for (const width of [360, 480, 640, 900, 1100, 480]) {
              await ctx.eval(`${panel}.style.width = '${width}px'; ${panel}.style.transition = 'none'`);
              await waitForFrame(client, `innerWidth === ${width}`, `${plugin.title} ${width}px reflow`);
              const state = await evaluate(client, `(() => {
                const rect = selector => {
                  const e = document.querySelector(selector);
                  if (!e || !e.getClientRects().length) return null;
                  const r = e.getBoundingClientRect();
                  return {left:r.left, right:r.right, top:r.top, width:r.width};
                };
                const h = document.querySelector('${plugin.header}');
                return {
                  width: innerWidth, header: rect('${plugin.header}'), overflow: h.scrollWidth > h.clientWidth,
                  controls: ${JSON.stringify(plugin.controls)}.map(rect),
                  logos: [...document.querySelectorAll('${plugin.logos}')].filter(e => e.getClientRects().length).length,
                };
              })()`);
              ctx.assert(!state.overflow, `${plugin.title} header overflows at ${width}px`);
              ctx.assert(state.logos === 1, `${plugin.title} must show exactly one logo at ${width}px`);
              const boxes = state.controls.filter(Boolean);
              ctx.assert(boxes.length >= 2, "Account picker and add button must remain visible");
              for (const box of boxes) {
                ctx.assert(box.width > 0 && box.left >= state.header.left && box.right <= state.header.right + 1, `Control outside header at ${width}px`);
                ctx.assert(Math.abs(box.top - boxes[0].top) < 2, `Account actions wrapped at ${width}px`);
              }
              for (let i = 1; i < boxes.length; i += 1) ctx.assert(boxes[i].left >= boxes[i - 1].right, `Overlapping controls at ${width}px`);
              measurements.push(state);
            }
            await ctx.output(`${plugin.id}-responsive-layout`, JSON.stringify(measurements, null, 2));
          },
          assert: async () => {
            ctx.assert(await evaluate(client, "innerWidth") === 480, "Capture must show the narrow panel");
            const title = await evaluate(client, `document.querySelector('${plugin.header}').innerText`);
            ctx.assert(title.includes(plugin.title), "Plugin title remains visible");
          },
          screenshot: { name: `${plugin.id}-responsive-header`, textTargetId: target.id, requireText: [plugin.title], rejectText: ["Something went wrong"] },
        });
      } finally {
        await ctx.eval(originalStyle === null ? `${panel}.removeAttribute('style')` : `${panel}.setAttribute('style', ${JSON.stringify(originalStyle)})`).catch(() => {});
        client.close();
      }
    },
  })),
};
