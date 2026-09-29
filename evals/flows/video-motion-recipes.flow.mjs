import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";

const requireStudio = createRequire(new URL("../../vendor/hyperframes/packages/studio/package.json", import.meta.url));
const execFileAsync = promisify(execFile);

export default {
  id: "video-motion-recipes",
  title: "Authored video recipes instantiate and remain deterministic under seeking",
  kind: "user-facing",
  requiresApp: false,
  steps: [{
    name: "Instantiate and seek every authored semantic recipe without editing user projects",
    async run(ctx) {
      const root = await mkdtemp(join(tmpdir(), "ipollowork-recipe-proof-"));
      const repo = new URL("../../", import.meta.url).pathname;
      const registry = join(repo, "vendor/hyperframes/registry/blocks");
      let browser;
      try {
        const script = [
          'import {mkdir,writeFile,readFile,readdir} from "node:fs/promises";',
          'import {join} from "node:path";',
          'import {installVideoComponents,checkVideoComponents} from "./apps/server/src/extensions/video-components.ts";',
          'const root=process.env.RECIPE_PROOF_ROOT,registry=process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT,project=join(root,"video/proof");',
          'await mkdir(join(project,"assets"),{recursive:true});',
          'await writeFile(join(project,"index.html"),"<main data-composition-id=main></main>");',
          'await writeFile(join(project,"assets/evidence.svg"),\'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#183b45"/><circle cx="1250" cy="520" r="260" fill="#dfb772"/><path d="M0 820L1920 650V1080H0Z" fill="#386876"/></svg>\');',
          'const output=[];for(const name of await readdir(registry)){const m=JSON.parse(await readFile(join(registry,name,"registry-item.json"),"utf8"));if(!m.motionRecipe)continue;',
          'const example=m.motionRecipe.usage.example.values,c=m.motionRecipe.capacity,variants=[{label:"example",values:{...example}}];',
          String.raw`if(c){const separator=c.separator.replaceAll("\\n","\n"),first=String(example[c.variable]).replaceAll("\\n","\n").split(separator)[0];for(const count of new Set([c.minItems,c.maxItems])){const values={...example,[c.variable]:Array(count).fill(first).join(separator)};for(const key of ["highlight","activeStep","focusLine"])if(key in values)values[key]=1;variants.push({label:"items-"+count,values});}}`,
          'for(const {label,values} of variants){',
          'const result=await installVideoComponents({id:"proof",path:root},{sourcePath:"video/proof/index.html",componentIds:[name],instances:[{sceneId:"proof",componentId:name,start:0,duration:m.duration,values,timingSource:"visual-cue"}]});',
          'await writeFile(join(project,"index.html"),"<main data-composition-id=main>"+result.instances[0].snippet+"</main>");',
          'const checked=await checkVideoComponents({id:"proof",path:root},{sourcePath:"video/proof/index.html"});if(!checked.valid)throw Error(JSON.stringify(checked.issues));',
          'values.motionCueTimes=JSON.stringify(result.instances[0].cueTimes);output.push({id:name+"-"+label,componentId:name,recipe:m.motionRecipe,duration:m.duration,values,html:await readFile(join(project,"compositions",name+".html"),"utf8")});}}console.log(JSON.stringify(output));',
        ].join("\n");
        const { stdout } = await execFileAsync(process.env.BUN_BINARY || "/Users/hesitu/.bun/bin/bun", ["--eval", script], {
          cwd: repo, maxBuffer: 4_000_000,
          env: { ...process.env, RECIPE_PROOF_ROOT: root, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registry },
        });
        const recipes = JSON.parse(stdout);
        ctx.assert(new Set(recipes.map(recipe => recipe.componentId)).size === 20, "All twenty recipes install Chinese examples and capacity boundaries without truncation");
        const puppeteer = requireStudio("puppeteer-core");
        browser = await puppeteer.launch({
          executablePath: process.env.IPOLLOWORK_EVAL_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          headless: true, defaultViewport: { width: 1920, height: 1080 },
          args: ["--no-sandbox"],
        });
        const page = (await browser.pages())[0];
        const base = "http://127.0.0.1:" + new URL(browser.wsEndpoint()).port;
        ctx.cdpBaseUrl = base;
        const target = (await listTargets(base)).find(target => target.type === "page" && target.url === "about:blank");
        ctx.assert(Boolean(target), "The isolated browser provides a capturable real rendering target");
        ctx.client = await connect(debuggerUrlFor(base, target));
        const gsap = await readFile(requireStudio.resolve("gsap/dist/gsap.min.js"), "utf8");
        const runtimeErrors = [];
        page.on("pageerror", error => runtimeErrors.push(error.message));
        await page.setRequestInterception(true);
        page.on("request", request => {
          if (request.url().endsWith("assets/evidence.svg")) {
            void readFile(join(root, "video/proof/assets/evidence.svg")).then(body => request.respond({ status: 200, contentType: "image/svg+xml", body }));
          } else void request.continue();
        });
        const failures = [];
        for (const recipe of recipes) {
          try {
            await ctx.prove(recipe.id + " progresses through real semantic events and rewinds identically", {
            voiceover: recipe.id + " 使用原版组件、语义事件和真实内容变量；中段实际推进，倒放恢复同一画面。",
            action: async () => {
              await page.goto("about:blank");
              runtimeErrors.length = 0;
              const injected = "<base href=\"http://ipollo-recipe.test/\"><script>window.__hyperframes={getVariables:()=>(" + JSON.stringify(recipe.values).replaceAll("<", "\\u003c") + ")};</script>";
              const html = recipe.html.replace("<head>", () => "<head>" + injected)
                .replace(/<script src="https:\/\/cdn.jsdelivr.net\/npm\/gsap[^"]*">\s*<\/script>/g, () => "<script>" + gsap + "</script>");
              await page.setContent(html, { waitUntil: "load" });
              await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all([...document.images].map(image => image.decode()));
              });
              ctx.assert(runtimeErrors.length === 0, recipe.id + " has no runtime errors: " + runtimeErrors.join("; "));
            },
            assert: async () => {
              const measured = await page.evaluate(({ events, duration, cueTimes }) => {
                const root = document.querySelector("[data-composition-id]");
                const tl = window.__timelines[root.dataset.compositionId];
                const snapshot = selector => [...root.querySelectorAll(selector)].map(element => {
                  const css = getComputedStyle(element);
                  return { opacity: css.opacity, transform: css.transform, text: element.textContent };
                });
                const samples = [];
                for (const event of events) {
                  const at = cueTimes[event.id];
                  if (at === undefined) continue;
                  tl.seek(Math.max(0, at - .01), false);
                  const before = snapshot(event.target);
                  tl.seek(at + event.duration, false);
                  const after = snapshot(event.target);
                  samples.push({ event: event.id, found: before.length, changed: JSON.stringify(before) !== JSON.stringify(after),
                    readableSingleHold: event.id === "resolve" && after.length === 1 && Number(after[0].opacity) >= .99 && Boolean(after[0].text.trim()) });
                }
                const at = events[1].time + .25;
                tl.seek(at, false); const forward = snapshot("*");
                tl.seek(duration, false); tl.seek(at, false); const rewind = snapshot("*");
                tl.seek(duration - .1, false);
                const clipped = [...root.querySelectorAll("h1,b,.vc-label,.vc-meta,.vc-value,.code-line,.cm-cell,.stat,.evidence,.source,.question-context,.diff-code,.diff-summary,.takeaway")].filter(element => {
                  const rect = element.getBoundingClientRect();
                  let parent = element.parentElement, ancestorClipped = false;
                  while (parent && parent !== root) {
                    const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent);
                    if (["hidden", "clip", "auto", "scroll"].includes(css.overflowX) && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) ancestorClipped = true;
                    if (["hidden", "clip", "auto", "scroll"].includes(css.overflowY) && (rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) ancestorClipped = true;
                    parent = parent.parentElement;
                  }
                  return rect.width && rect.height && (ancestorClipped || rect.left < -1 || rect.top < -1 || rect.right > 1921 || rect.bottom > 1081 || element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2);
                }).map(element => ({ selector: element.className || element.tagName, text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
                return { samples, deterministic: JSON.stringify(forward) === JSON.stringify(rewind), clipped, timelineDuration: tl.duration() };
              }, { events: recipe.recipe.events, duration: recipe.duration, cueTimes: JSON.parse(recipe.values.motionCueTimes) });
              ctx.assert(measured.samples.every(sample => sample.found > 0 && (sample.changed || sample.readableSingleHold)), recipe.id + ": events change rendered targets or preserve a readable single-item final hold: " + JSON.stringify(measured.samples));
              ctx.assert(measured.deterministic, "Forward seeking and rewind restore identical text, opacity and transforms");
              ctx.assert(measured.clipped.length === 0, recipe.id + ": representative content stays inside the canvas without text clipping: " + JSON.stringify(measured.clipped));
              ctx.assert(measured.timelineDuration + .001 >= recipe.duration, recipe.id + ": the paused timeline preserves the complete scene window: " + measured.timelineDuration);
              ctx.output(recipe.id + " measured event coverage", JSON.stringify(measured));
            },
            screenshot: { name: recipe.id, targetId: target.id },
            });
          } catch (error) {
            failures.push(recipe.id + ": " + error.message);
          }
        }
        ctx.assert(failures.length === 0, failures.join("\n"));
      } finally {
        ctx.client?.close();
        await browser?.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  }],
};
