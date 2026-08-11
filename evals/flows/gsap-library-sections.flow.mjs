import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("gsap-library-sections");
const projectId = "ipw-gsap-studio-proof";
const proofDir = join(tmpdir(), projectId);
const proofSource = join(proofDir, "index.html");
const registrySource = join(
  process.cwd(),
  "vendor",
  "hyperframes",
  "registry",
  "blocks",
  "opening-editorial-rise",
  "opening-editorial-rise.html",
);
const studioUrl = `http://localhost:5191/#project/${projectId}?v=1&t=2&tab=catalog&rc=0`;
const categorySections = [
  "opening-animation",
  "ending-animation",
  "transition-animation",
  "caption-animation",
];
const screenshotTargets = {
  rejectText: ["Console errors in preview", "composition script error", "Something went wrong"],
};

async function waitForPaint(ctx) {
  await ctx.eval(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    { awaitPromise: true },
  );
}

async function waitForSourceIncludes(fragment, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await readFile(proofSource, "utf8");
    if (source.includes(fragment)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for source fragment: ${fragment}`);
}

async function proveFrame(ctx, name, options) {
  const { screenshotName, ...proof } = options;
  await ctx.prove(name, proof);
  await waitForPaint(ctx);
  await ctx.screenshot(screenshotName, {
    ...screenshotTargets,
    claim: proof.claim ?? name,
  });
}

async function openAnimationCatalog(ctx) {
  const clicked = await ctx.eval(`(() => {
    const labels = new Set(["Animation", "\u52a8\u753b"]);
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      labels.has(candidate.getAttribute("aria-label") || candidate.innerText.trim())
    );
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, "The Animation inspector tab is missing.");
  await ctx.waitFor(
    `document.querySelectorAll('[data-testid="block-catalog-card"]').length === 16`,
    { timeoutMs: 20_000, label: "four-category animation catalog" },
  );
}

async function selectTitleFromCanvas(ctx) {
  const point = await ctx.eval(`(() => {
    const frame = document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe");
    const title = frame?.contentDocument?.querySelector(".title-one");
    if (!frame || !title) return null;
    const frameRect = frame.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const scaleX = frameRect.width / 1920;
    const scaleY = frameRect.height / 1080;
    return {
      x: frameRect.left + (titleRect.left + Math.min(200, titleRect.width / 2)) * scaleX,
      y: frameRect.top + (titleRect.top + titleRect.height / 2) * scaleY,
    };
  })()`);
  ctx.assert(point, "The editable title could not be located in the composition canvas.");
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await ctx.eval(`new Promise((resolve) => setTimeout(resolve, 220))`, { awaitPromise: true });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await ctx.waitFor(`location.hash.includes("selSelector=.title-one")`, {
    timeoutMs: 20_000,
    label: "canvas title selection",
  });
}

function playerExpression(innerExpression) {
  return `(() => {
    const frame = document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe");
    const doc = frame?.contentDocument;
    if (!doc) return null;
    return ${innerExpression};
  })()`;
}

export default {
  id: "gsap-library-sections",
  title: "Four attachable GSAP animation categories stay source-editable",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: { urlIncludes: `/#project/${projectId}` },
  precondition: async (ctx) => {
    await mkdir(proofDir, { recursive: true });
    await writeFile(proofSource, await readFile(registrySource, "utf8"));
    await ctx.eval(`location.href = ${JSON.stringify(studioUrl)}`);
    await ctx.waitFor(
      `(() => {
        const player = document.querySelector("hyperframes-player");
        const frame = player?.shadowRoot?.querySelector("iframe");
        return player?.ready === true
          && frame?.contentDocument?.querySelector(".title-one[data-hf-id]")
          && document.querySelectorAll('[data-testid="block-catalog-card"]').length === 16;
      })()`,
      { timeoutMs: 60_000, label: "proof composition and animation catalog" },
    );
    await ctx.eval(`new Promise((resolve) => setTimeout(resolve, 500))`, { awaitPromise: true });
    return null;
  },
  steps: [
    {
      name: "Four focused animation categories",
      run: async (ctx) => {
        await proveFrame(
          ctx,
          "The animation library contains only four focused categories with four presets each.",
          {
            voiceover: vo[0],
            action: async () => {
              await openAnimationCatalog(ctx);
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
              total: document.querySelectorAll('[data-testid="block-catalog-card"]').length,
              counts: ${JSON.stringify(categorySections)}.map((section) =>
                document.querySelector('[data-testid="catalog-section-' + section + '"]')
                  ?.querySelectorAll('[data-testid="block-catalog-card"]').length ?? -1
              ),
              legacy: ["text-animation", "interface-animation", "transition-scene", "background-scene"]
                .some((section) => document.querySelector('[data-testid="catalog-section-' + section + '"]')),
              body: document.body.innerText,
            }))()`);
              ctx.assert(state.total === 16, `Expected 16 presets, received ${state.total}.`);
              ctx.assert(
                state.counts.every((count) => count === 4),
                `Expected four presets in every category, received ${state.counts.join(", ")}.`,
              );
              ctx.assert(!state.legacy, "A legacy animation category is still visible.");
              for (const label of [
                "Opening animations",
                "Ending animations",
                "Transition animations",
                "Caption animations",
              ]) {
                ctx.assert(
                  state.body.includes(label),
                  `${label} is missing from the catalog navigation.`,
                );
              }
            },
            screenshotName: "four-animation-categories",
          },
        );
      },
    },
    {
      name: "Canvas selection enables compatible presets",
      run: async (ctx) => {
        await proveFrame(
          ctx,
          "Selecting a text element on the canvas enables compatible presets without losing the selection.",
          {
            voiceover: vo[1],
            action: async () => {
              await selectTitleFromCanvas(ctx);
              await openAnimationCatalog(ctx);
              await ctx.waitFor(
                `document.querySelector('[data-testid="motion-preset-selection-status"]')
                ?.innerText.includes("Selected: Title One")`,
                { timeoutMs: 20_000, label: "selected text compatibility status" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
              status: document.querySelector('[data-testid="motion-preset-selection-status"]')?.innerText,
              enabled: [...document.querySelectorAll('[data-testid="apply-motion-preset"]')]
                .filter((button) => !button.disabled).length,
              selected: [...document.querySelectorAll("button")]
                .find((button) => button.getAttribute("aria-label") === "Select Title One")
                ?.getAttribute("aria-pressed"),
            }))()`);
              ctx.assert(
                state.status?.includes("Compatible motion can be applied"),
                `Unexpected compatibility status: ${state.status}.`,
              );
              ctx.assert(
                state.enabled === 16,
                `Expected 16 enabled Apply buttons, received ${state.enabled}.`,
              );
              ctx.assert(
                state.selected === "true",
                "The title selection was lost after opening the catalog.",
              );
            },
            screenshotName: "selected-text-enables-animation-presets",
          },
        );
      },
    },
    {
      name: "Attach a caption preset and return to Properties",
      run: async (ctx) => {
        await proveFrame(
          ctx,
          "Caption Phrase Lift attaches to the selected text and immediately appears as an editable GSAP animation.",
          {
            voiceover: vo[2],
            action: async () => {
              const clicked = await ctx.eval(`(() => {
              const card = document.querySelector(
                '[data-testid="block-catalog-card"][data-block-name="caption-phrase-lift"]'
              );
              const button = card?.querySelector('[data-testid="apply-motion-preset"]');
              button?.click();
              return Boolean(button);
            })()`);
              ctx.assert(clicked, "Caption Phrase Lift could not be applied.");
              await ctx.waitFor(
                playerExpression(
                  `doc.querySelector(".title-one")?.getAttribute("data-ipw-animation-reference") === "caption-phrase-lift"`,
                ),
                { timeoutMs: 30_000, label: "caption preset marker in live composition" },
              );
              await ctx.waitFor(
                `[...document.querySelectorAll('input[type="text"]')]
                .some((input) => input.value === "0.72 s")`,
                { timeoutMs: 20_000, label: "editable applied duration" },
              );
            },
            assert: async () => {
              const marker = await ctx.eval(
                playerExpression(
                  `doc.querySelector(".title-one")?.getAttribute("data-ipw-animation-reference")`,
                ),
              );
              const state = await ctx.eval(`(() => ({
              selected: location.hash.includes("selSelector=.title-one"),
              animationCount: [...document.querySelectorAll("button")]
                .filter((button) => button.getAttribute("aria-label")?.startsWith("Remove animation ")).length,
              durationValues: [...document.querySelectorAll('input[type="text"]')]
                .map((input) => input.value).filter((value) => / s$/.test(value)),
            }))()`);
              ctx.assert(marker === "caption-phrase-lift", `Unexpected applied marker: ${marker}.`);
              ctx.assert(state.selected, "The selected text was lost after applying the preset.");
              ctx.assert(
                state.animationCount === 2,
                `Expected the original and applied animations, received ${state.animationCount}.`,
              );
              ctx.assert(
                state.durationValues.at(-1) === "0.72 s",
                `Unexpected applied duration: ${state.durationValues.at(-1)}.`,
              );
            },
            screenshotName: "caption-preset-in-properties",
          },
        );
      },
    },
    {
      name: "Visual duration edit persists to GSAP source",
      run: async (ctx) => {
        await proveFrame(
          ctx,
          "Editing the applied duration in Properties persists the change to GSAP source while keeping the element selected.",
          {
            voiceover: vo[3],
            action: async () => {
              const edited = await ctx.eval(`(() => {
              const durationInputs = [...document.querySelectorAll('input[type="text"]')]
                .filter((input) => / s$/.test(input.value));
              const input = durationInputs.at(-1);
              if (!input) return false;
              input.focus();
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, "1.20 s");
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
              input.blur();
              return true;
            })()`);
              ctx.assert(edited, "The applied duration input is missing.");
              await ctx.waitFor(
                `[...document.querySelectorAll('input[type="text"]')]
                .filter((input) => / s$/.test(input.value)).at(-1)?.value === "1.20 s"`,
                { timeoutMs: 20_000, label: "updated visual duration" },
              );
              await waitForSourceIncludes("duration: 1.2");
            },
            assert: async () => {
              const source = await readFile(proofSource, "utf8");
              const state = await ctx.eval(`(() => ({
              selected: location.hash.includes("selSelector=.title-one"),
              value: [...document.querySelectorAll('input[type="text"]')]
                .filter((input) => / s$/.test(input.value)).at(-1)?.value,
            }))()`);
              ctx.assert(
                state.value === "1.20 s",
                `Expected 1.20 s in Properties, received ${state.value}.`,
              );
              ctx.assert(state.selected, "The title selection was lost after editing duration.");
              ctx.assert(
                source.includes('data-ipw-animation-reference="caption-phrase-lift"'),
                "The animation reference was not persisted to source.",
              );
              ctx.assert(
                source.includes("duration: 1.2"),
                "The edited GSAP duration was not persisted to source.",
              );
            },
            screenshotName: "edited-duration-persists-to-gsap",
          },
        );
      },
    },
  ],
};
