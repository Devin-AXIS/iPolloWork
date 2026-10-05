/**
 * Business diagram library ("商业图库") generator.
 * Source of truth: scripts/business-diagrams/{definitions.json, *.js runtime}.
 * Output: one self-contained registry block per definition under registry/blocks/<name>/.
 *   bun scripts/business-diagram-catalog.ts generate   # write blocks
 *   bun scripts/business-diagram-catalog.ts check      # fail when committed blocks drift from the source
 * Recipe cards (recipe.md) and the registry index stay owned by visual-component-catalog.ts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hyperframesEffectVariableSchema, hyperframesMotionRecipeSchema } from "../../../packages/types/src/hyperframes.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "scripts", "business-diagrams");
const blocksRoot = join(root, "registry", "blocks");
const RENDERER_FILES = ["essentials", "hero", "systems", "frameworks"];
const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js";
const BALANCED_MOTION = { distance: 16, emphasisScale: 1.012, durationFactor: 1, ease: "power2.out", resolveEase: "power2.inOut" };

interface Definition {
  name: string; diagram: string; title: string; description: string; subcategory: string; tags: string[];
  duration: number; camera: string; pattern: string; variables: Array<Record<string, unknown> & { id: string; default: unknown }>;
  capacity: Record<string, unknown>; events: Array<{ id: string }>; usage: Record<string, unknown>;
}
interface Definitions {
  subcategories: string[];
  shared: { skin: Record<string, unknown>; camera: Record<string, unknown>; motionCueTimes: Record<string, unknown>; fallback: Record<string, string>; inputRules: Record<string, string> };
  blocks: Definition[];
}

export async function readDefinitions(): Promise<Definitions> {
  return JSON.parse(await readFile(join(sourceRoot, "definitions.json"), "utf8")) as Definitions;
}

const minifier = new Bun.Transpiler({ loader: "js", minifyWhitespace: true });

/** Core + the one renderer file that registers this diagram + variable mapping + GSAP compiler, minified. */
async function runtime(diagram: string): Promise<string> {
  const read = (name: string) => readFile(join(sourceRoot, `${name}.js`), "utf8");
  const renderers = await Promise.all(RENDERER_FILES.map(read));
  const owner = renderers.find(source => source.includes(`SD.register('${diagram}'`));
  if (!owner) throw new Error(`No renderer registers diagram type ${diagram}`);
  const code = [await read("core"), owner, await read("variables"), await read("timeline")].join("\n");
  return minifier.transformSync(code).replaceAll("</script", "<\\/script");
}

function variablesFor(definition: Definition, shared: Definitions["shared"]) {
  const declared = [
    ...definition.variables,
    shared.skin,
    { ...shared.camera, default: definition.camera },
    shared.motionCueTimes,
  ];
  return declared.map(variable => hyperframesEffectVariableSchema.parse(variable));
}

function manifestFor(definition: Definition, definitions: Definitions) {
  const variables = variablesFor(definition, definitions.shared);
  const motionRecipe = hyperframesMotionRecipeSchema.parse({
    version: 1,
    pattern: definition.pattern,
    minHoldSeconds: 0.7,
    capacity: definition.capacity,
    usage: { ...definition.usage, inputRules: { ...(definition.usage.inputRules as Record<string, string>), ...definitions.shared.inputRules }, fallback: definitions.shared.fallback },
    events: definition.events,
  });
  if (!definitions.subcategories.includes(definition.subcategory)) throw new Error(`Unknown subcategory ${definition.subcategory} in ${definition.name}`);
  return {
    $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
    name: definition.name,
    version: "1.0.0",
    type: "hyperframes:block",
    title: definition.title,
    description: definition.description,
    tags: definition.tags,
    author: "iPolloWork",
    license: "Apache-2.0",
    visualComponent: {
      version: 1,
      category: "business",
      subcategory: definition.subcategory,
      surfaces: ["video"],
      themeMode: "inherit",
      ai: {
        slots: variables.map(variable => variable.id).filter(id => id !== "motionCueTimes"),
        instructions: "AI may rewrite every content variable within its limits, choose the skin and camera, and bind measured cue times. Colours and fonts always come from the active --ipw-* theme.",
      },
    },
    dimensions: { width: 1920, height: 1080 },
    duration: definition.duration,
    engine: { name: "gsap", version: "3.13.0", seekable: true },
    files: [
      { path: `${definition.name}.html`, target: `compositions/${definition.name}.html`, type: "hyperframes:composition" },
      { path: "recipe.md", target: `compositions/${definition.name}.recipe.md`, type: "hyperframes:asset" },
    ],
    variables,
    motionRecipe,
  };
}

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

function htmlFor(definition: Definition, manifest: ReturnType<typeof manifestFor>, code: string): string {
  const defaults = Object.fromEntries(manifest.variables.map(variable => [variable.id, variable.default]));
  const { name, duration } = definition;
  return `<!doctype html><html lang="zh-CN" data-composition-variables='${attribute(JSON.stringify(manifest.variables))}'><head><meta charset="UTF-8"/><meta name="viewport" content="width=1920,height=1080"/><title>${definition.title}</title><style>*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:transparent}#${name}{position:relative;width:1920px;height:1080px;overflow:hidden}#${name} stage-diagram{width:1920px}</style></head><body><main id="${name}" data-composition-id="${name}" data-width="1920" data-height="1080" data-start="0" data-duration="${duration}"><stage-diagram type="${definition.diagram}" motion="none" autoplay="false" chrome="none"></stage-diagram></main><script src="${GSAP_URL}"></script>
<script data-ipw-business-runtime="1">
${code}
</script>
<script data-ipw-motion-recipe="1">
(function(){
const root=document.querySelector("[data-composition-id]"),id=root.dataset.compositionId;
const values={...${JSON.stringify(defaults)},...(window.__hyperframes?.getVariables?.()??window.__hfVariablesByComp?.[id]??{})};
const motionStyle=JSON.parse(String(values.motionStyle??'${JSON.stringify(BALANCED_MOTION)}'));
// Authored recipe times are the defaults the host's beat map uses; measured cues override them.
const times={...${JSON.stringify(Object.fromEntries(manifest.motionRecipe.events.map(event => [event.id, event.time])))},...JSON.parse(String(values.motionCueTimes??"{}"))};
window.__timelines=window.__timelines||{};
window.__timelines[id]?.kill();
StageDiagrams.define();
const el=root.querySelector("stage-diagram");
el.setAttribute("skin",String(values.skin));el.setAttribute("camera",String(values.camera));
const build=into=>{el.renderNow(StageDiagrams.fromVariables.${definition.diagram}(values));return StageDiagrams.timeline(el,gsap,{duration:${duration},cues:times,motionStyle,camera:String(values.camera),into});};
const tl=build();
tl.set(root.querySelectorAll("[data-u]"),{visibility:"inherit"},0);
tl.set(root,{visibility:"visible"},${duration});
window.__timelines[id]=tl;tl.seek(0);
// Web fonts change text metrics: rebuild once into the same registered timeline.
document.fonts?.ready.then(()=>{const at=tl.time();build(tl);tl.set(root,{visibility:"visible"},${duration});tl.seek(at);});
})();
</script>
</body></html>
`;
}

async function generatedFiles(): Promise<Array<[string, string]>> {
  const definitions = await readDefinitions();
  const files: Array<[string, string]> = [];
  for (const definition of definitions.blocks) {
    const manifest = manifestFor(definition, definitions), code = await runtime(definition.diagram);
    const directory = join(blocksRoot, definition.name);
    files.push(
      [join(directory, `${definition.name}.html`), htmlFor(definition, manifest, code)],
      [join(directory, "registry-item.json"), `${JSON.stringify(manifest, null, 2)}\n`],
    );
  }
  return files;
}

const command = process.argv[2] ?? "check";
if (command === "generate") {
  for (const [path, content] of await generatedFiles()) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  console.log("Generated business diagram blocks. Run visual-components recipe-cards-generate and registry-index-generate next.");
} else if (command === "check") {
  const stale: string[] = [];
  for (const [path, content] of await generatedFiles()) {
    if (await readFile(path, "utf8").catch(() => null) !== content) stale.push(path);
  }
  if (stale.length) throw new Error(`Business diagram blocks are stale; run business-diagrams:generate:\n${stale.join("\n")}`);
  console.log("Business diagram blocks match their source.");
} else {
  throw new Error(`Unknown command: ${command}`);
}
