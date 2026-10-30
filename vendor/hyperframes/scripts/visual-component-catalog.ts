import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hyperframesCatalogItemSchema, hyperframesMotionRecipeSchema } from "../../../packages/types/src/hyperframes.ts";

type Category = "media";

type Layout =
  | "grid"
  | "stack"
  | "radial"
  | "lanes"
  | "split"
  | "layers"
  | "profile"
  | "editorial"
  | "frame"
  | "social"
  | "network"
  | "spotlight"
  | "dashboard"
  | "orbit"
  | "flow"
  | "columns"
  | "cards"
  | "steps"
  | "compare"
  | "carousel"
  | "tree"
  | "matrix"
  | "funnel"
  | "path"
  | "cta";

interface ComponentDefinition {
  wave: number;
  name: string;
  title: string;
  category: Category;
  purpose: string;
  subject: string;
  mechanism: string[];
  rhythm: string;
  layout: Layout;
  phases: string[];
  duration: number;
  proofTimes: number[];
  parameters: string[];
  tags: string[];
  nearestExisting: string;
  difference: string;
  items: string;
  note: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blocksRoot = join(repositoryRoot, "registry", "blocks");
const registryIndexPath = join(repositoryRoot, "registry", "registry.json");
const parameters = ["title", "items", "highlight", "note"];

function define(
  wave: number,
  name: string,
  title: string,
  category: Category,
  layout: Layout,
  purpose: string,
  subject: string,
  mechanism: string,
  rhythm: string,
  nearestExisting: string,
  difference: string,
  items: string,
  note: string,
  duration = 8,
): ComponentDefinition {
  return {
    wave,
    name,
    title,
    category,
    purpose,
    subject,
    mechanism: [mechanism],
    rhythm,
    layout,
    phases: ["reveal", "proof", "settle", "hold"],
    duration,
    proofTimes: [0, 0.7, 1.6, duration - 0.5, duration],
    parameters,
    tags: ["component", category, layout, "theme"],
    nearestExisting,
    difference,
    items,
    note,
  };
}

/**
 * Canonical manifest for the retained generated visual components.
 * Screenshot Zoom, Device Carousel, and Spatial Camera Suite own their specialized camera choreography. Every entry
 * records its closest neighbor and a concrete visual/semantic distinction.
 */
export const VISUAL_COMPONENT_EXPANSION: ComponentDefinition[] = [


  define(
    3,
    "picture-in-picture",
    "Picture in Picture",
    "media",
    "frame",
    "Place a supporting view over a primary media surface.",
    "primary and inset frames",
    "nested frame reveal",
    "guided",
    "split-screen",
    "Preserves one dominant surface with a contextual inset.",
    "Main::Product walkthrough|Inset::Presenter context|Label::Live review|Moment::Approval",
    "Keep the supporting view secondary",
  ),

  define(
    4,
    "media-before-after",
    "Media Before / After",
    "media",
    "split",
    "Compare two visual states with clear labels and context.",
    "media comparison",
    "split uncover",
    "cinematic",
    "split-screen",
    "Reveals a before-and-after change instead of showing two simultaneous panels.",
    "RAW::Unfocused frame|TREATED::Clear hierarchy|BEFORE::Default state|AFTER::Theme applied",
    "A visual comparison with room for real media",
  ),
  define(
    4,
    "interface-state-board",
    "Interface State Board",
    "media",
    "cards",
    "Compare important UI states before a walkthrough.",
    "interface states",
    "state-card reveal",
    "guided",
    "browser-walkthrough",
    "Previews several states at once instead of animating one path.",
    "EMPTY::Invite first action|LOADING::Confirm progress|SUCCESS::Show the result|ERROR::Offer recovery",
    "A state model for product storytelling",
  ),
];


// The audience outcome is authored per executable recipe, including purely typographic treatments.
// A movement name or generic render-health check is not a narrative reason to select a recipe.
const RECIPE_INTENTS: Record<string, string> = {
  "media-hero": "沿真实素材的可见细节引导视线，让观众亲眼核对旁白所指的对象。",
  "shotcraft-card-stack": "把八张真实图像由堆叠展开，让观众先感到数量，再看见内容差异。",
  "shotcraft-dolly-zoom": "在真实素材中固定主体并扩张背景，让观众感到该主体的重要性与环境关系。",
  "shotcraft-multiplane": "沿真实素材的空间层次推进视线，让观众理解前后景与主体的相对位置。",
};

export async function auditNativeRecipeCoverage() {
  const entries = [];
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const raw: unknown = JSON.parse(await readFile(join(blocksRoot, entry.name, "registry-item.json"), "utf8"));
    if (!raw || typeof raw !== "object" || !("visualComponent" in raw) || "upstream" in raw) continue;
    const definition = VISUAL_COMPONENT_EXPANSION.find(value => value.name === entry.name);
    const ready = "motionRecipe" in raw;
    const reason = ready ? "Executable semantic contract; rendering acceptance is verified separately."
      : definition?.category === "data" ? "Needs real numeric binding and quantitative geometry; decorative bars are not data recipes."
      : definition?.category === "diagrams" ? "Needs measured nodes, connectors and state/path progression, not a card reveal."
      : definition?.category === "media" ? "Needs validated real assets, crops and camera/clip windows, not placeholder cards."
      : "Needs component-specific semantic events, validated input capacity and Chinese render acceptance; not counted as a recipe.";
    entries.push({ name: entry.name, status: ready ? "recipe" : "component-only", reason });
  }
  return { nativeComponents: entries.length, nativeRecipes: entries.filter(entry => entry.status === "recipe").length, componentOnly: entries.filter(entry => entry.status === "component-only").length, entries };
}

const CATEGORY_LABELS: Record<Category, string> = {
  media: "Media",
};

const variableDeclarations = [
  { id: "title", label: "Title", type: "string", default: "", maxLength: 76 },
  { id: "items", label: "Items", type: "string", default: "", maxLength: 280 },
  {
    id: "highlight",
    label: "Highlighted item",
    type: "number",
    default: 1,
    min: 1,
    max: 4,
    step: 1,
  },
  { id: "note", label: "Supporting note", type: "string", default: "", maxLength: 100 },
];

function renderMotion(layout: Layout): string {
  if (layout === "radial" || layout === "orbit") {
    return 'tl.fromTo(items,{scale:.35,rotation:-18,opacity:0},{scale:1,rotation:0,opacity:1,duration:.7,stagger:.1,ease:"back.out(1.45)"},.3);';
  }
  if (layout === "lanes" || layout === "flow" || layout === "path") {
    return 'tl.fromTo(items,{x:-90,opacity:0},{x:0,opacity:1,duration:.62,stagger:.12,ease:"power3.out"},.3);';
  }
  if (layout === "columns" || layout === "funnel" || layout === "steps") {
    return 'tl.fromTo(items,{y:86,scaleY:.72,opacity:0},{y:0,scaleY:1,opacity:1,duration:.65,stagger:.1,ease:"power4.out"},.3);';
  }
  if (layout === "editorial") {
    return 'tl.fromTo(items,{yPercent:105,clipPath:"inset(0 0 100% 0)",opacity:0},{yPercent:0,clipPath:"inset(0 0 0% 0)",opacity:1,duration:.72,stagger:.09,ease:"power4.out"},.28);';
  }
  if (layout === "split" || layout === "compare") {
    return 'tl.fromTo(items,{xPercent:-18,opacity:0},{xPercent:0,opacity:1,duration:.68,stagger:.12,ease:"power3.out"},.3);';
  }
  if (layout === "network" || layout === "tree") {
    return 'tl.fromTo(items,{scale:.6,y:35,opacity:0},{scale:1,y:0,opacity:1,duration:.6,stagger:.12,ease:"back.out(1.3)"},.3);';
  }
  if (layout === "frame" || layout === "carousel") {
    return 'tl.fromTo(visual,{rotateY:-9,y:52,scale:.94,opacity:0},{rotateY:0,y:0,scale:1,opacity:1,duration:.8,ease:"power3.out"},.26).fromTo(items,{x:38,opacity:0},{x:0,opacity:1,duration:.45,stagger:.08,ease:"power2.out"},.52);';
  }
  if (layout === "spotlight" || layout === "cta") {
    return 'tl.fromTo(active,{scale:.82,clipPath:"inset(12% 12% 12% 12% round 42px)",opacity:0},{scale:1,clipPath:"inset(0% 0% 0% 0% round 24px)",opacity:1,duration:.78,ease:"power3.out"},.3).fromTo(items,{y:32,opacity:0},{y:0,opacity:1,duration:.48,stagger:.08,ease:"power2.out"},.48);';
  }
  return 'tl.fromTo(items,{y:54,scale:.94,opacity:0},{y:0,scale:1,opacity:1,duration:.58,stagger:.1,ease:"power3.out"},.3);';
}

function renderHtml(definition: ComponentDefinition): string {
  const declarations = variableDeclarations.map((variable) => ({
    ...variable,
    default:
      variable.id === "title"
        ? definition.title
        : variable.id === "items"
          ? definition.items
          : variable.id === "note"
            ? definition.note
            : variable.default,
  }));
  const defaults = Object.fromEntries(
    declarations.map((variable) => [variable.id, variable.default]),
  );
  const serializedDeclarations = JSON.stringify(declarations)
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;");
  return `<!doctype html>
<html lang="en" data-composition-variables='${serializedDeclarations}'>
  <head>
    <!-- Generated by scripts/visual-component-catalog.ts. -->
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920,height=1080" />
    <title>${definition.title}</title>
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent}body{font-family:var(--ipw-font-body,Inter,sans-serif)}
      .vc-root{--vc-bg:var(--ipw-color-bg,#f4f6f8);--vc-text:var(--ipw-color-text,#172126);--vc-muted:var(--ipw-color-muted,#647078);--vc-primary:var(--ipw-color-primary,#20bbc0);--vc-accent:var(--ipw-color-accent,#ef6846);--vc-surface:var(--ipw-color-surface,#fff);--vc-border:var(--ipw-color-border,#d7dde1);position:relative;width:1920px;height:1080px;overflow:hidden;padding:86px 112px 82px;background:var(--vc-bg);color:var(--vc-text);font-family:var(--ipw-font-display,Inter,sans-serif)}
      .vc-root:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,color-mix(in srgb,var(--vc-border) 38%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--vc-border) 32%,transparent) 1px,transparent 1px);background-size:96px 96px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.5),transparent 82%)}
      .vc-header{position:relative;z-index:2;display:grid;grid-template-columns:1fr auto;align-items:end;gap:60px}.vc-kicker{margin-bottom:18px;color:var(--vc-primary);font:800 18px/1 var(--ipw-font-body,Inter,sans-serif);letter-spacing:.2em;text-transform:uppercase}.vc-title{max-width:1180px;margin:0;font-size:72px;line-height:.98;letter-spacing:-.055em}.vc-note{max-width:430px;margin:0;color:var(--vc-muted);font:500 23px/1.35 var(--ipw-font-body,Inter,sans-serif);text-align:right}
      .vc-visual{position:relative;z-index:2;height:660px;margin-top:54px;perspective:1400px}.vc-items{display:grid;width:100%;height:100%;grid-template-columns:repeat(2,1fr);gap:22px}.vc-item{position:relative;min-width:0;overflow:hidden;padding:30px 32px;border:1px solid var(--vc-border);border-radius:24px;background:color-mix(in srgb,var(--vc-surface) 92%,transparent);box-shadow:var(--ipw-card-shadow,0 20px 55px rgba(17,32,40,.10));transform-origin:center bottom}.vc-item.is-active{border-color:var(--vc-primary);background:color-mix(in srgb,var(--vc-primary) 11%,var(--vc-surface));box-shadow:0 20px 58px color-mix(in srgb,var(--vc-primary) 20%,transparent)}.vc-index{display:block;margin-bottom:18px;color:var(--vc-primary);font:800 14px/1 var(--ipw-font-body,Inter,sans-serif);letter-spacing:.14em}.vc-label{display:block;font-size:36px;line-height:1.05;letter-spacing:-.035em}.vc-meta{display:block;margin-top:14px;color:var(--vc-muted);font:550 20px/1.3 var(--ipw-font-body,Inter,sans-serif)}.vc-bar{position:absolute;left:32px;right:32px;bottom:27px;height:5px;border-radius:10px;background:var(--vc-border);overflow:hidden}.vc-bar:after{content:"";display:block;width:var(--progress,65%);height:100%;background:var(--vc-primary)}
      [data-layout="stack"] .vc-items{display:flex;flex-direction:column;justify-content:center;padding:30px 120px}[data-layout="stack"] .vc-item{min-height:118px;padding:24px 32px}[data-layout="stack"] .vc-meta{position:absolute;right:34px;top:23px;max-width:52%;text-align:right}[data-layout="stack"] .vc-bar{bottom:17px}
      [data-layout="radial"] .vc-items,[data-layout="orbit"] .vc-items{position:relative;display:block}[data-layout="radial"] .vc-items:before,[data-layout="orbit"] .vc-items:before{content:"";position:absolute;left:50%;top:50%;width:320px;height:320px;border:2px solid var(--vc-primary);border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 70px color-mix(in srgb,var(--vc-primary) 7%,transparent),0 0 0 140px color-mix(in srgb,var(--vc-primary) 4%,transparent)}[data-layout="radial"] .vc-item,[data-layout="orbit"] .vc-item{position:absolute;width:360px;min-height:170px}[data-layout="radial"] .vc-item:nth-child(1),[data-layout="orbit"] .vc-item:nth-child(1){left:32px;top:20px}[data-layout="radial"] .vc-item:nth-child(2),[data-layout="orbit"] .vc-item:nth-child(2){right:32px;top:20px}[data-layout="radial"] .vc-item:nth-child(3),[data-layout="orbit"] .vc-item:nth-child(3){left:32px;bottom:20px}[data-layout="radial"] .vc-item:nth-child(4),[data-layout="orbit"] .vc-item:nth-child(4){right:32px;bottom:20px}
      [data-layout="lanes"] .vc-items,[data-layout="flow"] .vc-items,[data-layout="path"] .vc-items{display:flex;flex-direction:column;justify-content:center;gap:22px;padding:24px 70px}[data-layout="lanes"] .vc-item,[data-layout="flow"] .vc-item,[data-layout="path"] .vc-item{min-height:124px;margin-left:calc((var(--i) - 1) * 105px);margin-right:calc((4 - var(--i)) * 105px)}
      [data-layout="split"] .vc-items,[data-layout="compare"] .vc-items{grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:28px}[data-layout="split"] .vc-item:nth-child(odd),[data-layout="compare"] .vc-item:nth-child(odd){border-left:8px solid var(--vc-primary)}[data-layout="split"] .vc-item:nth-child(even),[data-layout="compare"] .vc-item:nth-child(even){border-right:8px solid var(--vc-accent)}
      [data-layout="layers"] .vc-items{display:block;padding:40px 150px}[data-layout="layers"] .vc-item{position:absolute;left:calc(150px + (var(--i) - 1) * 110px);top:calc(35px + (var(--i) - 1) * 92px);width:990px;height:250px;background:color-mix(in srgb,var(--vc-surface) calc(96% - (var(--i) - 1) * 4%),var(--vc-primary))}
      [data-layout="profile"] .vc-items{grid-template-columns:1.35fr .65fr;grid-template-rows:repeat(3,1fr)}[data-layout="profile"] .vc-item:first-child{grid-row:1/4;padding:54px}[data-layout="profile"] .vc-item:first-child .vc-label{max-width:620px;font-size:66px}[data-layout="profile"] .vc-item:first-child .vc-meta{font-size:26px}[data-layout="profile"] .vc-item:nth-child(n+2) .vc-bar{display:none}
      [data-layout="editorial"] .vc-items{display:flex;align-items:flex-end;gap:18px}[data-layout="editorial"] .vc-item{flex:1;height:72%;border-width:0 0 5px;border-radius:0;background:transparent;box-shadow:none}[data-layout="editorial"] .vc-item.is-active{flex:1.8;height:100%;border-color:var(--vc-primary);background:color-mix(in srgb,var(--vc-primary) 8%,transparent)}[data-layout="editorial"] .vc-label{font-size:54px}[data-layout="editorial"] .vc-bar{display:none}
      [data-layout="frame"] .vc-visual{padding:64px 82px;border:16px solid color-mix(in srgb,var(--vc-text) 90%,var(--vc-bg));border-top-width:58px;border-radius:34px;background:var(--vc-surface);box-shadow:0 34px 90px rgba(12,24,32,.18)}[data-layout="frame"] .vc-visual:before{content:"";position:absolute;left:30px;top:-38px;width:14px;height:14px;border-radius:50%;background:var(--vc-accent);box-shadow:26px 0 0 var(--vc-primary),52px 0 0 var(--vc-border)}
      [data-layout="social"] .vc-visual{width:900px;margin-left:auto;margin-right:auto;padding:28px;border:2px solid var(--vc-border);border-radius:48px;background:var(--vc-surface)}[data-layout="social"] .vc-items{grid-template-columns:1fr;grid-template-rows:repeat(4,1fr)}[data-layout="social"] .vc-item{border-width:0 0 1px;border-radius:0;box-shadow:none}[data-layout="social"] .vc-bar{display:none}
      [data-layout="network"] .vc-items,[data-layout="tree"] .vc-items{position:relative;grid-template-columns:repeat(4,1fr);align-items:center;gap:48px;padding:110px 20px}[data-layout="network"] .vc-items:before,[data-layout="tree"] .vc-items:before{content:"";position:absolute;left:8%;right:8%;top:50%;height:4px;background:linear-gradient(90deg,var(--vc-border),var(--vc-primary),var(--vc-border))}[data-layout="network"] .vc-item,[data-layout="tree"] .vc-item{min-height:260px;background:var(--vc-surface)}
      [data-layout="spotlight"] .vc-items,[data-layout="cta"] .vc-items{grid-template-columns:1.8fr 1fr;grid-template-rows:repeat(3,1fr)}[data-layout="spotlight"] .vc-item.is-active,[data-layout="cta"] .vc-item.is-active{grid-row:1/4;padding:54px}[data-layout="spotlight"] .vc-item.is-active .vc-label,[data-layout="cta"] .vc-item.is-active .vc-label{font-size:68px}[data-layout="spotlight"] .vc-item:not(.is-active) .vc-bar,[data-layout="cta"] .vc-item:not(.is-active) .vc-bar{display:none}
      [data-layout="dashboard"] .vc-items,[data-layout="matrix"] .vc-items{grid-template-columns:repeat(4,1fr);align-items:stretch}[data-layout="dashboard"] .vc-item,[data-layout="matrix"] .vc-item{padding-top:58px}[data-layout="dashboard"] .vc-label,[data-layout="matrix"] .vc-label{font-size:44px}[data-layout="dashboard"] .vc-bar,[data-layout="matrix"] .vc-bar{height:170px;top:auto}[data-layout="dashboard"] .vc-bar:after,[data-layout="matrix"] .vc-bar:after{width:100%;height:var(--progress,65%);margin-top:calc(170px - var(--progress,65%))}
      [data-layout="columns"] .vc-items,[data-layout="funnel"] .vc-items,[data-layout="steps"] .vc-items{display:flex;align-items:flex-end;gap:22px;padding:20px 0}[data-layout="columns"] .vc-item,[data-layout="steps"] .vc-item{flex:1;height:calc(42% + var(--i) * 11%)}[data-layout="funnel"] .vc-items{flex-direction:column;align-items:center;justify-content:center}[data-layout="funnel"] .vc-item{width:calc(100% - (var(--i) - 1) * 190px);min-height:120px;padding:22px 34px}[data-layout="funnel"] .vc-meta{position:absolute;right:34px;top:20px}
      [data-layout="cards"] .vc-items,[data-layout="carousel"] .vc-items{display:flex;align-items:center;gap:24px;padding:60px 0}[data-layout="cards"] .vc-item,[data-layout="carousel"] .vc-item{flex:1;height:430px}[data-layout="cards"] .vc-item:nth-child(even),[data-layout="carousel"] .vc-item:nth-child(even){margin-top:90px}
    </style>
  </head>
  <body>
    <main id="${definition.name}" class="vc-root" data-composition-id="${definition.name}" data-width="1920" data-height="1080" data-start="0" data-duration="${definition.duration}" data-layout="${definition.layout}" data-ipw-ai-slot="highlight">
      <header class="vc-header"><div><div class="vc-kicker">${CATEGORY_LABELS[definition.category]}</div><h1 class="vc-title" data-ipw-variable="title" data-ipw-ai-slot="title"></h1></div><p class="vc-note" data-ipw-variable="note" data-ipw-ai-slot="note"></p></header>
      <section class="vc-visual"><div class="vc-items" data-ipw-ai-slot="items"></div></section>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
    <script>
      window.__timelines=window.__timelines||{};
      (function(){
        const root=document.getElementById(${JSON.stringify(definition.name)}),id=root.dataset.compositionId||${JSON.stringify(definition.name)};
        const defaults=${JSON.stringify(defaults)};
        const values={...defaults,...(window.__hyperframes?.getVariables?.()??{}),...(window.__hfVariablesByComp?.[id]??{})};
        root.querySelectorAll("[data-ipw-variable]").forEach(element=>{const key=element.getAttribute("data-ipw-variable");if(key)element.textContent=String(values[key]??"")});
        const parsed=String(values.items).split("|").map(value=>{const parts=value.split("::");return{label:(parts[0]||"").trim(),meta:(parts.slice(1).join("::")||"").trim()}}).filter(item=>item.label).slice(0,4);
        const fallback=[{label:"Context",meta:"Name the situation"},{label:"Signal",meta:"Show what changed"},{label:"Decision",meta:"Choose the move"},{label:"Result",meta:"Prove the outcome"}];
        const rows=parsed.length?parsed:fallback,highlight=Math.max(1,Math.min(rows.length,Number(values.highlight)||1)),container=root.querySelector(".vc-items");
        rows.forEach((row,index)=>{const item=document.createElement("article");item.className="vc-item"+(index+1===highlight?" is-active":"");item.style.setProperty("--i",String(index+1));item.style.setProperty("--progress",String(48+index*13)+"%");const number=document.createElement("span"),label=document.createElement("strong"),meta=document.createElement("span"),bar=document.createElement("i");number.className="vc-index";number.textContent="0"+String(index+1);label.className="vc-label";label.textContent=row.label;meta.className="vc-meta";meta.textContent=row.meta;bar.className="vc-bar";item.append(number,label,meta,bar);container.append(item)});
        const items=root.querySelectorAll(".vc-item"),visual=root.querySelector(".vc-visual"),active=root.querySelector(".vc-item.is-active")||items[0],tl=gsap.timeline({paused:true});
        tl.fromTo(root.querySelectorAll(".vc-header>*"),{y:34,opacity:0},{y:0,opacity:1,duration:.55,stagger:.1,ease:"power3.out"},.06);
        ${renderMotion(definition.layout)}
        tl.fromTo(root.querySelectorAll(".vc-bar"),{scaleX:0},{scaleX:1,transformOrigin:"left",duration:.48,stagger:.07,ease:"power2.out"},.86);
        window.__timelines[id]=tl;tl.seek(0);
      })();
    </script>
  </body>
</html>
`;
}

function renderManifest(definition: ComponentDefinition): string {
  const item = {
    $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
    name: definition.name,
    version: "1.0.0",
    type: "hyperframes:block",
    title: definition.title,
    description: definition.purpose,
    tags: definition.tags,
    author: "iPolloWork",
    license: "Apache-2.0",
    visualComponent: {
      version: 1,
      category: definition.category,
      surfaces: ["video"],
      themeMode: "inherit",
      ai: {
        slots: parameters,
        instructions: `AI may rewrite the title, supporting note, and up to four ${definition.subject}. Keep pipe separators between items and preserve the ${definition.layout} layout.`,
      },
    },
    dimensions: { width: 1920, height: 1080 },
    duration: definition.duration,
    engine: { name: "gsap", version: "3.13.0", seekable: true },
    files: [
      {
        path: `${definition.name}.html`,
        target: `compositions/${definition.name}.html`,
        type: "hyperframes:composition",
      },
    ],
    variables: [
      {
        id: "title",
        label: "Title",
        type: "string",
        default: definition.title,
        maxLength: 76,
        update: "live",
      },
      {
        id: "items",
        label: "Items (label::detail | ...)",
        type: "string",
        default: definition.items,
        maxLength: 280,
        update: "live",
      },
      {
        id: "highlight",
        label: "Highlighted item",
        type: "number",
        default: 1,
        min: 1,
        max: 4,
        step: 1,
        update: "live",
      },
      {
        id: "note",
        label: "Supporting note",
        type: "string",
        default: definition.note,
        maxLength: 100,
        update: "live",
      },
    ],
  };
  return `${JSON.stringify(item, null, 2)}\n`;
}

function generatedFiles(limitWave = 4): Map<string, string> {
  const files = new Map<string, string>();
  for (const definition of VISUAL_COMPONENT_EXPANSION.filter((item) => item.wave <= limitWave)) {
    const root = join(blocksRoot, definition.name);
    files.set(join(root, "registry-item.json"), renderManifest(definition));
    files.set(join(root, `${definition.name}.html`), renderHtml(definition));
  }
  return files;
}

async function readRegistryIndex(): Promise<{
  $schema: string;
  name: string;
  homepage: string;
  items: Array<{ name: string; type: string }>;
}> {
  const parsed: unknown = JSON.parse(await readFile(registryIndexPath, "utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("items" in parsed) ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error("registry/registry.json has an invalid shape");
  }
  if (!("$schema" in parsed) || typeof parsed.$schema !== "string")
    throw new Error("registry schema is missing");
  if (!("name" in parsed) || typeof parsed.name !== "string")
    throw new Error("registry name is missing");
  if (!("homepage" in parsed) || typeof parsed.homepage !== "string")
    throw new Error("registry homepage is missing");
  const items = parsed.items.filter((item): item is { name: string; type: string } =>
    Boolean(
      item &&
      typeof item === "object" &&
      "name" in item &&
      typeof item.name === "string" &&
      "type" in item &&
      typeof item.type === "string",
    ),
  );
  return { $schema: parsed.$schema, name: parsed.name, homepage: parsed.homepage, items };
}

async function updateRegistryIndex(write: boolean, limitWave = 4): Promise<boolean> {
  const registry = await readRegistryIndex();
  const names = new Set(registry.items.map((item) => item.name));
  const desired = new Map(
    VISUAL_COMPONENT_EXPANSION.filter((definition) => definition.wave <= limitWave)
      .map((definition) => [definition.name, { name: definition.name, type: "hyperframes:block" }]),
  );
  for (const item of await visualComponentEntries()) desired.set(item.name, item);
  const missing = [...desired.values()].filter((item) => !names.has(item.name));
  if (missing.length === 0) return true;
  if (!write) return false;
  registry.items.push(...missing);
  await writeFile(registryIndexPath, `${JSON.stringify(registry, null, 2)}\n`);
  return true;
}

async function visualComponentEntries(): Promise<Array<{ name: string; type: string }>> {
  const entries: Array<{ name: string; type: string }> = [];
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest: unknown = JSON.parse(
        await readFile(join(blocksRoot, entry.name, "registry-item.json"), "utf8"),
      );
      if (manifest && typeof manifest === "object" && "visualComponent" in manifest &&
        "name" in manifest && typeof manifest.name === "string" &&
        "type" in manifest && typeof manifest.type === "string") {
        entries.push({ name: manifest.name, type: manifest.type });
      }
    } catch {
      // Registry validation reports malformed or missing manifests separately.
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function assertManifest(): void {
  if (VISUAL_COMPONENT_EXPANSION.length !== 3) {
    throw new Error(`Expected 3 owned components, found ${VISUAL_COMPONENT_EXPANSION.length}`);
  }
  const names = new Set<string>();
  for (const definition of VISUAL_COMPONENT_EXPANSION) {
    if (names.has(definition.name)) throw new Error(`Duplicate component ${definition.name}`);
    names.add(definition.name);
    if (!definition.nearestExisting || !definition.difference) {
      throw new Error(`${definition.name} is missing its catalog distinction`);
    }
    if (definition.proofTimes.at(-1) !== definition.duration) {
      throw new Error(`${definition.name} proof times do not include the final frame`);
    }
  }
}

async function generate(limitWave: number): Promise<void> {
  assertManifest();
  for (const [path, content] of generatedFiles(limitWave)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await updateRegistryIndex(true, limitWave);
  await recipeCards(true);
  console.log(`Generated visual component waves 1-${limitWave}.`);
}


const recipeCardManifestSchema = hyperframesCatalogItemSchema.pick({
  name: true, title: true, description: true, duration: true, variables: true,
  engine: true, dimensions: true, source: true, preview: true,
}).extend({ motionRecipe: hyperframesMotionRecipeSchema }).strip();

function cardSourceField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = Object.entries<unknown>(value).find(([name]) => name === key)?.[1];
  return typeof field === "string" ? field : undefined;
}

function renderRecipeCard(raw: unknown): string {
  const manifest = recipeCardManifestSchema.parse(raw), recipe = manifest.motionRecipe, usage = recipe.usage;
  const list = (values: string[]) => values.map(value => "- " + value).join("\n");
  const upstream = raw && typeof raw === "object" && "upstream" in raw ? raw.upstream : undefined;
  const lines = [
    "<!-- Generated by visual-component-catalog.ts recipe-cards-generate. Edit the owning manifest/generator, not this file. -->",
    "# " + manifest.title, "", "Component ID: " + manifest.name, "",
    "## Narrative intent", "", usage.intent, "",
    "Select this recipe only when the current story event needs that audience outcome; the animation alone is not evidence that the outcome was delivered.", "",
    "## Purpose and selection", "", list(usage.useWhen), "", "Do not use:", "", list(usage.avoidWhen), "",
    "## Supported inputs", "",
    ...Object.entries(usage.inputRules).map(([key, rule]) => "- " + key + ": " + rule), "",
    ...(recipe.capacity ? ["Capacity contract:", "", "~~~json", JSON.stringify(recipe.capacity, null, 2), "~~~", ""] : []),
    ...(recipe.textLimits ? ["Text limits:", "", "~~~json", JSON.stringify(recipe.textLimits, null, 2), "~~~", ""] : []),
    "Editable variable contract (demo defaults are not user content; apply both variable limits and the stricter recipe text/capacity limits above):", "", "~~~json", JSON.stringify(manifest.variables, null, 2), "~~~", "",
    "## Reading order and motion", "", list(usage.readingOrder), "",
    "Pattern: " + recipe.pattern + ". Native default duration: " + manifest.duration + "s. Minimum final readable hold: " + recipe.minHoldSeconds + "s.", "",
    ...recipe.events.flatMap(event => ["### " + event.id, "", "- Target: " + event.target, "- Visible action: " + event.action,
      "- Authored start: " + event.time + "s; action duration: " + event.duration + "s.", "- Narration cue: " + usage.cueBindings[event.id], ""]),
    "These are authored event defaults, not measured speech alignment. Rebind active events to actual narration at project FPS; omitted capacity items must not acquire phantom cues. Preserve source easing, internal timing ratios and landing geometry. Source implementation is authoritative for curves not declared in the manifest; this card does not invent calibrated parameter ranges.", "",
    "## Sequence and adjacent handoff", "",
    "Choose the sequence by the audience task using the Video Studio Sequence templates, then verify this card's use/avoid rules for its assigned slot. Sequence membership is not proof of fit or a new rendering capability.", "",
    "- Entry reading state: " + usage.readingOrder[0],
    "- Landing reading state: " + usage.readingOrder.at(-1),
    "- Handoff: identify the outgoing result and next subject in the existing storyboard narrative. Preserve only labels, comparison anchors or direction actually supported by the paired recipes. Use a direct cut when the semantic connection is enough; unsupported object morphs/camera paths require a different pairing or a disclosed gap.",
    "- Budget: reserve readable Land time first; an incoming transition lives inside the next shot's Establish window. Do not duplicate narration or reset a developed object merely to replay an entrance.", "",
    "## Known failure modes and recovery", "",
    ...Object.entries(usage.fallback).map(([key, rule]) => "- " + key + ": " + rule), "",
    "Under recipes-only policy, missing capability means another validated recipe, a meaningful split or an explicit gap; not custom graphics disguised as reuse.", "",
    "## Example", "", "~~~json", JSON.stringify(usage.example.values, null, 2), "~~~", "", "Narration: " + usage.example.narration, "",
    "Example media, identities and quotations are demonstration inputs, not factual evidence or supplied assets.", "",
    "## Acceptance and verification status", "", list(usage.acceptance), "",
    "Executable recipe contract exists. Card generation verifies documentation consistency only; it does not certify this shot's factual content, ordinary-speed rhythm, audible synchronization or exported pixels. Run the existing frame/playback/audio acceptance on real project inputs and report observed evidence separately.", "",
    "## Implementation, references and preview", "",
    "- Local implementation: [" + manifest.name + ".html](" + manifest.name + ".html)",
    "- Rule source: registry-item.json in the owning registry directory; this card is its generated view, not an independent rule source.",
  ];
  if (manifest.source?.url) lines.push("- Source: " + manifest.source.url);
  for (const key of ["repository", "revision", "implementation", "rules", "adaptation", "referenceGallery"]) {
    const field = cardSourceField(upstream, key);
    if (field) lines.push("- Upstream " + key + ": " + field);
  }
  if (upstream) {
    lines.push("- Registry-only vendored reference: upstream-card.md (not copied into the project).");
    const repository = cardSourceField(upstream, "repository"), revision = cardSourceField(upstream, "revision");
    if (repository && revision) lines.push("- License: " + repository + "/blob/" + revision + "/LICENSE");
  }
  const preview = manifest.preview?.video;
  lines.push(preview ? "- Registered preview: " + preview : "- No local video preview registered in this manifest. For imports, resolve the exact variant preview through media/video_recipe_catalog; do not claim an audition or pixel parity from an available URL.");
  return lines.join("\n") + "\n";
}

async function recipeCards(write: boolean): Promise<void> {
  const expectedCount = Object.keys(RECIPE_INTENTS).length;
  let count = 0;
  for (const entry of await readdir(blocksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(blocksRoot, entry.name), path = join(directory, "registry-item.json");
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object" || !("motionRecipe" in raw)) continue;
    const recipe = raw.motionRecipe;
    if (!recipe || typeof recipe !== "object" || !("usage" in recipe) || !recipe.usage || typeof recipe.usage !== "object") throw Error("Invalid recipe usage " + entry.name);
    const intent = RECIPE_INTENTS[entry.name];
    if (!intent) throw Error("Missing narrative intent " + entry.name);
    if (write) Object.assign(recipe.usage, { intent });
    else if (!("intent" in recipe.usage) || recipe.usage.intent !== intent) throw Error("Narrative intent stale: " + entry.name);
    const manifest = recipeCardManifestSchema.parse(raw);
    if (manifest.name !== entry.name || !("files" in raw) || !Array.isArray(raw.files)) throw Error("Invalid recipe card owner " + entry.name);
    const file = { path: "recipe.md", target: "compositions/" + entry.name + ".recipe.md", type: "hyperframes:asset" };
    const existing = raw.files.filter(item => item && typeof item === "object" && "path" in item && item.path === file.path);
    if (write) {
      raw.files = [...raw.files.filter(item => !existing.includes(item)), file];
      await writeFile(path, JSON.stringify(raw, null, 2) + "\n");
    } else if (existing.length !== 1 || JSON.stringify(existing[0]) !== JSON.stringify(file)) {
      throw Error("Recipe documentation entry missing or stale: " + entry.name);
    }
    const expected = renderRecipeCard(raw), destination = join(directory, "recipe.md");
    if (write) await writeFile(destination, expected);
    else if (await readFile(destination, "utf8") !== expected) throw Error("Recipe documentation stale: " + entry.name);
    count++;
  }
  if (count !== expectedCount) throw Error(`Expected ${expectedCount} executable recipe cards, found ${count}`);
  console.log((write ? "Generated" : "Checked") + " " + count + " recipe cards from their owning manifests.");
}

async function check(): Promise<void> {
  await recipeCards(false);
  assertManifest();
  const mismatches: string[] = [];
  for (const [path, expected] of generatedFiles()) {
    try {
      if ((await readFile(path, "utf8")) !== expected) mismatches.push(path);
    } catch {
      mismatches.push(path);
    }
  }
  if (!(await updateRegistryIndex(false))) mismatches.push(registryIndexPath);
  const total = (await visualComponentEntries()).length;
  if (total !== 26) mismatches.push(`visual-component-count:${total}`);
  if (mismatches.length > 0) {
    throw new Error(`Visual component catalog is stale:\n${mismatches.join("\n")}`);
  }
  console.log("Visual component catalog is current: 23 native components and 3 Shotcraft imports.");
}

// Refresh metadata only for reviewed local ports; never restore the unported reference archive.
async function importShotcraftReferences(): Promise<void> {
  const repository = "Vincentwei1021/video-shotcraft";
  const revision = "5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab";
  const fork = "louiseliu/hyperFrames-video-shotcraft";
  const forkRevision = "1df77f1ab080323558f70a5fb880fad0f88f87fc";
  const raw = async (repo: string, ref: string, path: string): Promise<string> => {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.text();
  };
  const tree: { tree: { path: string }[] } = JSON.parse(await (await fetch(`https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`)).text());
  const forkTree: { tree: { path: string }[] } = JSON.parse(await (await fetch(`https://api.github.com/repos/${fork}/git/trees/${forkRevision}?recursive=1`)).text());
  type Style = { key: string; label: string; description: string; use?: string; media?: { url: string }; implementationStatus?: string };
  type Card = { name: string; summary: string; use: string; duration: string; energy: string; intention: string; source: string; category: string; tags: string[]; styles: Style[] };
  const library: { cards: Card[]; stats: { cardCount: number; styleCount: number } } = JSON.parse(await raw(repository, revision, "gallery/api/library.json"));
  if (library.cards.length !== 157 || library.cards.reduce((sum, card) => sum + card.styles.length, 0) !== 214) throw new Error("Pinned Shotcraft inventory changed");
  const catalogPath = resolve(dirname(registryIndexPath), "shotcraft-references.json");
  const installedCatalog: { cards: { name: string; styles: { key: string }[] }[] } = JSON.parse(await readFile(catalogPath, "utf8"));
  const allowed = new Map(installedCatalog.cards.map(card => [card.name, new Set(card.styles.map(style => style.key))]));
  const installedCards = library.cards.filter(card => allowed.has(card.name)).map(card => ({
    ...card, styles: card.styles.filter(style => allowed.get(card.name)?.has(style.key)),
  }));
  const demoSources = tree.tree.filter(file => /^(?:demos|assets\/lib|template\/src)\/.*\.tsx$/.test(file.path)).map(file => file.path);
  const forkPaths = new Set(forkTree.tree.map(file => file.path));
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Aliases reviewed against each card's reference-implementation section; not fuzzy matches.
  const sourceAliases: Record<string, string> = {
    "panel-to-canvas": "PanelToCanvasMaterialize", "diagram-cascade": "DiagramCascadeBuild",
    "oscilloscope-stream": "OscilloscopeStreamV2", "unit-dot-swarm-regroup": "UnitDotSwarmRegroupV2", "axis-rescale-shock": "AxisRescaleShockV2",
    "dialogue-duet": "CursorDialogueDuet", "cast-ensemble": "CursorCastEnsemble",
    "multiplane": "MultiplaneReal", "dolly-zoom": "DollyZoomReal", "cursor-performance": "CursorPerformancePunchIn",
    "spotlight-sweep": "SpotlightSweepReveal", "sheen-sweep": "SheenSweepRetry",
    "misregistration-hit": "RisoMisregistrationHit", "beat-pump": "RisoBeatPump",
    "flash-cut": "FlashCut", "shot-transitions-4": "DarkTunnelTransition", "shot-transitions-5": "FocusHandoffTransition",
    "shot-transitions-6": "BlackCardTransition", "whip-pan": "WhipPanReal", "mask-wipe": "MaskWipeReal",
    "speed-ramp": "SpeedRampReal", "freeze-annotate": "FreezeAnnotateReal", "drift-assembly": "LetterformDriftAssembly",
    "tracking-expand": "TrackingExpandReveal", "error-retype": "TypewriterErrorRetype",
    "icon-flip-bloom": "IconFlipBloomLogo", "input-morph-assemble": "InputMorphsIntoLogo",
  };
  const sources = new Map<string, string>();
  const converted = new Map<string, string>();
  const cards = [];
  // A small worker batch bounds GitHub traffic; generated output remains deterministic.
  for (let offset = 0; offset < installedCards.length; offset += 8) {
    cards.push(...await Promise.all(installedCards.slice(offset, offset + 8).map(async card => {
      const rules = await raw(repository, revision, card.source);
      const references = [...rules.matchAll(/(?:demos|assets\/lib|template\/src)\/[A-Za-z0-9_./-]+/g)].map(match => match[0]);
      const candidates = demoSources.filter(path => references.some(reference => reference.endsWith(".tsx") ? path === reference : path.startsWith(reference.endsWith("/") ? reference : `${reference}/`)));
      const implementations = await Promise.all(candidates.map(async path => {
        let text = sources.get(path);
        if (text === undefined) { text = await raw(repository, revision, path); sources.set(path, text); }
        const dependencies = [...text.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
        const htmlPath = path.replace(/\.tsx$/, "/index.html");
        const singlePath = `${path.slice(0, path.lastIndexOf("/"))}/index.html`;
        const pathInFork = forkPaths.has(htmlPath) ? htmlPath : candidates.length === 1 && forkPaths.has(singlePath) ? singlePath : null;
        let conversionStatus = "missing";
        if (pathInFork) {
          let html = converted.get(pathInFork);
          if (html === undefined) { html = await raw(fork, forkRevision, pathInFork); converted.set(pathInFork, html); }
          conversionStatus = html.includes("TODO: Port animation logic") ? "placeholder" : /\btl\.(?:to|from|fromTo|set|add|call)\s*\(/.test(html) ? "authored-unverified" : "no-timeline";
        }
        return { path, url: `https://github.com/${repository}/blob/${revision}/${path}`, dependencies,
          conversion: { status: conversionStatus, path: pathInFork, url: pathInFork ? `https://github.com/${fork}/blob/${forkRevision}/${pathInFork}` : null } };
      }));
      const styles = await Promise.all(card.styles.map(async style => {
        const matching = implementations.filter(item => normalize(item.path.split("/").at(-1)!.replace(/\.tsx$/, "")) === normalize(sourceAliases[style.key] ?? style.key));
        const demos = matching.filter(item => item.path.startsWith("demos/"));
        const implementation = matching.length === 1 ? matching[0] : demos.length === 1 ? demos[0] : card.styles.length === 1 && implementations.length === 1 ? implementations[0] : null;
        const previewUrl = style.media ? new URL(style.media.url, "https://vincentwei1021.github.io/video-shotcraft/").href : null;
        const previewStatus = previewUrl ? (await fetch(previewUrl, { method: "HEAD" })).status : null;
        return { key: style.key, label: style.label, description: style.description, use: style.use ?? card.use,
          upstreamStatus: style.implementationStatus ?? "preview-available",
          previewUrl, previewStatus, previewRevision: "live-gallery-not-pinned",
          implementationPath: implementation?.path ?? null,
          implementationPaths: implementation ? [implementation.path] : implementations.map(item => item.path),
          sourceResolution: implementation ? "resolved" : "read-card-to-resolve",
          conversion: implementation?.conversion ?? { status: "source-unresolved", path: null, url: null } };
      }));
      return { name: card.name, summary: card.summary, use: card.use, duration: card.duration, energy: card.energy,
        intention: card.intention, category: card.category, tags: card.tags, sourcePath: card.source,
        sourceUrl: `https://github.com/${repository}/blob/${revision}/${card.source}`, rules, implementations, styles };
    })));
  }
  const license = await raw(repository, revision, "LICENSE");
  const output = { schemaVersion: 1, repository: `https://github.com/${repository}`, revision,
    conversionRepository: `https://github.com/${fork}`, conversionRevision: forkRevision,
    license: "Apache-2.0", licenseFile: "shotcraft-reference-LICENSE.txt", stats: { cardCount: cards.length, styleCount: cards.reduce((sum, card) => sum + card.styles.length, 0) },
    methodology: { sourceUrl: `https://github.com/${repository}/blob/${revision}/references/pipeline.md`, rules: await raw(repository, revision, "references/pipeline.md") }, cards };
  await writeFile(catalogPath, JSON.stringify(output, null, 2) + "\n");
  await writeFile(resolve(dirname(registryIndexPath), "shotcraft-reference-LICENSE.txt"), license);
  console.log(`Refreshed ${output.stats.cardCount} installable Shotcraft cards and ${output.stats.styleCount} preview variants; unported entries remain excluded.`);
}

async function importShotcraftCameras(): Promise<void> {
  const revision = "5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab";
  const repository = "https://github.com/Vincentwei1021/video-shotcraft";
  const raw = async (path: string) => {
    const response = await fetch("https://raw.githubusercontent.com/Vincentwei1021/video-shotcraft/" + revision + "/" + path);
    if (!response.ok) throw new Error(path + ": " + response.status);
    return response.text();
  };
  const rulesPath = "references/shots/camera/depth-layer-moves.md";
  const rules = await raw(rulesPath), license = await raw("LICENSE");
  const captureLayout = JSON.stringify({ width: 1920, height: 1080, pixelRatio: 1,
    regions: Array.from({ length: 6 }, (_, i) => ({ id: "region-" + i, x: 50 + i * 280, y: 300, width: 240, height: 240 })),
    heroId: "region-3", foregroundIds: ["region-0", "region-5"] });
  // Shared page-space construction, emitted into both self-contained registry compositions.
  const pageSpace = String.raw`
 const capture=JSON.parse(String(values.captureLayout));
 const source=new Image();source.src=String(values.mediaUrl);await source.decode();
 if(source.naturalWidth!==Math.round(capture.width*capture.pixelRatio)||source.naturalHeight!==Math.round(capture.height*capture.pixelRatio))throw Error('Screenshot dimensions differ from captureLayout');
 const layer=className=>{const element=document.createElement('div');element.className='sc-layer '+className;root.append(element);return element;};
 const page=(parent,width,top,opacity)=>{const image=source.cloneNode();Object.assign(image.style,{position:'absolute',left:'0px',top:Math.max(top,1080-capture.height*width/capture.width)+'px',width:width+'px',opacity:String(opacity)});parent.append(image);};
 const crop=(parent,region,width,x,y,className)=>{const scale=width/region.width,box=document.createElement('div');box.className='sc-crop '+className;box.dataset.captureRegion=region.id;Object.assign(box.style,{left:x+'px',top:y+'px',width:width+'px',height:region.height*scale+'px'});const image=source.cloneNode();Object.assign(image.style,{position:'absolute',width:capture.width*scale+'px',left:-region.x*scale+'px',top:-region.y*scale+'px'});box.append(image);parent.append(box);return box;};
 const region=id=>{const item=capture.regions.find(item=>item.id===id);if(!item)throw Error('Missing capture region '+id);return item;};
 const cubic=(x1,y1,x2,y2,t)=>{const coordinate=(a,b,p)=>3*(1-p)*(1-p)*p*a+3*(1-p)*p*p*b+p*p*p;let low=0,high=1;for(let i=0;i<24;i++){const p=(low+high)/2;if(coordinate(x1,x2,p)<t)low=p;else high=p;}return t<=0?0:t>=1?1:coordinate(y1,y2,(low+high)/2);};
 `;
  for (const spec of [
    { id: "shotcraft-multiplane", title: "真实页面多层视差", source: "MultiplaneReal", seconds: 115 / 30, key: "multiplane",
      use: "展示真实页面、图像或空间层次，沿同一方向探索真实内容。",
      avoid: "不用于必须固定对照的公式、代码或精确数值；前景不可遮挡主阅读对象。" },
    { id: "shotcraft-dolly-zoom", title: "主体固定背景变焦", source: "DollyZoomReal", seconds: 95 / 30, key: "dolly-zoom",
      use: "在真实素材上突出一个固定主体，背景膨胀形成一次戏剧性强调。",
      avoid: "不用于日常连续阅读或每幕重复；全片最多一次，不给主体增加运镜或模糊。" },
  ]) {
    const implementation = "demos/camera/depth-layer-moves/" + spec.source + ".tsx";
    const upstream = await raw(implementation);
    const variables = [
      { id: "title", label: "Short scene heading", type: "string", default: spec.title, maxLength: 12, update: "reload" },
      { id: "mediaUrl", label: "Real captured screenshot", type: "string", default: "assets/evidence.svg", maxLength: 2000, update: "reload" },
      { id: "captureLayout", label: "Measured CSS-page crop geometry", type: "string", default: captureLayout, maxLength: 4096, update: "reload" },
      { id: "motionCueTimes", label: "Measured semantic cues", type: "string", default: "{}", maxLength: 2048, update: "reload" },
    ];
    const recipe = { version: 1, pattern: "state-transformation", minHoldSeconds: .7,
      textLimits: { title: { maxLines: 1, maxLineLength: 12 } },
      events: [{ id: "camera", target: ".sc-layer", time: .65, duration: spec.seconds, action: spec.use }],
      usage: { intent: RECIPE_INTENTS[spec.id], useWhen: [spec.use], avoidWhen: [spec.avoid],
        inputRules: { title: "单行最多12字；不遮盖素材中的必要信息。", mediaUrl: "已有项目内真实页面截图；禁止用演示卡片或手绘假界面替代。",
          captureLayout: "JSON: width/height 是截图的 CSS 页面尺寸，pixelRatio 是像素倍率；regions 是6–8个实测 {id,x,y,width,height} 区域，heroId 与两个 foregroundIds 引用已有区域。图片像素尺寸必须一致。先核对裁切，过密或无适合主体时换配方，不猜坐标。" },
        readingOrder: ["建立真实页面和层次", spec.use, "保留主体和最终可读画面"],
        cueBindings: { camera: "绑定开始探索/强调主体的实测旁白短语；内部时值比例和各层运动关系不变。" },
        fallback: { overflow: "拆镜或选择合适配方，不缩小文字。", missingInput: "先取得真实截图和实测区域；素材不可用则报告缺口。",
          timingMismatch: "绑定实测短语并整体重排；过长旁白拆镜，不让相机漫无目的持续移动。", inapplicable: "换合适的已验证配方；仅配方模式下禁止自绘替代。" },
        example: { values: { title: spec.title, mediaUrl: "assets/evidence.svg", captureLayout }, narration: spec.use },
        acceptance: ["真实页面裁切与实测坐标一致，原图解码成功，高清主阅读层不模糊。",
          spec.key === "multiplane" ? "各层沿同一 drive 移动，系数保持0.35/0.7/1.4，中景无模糊。" : "主体屏幕矩形保持固定；背景从1放大到2.25，模糊从0增加到3.5。",
          "保持原曲线和动效关系，正反向拖动恢复同一画面；这不是像素完全相同的Remotion渲染。"] } };
    const motion = spec.key === "multiplane" ? String.raw`
 const background=layer('sc-background'),middle=layer('sc-middle'),foreground=layer('sc-foreground');
 background.style.cssText='opacity:.85;filter:blur(2px) saturate(.92)';foreground.style.filter='blur(3px)';page(background,2100,-300,1);
 capture.regions.slice(0,6).forEach((item,k)=>crop(middle,item,420,200+k*480,330+(k%2)*40,'sc-card'));
 crop(foreground,region(capture.foregroundIds[0]),700,900,150,'sc-front');crop(foreground,region(capture.foregroundIds[1]),380,2100,700,'sc-front');
 const apply=progress=>{const drive=progress*1000;background.style.transform='translateX('+(-drive*.35)+'px) scale(1.05)';middle.style.transform='translateX('+(-drive*.7)+'px)';foreground.style.transform='translateX('+(-drive*1.4)+'px)';root.dataset.ipwPageProgress=String(progress);};
 const ease=t=>cubic(.35,0,.25,1,t);
 ` : String.raw`
 const background=layer('sc-background');background.style.transformOrigin='960px 540px';page(background,1920,-400,.55);
 const xs=[180,1280,240,1220,700,760,60,1500],ys=[140,120,700,720,60,840,420,430];
 capture.regions.filter(item=>item.id!==capture.heroId).slice(0,8).forEach((item,k)=>{const card=crop(background,item,320,xs[k],ys[k],'sc-card');card.style.opacity='.9';});
 const subject=region(capture.heroId),hero=crop(root,subject,520,700,540-subject.height*520/subject.width/2,'sc-hero');
 const apply=progress=>{background.style.transform='scale('+(1+progress*1.25)+')';background.style.filter='blur('+(progress*3.5)+'px) saturate(.9)';hero.style.boxShadow='0 '+(12+progress*16)+'px '+(40+progress*28)+'px rgba(31,28,23,'+(.16+progress*.1)+')';root.dataset.ipwPageProgress=String(progress);};
 const ease=t=>cubic(.4,0,.3,1,t);
 `;
    const html = '<!doctype html>\n<html lang="zh" data-composition-variables=\'' + JSON.stringify(variables) + '\'><head><meta charset="utf-8"><title>' + spec.title + '</title><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}*{box-sizing:border-box}.sc-root{position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--ipw-color-bg,#efece6);color:var(--ipw-color-text,#191919);font-family:var(--ipw-font-display,-apple-system,"PingFang SC",sans-serif)}.sc-layer{position:absolute;inset:0}.sc-crop{position:absolute;overflow:hidden;border-radius:12px;box-shadow:0 8px 28px rgba(31,28,23,.14)}.sc-hero{border-radius:14px}.sc-front{border-radius:22px}.sc-context{position:absolute;left:120px;top:72px;z-index:5;margin:0;padding:12px 20px;font-size:48px;line-height:1.4;background:var(--ipw-color-bg,#efece6);border-radius:8px}</style></head>\n<body><main id="' + spec.id + '" class="sc-root" data-composition-id="' + spec.id + '" data-width="1920" data-height="1080" data-duration="5.2"><h1 class="sc-context" data-ipw-variable="title"></h1></main><script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>\n<!-- Derived from ' + repository + ' ' + revision + ' ' + implementation + '. Copyright 2026 WeiYihao. Apache-2.0. Modified: measured screenshot crops, content, narration cues, page extent clamp, theme and hold. See LICENSE. -->\n<script data-ipw-motion-recipe="1">\n(async function(){await document.fonts.ready;const root=document.getElementById(' + JSON.stringify(spec.id) + '),id=root.dataset.compositionId||' + JSON.stringify(spec.id) + ';const values={...' + JSON.stringify(recipe.usage.example.values) + ',...(window.__hyperframes?.getVariables?.()??{}),...(window.__hfVariablesByComp?.[id]??{})};const recipe=' + JSON.stringify(recipe) + ';\n const cues=JSON.parse(String(values.motionCueTimes??"{}"));\n root.querySelector("[data-ipw-variable=title]").textContent=String(values.title);\n' + pageSpace + motion + '\n const state={progress:0},event=recipe.events[0],tl=gsap.timeline({paused:true});apply(0);tl.fromTo(state,{progress:0},{progress:1,duration:event.duration,ease,onUpdate:()=>apply(state.progress)},cues.camera??event.time);tl.to({}, {duration:5.2},0);window.__timelines=window.__timelines||{};window.__timelines[id]=tl;tl.seek(0,false);})();\n</script></body></html>\n';
    const manifest = { $schema: "https://hyperframes.heygen.com/schema/registry-item.json", name: spec.id, version: "1.0.0", type: "hyperframes:block", title: spec.title, description: spec.use,
      tags: ["component", "shotcraft", "media", "camera", "theme"], author: "WeiYihao; iPolloWork integration", license: "Apache-2.0",
      upstream: { repository, revision, implementation, rules: rulesPath, license: "Apache-2.0", upstreamSha256: (await import("node:crypto")).createHash("sha256").update(upstream).digest("hex"),
        adaptation: "Preserves original bezier curves, layered motion coefficients and fixed-subject geometry. Adapted: real screenshot regions instead of hardcoded demo textures, page extent clamp, content variables, theme, measured phrase cues and final hold. Not pixel-identical Remotion rendering." },
      source: { provider: "video-shotcraft", label: "Video Shotcraft · Apache-2.0", url: repository + "/blob/" + revision + "/" + rulesPath },
      visualComponent: { version: 1, category: "media", surfaces: ["video"], themeMode: "inherit", ai: { slots: ["title", "mediaUrl", "captureLayout"], instructions: spec.use + " " + spec.avoid } },
      dimensions: { width: 1920, height: 1080 }, duration: 5.2, engine: { name: "gsap", version: "3.13.0", seekable: true },
      files: [{ path: spec.id + ".html", target: "compositions/" + spec.id + ".html", type: "hyperframes:composition" }, { path: "LICENSE", target: "compositions/licenses/video-shotcraft-LICENSE.txt", type: "hyperframes:asset" }], variables, motionRecipe: recipe };
    const directory = resolve(dirname(registryIndexPath), "blocks", spec.id);await mkdir(directory, { recursive: true });
    for (const [name, content] of [[spec.id + ".html", html], ["registry-item.json", JSON.stringify(manifest, null, 2) + "\n"], ["upstream.tsx", upstream], ["upstream-card.md", rules], ["LICENSE", license]]) await writeFile(join(directory, name), content);
  }
  const index = JSON.parse(await readFile(registryIndexPath, "utf8"));
  for (const name of ["shotcraft-multiplane", "shotcraft-dolly-zoom"]) if (!index.items.some((item: { name: string }) => item.name === name)) index.items.push({ name, type: "hyperframes:block" });
  await writeFile(registryIndexPath, JSON.stringify(index, null, 2) + "\n");
  console.log("Generated two source-preserving Shotcraft page-space recipes.");
}

const command = process.argv[2] ?? "check";
if (command === "shotcraft-camera-import") {
  await importShotcraftCameras();
} else if (command === "shotcraft-reference-import") {
  await importShotcraftReferences();
} else if (command === "recipes-audit") {
  console.log(JSON.stringify(await auditNativeRecipeCoverage(), null, 2));
} else if (command === "recipe-cards-generate") {
  await recipeCards(true);
} else if (command === "registry-index-generate") {
  await updateRegistryIndex(true);
  console.log("Updated the registry index from the owning visual component manifests.");
} else if (command === "generate") {
  const limitWave = Math.max(1, Math.min(4, Number(process.argv[3] ?? 4) || 4));
  await generate(limitWave);
} else if (command === "check") {
  await check();
} else {
  throw new Error(`Unknown command: ${command}`);
}
