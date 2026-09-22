import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../..");
let library;
let layouts;

export default {
  id: "video-layout-library",
  title: "Video scene references materialize and render without owning project timing",
  kind: "internal",
  preserveTheme: true,
  steps: [{
    name: "Read actual materialized scene references",
    run: async (ctx) => {
      const root = resolve(ctx.outDir, "workspace");
      await mkdir(root, { recursive: true });
      const source = pathToFileURL(join(repo, "apps/server/src/templates.ts")).href;
      const result = execFileSync("bun", ["--eval", `
        import { installBundledTemplate, materializeTemplate } from ${JSON.stringify(source)};
        const root = ${JSON.stringify(root)};
        const config = {host:'127.0.0.1',port:0,token:'test',hostToken:'host',approval:{mode:'auto',timeoutMs:1000},corsOrigins:['*'],workspaces:[],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:'env',hostTokenSource:'env',logFormat:'pretty',logRequests:false};
        const workspace = {id:'preview',name:'Preview',path:root,preset:'default',workspaceType:'local'};
        await installBundledTemplate(config, workspace.id, 'ipollowork.html-anything.motion-frames');
        console.log(JSON.stringify(await materializeTemplate(config, workspace, 'ipollowork.html-anything.motion-frames', 'video-layouts')));
      `], { cwd: repo, encoding: "utf8", env: { ...process.env, IPOLLOWORK_RUNTIME_DB: join(root, "runtime.sqlite"), IPOLLOWORK_BUNDLED_TEMPLATES_DIR: join(repo, "apps/server/bundled-templates") } });
      ctx.output("Session materialization", result);
      library = join(root, "video/video-layouts/core-v1-video");
      const catalog = await readFile(join(library, "catalog.md"), "utf8");
      layouts = [...catalog.matchAll(/^\| `([^`]+\.html)`/gm)].map((match) => match[1]);
      ctx.assert(layouts.length === 9, "All nine independent video layouts materialized");
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1150, deviceScaleFactor: 1, mobile: false });
    },
  }, {
    name: "Inspect scene bodies and theme/text adaptation",
    run: async (ctx) => {
      for (const file of layouts) {
        for (const adapted of [false, true]) {
          await ctx.prove(`${file}: ${adapted ? "adapted theme and Chinese copy" : "source scene"} fits the declared preview stage`, {
            voiceover: adapted
              ? "The same scene structure remains readable with a new theme and longer Chinese copy. This checks static layout, not animated playback."
              : "The materialized scene reference displays its content without adding a composition root or setting project duration.",
            action: async () => {
              await ctx.client.send("Page.navigate", { url: pathToFileURL(join(library, file)).href });
              await ctx.waitFor("document.readyState === 'complete' && Boolean(document.querySelector('main .ipw-video-layout'))");
              await ctx.eval("document.fonts.ready.then(() => true)");
              if (adapted) await ctx.eval(`(() => {
                document.documentElement.style.setProperty('--ipw-color-bg', '#102638');
                document.documentElement.style.setProperty('--ipw-color-text', '#f6f3e9');
                document.documentElement.style.setProperty('--ipw-color-muted', '#c4d3df');
                document.documentElement.style.setProperty('--ipw-color-primary', '#e8bc77');
                document.documentElement.style.setProperty('--ipw-color-border', '#738998');
                document.documentElement.style.setProperty('--ipw-font-display', 'system-ui, sans-serif');
                document.querySelector('main h2').textContent = '从真实观察走向行动，让每一个结论都有清晰的依据';
              })()`);
              await ctx.waitFor("document.querySelector('main').getBoundingClientRect().width === 1920");
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const stage = document.querySelector('main').getBoundingClientRect();
                const elements = [...document.querySelectorAll('main h2, main h3, main p, main span')];
                return {
                  noRoot: !document.querySelector('main [data-composition-id], main [data-duration]'),
                  visible: elements.length > 0 && elements.every(el => getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0'),
                  fits: elements.every(el => { const r = el.getBoundingClientRect(); return r.left >= stage.left && r.right <= stage.right + 1 && r.top >= stage.top && r.bottom <= stage.bottom + 1 && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1; }),
                  background: getComputedStyle(document.querySelector('main .ipw-video-layout')).backgroundColor,
                };
              })()`);
              ctx.assert(state.noRoot, "Fragment does not own composition or duration");
              ctx.assert(state.visible && state.fits, "Text is visible and stays inside the fixed stage");
              if (adapted) ctx.assert(state.background === "rgb(16, 38, 56)", "Fragment follows active theme tokens");
            },
            screenshot: { name: file.replace(".html", "") + (adapted ? "-adapted" : ""), requireText: [adapted ? "从真实观察走向行动" : "static scene-body preview"] },
          });
        }
      }
    },
  }],
};
