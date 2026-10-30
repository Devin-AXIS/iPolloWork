import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const project = join(root, ".ipollowork-dev/layer-visibility-project");
const url = "http://127.0.0.1:5538/#project/layer-visibility-proof?ipolloworkTheme=light";
const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Layer Visibility</title><style>
*{box-sizing:border-box}body{margin:0;font:32px Arial;color:#242424}main{width:1280px;height:720px;background:#f4f2ed;padding:70px}section{position:relative;width:1140px;height:580px}.parent-panel{position:absolute;left:40px;top:70px;width:720px;height:390px;display:flex;flex-direction:column;gap:35px;padding:45px;background:#a9d8d6;border-radius:20px}.caption{margin:0;font-size:44px;font-weight:bold;visibility:visible}.independent-child{color:#bd421f}.animated-child{background:#fcf5dd;padding:20px;visibility:visible}.sibling{position:absolute;right:0;top:190px;background:#d7c4eb;padding:25px;width:250px}
</style></head><body><main id="root" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720"><section id="scene" class="scene clip" data-label="Scene" data-start="0" data-duration="12" data-track-index="1"><div class="parent-panel" data-hf-id="parent-panel" data-label="Parent Group"><p class="caption" data-hf-id="caption" data-label="Child Caption">A caption inside the group</p><span class="independent-child" data-hf-id="independent-child" data-label="Independent Child">Independently hidden child</span><div class="animated-child" data-hf-id="animated-child" data-label="Animated Child" data-start="0" data-duration="12">Nested animated layer</div></div><aside class="sibling" data-hf-id="sibling" data-label="Sibling">Sibling stays visible</aside></section></main></body></html>`;
const frame = `([...document.querySelectorAll('hyperframes-player')].filter(host => getComputedStyle(host.parentElement.parentElement).opacity !== '0').map(host => host.shadowRoot?.querySelector('iframe')).find(frame => frame?.style.visibility !== 'hidden' && frame?.contentDocument?.querySelector('.parent-panel')))`;
const state = `(() => {
  const doc = ${frame}?.contentDocument;
  if (!doc) return null;
  const hidden = (element) => {
    for (let current = element; current; current = current.parentElement) {
      const style = doc.defaultView.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    return false;
  };
  return { parent: hidden(doc.querySelector('.parent-panel')), caption: hidden(doc.querySelector('.caption')),
    animated: hidden(doc.querySelector('.animated-child')), independent: hidden(doc.querySelector('.independent-child')),
    sibling: hidden(doc.querySelector('.sibling')) };
})()`;

async function expand(ctx) {
  await ctx.waitFor("Boolean(document.querySelector('.hf-timeline-layer-header'))", { timeoutMs: 60_000 });
  await ctx.eval('window.postMessage({ type: "ipollowork:studio-theme", theme: "light" }, "*")');
  for (const label of ["Scene", "Parent Group"]) {
    const selector = `button[aria-label="Expand ${label}"]`;
    if (await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
      await ctx.trustedClick(selector);
    }
    await ctx.waitFor(`Boolean(document.querySelector('button[aria-label="Collapse ${label}"]'))`);
  }
}

async function canvasReady(ctx) {
  await ctx.waitFor(`Boolean(${frame}) && [...document.querySelectorAll('hyperframes-player')].every(host => {
    const loader = host.shadowRoot?.querySelector('.hfp-shader-loader');
    if (!loader) return true;
    const style = getComputedStyle(loader);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  })`, { timeoutMs: 60_000, label: "visible preview canvas after refresh" });
}

async function reload(ctx, navigate = false) {
  if (navigate) await ctx.client.send("Page.navigate", { url });
  const previousOrigin = await ctx.eval("performance.timeOrigin");
  await ctx.client.send("Page.reload");
  await ctx.waitFor(`performance.timeOrigin > ${previousOrigin} && document.readyState === 'complete'`, { timeoutMs: 60_000, label: "new document finished navigation" });
}

async function waitForSavedVisibility(id, hidden) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const source = await readFile(join(project, "index.html"), "utf8");
    const tag = source.match(new RegExp(`<[^>]*data-hf-id="${id}"[^>]*>`))?.[0];
    if (tag && tag.includes("data-hidden") === hidden) return;
    await setTimeout(100);
  }
  throw new Error(`Visibility did not persist for ${id}`);
}

export default {
  id: "video-layer-visibility",
  title: "Hiding a video layer hides its entire subtree in the preview",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":5538" },
  preserveTheme: true,
  steps: [
    {
      name: "A parent eye toggle hides the entire group",
      run: async (ctx) => {
        await ctx.prove("The parent and every descendant disappear while unrelated layers remain visible", {
          voiceover: "点击父图层的眼睛后，整个分组及所有子元素从播放画布消失，旁边的独立图层仍然可见。",
          action: async () => {
            await mkdir(project, { recursive: true });
            const registrations = join(root, "vendor/hyperframes/packages/studio/data/projects");
            await mkdir(registrations, { recursive: true });
            const registration = join(registrations, "layer-visibility-proof");
            try { await symlink(project, registration, "junction"); }
            catch (error) {
              if (error.code !== "EEXIST" || await realpath(registration) !== await realpath(project)) throw error;
            }
            await writeFile(join(project, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
            await writeFile(join(project, "index.html"), fixture);
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false });
            await reload(ctx, true);
            await expand(ctx);
            await ctx.waitFor(`(${state})?.parent === false`);
            await ctx.trustedClick('button[aria-label="Hide Independent Child"]');
            await ctx.waitFor(`(${state})?.independent === true`);
            await waitForSavedVisibility("independent-child", true);
            await ctx.trustedClick('button[aria-label="Hide Parent Group"]');
            await waitForSavedVisibility("parent-panel", true);
          },
          assert: async () => {
            await ctx.waitFor(`(() => { const s = ${state}; return s?.parent && s.caption && s.animated && !s.sibling; })()`);
            for (const label of ["Parent Group", "Child Caption", "Animated Child", "Independent Child"]) {
              await ctx.waitFor(`Boolean(document.querySelector('button[aria-label="Show ${label}"]'))`);
            }
            ctx.output("Canvas visibility", JSON.stringify(await ctx.eval(state)));
            await canvasReady(ctx);
          },
          screenshot: { name: "parent-and-descendants-hidden", requireText: ["Parent Group", "Child Caption"], rejectText: ["Loading assets"] },
        });
      },
    },
    {
      name: "Playback and seeking preserve hiding",
      run: async (ctx) => {
        await ctx.prove("Hidden descendants stay absent while playing and after moving the playhead", {
          voiceover: "继续播放或拖动进度条，已隐藏的分组和子元素都不会重新出现。",
          action: async () => {
            await ctx.trustedClick('[data-testid="figma-player-controls"] button[aria-label="Play"]');
            await ctx.waitFor(`(${frame}?.contentWindow?.__player?.getTime?.() ?? 0) > 0.3`);
            await ctx.trustedClick('[data-testid="figma-player-controls"] button[aria-label="Pause"]');
            await ctx.trustedClick('[role="slider"][aria-label="Seek"]');
          },
          assert: async () => {
            await ctx.waitFor(`(${frame}?.contentWindow?.__player?.getTime?.() ?? 0) > 4`);
            const current = await ctx.eval(state);
            ctx.assert(current.parent && current.caption && current.animated && !current.sibling, "The subtree stays hidden after playback and seeking");
            ctx.output("After playback and seek", JSON.stringify(current));
            await canvasReady(ctx);
          },
          screenshot: { name: "hidden-after-playback-and-seek", requireText: ["Parent Group"], rejectText: ["Loading assets"] },
        });
      },
    },
    {
      name: "Showing the parent preserves independently hidden children after reload",
      run: async (ctx) => {
        await ctx.prove("Showing the group restores its contents without revealing an independently hidden child", {
          voiceover: "重新显示父图层后，普通子元素恢复可见，单独隐藏的子元素保持隐藏，刷新后状态也一致。",
          action: async () => {
            await ctx.trustedClick('button[aria-label="Show Parent Group"]');
            await ctx.waitFor(`(() => { const s = ${state}; return s && !s.parent && !s.caption && !s.animated && s.independent; })()`);
            await waitForSavedVisibility("parent-panel", false);
            await reload(ctx);
            await expand(ctx);
          },
          assert: async () => {
            await ctx.waitFor(`(() => { const s = ${state}; return s && !s.parent && !s.caption && !s.animated && s.independent && !s.sibling; })()`, { timeoutMs: 60_000 });
            await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Show Independent Child"]\'))');
            await ctx.waitFor('Boolean(document.querySelector(\'button[aria-label="Hide Child Caption"]\'))');
            ctx.output("Restored parent after reload", JSON.stringify(await ctx.eval(state)));
            await canvasReady(ctx);
          },
          screenshot: { name: "parent-restored-child-still-hidden", requireText: ["Parent Group", "Independent Child"], rejectText: ["Loading assets"] },
        });
      },
    },
  ],
};
