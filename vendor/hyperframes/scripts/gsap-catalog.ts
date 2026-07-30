import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GSAP_OFFICIAL_CAPABILITIES,
  GSAP_OFFICIAL_VERSION,
  type GsapOfficialCapability,
} from "../packages/core/src/registry/gsapCapabilities";

const hyperframesRoot = dirname(dirname(import.meta.path));
const registryRoot = join(hyperframesRoot, "registry");
const blocksRoot = join(registryRoot, "blocks");
const registryIndexPath = join(registryRoot, "registry.json");

const HAND_AUTHORED_ITEMS = new Map([
  ["ScrollTrigger", "gsap-scrolltrigger-story"],
  ["SplitText", "gsap-splittext-reveal"],
  ["MorphSVGPlugin", "gsap-morphsvg-shape"],
]);

interface DemoDefinition {
  scripts: string[];
  setup: string;
  extraPlugins?: string[];
  externalScripts?: string[];
}

const DEMOS: Readonly<Record<string, DemoDefinition>> = {
  ScrollSmoother: {
    scripts: ["ScrollTrigger", "ScrollSmoother"],
    extraPlugins: ["ScrollTrigger"],
    setup: `
      gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
      ScrollSmoother.create({ wrapper: "#smooth-wrapper", content: "#smooth-content", smooth: 1 });
      timeline.fromTo(".feature-card", { y: 180 }, { y: -180, stagger: 0.18, duration: duration, ease: "none" });
    `,
  },
  ScrollToPlugin: {
    scripts: ["ScrollToPlugin"],
    setup: `
      gsap.registerPlugin(ScrollToPlugin);
      timeline.to("#scroll-viewport", { scrollTo: { y: 360 }, duration: duration, ease: "power2.inOut" });
    `,
  },
  ScrambleTextPlugin: {
    scripts: ["ScrambleTextPlugin"],
    setup: `
      gsap.registerPlugin(ScrambleTextPlugin);
      timeline.to("#headline", {
        scrambleText: { text: headline, chars: "upperAndLowerCase", revealDelay: 0.2 },
        duration: duration,
        ease: "none"
      });
    `,
  },
  TextPlugin: {
    scripts: ["TextPlugin"],
    setup: `
      gsap.registerPlugin(TextPlugin);
      document.querySelector("#headline").textContent = "";
      timeline.to("#headline", { text: headline, duration: duration, ease: "none" });
    `,
  },
  DrawSVGPlugin: {
    scripts: ["DrawSVGPlugin"],
    setup: `
      gsap.registerPlugin(DrawSVGPlugin);
      document.querySelector("#motion-svg").classList.add("is-visible");
      timeline.fromTo("#draw-path", { drawSVG: "0%" }, { drawSVG: "100%", duration: duration, ease: "power2.inOut" });
    `,
  },
  MotionPathPlugin: {
    scripts: ["MotionPathPlugin"],
    setup: `
      gsap.registerPlugin(MotionPathPlugin);
      document.querySelector("#motion-svg").classList.add("is-visible");
      timeline.to("#orb", {
        motionPath: { path: "#motion-path", align: "#motion-path", autoRotate: true, alignOrigin: [0.5, 0.5] },
        duration: duration,
        ease: "power1.inOut"
      });
    `,
  },
  MotionPathHelper: {
    scripts: ["MotionPathPlugin", "MotionPathHelper"],
    extraPlugins: ["MotionPathPlugin"],
    setup: `
      gsap.registerPlugin(MotionPathPlugin, MotionPathHelper);
      document.querySelector("#motion-svg").classList.add("is-visible");
      MotionPathHelper.create("#orb", { path: "#motion-path" });
      timeline.to("#orb", {
        motionPath: { path: "#motion-path", align: "#motion-path", alignOrigin: [0.5, 0.5] },
        duration: duration,
        ease: "none"
      });
    `,
  },
  Flip: {
    scripts: ["Flip"],
    setup: `
      gsap.registerPlugin(Flip);
      var tiles = document.querySelector(".tiles");
      tiles.classList.add("is-visible");
      var state = Flip.getState(".tile");
      tiles.classList.add("is-stacked");
      timeline.add(Flip.from(state, { duration: duration, absolute: true, ease: "power3.inOut", paused: true }), 0);
    `,
  },
  Draggable: {
    scripts: ["Draggable"],
    setup: `
      gsap.registerPlugin(Draggable);
      Draggable.create("#orb", { bounds: "#demo-surface", type: "x,y" });
      timeline.fromTo("#orb", { x: -180 }, { x: 180, duration: duration, yoyo: true, repeat: 1, ease: "power2.inOut" });
    `,
  },
  InertiaPlugin: {
    scripts: ["Draggable", "InertiaPlugin"],
    extraPlugins: ["Draggable"],
    setup: `
      gsap.registerPlugin(Draggable, InertiaPlugin);
      Draggable.create("#orb", { bounds: "#demo-surface", type: "x,y", inertia: true });
      timeline.to("#orb", {
        inertia: { x: { velocity: 420, min: -220, max: 220 }, y: { velocity: -180, min: -160, max: 160 } },
        duration: duration
      });
    `,
  },
  Observer: {
    scripts: ["Observer"],
    setup: `
      gsap.registerPlugin(Observer);
      Observer.create({
        target: "#demo-surface",
        type: "pointer,touch,wheel",
        onChangeX: function (self) { gsap.to("#orb", { x: "+=" + self.deltaX * 0.2, overwrite: true }); },
        onChangeY: function (self) { gsap.to("#orb", { y: "+=" + self.deltaY * 0.2, overwrite: true }); }
      });
      timeline.to("#orb", { x: 190, y: -90, rotate: 180, duration: duration, yoyo: true, repeat: 1, ease: "sine.inOut" });
    `,
  },
  Physics2DPlugin: {
    scripts: ["Physics2DPlugin"],
    setup: `
      gsap.registerPlugin(Physics2DPlugin);
      timeline.to("#orb", {
        physics2D: { velocity: 520, angle: -58, gravity: 680 },
        duration: duration
      });
    `,
  },
  PhysicsPropsPlugin: {
    scripts: ["PhysicsPropsPlugin"],
    setup: `
      gsap.registerPlugin(PhysicsPropsPlugin);
      timeline.to("#orb", {
        physicsProps: {
          x: { velocity: 360, acceleration: -90 },
          y: { velocity: -260, acceleration: 120 },
          rotation: { velocity: 300, acceleration: -45 }
        },
        duration: duration
      });
    `,
  },
  GSDevTools: {
    scripts: ["GSDevTools"],
    setup: `
      gsap.registerPlugin(GSDevTools);
      timeline.to("#orb", { x: 180, rotate: 360, scale: 1.35, duration: duration, ease: "power2.inOut" });
      GSDevTools.create({ animation: timeline, container: "#tools" });
    `,
  },
  EaselPlugin: {
    scripts: ["EaselPlugin"],
    externalScripts: ["https://code.createjs.com/1.0.0/createjs.min.js"],
    setup: `
      gsap.registerPlugin(EaselPlugin);
      document.querySelector("#easel-canvas").classList.add("is-visible");
      var easelStage = new createjs.Stage("easel-canvas");
      var shape = new createjs.Shape();
      shape.graphics.beginFill(accentColor).drawCircle(0, 0, 74);
      shape.x = 160;
      shape.y = 280;
      easelStage.addChild(shape);
      easelStage.update();
      timeline.to(shape, {
        x: 790,
        rotation: 360,
        easel: { tint: "#FFFFFF", tintAmount: 0.45 },
        duration: duration,
        ease: "power2.inOut",
        onUpdate: function () { easelStage.update(); }
      });
    `,
  },
  PixiPlugin: {
    scripts: ["PixiPlugin"],
    externalScripts: ["https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js"],
    setup: `
      gsap.registerPlugin(PixiPlugin);
      PixiPlugin.registerPIXI(PIXI);
      document.querySelector("#pixi-canvas").classList.add("is-visible");
      var pixiApp = new PIXI.Application({ view: document.querySelector("#pixi-canvas"), width: 960, height: 560, backgroundAlpha: 0 });
      var graphic = new PIXI.Graphics();
      graphic.beginFill(Number("0x" + accentColor.slice(1))).drawRoundedRect(-80, -80, 160, 160, 38).endFill();
      graphic.x = 160;
      graphic.y = 280;
      pixiApp.stage.addChild(graphic);
      timeline.to(graphic, {
        pixi: { x: 800, rotation: 360, scale: 1.35, tint: "#FFFFFF" },
        duration: duration,
        ease: "power2.inOut"
      });
    `,
  },
  RoughEase: {
    scripts: ["EasePack"],
    setup: `
      timeline.to("#orb", {
        x: 210,
        rotate: 180,
        duration: duration,
        ease: "rough({ strength: 1.6, points: 24, template: none, taper: none, randomize: false })"
      });
    `,
  },
  ExpoScaleEase: {
    scripts: ["EasePack"],
    setup: `
      timeline.fromTo("#orb", { scale: 0.35 }, {
        scale: 2,
        rotate: 270,
        duration: duration,
        ease: ExpoScaleEase.config(0.35, 2, "power2.inOut")
      });
    `,
  },
  SlowMo: {
    scripts: ["EasePack"],
    setup: `
      timeline.to("#orb", {
        x: 220,
        rotate: 360,
        duration: duration,
        ease: SlowMo.config(0.65, 0.8, false)
      });
    `,
  },
  CustomEase: {
    scripts: ["CustomEase"],
    setup: `
      gsap.registerPlugin(CustomEase);
      CustomEase.create("catalogEase", "M0,0 C0.12,0.78 0.22,1 1,1");
      timeline.to("#orb", { x: 220, scale: 1.5, rotate: 300, duration: duration, ease: "catalogEase" });
    `,
  },
  CustomBounce: {
    scripts: ["CustomEase", "CustomBounce"],
    extraPlugins: ["CustomEase"],
    setup: `
      gsap.registerPlugin(CustomEase, CustomBounce);
      CustomBounce.create("catalogBounce", { strength: 0.75, squash: 2 });
      timeline.from("#orb", { y: -250, scaleY: 1.3, duration: duration, ease: "catalogBounce" });
    `,
  },
  CustomWiggle: {
    scripts: ["CustomEase", "CustomWiggle"],
    extraPlugins: ["CustomEase"],
    setup: `
      gsap.registerPlugin(CustomEase, CustomWiggle);
      CustomWiggle.create("catalogWiggle", { wiggles: 9, type: "easeOut" });
      timeline.to("#orb", { x: 220, rotate: 25, duration: duration, ease: "catalogWiggle" });
    `,
  },
};

function itemName(capability: GsapOfficialCapability): string {
  return HAND_AUTHORED_ITEMS.get(capability.runtimeName) ?? `gsap-${capability.id}-official`;
}

function pluginUrl(script: string): string {
  return `https://cdn.jsdelivr.net/npm/gsap@${GSAP_OFFICIAL_VERSION}/dist/${script}.min.js`;
}

function docsUrl(capability: GsapOfficialCapability): string {
  const section = capability.kind === "ease" ? "Eases" : "Plugins";
  return `https://gsap.com/docs/v3/${section}/${capability.runtimeName}/`;
}

function renderHtml(capability: GsapOfficialCapability, demo: DemoDefinition): string {
  const scripts = [
    `https://cdn.jsdelivr.net/npm/gsap@${GSAP_OFFICIAL_VERSION}/dist/gsap.min.js`,
    ...(demo.externalScripts ?? []),
    ...demo.scripts.map(pluginUrl),
  ];
  const scriptTags = scripts.map((url) => `    <script src="${url}"></script>`).join("\n");
  const title = `${capability.label} Official Demo`;
  return `<!-- Generated by scripts/gsap-catalog.ts. Run "bun scripts/gsap-catalog.ts generate". -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: var(--background, #070b16); color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .stage { display: grid; grid-template-columns: .9fr 1.1fr; width: 100%; height: 100%; padding: 100px 120px; gap: 80px; align-items: center; }
      .eyebrow { color: var(--accent, #6ef2be); font-size: 20px; font-weight: 750; letter-spacing: .2em; text-transform: uppercase; }
      h1 { margin: 26px 0 0; font-size: 84px; line-height: .94; letter-spacing: -.06em; }
      p { margin: 30px 0 0; max-width: 650px; color: rgba(248,250,252,.62); font-size: 24px; line-height: 1.55; }
      .meta { display: inline-flex; margin-top: 34px; padding: 10px 14px; border: 1px solid rgba(110,242,190,.3); border-radius: 999px; color: var(--accent, #6ef2be); font-size: 16px; }
      #demo-surface { position: relative; display: grid; place-items: center; min-height: 720px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 44px; background: radial-gradient(circle at 50% 35%, rgba(110,242,190,.15), rgba(255,255,255,.025) 55%); }
      #orb { z-index: 3; width: 132px; height: 132px; border-radius: 34px; background: var(--accent, #6ef2be); box-shadow: 0 30px 100px rgba(110,242,190,.38); }
      #motion-svg { position: absolute; inset: 10%; display: none; width: 80%; height: 80%; overflow: visible; }
      #motion-svg.is-visible { display: block; }
      #motion-path, #draw-path { fill: none; stroke: rgba(110,242,190,.65); stroke-width: 6; stroke-linecap: round; }
      #draw-path { stroke: var(--accent, #6ef2be); stroke-width: 14; }
      .tiles { position: absolute; display: none; grid-template-columns: repeat(3, 130px); gap: 18px; }
      .tiles.is-visible { display: grid; }
      .tile { width: 130px; height: 130px; border-radius: 28px; background: linear-gradient(145deg, var(--accent, #6ef2be), #5f7cff); }
      .tiles.is-stacked { grid-template-columns: 130px; }
      .tiles.is-stacked .tile { grid-row: 1; grid-column: 1; }
      #scroll-viewport { position: absolute; inset: 70px; overflow: auto; border-radius: 30px; scrollbar-width: none; }
      #smooth-content, .scroll-content { display: grid; gap: 24px; min-height: 1100px; padding: 40px; align-content: start; }
      .feature-card { min-height: 190px; padding: 34px; border: 1px solid rgba(255,255,255,.13); border-radius: 28px; background: rgba(255,255,255,.06); font-size: 34px; font-weight: 700; }
      canvas { position: absolute; display: none; width: calc(100% - 80px); height: calc(100% - 80px); }
      canvas.is-visible { display: block; }
      #tools { position: absolute; inset: auto 24px 24px; z-index: 8; }
    </style>
  </head>
  <body>
    <main class="stage">
      <section>
        <div class="eyebrow">GSAP ${GSAP_OFFICIAL_VERSION} · ${capability.group}</div>
        <h1 id="headline">${title}</h1>
        <p>${capability.role === "tool" ? "An official GSAP workflow tool presented as an inspectable catalog capability." : "An official GSAP capability adapted into the iPolloWork variable and seek contract."}</p>
        <div class="meta">${capability.kind === "ease" ? "Ease extension" : capability.role === "tool" ? "Workflow tool" : "Plugin effect"}</div>
      </section>
      <section id="demo-surface">
        <div id="smooth-wrapper">
          <div id="scroll-viewport">
            <div id="smooth-content" class="scroll-content">
              <article class="feature-card">Discover</article>
              <article class="feature-card">Compose</article>
              <article class="feature-card">Deliver</article>
            </div>
          </div>
        </div>
        <svg id="motion-svg" viewBox="0 0 800 520">
          <path id="motion-path" d="M70 380 C180 80 610 70 730 330 C620 500 230 480 70 380 Z"></path>
          <path id="draw-path" d="M90 350 C220 110 530 80 710 300 C590 470 270 480 90 350"></path>
        </svg>
        <div id="orb"></div>
        <div class="tiles"><div class="tile"></div><div class="tile"></div><div class="tile"></div></div>
        <canvas id="easel-canvas" width="960" height="560"></canvas>
        <canvas id="pixi-canvas" width="960" height="560"></canvas>
        <div id="tools"></div>
      </section>
    </main>
${scriptTags}
    <script>
      window.__timelines = window.__timelines || {};
      var variables = window.__hyperframes && window.__hyperframes.getVariables
        ? window.__hyperframes.getVariables()
        : {};
      var headline = typeof variables.headline === "string" ? variables.headline : "${title}";
      var backgroundColor = typeof variables.backgroundColor === "string" ? variables.backgroundColor : "#070B16";
      var accentColor = typeof variables.accentColor === "string" ? variables.accentColor : "#6EF2BE";
      var intensity = typeof variables.intensity === "number" ? variables.intensity : 1;
      var duration = typeof variables.duration === "number" ? variables.duration : 6;
      document.documentElement.style.setProperty("--background", backgroundColor);
      document.documentElement.style.setProperty("--accent", accentColor);
      document.querySelector("#headline").textContent = headline;
      gsap.set("#orb", { scale: intensity });
      var timeline = gsap.timeline({ paused: true });
${demo.setup.trimEnd()}
      window.__timelines["${itemName(capability)}"] = timeline;
      window.addEventListener("hf-seek", function (event) {
        timeline.seek(Math.max(0, Math.min(event.detail.time, duration)));
      });
      timeline.seek(0);
    </script>
  </body>
</html>
`;
}

function renderRegistryItem(capability: GsapOfficialCapability, demo: DemoDefinition): string {
  const name = itemName(capability);
  const plugins = [capability.runtimeName, ...(demo.extraPlugins ?? [])];
  const librarySection =
    capability.group === "text"
      ? "text-animation"
      : capability.group === "ui" || capability.group === "scroll"
        ? "interface-animation"
        : "background-scene";
  const item = {
    $schema: "https://hyperframes.heygen.com/schema/registry-item.json",
    name,
    version: "1.0.0",
    type: "hyperframes:block",
    kind: "effect",
    librarySection,
    title: `${capability.label} Official Demo`,
    description:
      capability.role === "tool"
        ? `Official GSAP ${capability.label} workflow tool adapted for iPolloWork.`
        : `Official GSAP ${capability.label} capability adapted as a seekable iPolloWork effect.`,
    dimensions: { width: 1920, height: 1080 },
    duration: 6,
    tags: Array.from(
      new Set(["effect", "gsap-official", capability.group, capability.kind, capability.role]),
    ),
    engine: {
      name: "gsap",
      version: GSAP_OFFICIAL_VERSION,
      seekable: true,
      plugins,
    },
    source: {
      provider: "gsap-docs",
      label: `GSAP ${GSAP_OFFICIAL_VERSION} Docs`,
      url: docsUrl(capability),
    },
    files: [
      {
        path: `${name}.html`,
        target: `compositions/${name}.html`,
        type: "hyperframes:composition",
      },
    ],
    variables: [
      {
        id: "headline",
        label: "Headline",
        type: "string",
        default: `${capability.label} Official Demo`,
        maxLength: 80,
        update: "reload",
      },
      {
        id: "backgroundColor",
        label: "Background color",
        type: "color",
        default: "#070B16",
        update: "live",
      },
      {
        id: "accentColor",
        label: "Accent color",
        type: "color",
        default: "#6EF2BE",
        update: "live",
      },
      {
        id: "intensity",
        label: "Intensity",
        type: "number",
        default: 1,
        min: 0.25,
        max: 2,
        step: 0.05,
        update: "rebuild",
      },
      {
        id: "duration",
        label: "Duration",
        type: "number",
        default: 6,
        min: 1,
        max: 20,
        step: 0.5,
        unit: "s",
        update: "rebuild",
      },
    ],
    agentPrompt: `Use the ${capability.label} official GSAP capability. Preserve its declared variables, source credit, and deterministic seek contract.`,
  };
  return `${JSON.stringify(item, null, 2)}\n`;
}

async function generatedFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const capability of GSAP_OFFICIAL_CAPABILITIES) {
    if (HAND_AUTHORED_ITEMS.has(capability.runtimeName)) continue;
    const demo = DEMOS[capability.runtimeName];
    if (!demo) throw new Error(`Missing demo definition for ${capability.runtimeName}`);
    const name = itemName(capability);
    files.set(join(blocksRoot, name, "registry-item.json"), renderRegistryItem(capability, demo));
    files.set(join(blocksRoot, name, `${name}.html`), renderHtml(capability, demo));
  }
  return files;
}

async function updateRegistryIndex(write: boolean): Promise<boolean> {
  const parsed: unknown = JSON.parse(await readFile(registryIndexPath, "utf8"));
  if (!isRegistryIndex(parsed)) throw new Error("registry/registry.json has an invalid shape");
  const existingNames = new Set(parsed.items.map((item) => item.name));
  const missing = GSAP_OFFICIAL_CAPABILITIES.map(itemName)
    .filter((name) => !existingNames.has(name))
    .map((name) => ({ name, type: "hyperframes:block" }));
  if (missing.length === 0) return true;
  if (!write) return false;
  parsed.items.push(...missing);
  await writeFile(registryIndexPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

function isRegistryIndex(value: unknown): value is {
  $schema: string;
  name: string;
  homepage: string;
  items: Array<{ name: string; type: string }>;
} {
  if (!value || typeof value !== "object") return false;
  return (
    "$schema" in value &&
    typeof value.$schema === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "homepage" in value &&
    typeof value.homepage === "string" &&
    "items" in value &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "name" in item &&
        typeof item.name === "string" &&
        "type" in item &&
        typeof item.type === "string",
    )
  );
}

async function generate(): Promise<void> {
  for (const [path, content] of await generatedFiles()) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await updateRegistryIndex(true);
  console.log(
    `Generated ${GSAP_OFFICIAL_CAPABILITIES.length - HAND_AUTHORED_ITEMS.size} capability demos; official baseline is 19 plugins + 6 eases.`,
  );
}

async function check(): Promise<void> {
  const mismatches: string[] = [];
  for (const [path, expected] of await generatedFiles()) {
    let actual = "";
    try {
      actual = await readFile(path, "utf8");
    } catch {
      mismatches.push(path);
      continue;
    }
    if (actual !== expected) mismatches.push(path);
  }
  if (!(await updateRegistryIndex(false))) mismatches.push(registryIndexPath);
  for (const capability of GSAP_OFFICIAL_CAPABILITIES) {
    const manifestPath = join(blocksRoot, itemName(capability), "registry-item.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      mismatches.push(manifestPath);
      continue;
    }
    if (!declaresCapability(parsed, capability.runtimeName)) mismatches.push(manifestPath);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `GSAP catalog is stale. Run "bun scripts/gsap-catalog.ts generate".\n${mismatches.join("\n")}`,
    );
  }
  console.log("GSAP catalog is generated and covers 19 plugins + 6 eases.");
}

function declaresCapability(value: unknown, runtimeName: string): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "effect" &&
    "engine" in value &&
    value.engine &&
    typeof value.engine === "object" &&
    "plugins" in value.engine &&
    Array.isArray(value.engine.plugins) &&
    value.engine.plugins.includes(runtimeName),
  );
}

async function checkUpstream(): Promise<boolean> {
  const response = await fetch("https://registry.npmjs.org/gsap/latest");
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!isVersionPayload(payload))
    throw new Error("npm registry response did not contain a version");
  const status =
    payload.version === GSAP_OFFICIAL_VERSION
      ? "up to date"
      : `update available: ${GSAP_OFFICIAL_VERSION} -> ${payload.version}`;
  console.log(`GSAP npm: ${status}`);
  console.log(
    `Tracked official baseline: ${GSAP_OFFICIAL_CAPABILITIES.filter((item) => item.kind === "plugin").length} plugins + ${GSAP_OFFICIAL_CAPABILITIES.filter((item) => item.kind === "ease").length} eases.`,
  );
  return payload.version === GSAP_OFFICIAL_VERSION;
}

function isVersionPayload(value: unknown): value is { version: string } {
  return Boolean(
    value && typeof value === "object" && "version" in value && typeof value.version === "string",
  );
}

const command = process.argv[2] ?? "check";
if (command === "generate") {
  await generate();
} else if (command === "check") {
  await check();
} else if (command === "upstream") {
  await checkUpstream();
} else if (command === "sync") {
  if (!(await checkUpstream())) {
    throw new Error(
      "Update GSAP_OFFICIAL_VERSION and the official capability baseline before regenerating.",
    );
  }
  await generate();
} else {
  throw new Error(`Unknown command "${command}". Use generate, check, upstream, or sync.`);
}
