import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function findStudioFrame(node) {
  if (node.frame.url.includes(":3367/")) return node.frame;
  for (const child of node.childFrames || []) {
    const found = findStudioFrame(child);
    if (found) return found;
  }
  return null;
}

async function studioContext(ctx, worldName) {
  const tree = await ctx.client.send("Page.getFrameTree");
  const frame = findStudioFrame(tree.frameTree);
  if (!frame) throw new Error("HyperFrames Studio iframe is not open");
  const world = await ctx.client.send("Page.createIsolatedWorld", { frameId: frame.id, worldName });
  const evaluate = async (expression) => {
    const result = await ctx.client.send("Runtime.evaluate", {
      contextId: world.executionContextId,
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Studio evaluation failed"}\nExpression: ${expression}`);
    return result.result.value;
  };
  return { frame, evaluate };
}

async function waitFor(check, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

export default {
  id: "avatar-insert-sync-composite",
  title: "数字人素材按配音起点插入并保持单一可编辑对象",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_AVATAR_PROOF_DIR"],
  steps: [{
    name: "Insert the generated avatar from a nonzero playhead",
    run: async (ctx) => {
      const project = resolve(process.env.IPOLLOWORK_AVATAR_PROOF_DIR);
      const htmlFile = join(project, "index.html");
      const assetName = (await readdir(join(project, "assets"))).find((name) => /^avatar-long-.+\.webm$/i.test(name));
      if (!assetName) throw new Error("Generated long-avatar material was not found");
      const material = `assets/${assetName}`;
      const source = `renders/${assetName.replace(/\.webm$/i, ".mp4")}`;
      const expectedStart = Number((await readFile(htmlFile, "utf8")).match(/data-ipw-voiceover="true"[^>]*data-start="([\d.]+)"/)?.[1] ?? 0);

      await ctx.prove("Material insertion uses the bound narration start instead of the current playhead", {
        voiceover: "即使播放头停在四十三秒，数字人成片仍按绑定配音的零秒起点插入。",
        action: async () => {
          const studio = await studioContext(ctx, "avatar-insert-seek");
          const url = new URL(studio.frame.url + (studio.frame.urlFragment || ""));
          const params = new URLSearchParams(url.hash.split("?")[1] || "");
          params.set("t", "43");
          url.hash = `${url.hash.split("?")[0]}?${params}`;
          await ctx.client.send("Page.navigate", { frameId: studio.frame.id, url: url.href });
          await sleep(1500);
          const refreshed = await studioContext(ctx, "avatar-insert-action");
          await waitFor(() => refreshed.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('button[aria-label=\"属性\"]'))"));
          await refreshed.evaluate(`document.querySelector('button[aria-label="属性"]')?.click()`);
          await sleep(300);
          await refreshed.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '素材')?.click()`);
          await waitFor(() => refreshed.evaluate(`Boolean(document.querySelector('[data-testid="asset-card"][data-asset-path="${material}"] [data-testid="asset-insert-action"]'))`));
          const playhead = await refreshed.evaluate(String.raw`document.body.innerText.match(/\d\d:\d\d \/ \d\d:\d\d/)?.[0] || ''`);
          ctx.output("playhead before insertion", playhead);
          const existingHtml = await readFile(htmlFile, "utf8");
          if (!existingHtml.includes(`data-avatar-material="${material}"`)) {
            await refreshed.evaluate(`document.querySelector('[data-testid="asset-card"][data-asset-path="${material}"] [data-testid="asset-insert-action"]')?.click()`);
          }
          await waitFor(async () => {
            const html = await readFile(htmlFile, "utf8");
            return html.includes(`src="${source}"`) && html.includes(`data-avatar-material="${material}"`);
          }, 20_000);
        },
        assert: async () => {
          const html = await readFile(htmlFile, "utf8");
          const sourceTag = html.match(new RegExp(`<video[^>]+src="${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`))?.[0] || "";
          ctx.assert(sourceTag.includes(`data-start="${expectedStart}"`), `Expected narration start ${expectedStart}; source tag was ${sourceTag}`);
          ctx.assert(sourceTag.includes('data-has-audio="true"') && sourceTag.includes('data-volume="1"'), "Inserted source keeps generated narration audio");
          ctx.assert(!sourceTag.includes('data-start="43"'), "Insertion ignored the nonzero playhead");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: `Avatar source starts at bound narration time ${expectedStart}s, not the 43s playhead` });
        },
        screenshot: { name: "avatar-bound-audio-start", requireText: ["视频"] },
      });

      await ctx.prove("The cutout is one editable clip with background, content, and person in the correct order", {
        voiceover: "时间线只暴露一个数字人片段；原视频背景在底层，普通元素在中间，透明人物主体始终在最上层。",
        action: async () => {
          const studio = await studioContext(ctx, "avatar-insert-verify");
          await waitFor(() => studio.evaluate(`(() => { const p=document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe'); return Boolean(p?.contentDocument?.querySelector('video[data-avatar-source]')); })()`), 30_000);
          await studio.evaluate(`document.querySelector('[data-testid="asset-card"][data-asset-path="${material}"] button[aria-label^="预览:"]')?.click()`);
          await sleep(300);
        },
        assert: async () => {
          const studio = await studioContext(ctx, "avatar-insert-assert");
          const state = await studio.evaluate(`(() => {
            const frame=document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe');
            const d=frame?.contentDocument,w=frame?.contentWindow;
            const source=d?.querySelector('video[data-avatar-cutout]'),foreground=d?.querySelector('video[data-avatar-source]');
            const scene=d?.querySelector('.scene.clip:not([style*="display: none"])') || d?.querySelector('.scene.clip');
            const proxy=scene?.querySelector('[data-avatar-background-proxy]');
            const timelineVideos=[...document.querySelectorAll('[data-timeline-kind="video"]')].map(e=>e.textContent.trim());
            return { source:source?.getAttribute('src'), foreground:foreground?.getAttribute('src'), sourceStart:source?.dataset.start, foregroundStart:foreground?.dataset.start, sourceZ:Number(w?.getComputedStyle(source).zIndex)||0, sceneZ:Number(w?.getComputedStyle(scene).zIndex)||0, foregroundZ:Number(w?.getComputedStyle(foreground).zIndex)||0, proxyMask:w?.getComputedStyle(proxy).maskImage || 'none', timelineVideos, assetText:document.querySelector('[data-testid="asset-card"][data-asset-path="${material}"]')?.textContent || '' };
          })()`);
          ctx.output("composite layer state", JSON.stringify(state, null, 2));
          ctx.assert(state.source?.includes(source) && state.foreground?.includes(material), "Original-background source and transparent foreground are both active");
          ctx.assert(state.sourceStart === state.foregroundStart && Number(state.sourceStart) === expectedStart, "Both internal layers share the narration start");
          ctx.assert(state.sourceZ <= state.sceneZ && state.sceneZ < state.foregroundZ, "Normal scene content is between avatar background and person");
          ctx.assert(state.proxyMask !== "none", "Scene background opens a masked window for the original avatar background");
          ctx.assert(state.timelineVideos.length === 1, `Expected one editable video clip, received ${JSON.stringify(state.timelineVideos)}`);
          ctx.assert(state.assetText.includes("使用中"), "The one material card is linked to the composite source");
        },
        screenshot: { name: "avatar-single-composite", requireText: ["视频"] },
      });
    },
  }],
};
