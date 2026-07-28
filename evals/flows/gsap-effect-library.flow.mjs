import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("gsap-effect-library");

const LIBRARY_LABELS = ["GSAP animation and effect library", "GSAP 动画特效库"];
const EFFECT_LIBRARY_LABELS = ["GSAP effect library", "GSAP 特效库"];
const VIDEO_LABELS = ["Video", "视频制作"];

function includesOne(value, labels) {
  return labels.some((label) => value.includes(label));
}

async function clickButton(ctx, labels, parentText = "") {
  const clicked = await ctx.eval(`(() => {
    const labels = ${JSON.stringify(labels)};
    const parentText = ${JSON.stringify(parentText)};
    const button = [...document.querySelectorAll("button")].find((candidate) => {
      const text = candidate.innerText.trim();
      const labelMatches = labels.some((label) => text === label || text.includes(label));
      return labelMatches && (!parentText || candidate.parentElement?.innerText.includes(parentText));
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);
  ctx.assert(clicked === true, `Could not find button: ${labels.join(" / ")}`);
}

async function setInputValue(ctx, label, value) {
  const updated = await ctx.eval(`(() => {
    const input = document.querySelector('[role="dialog"] [aria-label=${JSON.stringify(label)}]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  ctx.assert(updated === true, `Could not update ${label}.`);
}

async function openConfiguration(ctx, title) {
  const opened = await ctx.eval(`(() => {
    const selectButton = [...document.querySelectorAll("button")]
      .find((button) => button.innerText.includes(${JSON.stringify(title)}));
    const configureButton = [...(selectButton?.parentElement?.querySelectorAll("button") ?? [])]
      .find((button) => button !== selectButton);
    if (!configureButton) return false;
    configureButton.click();
    return true;
  })()`);
  ctx.assert(opened === true, `Could not configure ${title}.`);
  await ctx.waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, {
    timeoutMs: 15_000,
    label: `${title} parameter dialog`,
  });
}

async function closeDialog(ctx) {
  if (!await ctx.eval("Boolean(document.querySelector('[role=\"dialog\"]'))")) return;
  await ctx.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await ctx.waitFor("!document.querySelector('[role=\"dialog\"]')", {
    timeoutMs: 15_000,
    label: "parameter dialog closed",
  });
}

export default {
  id: "gsap-effect-library",
  title: "Browse, filter, configure, and add the bundled GSAP catalog",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl) && Boolean(window.__ipollowork)", {
      timeoutMs: 60_000,
      label: "iPolloWork control and inspector APIs",
    });
    return null;
  },
  steps: [
    {
      name: "GSAP libraries and catalog status are visible",
      run: async (ctx) => {
        await ctx.prove("The video workspace shows separate GSAP animation and effect libraries with complete local counts", {
          voiceover: vo[0],
          action: async () => {
            await ctx.ensureLightMode();
            await closeDialog(ctx);
            await ctx.waitFor(
              `window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`,
              { timeoutMs: 60_000, label: "create task action" },
            );
            const previousRoute = await ctx.eval("window.__ipolloworkControl.snapshot().route");
            await ctx.control("session.create_task");
            await ctx.waitFor(
              `window.__ipolloworkControl.snapshot().route !== ${JSON.stringify(previousRoute)}
                && window.__ipolloworkControl.snapshot().route.includes("/session/")`,
              { timeoutMs: 60_000, label: "new task route" },
            );
            await ctx.waitFor(
              `[...document.querySelectorAll("button")].some((button) =>
                ["Video", "视频制作"].includes(button.innerText.trim())
              )`,
              { timeoutMs: 60_000, label: "video mode button" },
            );
            await clickButton(ctx, VIDEO_LABELS);
            await ctx.waitFor(
              `document.body.innerText.includes("GSAP effect library") || document.body.innerText.includes("GSAP 特效库")`,
              { timeoutMs: 60_000, label: "GSAP effect library" },
            );
            await ctx.waitFor(
              `document.querySelector('section[aria-label*="GSAP"]')?.innerText.includes("129")`,
              { timeoutMs: 60_000, label: "complete GSAP catalog counts" },
            );
            await ctx.eval(`document.querySelector('section[aria-label*="GSAP"]')?.scrollIntoView({ block: "center" })`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const section = document.querySelector('section[aria-label*="GSAP"]');
              return { label: section?.getAttribute("aria-label") ?? "", text: section?.innerText ?? "" };
            })()`);
            ctx.assert(includesOne(state.label, LIBRARY_LABELS), `Unexpected library label: ${state.label}`);
            ctx.assert(state.text.includes("129"), "The complete 129-item GSAP count is missing.");
            ctx.assert(state.text.includes("69") && state.text.includes("60"), "Animation/effect totals are missing.");
            ctx.assert(
              state.text.includes("Local catalog synced") || state.text.includes("本地已同步"),
              "Local catalog sync status is missing.",
            );
          },
          screenshot: {
            name: "gsap-library-counts",
            requireText: ["GSAP", "129", "69", "60"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Effects are grouped with dynamic previews",
      run: async (ctx) => {
        await ctx.prove("The effect library exposes scroll, SVG, text, transition, and visual-effect categories with preview cards", {
          voiceover: vo[1],
          action: async () => {
            await clickButton(ctx, ["Effects 60", "特效库 60"]);
            await ctx.eval(`document.querySelector('section[aria-label*="GSAP"]')?.scrollIntoView({ block: "center" })`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const section = document.querySelector('section[aria-label*="GSAP"]');
              const text = section?.innerText ?? "";
              return {
                text,
                cardCount: section?.querySelectorAll('button[aria-pressed]').length ?? 0,
                previewCount: section?.querySelectorAll("video, img").length ?? 0,
              };
            })()`);
            for (const labels of [["Scroll", "滚动"], ["SVG"], ["Text effects", "文字特效"], ["Transitions", "转场"], ["VFX", "视觉特效"]]) {
              ctx.assert(includesOne(state.text, labels), `Missing category: ${labels.join(" / ")}`);
            }
            ctx.assert(state.cardCount === 60, `Expected 60 effect cards, found ${state.cardCount}.`);
            ctx.assert(state.previewCount > 0, "Effect cards do not expose dynamic preview media.");
          },
          screenshot: {
            name: "effect-categories-and-previews",
            requireText: ["Scroll", "SVG", "VFX"],
          },
        });
      },
    },
    {
      name: "Plugin filtering exposes dependency metadata",
      run: async (ctx) => {
        await ctx.prove("Filtering by SplitText leaves its matching effect and exposes version, source, dependency, and bundled status", {
          voiceover: vo[2],
          action: async () => {
            await clickButton(ctx, ["SplitText"]);
            await ctx.waitForText("SplitText Reveal", { timeoutMs: 15_000 });
            await openConfiguration(ctx, "SplitText Reveal");
          },
          assert: async () => {
            const dialog = await ctx.eval(`document.querySelector('[role="dialog"]')?.innerText ?? ""`);
            ctx.assert(dialog.includes("SplitText Reveal"), "Filtered SplitText effect is missing.");
            ctx.assert(dialog.includes("GSAP 3.15.0"), "GSAP version metadata is missing.");
            ctx.assert(dialog.includes("SplitText"), "Plugin dependency metadata is missing.");
            ctx.assert(dialog.includes("HyperFrames"), "Catalog source metadata is missing.");
            ctx.assert(dialog.includes("Bundled") || dialog.includes("已内置"), "Bundled state is missing.");
          },
          screenshot: {
            name: "splittext-plugin-metadata",
            requireText: ["SplitText Reveal", "GSAP 3.15.0", "SplitText", "HyperFrames"],
          },
        });
      },
    },
    {
      name: "Effect parameters update the preview",
      run: async (ctx) => {
        await ctx.prove("A GSAP effect exposes safe color, speed, duration, intensity, and easing controls with immediate preview feedback", {
          voiceover: vo[3],
          action: async () => {
            await closeDialog(ctx);
            await ctx.eval(`(() => {
              const splitText = [...document.querySelectorAll("button")]
                .find((button) => button.innerText.includes("SplitText Reveal"));
              if (splitText?.getAttribute("aria-pressed") === "true") splitText.click();
            })()`);
            await clickButton(ctx, ["All plugins", "全部插件"]);
            await openConfiguration(ctx, "Liquid Background");
            await setInputValue(ctx, "Background color", "#123456");
            await setInputValue(ctx, "Wave intensity", "2.5");
            await setInputValue(ctx, "Animation speed", "1.4");
            await setInputValue(ctx, "Duration", "18");
            await ctx.waitFor(
              `document.querySelector('[role="dialog"] [aria-label="Duration"]')?.value === "18"`,
              { timeoutMs: 10_000, label: "updated duration" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const value = (label) => dialog?.querySelector('[aria-label="' + label + '"]')?.value;
              return {
                text: dialog?.innerText ?? "",
                background: value("Background color"),
                intensity: value("Wave intensity"),
                speed: value("Animation speed"),
                duration: value("Duration"),
                previewBackground: dialog?.querySelector("video")?.parentElement?.style.backgroundColor ?? "",
              };
            })()`);
            ctx.assert(state.background === "#123456", "Color value was not applied.");
            ctx.assert(state.intensity === "2.5", "Intensity value was not applied.");
            ctx.assert(state.speed === "1.4", "Speed value was not applied.");
            ctx.assert(state.duration === "18", "Duration value was not applied.");
            ctx.assert(state.previewBackground === "rgb(18, 52, 86)", "Preview did not reflect the color immediately.");
            ctx.assert(state.text.includes("Entrance easing"), "Easing control is missing.");
          },
          screenshot: {
            name: "effect-parameter-preview",
            requireText: ["Liquid Background", "#123456", "2.5", "18s", "Entrance easing"],
          },
        });
      },
    },
    {
      name: "Configured effect enters the current work",
      run: async (ctx) => {
        await ctx.prove("Adding the configured effect preserves its parameters and identifies the bundled local catalog state", {
          voiceover: vo[4],
          action: async () => {
            await closeDialog(ctx);
            const selected = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll("button")]
                .find((candidate) => candidate.innerText.includes("Liquid Background"));
              if (!button) return false;
              if (button.getAttribute("aria-pressed") !== "true") button.click();
              return true;
            })()`);
            ctx.assert(selected === true, "Could not add Liquid Background to the current work.");
            await ctx.waitFor(
              `[...document.querySelectorAll("button")].some((button) =>
                button.innerText.includes("Liquid Background") && button.getAttribute("aria-pressed") === "true"
              )`,
              { timeoutMs: 15_000, label: "selected Liquid Background" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const section = document.querySelector('section[aria-label*="GSAP"]');
              const cardButton = [...(section?.querySelectorAll("button") ?? [])]
                .find((button) => button.innerText.includes("Liquid Background"));
              return {
                selected: cardButton?.getAttribute("aria-pressed"),
                sectionText: section?.innerText ?? "",
                cardText: cardButton?.innerText ?? "",
              };
            })()`);
            ctx.assert(state.selected === "true", "Configured effect is not selected in the current work.");
            ctx.assert(state.sectionText.includes("Selected 1") || state.sectionText.includes("已选择 1"), "Selected count is not visible.");
            ctx.assert(state.sectionText.includes("Local catalog synced") || state.sectionText.includes("本地已同步"), "Catalog sync state is missing.");
            ctx.assert(state.cardText.includes("Bundled") || state.cardText.includes("已内置"), "Offline bundled state is missing.");
          },
          screenshot: {
            name: "configured-effect-added",
            requireText: ["Liquid Background", "GSAP"],
          },
        });
      },
    },
  ],
};
