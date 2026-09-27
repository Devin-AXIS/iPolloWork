import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const exec = promisify(execFile);
const vo = await loadVoiceoverParagraphs("video-camera-direction");
const repo = resolve(import.meta.dirname, "../..");
const registry = join(repo, "vendor/hyperframes/registry/blocks");
const gsapPath = join(repo, "vendor/hyperframes/node_modules/.bun/gsap@3.15.0/node_modules/gsap/dist/gsap.min.js");
const components = ["screenshot-zoom", "device-carousel"];
const themes = {
  light: { bg: "#f4f6f8", text: "#172126", muted: "#647078", surface: "#ffffff", border: "#d7dde1", primary: "#087d81" },
  dark: { bg: "#10191e", text: "#eff6f7", muted: "#a3b2bb", surface: "#1c2b33", border: "#3b515e", primary: "#45d6cc" },
};
let project;
let scenes;

export default {
  id: "video-camera-direction",
  title: "Shared camera presets and native components retain editing, themes and deterministic seeks",
  kind: "internal",
  preserveTheme: true,
  // Never navigate the user's app. Run on a dedicated test browser with this tab title.
  cdpTarget: { title: "iPolloWork Camera Proof" },
  steps: [{
    name: "Install from the existing component service",
    run: async (ctx) => {
      const workspace = join(ctx.outDir, "workspace");
      project = join(workspace, "video/camera-proof");
      scenes = join(ctx.outDir, "camera-scenes");
      await mkdir(scenes, { recursive: true });
      await copyFile(gsapPath, join(scenes, "gsap.min.js"));
      await mkdir(project, { recursive: true });
      await writeFile(join(project, "index.html"), "<!doctype html><html><body>Camera installation fixture</body></html>");
      const installed = await exec("bun", ["--eval", `
        import { installVideoComponents } from ${JSON.stringify(pathToFileURL(join(repo, "apps/server/src/extensions/video-components.ts")).href)};
        console.log(JSON.stringify(await installVideoComponents({ id: "camera-proof", path: ${JSON.stringify(workspace)} }, { sourcePath: "video/camera-proof/index.html", componentIds: ${JSON.stringify(components)} })));
      `], { cwd: repo, env: { ...process.env, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registry }, timeout: 60_000 });
      const result = JSON.parse(installed.stdout);
      ctx.assert(result.components.length === 2, "Both components install through the existing Work service");
      await copyFile(gsapPath, join(project, "gsap.min.js"));
      await writeFile(join(project, "screen.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1660" height="692"><rect width="1660" height="692" fill="#162f3a"/><rect x="180" y="150" width="600" height="400" rx="35" fill="#247982"/><rect x="850" y="150" width="620" height="400" rx="35" fill="#315262"/><text x="245" y="355" fill="white" font-size="65" font-family="sans-serif">Imported screen</text></svg>');
      await copyFile(join(project, "screen.svg"), join(scenes, "screen.svg"));
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      for (const id of components) {
        const source = await readFile(join(project, "compositions", id + ".html"), "utf8");
        const manifest = JSON.parse(await readFile(join(registry, id, "registry-item.json"), "utf8"));
        ctx.assert(manifest.variables.length === 4 && manifest.visualComponent.themeMode === "inherit", id + ": four native parameters, theme inheritance");
        for (const [theme, tokens] of Object.entries(themes)) {
          const variables = theme === "light" ? {} : id === "screenshot-zoom"
            ? { title: "把镜头交给重要的信息", focusX: 72, focusY: 45 }
            : { title: "一个产品，连续的体验", labels: "发现价值|开始创作|确认成果", note: "三个独立景深平面，跟随焦点依次展开" };
          const styles = Object.entries(tokens).map(([key, value]) => "--ipw-color-" + key + ":" + value).join(";");
          const fixture = source.replace('src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"', 'src="./gsap.min.js"')
            .replace("</head>", '<style>:root{' + styles + '}</style><script>window.__hfVariablesByComp=' + JSON.stringify({ [id]: variables }) + ';</script></head>');
          await writeFile(join(scenes, id + "-" + theme + ".html"), fixture);
        }
      }
      // Render the real installed sub-compositions through the host, not a parallel player.
      for (const id of components) {
        const file = join(project, "compositions", id + ".html");
        await writeFile(file, (await readFile(file, "utf8")).replace('src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"', 'src="./gsap.min.js"'));
      }
      const tokens = Object.entries(themes.light).map(([key, value]) => "--ipw-color-" + key + ":" + value).join(";");
      const hosts = components.map((id, index) => '<section id="' + id + '-scene" class="clip" data-composition-id="' + id + '-proof" data-composition-src="compositions/' + id + '.html" data-ipw-registry-component="' + id + '" data-ipw-timing-owner="host" data-variable-values=\'{}\' data-start="' + index * 8 + '" data-duration="8" data-track-index="0" style="position:absolute;inset:0"></section>').join("");
      await writeFile(join(project, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}main{position:relative;width:1920px;height:1080px;' + tokens + '}</style></head><body><main id="camera-demo" data-composition-id="camera-demo" data-width="1920" data-height="1080" data-start="0" data-duration="16">' + hosts + '</main><script src="./gsap.min.js"></script><script>window.__timelines=window.__timelines||{};window.__timelines["camera-demo"]=gsap.timeline({paused:true}).to({}, {duration:16});</script></body></html>');
    },
  }, {
    name: "Five actual spatial camera recipes move and seek in both themes",
    run: async (ctx) => {
      const installed = await exec("bun", ["--eval", `
        import { installVideoComponents } from ${JSON.stringify(pathToFileURL(join(repo, "apps/server/src/extensions/video-components.ts")).href)};
        console.log(JSON.stringify(await installVideoComponents({ id: "camera-proof", path: ${JSON.stringify(join(ctx.outDir, "workspace"))} }, { sourcePath: "video/camera-proof/index.html", componentIds: ["spatial-camera-suite"] })));
      `], { cwd: repo, env: { ...process.env, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registry }, timeout: 60_000 });
      ctx.assert(JSON.parse(installed.stdout).components.length === 1, "Spatial suite installs through the same Work component service");
      const source = await readFile(join(project, "compositions/spatial-camera-suite.html"), "utf8");
      const manifest = JSON.parse(await readFile(join(registry, "spatial-camera-suite/registry-item.json"), "utf8"));
      const recipes = manifest.variables.find(variable => variable.id === "shotStyle").options;
      ctx.assert(recipes.length === 5, "All five runtime recipes are tested from the registry");
      for (const recipe of recipes) {
        for (const [theme, tokens] of Object.entries(themes)) {
          const variables = { title: "空间运镜，让信息有层次", shotStyle: recipe.value, items: "*焦点::首先看到关键信息|景深::层次随镜头展开|落点::清晰回到完整画面" };
          const styles = Object.entries(tokens).map(([key, value]) => "--ipw-color-" + key + ":" + value).join(";");
          const fixture = source.replace('src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"', 'src="./gsap.min.js"')
            .replace("</head>", '<style>:root{' + styles + '}</style><script>window.__hfVariablesByComp=' + JSON.stringify({ "spatial-camera-suite": variables }) + ';</script></head>');
          const file = join(scenes, recipe.value + "-" + theme + ".html");
          await writeFile(file, fixture);
          let state;
          await ctx.prove(recipe.value + " / " + theme + ": actual multi-stage spatial motion and exact reverse seek", {
            voiceover: vo[1],
            action: async () => {
              await ctx.client.send("Page.navigate", { url: pathToFileURL(file).href });
              await ctx.waitFor("document.readyState === 'complete' && Boolean(window.__timelines?.['spatial-camera-suite'])", { timeoutMs: 30_000 });
              state = await ctx.eval(`(() => {
                const tl=window.__timelines['spatial-camera-suite'];
                const sample=time=>{tl.seek(time);return JSON.stringify([...document.querySelectorAll('[data-motion-role],.sc-card,.sc-light')].map(el=>{const s=getComputedStyle(el),matrix=new DOMMatrixReadOnly(s.transform==='none'?undefined:s.transform);return [...matrix.toFloat64Array()].map(value=>Math.round(value*1e6)/1e6).concat(Number(s.opacity),s.filter)}))};
                const frames=[1.2,2.5,4.2,6.6,2.5].map(sample);
                const groundDepths=[...document.querySelectorAll('.sc-floor,.sc-runway')].map(el=>{const s=getComputedStyle(el),m=new DOMMatrixReadOnly(s.transform);return m.m43+Math.abs(m.m23)*parseFloat(s.height)});
                return {frames,groundDepths,pageOverflow:getComputedStyle(document.querySelector('.sc-page')).overflow,spotlightBlend:getComputedStyle(document.querySelector('.sc-light')).mixBlendMode,duration:tl.duration(),recipe:document.querySelector('main').dataset.shotStyle,background:getComputedStyle(document.querySelector('main')).backgroundColor,cards:document.querySelectorAll('.sc-card').length};
              })()`);
            },
            assert: async () => {
              ctx.assert(state.duration === 9 && state.recipe === recipe.value, "The selected recipe runs on its declared nine-second timeline");
              ctx.assert(state.frames.slice(1, 4).every((frame, index) => frame !== state.frames[index]), "Entrance, development, focus and landing have distinct spatial states");
              ctx.assert(state.frames[1] === state.frames[4], "Reverse seek reconstructs identical spatial transforms and opacity");
              ctx.assert(state.cards === 3, "All three data layers render");
              ctx.assert(state.groundDepths.length === 2 && state.groundDepths.every(depth => depth < 0), "Ground planes stay behind the content plane across their rotated extent");
              ctx.assert(state.pageOverflow !== "hidden" && state.spotlightBlend !== "multiply", "Card depth is preserved and the spotlight does not invert on the dark theme");
              ctx.assert(state.background === (theme === "light" ? "rgb(244, 246, 248)" : "rgb(16, 25, 30)"), "Theme tokens reach the spatial scene");
            },
            screenshot: { name: recipe.value + "-" + theme, requireText: ["空间运镜，让信息有层次", "首先看到关键信息"] },
          });
        }
      }
      await ctx.eval('document.title="iPolloWork Camera Proof"');
    },
  }, {
    name: "Prove continuous camera motion and reversible seeking in both themes",
    run: async (ctx) => {
      for (const id of components) {
        for (const theme of Object.keys(themes)) {
          let states;
          await ctx.prove(id + " / " + theme + ": distinct mid-shot development with exact reverse seek", {
            voiceover: vo[0],
            action: async () => {
              await ctx.client.send("Page.navigate", { url: pathToFileURL(join(scenes, id + "-" + theme + ".html")).href });
              await ctx.waitFor("document.readyState === 'complete' && Boolean(window.__timelines?.[" + JSON.stringify(id) + "])", { timeoutMs: 30_000 });
              states = await ctx.eval(`(() => {
                const tl=window.__timelines[${JSON.stringify(id)}];
                const state=(time)=>{tl.seek(time);return [...document.querySelectorAll('[data-motion-role]')].map(el=>{const s=getComputedStyle(el);return [s.transform,s.opacity,s.filter].join('|')}).join(';')};
                const a=state(1.2),b=state(3.3),c=state(5.8),d=state(7.8),again=state(3.3);
                return {a,b,c,d,again,duration:tl.duration(),background:getComputedStyle(document.querySelector('[class$="-fill"]')).backgroundColor,emptyImages:[...document.images].filter(img=>!img.hidden&&(!img.complete||img.naturalWidth===0)).length};
              })()`);
            },
            assert: async () => {
              ctx.assert(states.duration === 8, "Declared and actual duration are 8 seconds");
              ctx.assert(states.a !== states.b && states.b !== states.c && states.c !== states.d, "The shot develops after the initial entrance, through focus and landing");
              ctx.assert(states.b === states.again, "Seeking backward restores the exact same transforms, filters and opacity");
              ctx.assert(states.emptyImages === 0, "No broken visible image");
              ctx.assert(states.background === (theme === "light" ? "rgb(244, 246, 248)" : "rgb(16, 25, 30)"), "The existing theme tokens reach the rendered scene");
            },
            screenshot: { name: id + "-" + theme, requireText: theme === "dark" ? [id === "screenshot-zoom" ? "把镜头交给重要的信息" : "发现价值"] : [id === "screenshot-zoom" ? "Focus on what matters" : "One product. Every moment."] },
          });
        }
      }
    },
  }, {
    name: "Nested scenes share the actual export clock",
    run: async (ctx) => {
      const bundle = join(ctx.outDir, "camera-direction.html");
      await exec("bun", ["--eval", `
        import { bundleToSingleHtml } from ${JSON.stringify(pathToFileURL(join(repo, "vendor/hyperframes/packages/core/src/compiler/htmlBundler.ts")).href)};
        await Bun.write(${JSON.stringify(bundle)}, await bundleToSingleHtml(${JSON.stringify(project)}));
      `], { cwd: repo, timeout: 60_000 });
      let states;
      await ctx.prove("Nested export keeps both components on one reversible master timeline", {
        voiceover: vo[2],
        action: async () => {
          await ctx.client.send("Page.navigate", { url: pathToFileURL(bundle).href });
          await ctx.waitFor("Boolean(window.__player?.renderSeek && window.__timelines?.['device-carousel-proof'])", { timeoutMs: 30_000 });
          states = await ctx.eval(`(() => {
            window.__player.enableRenderMode();
            const sample = time => {
              window.__player.renderSeek(time);
              const timelines = window.__timelines;
              return {
                time,
                screenshot: timelines['screenshot-zoom-proof'].time(),
                device: timelines['device-carousel-proof'].time(),
                nested: timelines['screenshot-zoom-proof'].parent === timelines['camera-demo'] && timelines['device-carousel-proof'].parent === timelines['camera-demo'],
                motion: [...document.querySelectorAll('[data-motion-role]')].map(el => {const s=getComputedStyle(el);return [s.transform,s.opacity,s.filter].join('|')}).join(';')
              };
            };
            return [1.2,3.3,7.8,9.2,11.3,15.8,3.3].map(sample);
          })()`);
        },
        assert: async () => {
          ctx.assert(states.every(state => state.nested), "One shared GSAP instance owns both scene timelines");
          ctx.assert(states.every(state => Math.abs(state.screenshot - Math.min(8, state.time)) < .002 && Math.abs(state.device - Math.max(0, state.time - 8)) < .002), "Each scene follows its host start offset, not wall-clock playback");
          ctx.assert(states[1].motion === states[6].motion, "Export restores exactly the same frame after reverse seeking across scenes");
          ctx.assert(states[0].motion !== states[1].motion && states[1].motion !== states[2].motion, "The nested camera performs entrance, focus and landing");
        },
        screenshot: { name: "nested-camera-focus", requireText: ["Focus on what matters"] },
      });
      await ctx.prove("The second nested scene returns to its three-device overview", {
        voiceover: vo[3],
        action: async () => { await ctx.eval("window.__player.renderSeek(15.8); true"); },
        assert: async () => {
          const opacity = await ctx.eval("[...document.querySelectorAll('.dc-device')].map(el => Number(getComputedStyle(el).opacity))");
          ctx.assert(opacity.length === 3 && opacity.every(value => value === 1), "All three devices return to full visibility before the scene ends");
        },
        screenshot: { name: "nested-camera-landing", requireText: ["One product. Every moment."] },
      });
      await ctx.eval('document.title="iPolloWork Camera Proof"');
    },
  }, {
    name: "Real image parameters and focal framing survive installation",
    run: async (ctx) => {
      for (const id of components) {
        const original = await readFile(join(scenes, id + "-light.html"), "utf8");
        const variables = id === "screenshot-zoom" ? { imageUrl: "./screen.svg", focusX: 100, focusY: 0 } : { screenUrls: "./screen.svg|./screen.svg|./screen.svg", labels: "One|Two|Three" };
        const source = original.replace("window.__hfVariablesByComp=" + JSON.stringify({ [id]: {} }), "window.__hfVariablesByComp=" + JSON.stringify({ [id]: variables }));
        const file = join(scenes, id + "-media.html");
        await writeFile(file, source);
        await ctx.prove(id + ": editable image parameters display local media", {
          voiceover: vo[4],
          action: async () => {
            await ctx.client.send("Page.navigate", { url: pathToFileURL(file).href });
            await ctx.waitFor("document.readyState === 'complete' && [...document.images].every(img => img.complete && img.naturalWidth > 0) && Boolean(window.__timelines?.[" + JSON.stringify(id) + "])", { timeoutMs: 30_000 });
            await ctx.eval("window.__timelines[" + JSON.stringify(id) + "].seek(3.3); true");
          },
          assert: async () => {
            const count = await ctx.eval("document.images.length");
            ctx.assert(count === (id === "screenshot-zoom" ? 1 : 3), "All supplied screens render as image elements");
            if (id === "screenshot-zoom") {
              const covered = await ctx.eval(`(() => {const v=document.querySelector('.sz-viewport').getBoundingClientRect(),w=document.querySelector('.sz-world').getBoundingClientRect();return w.left<=v.left+1&&w.top<=v.top+1&&w.right>=v.right-1&&w.bottom>=v.bottom-1})()`);
              ctx.assert(covered, "Extreme focal coordinates cannot reveal an empty viewport edge");
            }
          },
          screenshot: { name: id + "-local-media", requireText: [id === "screenshot-zoom" ? "Focus on what matters" : "One"] },
        });
      }
      await ctx.eval('document.title="iPolloWork Camera Proof"');
    },
  }],
};
