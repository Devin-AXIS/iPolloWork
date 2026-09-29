import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from "node:fs/promises";
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
          'import {installVideoComponents,checkVideoComponents,attribute} from "./apps/server/src/extensions/video-components.ts";',
          'const root=process.env.RECIPE_PROOF_ROOT,registry=process.env.IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT,project=join(root,"video/proof");',
          'await mkdir(join(project,"assets"),{recursive:true});',
          'await writeFile(join(project,"index.html"),"<main data-composition-id=main></main>");',
          'await writeFile(join(project,"assets/evidence.svg"),\'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#183b45"/><circle cx="1250" cy="520" r="260" fill="#dfb772"/><path d="M0 820L1920 650V1080H0Z" fill="#386876"/></svg>\');',
          'const output=[];for(const name of await readdir(registry)){const m=JSON.parse(await readFile(join(registry,name,"registry-item.json"),"utf8"));if(!m.motionRecipe)continue;',
          'const example=m.motionRecipe.usage.example.values,c=m.motionRecipe.capacity,variants=[{label:"example",values:{...example}}];',
          String.raw`if(c){const separator=c.separator.replaceAll("\\n","\n"),first=String(example[c.variable]).replaceAll("\\n","\n").split(separator)[0];for(const count of new Set([c.minItems,c.maxItems])){const values={...example,[c.variable]:Array(count).fill(first).join(separator)};for(const key of ["highlight","activeStep","focusLine"])if(key in values)values[key]=1;variants.push({label:"items-"+count,values});}}`,
          'if(name==="question-opener")for(const motionStyle of ["restrained","energetic"])variants.push({label:motionStyle,values:{...example},motionStyle});',
          'if(["metric-signal","gauge-scorecard","sparkline-grid","cohort-retention","conversion-funnel"].includes(name)){const items=name==="sparkline-grid"||name==="cohort-retention"?"零值组::0,0,0|对照组::100,80,60":name==="conversion-funnel"?"开始::100|结束::0":"零值::0|对照::100";variants.push({label:"zero-and-scale",values:{...example,items}});}',
          'if(["metric-signal","gauge-scorecard","benchmark-scorecard","sparkline-grid","cohort-retention","conversion-funnel","feedback-loop","process-handoff-map","deployment-pipeline"].includes(name)){const connected=["feedback-loop","process-handoff-map","deployment-pipeline"].includes(name),items=String(example.items).split("|").map(item=>"字".repeat(c.maxFieldLength)+"::"+(connected?"字".repeat(c.maxFieldLength):item.split("::")[1])).join("|");variants.push({label:"max-chinese-text",values:{...example,items,title:"字".repeat(24),note:"字".repeat(40)}});}',
          'if(m.source?.provider==="hyperframes-video-shotcraft"){const values={...example};for(const [key,limit] of Object.entries(m.motionRecipe.textLimits)){values[key]=Array(limit.maxLines).fill("字".repeat(limit.maxLineLength)).join("\\n");}if(c?.variable==="words")values.words=Array(c.maxItems).fill("字".repeat(c.maxFieldLength)).join("|");variants.push({label:"max-chinese-text",values});}',
          'if(m.upstream?.adaptation?.startsWith("Retains converted GSAP/frame functions."))for(const motionStyle of ["restrained","energetic"]){let end=.85;const cueTimes={};for(const event of m.motionRecipe.events){cueTimes[event.id]=end;end+=event.duration*(motionStyle==="restrained"?1.15:.85)+.15;}variants.push({label:motionStyle+"-rebound-cues",values:{...example},motionStyle,cueTimes,duration:Math.max(m.duration,end+1)});}',
          'for(const {label,values,motionStyle="balanced",cueTimes,duration=m.duration} of variants){',
          'const result=await installVideoComponents({id:"proof",path:root},{sourcePath:"video/proof/index.html",componentIds:[name],motionStyle,instances:[{sceneId:"proof",componentId:name,start:0,duration,values,cueTimes,timingSource:"visual-cue"}]});',
          'await writeFile(join(project,"index.html"),"<main data-composition-id=main>"+result.instances[0].snippet+"</main>");',
          'const checked=await checkVideoComponents({id:"proof",path:root},{sourcePath:"video/proof/index.html",recipesOnly:true});if(!checked.valid)throw Error(JSON.stringify(checked.issues));',
          'await writeFile(join(project,"index.html"),"<main data-composition-id=main>"+result.instances[0].snippet.replace(/data-ipw-registry-component="[^"]+"/,\'data-ipw-component-decision="custom:diagram"\')+"</main>");const rejected=await checkVideoComponents({id:"proof",path:root},{sourcePath:"video/proof/index.html",recipesOnly:true});if(!rejected.issues.some(issue=>issue.code==="recipe_only_scene_required"))throw Error("Host recipe policy was bypassed: "+name);await writeFile(join(project,"index.html"),"<main data-composition-id=main>"+result.instances[0].snippet+"</main>");',
          'const cardPath=join(project,"compositions",name+".recipe.md");if(await readFile(cardPath,"utf8")!==await readFile(join(registry,name,"recipe.md"),"utf8"))throw Error("Installed recipe card differs from its owner: "+name);',
          'const mounted=JSON.parse(attribute(result.instances[0].snippet,"data-variable-values")),style=JSON.parse(mounted.motionStyle);output.push({id:name+"-"+label,componentId:name,recipe:{...m.motionRecipe,events:m.motionRecipe.events.map(event=>({...event,duration:event.duration*style.durationFactor}))},duration,values:mounted,html:await readFile(join(project,"compositions",name+".html"),"utf8")});}}console.log(JSON.stringify(output));',
        ].join("\n");
        const { stdout } = await execFileAsync(process.env.BUN_BINARY || "/Users/hesitu/.bun/bin/bun", ["--eval", script], {
          cwd: repo, maxBuffer: 8_000_000,
          env: { ...process.env, RECIPE_PROOF_ROOT: root, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registry },
        });
        const recipes = JSON.parse(stdout);
        ctx.assert(new Set(recipes.map(recipe => recipe.componentId)).size === 81, "All eighty-one recipes install matching Markdown cards, Chinese examples and capacity boundaries without truncation");
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
        let referenceEvidence;
        await ctx.prove("Full Shotcraft selection separates reference cards from executable ports", {
          voiceover: "现有媒体工具查询全量目录，读取所选卡的规则和源码关联。未迁移卡不能安装；这验证检索与拦截，不代表全部卡已转换或整片生成通过。",
          action: async () => {
            const selectionScript = `
              import {callMediaExtensionAction} from './apps/server/src/extensions/media-center.ts';
              import {installVideoComponents} from './apps/server/src/extensions/video-components.ts';
              import {readFile,readdir} from 'node:fs/promises';
              import {join} from 'node:path';
              const config={workspaces:[]}, auth={read:async()=>({})};
              const camera=await callMediaExtensionAction(config,auth,'video_recipe_catalog',{category:'camera'},{});
              const detail=await callMediaExtensionAction(config,auth,'video_recipe_catalog',{cardIds:['type-entrance-moves','shot-transitions'],includeMethodology:true},{});
              const project=join(process.env.RECIPE_PROOF_ROOT,'video/proof'), before=await readFile(join(project,'index.html'),'utf8'), files=JSON.stringify((await readdir(project,{recursive:true})).sort());
              const error=await installVideoComponents({id:'proof',name:'Proof',path:process.env.RECIPE_PROOF_ROOT},{sourcePath:'video/proof/index.html',componentIds:['question-opener','cursor-flyover']}).catch(error=>error);
              console.log(JSON.stringify({camera:camera.result.output,detail:detail.result.output,blocked:error.code,blockedMessage:error.message,unchanged:before===await readFile(join(project,'index.html'),'utf8')&&files===JSON.stringify((await readdir(project,{recursive:true})).sort())}));`;
            const result = await execFileAsync(process.env.BUN_BINARY || "/Users/hesitu/.bun/bin/bun", ["--eval", selectionScript], {
              cwd: repo, maxBuffer: 2_000_000, env: { ...process.env, RECIPE_PROOF_ROOT: root, IPOLLOWORK_HYPERFRAMES_REGISTRY_ROOT: registry },
            });
            referenceEvidence = JSON.parse(result.stdout);
            await page.setContent('<html><head><style>body{margin:48px;background:#f6f5f1;color:#172c36;font:24px sans-serif}h1{font-size:42px}article{border-bottom:1px solid #ccc;padding:14px 0}small{display:block;color:#566}pre{white-space:pre-wrap;font-size:18px}summary{cursor:pointer}</style></head><body><h1>Shotcraft reference selection</h1><main></main></body></html>');
            await page.evaluate(evidence => {
              const heading=document.createElement('p');heading.textContent=`${evidence.camera.stats.cardCount} cards · ${evidence.camera.stats.styleCount} variants · ${evidence.camera.stats.localRecipeCount} executable ports`;document.querySelector('main').append(heading);
              for(const card of evidence.camera.cards.slice(0,5)){const row=document.createElement('article');row.textContent=card.name+' — '+card.summary;const status=document.createElement('small');status.textContent=card.styles.map(style=>style.key+': '+style.migrationStatus+' / '+style.conversion.status).join(' · ');row.append(status);document.querySelector('main').append(row);}
              const detail=document.createElement('details');detail.innerHTML='<summary>Selected card rules and exact source</summary>';const rules=document.createElement('pre');rules.textContent=evidence.detail.cards[0].rules;detail.append(rules);document.querySelector('main').append(detail);
              const result=document.createElement('p');result.textContent='Unported install: '+evidence.blocked+' · project unchanged: '+evidence.unchanged;document.querySelector('main').append(result);
            }, referenceEvidence);
            await page.click('summary');
          },
          assert: async () => {
            ctx.assert(referenceEvidence.camera.stats.cardCount === 157 && referenceEvidence.camera.stats.styleCount === 214 && referenceEvidence.camera.stats.executableVariantCount === 30, "Real media action reports complete references and exactly thirty executable migrated variants");
            ctx.assert(referenceEvidence.detail.cards.every(card => card.rules.includes('## 参考实现') && card.implementations.length), "Full selected rules and precise source associations are reachable");
            ctx.assert(referenceEvidence.blocked === 'video_recipe_reference_only' && referenceEvidence.unchanged, "An unavailable treatment cannot write even the valid selections in the same request: " + JSON.stringify({code:referenceEvidence.blocked,message:referenceEvidence.blockedMessage,unchanged:referenceEvidence.unchanged}));
            ctx.assert(await page.$eval('details', element => element.open), "Selected full rules remain readable when expanded");
            ctx.output("Reference catalog and guarded installation", JSON.stringify({stats:referenceEvidence.camera.stats,blocked:referenceEvidence.blocked,unchanged:referenceEvidence.unchanged}));
          },
          screenshot: { name: "shotcraft-reference-selection", targetId: target.id },
        });
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
              await page.waitForFunction(() => Object.keys(window.__timelines ?? {}).length > 0, { timeout: 5000 });
            },
            assert: async () => {
              const measured = await page.evaluate(({ events, duration, cueTimes, style, componentId, values }) => {
                const root = document.querySelector("[data-composition-id]");
                const tl = window.__timelines[root.dataset.compositionId];
                const snapshot = selector => [...root.querySelectorAll(selector)].map(element => {
                  const css = getComputedStyle(element);
                  return { opacity: css.opacity, transform: css.transform, text: element.textContent, filter: css.filter, clipPath: css.clipPath, fontWeight: css.fontWeight, fontVariationSettings: css.fontVariationSettings };
                });
                const samples = [];
                const originalCurveChecks = [];
                if (["metric-signal", "gauge-scorecard", "benchmark-scorecard", "conversion-funnel", "sparkline-grid", "cohort-retention"].includes(componentId)) {
                  tl.seek(duration - .1, false);
                  const rows = [...root.querySelectorAll(".vc-item")], scale = Number(root.dataset.scale), mode = root.dataset.mode;
                  const numbers = String(values.items).split("|").map(item => item.split("::")[1].split(",").map(Number));
                  const expectedScale = ["gauge", "matrix"].includes(mode) ? 100 : mode === "funnel" ? numbers[0][0] : Math.max(...numbers.flat());
                  originalCurveChecks.push(scale === expectedScale);
                  for (const [index, row] of rows.entries()) {
                    const fill = row.querySelector(".vc-fill");
                    // Chromium serializes inline percentages to fewer decimals; tolerance is < .02px here.
                    if (fill) originalCurveChecks.push(Number(fill.dataset.value) === numbers[index][0] && Math.abs(Number.parseFloat(fill.style.width) - (expectedScale === 0 ? 0 : numbers[index][0] / expectedScale * 100)) < .001);
                    if (mode === "matrix") for (const [column, cell] of [...row.querySelectorAll(".vc-cell")].entries()) originalCurveChecks.push(cell.style.getPropertyValue("--value") === numbers[index][column] + "%" && cell.textContent === numbers[index][column] + "%");
                    if (mode === "series") {
                      const path = row.querySelector(".vc-line"), points = [...row.querySelectorAll(".vc-point")];
                      originalCurveChecks.push(points.length === 3 && path.getAttribute("d") === points.map((point, index) => (index ? "L" : "M") + point.getAttribute("cx") + " " + point.getAttribute("cy")).join(" "));
                      originalCurveChecks.push(points.every(point => Number(point.getAttribute("cy")) >= 10 && Number(point.getAttribute("cy")) <= 100));
                      originalCurveChecks.push(points.every((point, column) => Number(point.getAttribute("cx")) === column * 450 && Math.abs(Number(point.getAttribute("cy")) - (100 - (expectedScale === 0 ? 0 : numbers[index][column] / expectedScale) * 90)) < .00001));
                    }
                  }
                  originalCurveChecks.push(Number.isFinite(scale));
                }
                if (["feedback-loop", "process-handoff-map", "deployment-pipeline"].includes(componentId)) {
                  tl.seek(duration - .1, false);
                  const nodes = [...root.querySelectorAll(".vc-item")];
                  for (let index = 1; index < nodes.length; index++) {
                    const previous = nodes[index - 1].getBoundingClientRect(), current = nodes[index].getBoundingClientRect(), link = nodes[index].querySelector(".vc-link").getBoundingClientRect();
                    originalCurveChecks.push(Math.abs(link.left - previous.right) <= 2 && Math.abs(link.right - current.left) <= 2);
                  }
                  if (componentId === "feedback-loop") {
                    const back = root.querySelector(".vc-back"), svg = root.querySelector(".vc-return").getBoundingClientRect(), last = nodes.at(-1).getBoundingClientRect();
                    originalCurveChecks.push(Math.abs(svg.top + 400 - last.bottom) <= 2 && Number.parseFloat(getComputedStyle(back).strokeDashoffset) === 0);
                  }
                }
                if(componentId === "shotcraft-card-stack") {
                  const card=root.querySelector(".sc-card"),factor=events[0].duration/2.24;
                  tl.seek(cueTimes.stack+.3*(125/30)*factor*.5,false);
                  const expected=300*Math.exp(-3)*Math.cos((8+8*.7)*.5*.3*2.2);
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(card,"y"))-expected)<.002);
                  tl.seek(cueTimes.fan+events[1].duration*.5,false);
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(card,"x"))-(-3.5*34*.5))<.002);
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(card,"rotation"))-(-3.5*8*.5))<.002);
                }
                if(componentId === "shotcraft-tracking-expand") {
                  tl.seek(cueTimes.expand+events[0].duration*.5,false);
                  const chars=[...root.querySelectorAll(".sc-word span")];
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(chars[0],"x"))-(1/32)*(0-(chars.length-1)/2)*(-.56*150))<.002);
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(root.querySelector(".sc-word"),"scaleX"))-(.92+.08*(31/32)))<.002);
                }
                if(componentId === "shotcraft-marker-title") {
                  tl.seek(cueTimes.title+events[0].duration*.5,false);
                  originalCurveChecks.push(Math.abs(Number(gsap.getProperty(root.querySelector(".sc-title"),"y"))-4.5)<.002);
                  const keyword=root.querySelector(".sc-keyword").getBoundingClientRect(),mark=root.querySelector(".sc-mark").getBoundingClientRect();
                  originalCurveChecks.push(Math.abs(mark.width-keyword.width-24)<1);
                  originalCurveChecks.push(Math.abs(mark.left-keyword.left+12)<1);
                }
                if(componentId === "shotcraft-multiplane" || componentId === "shotcraft-dolly-zoom") {
                  const cubic=(x1,x2,t)=>{const x=p=>3*(1-p)*(1-p)*p*x1+3*(1-p)*p*p*x2+p*p*p;let lo=0,hi=1;for(let i=0;i<24;i++){const p=(lo+hi)/2;if(x(p)<t)lo=p;else hi=p;}const p=(lo+hi)/2;return 3*(1-p)*p*p+p*p*p;};
                  const hero=root.querySelector(".sc-hero"), before=hero?.getBoundingClientRect().toJSON();
                  tl.seek(cueTimes.camera+events[0].duration*.5,false);
                  const background=root.querySelector(".sc-background"), transform=new DOMMatrix(getComputedStyle(background).transform);
                  if(componentId === "shotcraft-multiplane") {
                    const progress=cubic(.35,.25,.5);
                    for(const [selector,coefficient] of [[".sc-background",.35],[".sc-middle",.7],[".sc-foreground",1.4]]) originalCurveChecks.push(Math.abs(new DOMMatrix(getComputedStyle(root.querySelector(selector)).transform).m41+1000*progress*coefficient)<.003);
                    originalCurveChecks.push(getComputedStyle(root.querySelector(".sc-middle")).filter==="none");
                  } else {
                    const progress=cubic(.4,.3,.5);
                    originalCurveChecks.push(Math.abs(transform.a-(1+1.25*progress))<.003);
                    originalCurveChecks.push(Math.abs(Number.parseFloat(getComputedStyle(background).filter.slice(5))-3.5*progress)<.003);
                    originalCurveChecks.push(JSON.stringify(before)===JSON.stringify(hero.getBoundingClientRect().toJSON()));
                  }
                  const crop=root.querySelector(".sc-crop"),image=crop.querySelector("img"),geometry=JSON.parse(document.documentElement.dataset.compositionVariables).find(variable=>variable.id==="captureLayout");
                  const capture=JSON.parse(geometry.default),region=capture.regions.find(region=>region.id===crop.dataset.captureRegion),scale=Number.parseFloat(crop.style.width)/region.width;
                  originalCurveChecks.push(Math.abs(Number.parseFloat(image.style.left)+region.x*scale)<.003 && Math.abs(Number.parseFloat(image.style.top)+region.y*scale)<.003);
                }
                tl.seek(0, false);
                const profileY = componentId === "question-opener" ? Number(gsap.getProperty(root.querySelector("h1"), "y")) : null;
                const profileApplied = profileY === null || [style.distance, style.distance * 1.5].some(distance => Math.abs(profileY - distance) < .01);
                for (const event of events) {
                  const at = cueTimes[event.id];
                  if (at === undefined) continue;
                  tl.seek(Math.max(0, at - .01), false);
                  const before = snapshot(event.target);
                  const during = [.125, .25, .5, .75, 1].map(fraction => { tl.seek(at + event.duration * fraction, false); return snapshot(event.target); });
                  if (root.__sourceTimeline && root.dataset.ipwSourceRanges) {
                    const ranges = JSON.parse(root.dataset.ipwSourceRanges);
                    const [from, to] = ranges[events.indexOf(event)];
                    tl.seek(at + event.duration * .5, false);
                    originalCurveChecks.push(Math.abs(Number(root.dataset.ipwSourceTime) - (from + to) / 2) < .00001);
                    const adapted = snapshot("*");
                    root.__sourceTimeline.render((from + to) / 2, false, true);
                    originalCurveChecks.push(JSON.stringify(adapted) === JSON.stringify(snapshot("*")));
                  }
                  const after = during.at(-1);
                  samples.push({ event: event.id, found: Math.max(before.length, ...during.map(sample => sample.length)), changed: during.some(sample => JSON.stringify(before) !== JSON.stringify(sample)),
                    readableSingleHold: event.id === "resolve" && after.length === 1 && Number(after[0].opacity) >= .99 && Boolean(after[0].text.trim()) });
                }
                const at = events.at(-1).time + .25;
                tl.seek(at, false); const forward = snapshot("*");
                tl.seek(duration, false); tl.seek(at, false); const rewind = snapshot("*");
                tl.seek(duration - .1, false);
                if (componentId === "shotcraft-split-flap-title") {
                  const halves = [...root.querySelectorAll("[data-ipw-flap-half]")];
                  const characters = [...String(values.title)].filter(character => character !== " ");
                  originalCurveChecks.push(halves.length === characters.length * 2);
                  originalCurveChecks.push(characters.every((character, index) => halves[index * 2]?.textContent === character && halves[index * 2 + 1]?.textContent === character));
                }
                const sourceText = [...root.querySelectorAll(".sc-content *")].filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
                const clipped = [...new Set([...root.querySelectorAll("h1,b,.vc-label,.vc-meta,.vc-value,.code-line,.cm-cell,.stat,.evidence,.source,.question-context,.diff-code,.diff-summary,.takeaway"), ...sourceText])].filter(element => {
                  if (element.closest('[aria-hidden]')) return false;
                  const rect = element.getBoundingClientRect();
                  let parent = element.parentElement, ancestorClipped = false;
                  while (parent && parent !== root) {
                    const bounds = parent.getBoundingClientRect(), css = getComputedStyle(parent);
                    if (Number(css.opacity) === 0 || css.visibility === "hidden" || css.display === "none") return false;
                    // Offscreen rows in a rolling slot are not visible content.
                    // Partially clipped visible glyphs still fail below.
                    if (["hidden", "clip", "auto", "scroll"].includes(css.overflowX) && (rect.right <= bounds.left || rect.left >= bounds.right)) return false;
                    if (["hidden", "clip", "auto", "scroll"].includes(css.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return false;
                    if (["hidden", "clip", "auto", "scroll"].includes(css.overflowX) && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) ancestorClipped = true;
                    // A flip cell intentionally composes two complementary clipped
                    // halves of the same glyph; neither half alone is missing text.
                    if (!parent.hasAttribute("data-ipw-flap-half") && ["hidden", "clip", "auto", "scroll"].includes(css.overflowY) && (rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2)) ancestorClipped = true;
                    parent = parent.parentElement;
                  }
                  const css = getComputedStyle(element);
                  const ownClipped = (["hidden", "clip", "auto", "scroll"].includes(css.overflowX) && element.scrollWidth > element.clientWidth + 2) || (["hidden", "clip", "auto", "scroll"].includes(css.overflowY) && element.scrollHeight > element.clientHeight + 2);
                  return rect.width && rect.height && (ancestorClipped || rect.left < -1 || rect.top < -1 || rect.right > 1921 || rect.bottom > 1081 || ownClipped);
                }).map(element => ({ selector: element.className || element.tagName, text: element.textContent, bounds: element.getBoundingClientRect().toJSON(), parent: element.parentElement.getBoundingClientRect().toJSON(), width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
                return { samples, originalCurveChecks, profileApplied, profileY, style, deterministic: JSON.stringify(forward) === JSON.stringify(rewind), clipped, timelineDuration: tl.duration() };
              }, { events: recipe.recipe.events, duration: recipe.duration, cueTimes: JSON.parse(recipe.values.motionCueTimes), style: JSON.parse(recipe.values.motionStyle), componentId: recipe.componentId, values: recipe.values });
              ctx.assert(measured.originalCurveChecks.every(Boolean), "Actions retain source curves, measured input geometry and attached connectors: " + JSON.stringify(measured.originalCurveChecks));
              ctx.assert(measured.profileApplied, "The selected whole-video profile controls actual rendered displacement, not just metadata: " + JSON.stringify({ y: measured.profileY, style: measured.style }));
              ctx.assert(measured.samples.every(sample => sample.found > 0 && (sample.changed || sample.readableSingleHold)), recipe.id + ": events change rendered targets or preserve a readable single-item final hold: " + JSON.stringify(measured.samples));
              ctx.assert(measured.deterministic, "Forward seeking and rewind restore identical text, opacity and transforms");
              ctx.assert(measured.clipped.length === 0, recipe.id + ": representative content stays inside the canvas without text clipping: " + JSON.stringify(measured.clipped));
              ctx.assert(measured.timelineDuration + .001 >= recipe.duration, recipe.id + ": the paused timeline preserves the complete scene window: " + measured.timelineDuration);
              ctx.output(recipe.id + " measured event coverage", JSON.stringify(measured));
              await page.evaluate(id => { const label = document.createElement("div"); label.textContent = "验收案例：" + id; label.style.cssText = "position:fixed;bottom:8px;left:8px;padding:6px 10px;background:#fff;color:#111;font:14px sans-serif;z-index:9999"; document.body.append(label); }, recipe.id);
            },
            screenshot: { name: recipe.id, targetId: target.id },
            });
          } catch (error) {
            failures.push(recipe.id + ": " + error.message);
          }
        }
        ctx.assert(failures.length === 0, failures.join("\n"));
        const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
        const healthCases = [
          { id: "static-declared-motion", source: "color=gray:size=192x108:rate=30:duration=3", filter: "drawbox=x=40:y=20:w=60:h=60:color=white:t=fill", animation: "custom:semantic-change", expected: false },
          { id: "intentional-reading-hold", source: "color=gray:size=192x108:rate=30:duration=3", filter: "drawbox=x=40:y=20:w=60:h=60:color=white:t=fill", animation: "hold:read-evidence", expected: true },
          { id: "visible-declared-motion", source: "testsrc2=size=192x108:rate=30:duration=3", filter: "null", animation: "custom:semantic-change", expected: true },
          { id: "blank-incoming-transition", source: "testsrc2=size=192x108:rate=30:duration=3", filter: "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,0.5)'", animation: "custom:semantic-change", transition: .6, expected: false },
        ];
        for (const sample of healthCases) {
          const output = join(root, sample.id + ".mp4");
          let result, preview;
          await ctx.prove(sample.id + " receives the correct real rendered motion-health verdict", {
            voiceover: "真实 MP4 检查：静止的声明动作和空白转场被拦截，明确的阅读停留不误报；像素通过不代表表达质量通过。",
            action: async () => {
              await execFileAsync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", sample.source, "-vf", sample.filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
              const html = `<section id="proof" class="scene clip" data-start="0" data-duration="3" data-ipw-transition-duration="${sample.transition || 0}" data-ipw-beats='${JSON.stringify([{ animation: sample.animation, motion: { start: .5, end: 1.5 } }])}'></section>`;
              const reviewed = await execFileAsync(process.env.BUN_BINARY || "/Users/hesitu/.bun/bin/bun", ["--eval", 'import {reviewRenderedPixels} from "./apps/server/src/extensions/video-render.ts"; console.log(JSON.stringify(await reviewRenderedPixels(process.env.REVIEW_VIDEO,process.env.REVIEW_HTML)));'], { cwd: repo, env: { ...process.env, REVIEW_VIDEO: output, REVIEW_HTML: html } });
              result = JSON.parse(reviewed.stdout);
              preview = await execFileAsync(ffmpeg, ["-v", "error", "-ss", String(sample.transition ? .2 : 1), "-i", output, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { encoding: "buffer" });
              await page.setContent(`<body style="margin:0;background:#111;color:white;font:28px sans-serif;padding:48px"><h1>${sample.id}</h1><p>Expected: ${sample.expected} · Rendered review: ${result.valid}</p><img width="1152" src="data:image/png;base64,${preview.stdout.toString("base64")}"><pre>${JSON.stringify(result.issues, null, 2)}</pre></body>`);
            },
            assert: async () => {
              ctx.assert(result.valid === sample.expected, sample.id + ": decoded MP4 receives the expected acceptance verdict");
              ctx.assert(result.sampledFrameCount > 0 && preview.stdout.length > 100, "Verdict and screenshot use actual decoded video frames");
              ctx.output(sample.id + " pixel evidence", JSON.stringify(result));
            },
            screenshot: { name: sample.id, targetId: target.id },
          });
        }
      } finally {
        ctx.client?.close();
        await browser?.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  }, {
    name: "Inspect executed events and real layout, including an optional existing video",
    async run(ctx) {
      const repo = new URL("../../", import.meta.url).pathname;
      const inspector = await execFileAsync(process.env.BUN_BINARY || "bun", ["--eval", 'import {reviewVideoRuntime} from "./vendor/hyperframes/packages/studio-server/src/helpers/screenshotClip.ts"; console.log(reviewVideoRuntime.toString());'], { cwd: repo });
      const inspect = new Function("return (" + inspector.stdout + ");")();
      const puppeteer = requireStudio("puppeteer-core");
      const browser = await puppeteer.launch({ executablePath: process.env.IPOLLOWORK_EVAL_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1920, height: 1080 } });
      try {
        const page = (await browser.pages())[0];
        const base = "http://127.0.0.1:" + new URL(browser.wsEndpoint()).port;
        const target = (await listTargets(base)).find(target => target.type === "page");
        ctx.cdpBaseUrl = base;
        ctx.client = await connect(debuggerUrlFor(base, target));
        const gsap = await readFile(requireStudio.resolve("gsap/dist/gsap.min.js"), "utf8");
        for (const sample of [
          { name: "real-event-aligned", actual: 1, expected: null },
          { name: "metadata-aligned-but-tween-early", actual: .1, expected: "executed-event-time-mismatch" },
          { name: "caption-overlaps-content", actual: 1, captionTop: 400, expected: "caption-content-overlap" },
          { name: "short-event-overlap-between-percent-samples", actual: .2, anchor: .2, end: .4, transient: true, expected: "caption-content-overlap" },
          { name: "visible-media-broken", actual: 1, media: true, expected: "broken-visible-media" },
        ]) {
          let review;
          await ctx.prove(sample.name + " is decided by executed GSAP and actual rectangles", {
            voiceover: "真实浏览器检查实际 GSAP 时间、字幕重叠与坏图；脚本标签正确但动作提前仍然失败。这是验收引擎证据，不是模型生成或审美通过。",
            action: async () => {
              const beats = JSON.stringify([{ animation: "custom:explain", targets: ["#value"], motion: { start: sample.anchor ?? 1, end: sample.end ?? 1.5 } }]);
              await page.setContent(`<html><head><style>body{margin:0;background:#14232c;color:#f4eee1;font:48px sans-serif}.content{position:absolute;left:100px;top:300px;width:1600px;height:400px;background:#28424d}.caption{position:absolute;left:100px;top:${sample.captionTop || 800}px}img{width:100px;height:100px}</style></head><body><main data-composition-id="root"><section id="proof" class="scene clip" data-start="0" data-duration="3" data-ipw-beats='${beats}'><h1>${sample.name}</h1><div class="content" data-ipw-content><p id="value">Measured phrase → visual change</p></div><p class="caption" data-ipw-caption>Readable caption outside the diagram</p>${sample.media ? '<img src="data:image/png;base64,broken">' : ''}</section></main><script>${gsap}</script><script>window.__timelines={main:gsap.timeline({paused:true}).to('#value',{x:100,duration:.5,data:'custom:explain'},${sample.actual})};</script></body></html>`, { waitUntil: "domcontentloaded" });
              if (sample.transient) await page.evaluate(() => {
                window.__timelines.main.to('.caption', { y: -400, duration: .05 }, .2).to('.caption', { y: 0, duration: .05 }, .35);
              });
              review = await page.evaluate(inspect);
            },
            assert: async () => {
              ctx.assert(review.valid === (sample.expected === null), "The executed timeline receives the expected verdict: " + JSON.stringify(review));
              if (sample.expected) ctx.assert(review.issues.some(issue => issue.code === sample.expected), "The defect is specifically identified, not inferred from source labels");
              ctx.output(sample.name, JSON.stringify(review));
              if (sample.transient) await page.evaluate(() => { window.__timelines.main.pause(.3); });
            },
            screenshot: { name: sample.name, targetId: target.id },
          });
        }
        if (process.env.IPOLLOWORK_REVIEW_VIDEO_PROJECT) {
          const prepared = await execFileAsync(process.env.BUN_BINARY || "bun", ["--eval", 'import {bundleToSingleHtml} from "./vendor/hyperframes/packages/core/src/compiler/htmlBundler.ts"; console.log(JSON.stringify(await bundleToSingleHtml(process.env.IPOLLOWORK_REVIEW_VIDEO_PROJECT)));'], { cwd: repo, env: process.env, maxBuffer: 8_000_000 });
          const html = JSON.parse(prepared.stdout).replace(/<script[^>]+src="[^"]*gsap[^"]*"[^>]*><\/script>/g, () => "<script>" + gsap + "</script>").replace(/<link[^>]+href="https:\/\/fonts[^>]+>/g, "");
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          const review = await page.evaluate(inspect);
          ctx.assert(review.valid, "The existing video passes bounded executed-timing/layout review: " + JSON.stringify(review));
          const scenes = await page.evaluate(() => [...document.querySelectorAll('.scene.clip,[data-ipw-scene]')].map(scene => ({ id: scene.id, start: Number(scene.getAttribute('data-start')), duration: Number(scene.getAttribute('data-duration') ?? scene.getAttribute('data-hf-authored-duration')) })));
          ctx.assert(scenes.length > 0 && scenes.length <= 48, "The exact existing project has a bounded scene set");
          for (const scene of scenes) for (const [phase, fraction] of [["establish", .15], ["develop", .5], ["land", .85]]) {
            await ctx.prove(scene.id + " " + phase + " remains reviewable with original narration timing", {
              voiceover: "保留原旁白的成片采样。实际配方、图形和字幕可审阅；本流程不调用付费模型，也不代替听音或完整客户端生成验收。",
              action: async () => { await page.evaluate(time => window.__player.seek(time), scene.start + scene.duration * fraction); },
              assert: async () => {
                ctx.assert(!review.issues.some(issue => issue.sceneId === scene.id), "No sampled executed-timing or layout issue: " + scene.id);
                ctx.assert(await page.evaluate(id => { const scene=document.getElementById(id);return Boolean(scene && getComputedStyle(scene).visibility !== 'hidden'); }, scene.id), "The intended scene is actually visible");
                ctx.output("Bounded runtime verdict", JSON.stringify(review));
              },
              screenshot: { name: scene.id + "-" + phase, targetId: target.id },
            });
          }
        }
      } finally { ctx.client?.close(); await browser.close(); }
    },
  }, {
    name: "Show planned recipes, source-inspected mounts and custom reasons in the real script table",
    async run(ctx) {
      if (process.env.IPOLLOWORK_RECIPE_TABLE_PROOF !== "1") return;
      const repo = new URL("../../", import.meta.url).pathname;
      await mkdir(join(repo, "vendor/hyperframes/packages/studio/data/projects"), { recursive: true });
      const fixture = await mkdtemp(join(repo, "vendor/hyperframes/packages/studio/data/projects/recipe-record-"));
      const projectId = fixture.split("/").at(-1);
      let browser;
      try {
        await mkdir(join(fixture, "compositions"));
        await copyFile(join(repo, "vendor/hyperframes/registry/blocks/question-opener/question-opener.html"), join(fixture, "compositions/question-opener.html"));
        await writeFile(join(fixture, "index.html"), '<main data-composition-id="main"><section id="opening" data-ipw-scene data-ipw-registry-component="question-opener" data-ipw-timing-owner="host" data-composition-id="question-opener" data-composition-src="compositions/question-opener.html"></section></main>');
        await writeFile(join(fixture, "STORYBOARD.md"), '# Recipe proof\n\n## Frame 1 — 开场问题\n- recipe: "question-opener"\n- scene_id: "opening"\n- duration: 8s\n\n## Frame 2 — 待生成镜头\n- recipe: "feedback-loop"\n- scene_id: "planned"\n- recipe_status: mounted\n- duration: 8s\n\n## Frame 3 — 定制例外\n- scene_id: "custom"\n- custom_reason: "已比较现有回路配方，无法保留三路条件分支；仅补充分支连接图。"\n- duration: 8s\n');
        const puppeteer = requireStudio("puppeteer-core");
        browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, defaultViewport: { width: 1600, height: 1100 }, args: ["--no-sandbox"] });
        const page = (await browser.pages())[0];
        await page.goto(`http://127.0.0.1:5198/?view=storyboard&locale=zh#project/${projectId}`, { waitUntil: "networkidle0" });
        await page.waitForSelector('[data-testid="storyboard-recipe-1"]');
        const base = "http://127.0.0.1:" + new URL(browser.wsEndpoint()).port;
        const target = (await listTargets(base)).find(item => item.type === "page" && item.url.includes(projectId));
        ctx.cdpBaseUrl = base;
        ctx.client = await connect(debuggerUrlFor(base, target));
        await ctx.prove("The script table distinguishes recipe selection from source-inspected mounting and explains custom graphics", {
          voiceover: "脚本表逐镜头显示配方。已经挂载的配方由源码核对；仅写了配方或状态的镜头仍然是计划使用，定制镜头直接说明不能复用的原因。源码挂载不代表画面验收通过。",
          action: async () => { await page.reload({ waitUntil: "networkidle0" }); await page.waitForSelector('[data-testid="storyboard-recipe-3"]'); },
          assert: async () => {
            const rows = await page.$$eval('[data-testid^="storyboard-recipe-"]', elements => elements.map(element => element.textContent));
            ctx.assert(rows[0].includes("question-opener") && rows[0].includes("已挂载"), "Real existing recipe source matches its exact scene");
            ctx.assert(rows[1].includes("feedback-loop") && rows[1].includes("计划使用") && !rows[1].includes("已挂载"), "Markdown mounted status cannot fabricate a mount");
            ctx.assert(rows[2].includes("定制图形") && rows[2].includes("三路条件分支"), "Custom reason remains visible after reload");
            ctx.output("Recipe records", JSON.stringify(rows));
          },
          screenshot: { name: "script-recipe-records", targetId: target.id, requireText: ["画面配方", "已挂载", "计划使用", "定制图形"] },
        });
      } finally { ctx.client?.close(); await browser?.close(); await rm(fixture, { recursive: true, force: true }); }
    },
  }],
};
