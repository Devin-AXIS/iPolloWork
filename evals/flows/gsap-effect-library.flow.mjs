import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("gsap-effect-library");
const STUDIO_SCREENSHOT_TARGETS = {
  targetUrlIncludes: "app-dist/index.html",
  textTargetUrlIncludes: "#project/",
  rejectText: ["Console errors in preview", "composition script error", "Something went wrong"],
};

async function clickTextButton(ctx, text) {
  await ctx.waitFor(
    `(() => {
      const text = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.innerText.trim() === text);
      if (!button) return false;
      button.click();
      return true;
    })()`,
    { timeoutMs: 20_000, label: `button ${JSON.stringify(text)}` },
  );
}

export default {
  id: "gsap-effect-library",
  title: "Verify the packaged Studio animation and GSAP effect libraries",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "#project/" },
  preserveTheme: true,
  precondition: async (ctx) => {
    if (!await ctx.eval(`document.body.innerText.includes("动画库")`)) {
      await clickTextButton(ctx, "设计");
    }
    await ctx.waitFor(
      `document.body.innerText.includes("动画库") && document.body.innerText.includes("特效库")`,
      { timeoutMs: 60_000, label: "Studio animation and effect tabs" },
    );
    return null;
  },
  steps: [
    {
      name: "Animation and effect libraries are separate Studio tabs",
      run: async (ctx) => {
        await ctx.prove("The real packaged Studio places 动画库 and 特效库 side by side.", {
          voiceover: vo[0],
          action: async () => {
            await clickTextButton(ctx, "动画库");
            await ctx.waitForText("iPolloWork 动画预设", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const buttons = [...document.querySelectorAll("button")].map((button) => button.innerText.trim());
              return { buttons, text: document.body.innerText };
            })()`);
            ctx.assert(state.buttons.includes("动画库"), "动画库 tab is missing.");
            ctx.assert(state.buttons.includes("特效库"), "特效库 tab is missing.");
            ctx.assert(state.text.includes("iPolloWork 动画预设"), "Animation preset summary is missing.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "studio-animation-effect-tabs",
            requireText: ["动画库", "特效库", "iPolloWork 动画预设"],
          },
        });
      },
    },
    {
      name: "Official GSAP coverage is complete and independently counted",
      run: async (ctx) => {
        await ctx.prove("The effect library reports 82 local presets and official coverage of 19 plugins plus 6 eases.", {
          voiceover: vo[1],
          action: async () => {
            await clickTextButton(ctx, "特效库");
            await ctx.waitFor(
              `document.body.innerText.includes("iPolloWork 特效预设")
                && document.body.innerText.includes("82")
                && document.body.innerText.includes("插件 19/19")
                && document.body.innerText.includes("缓动 6/6")`,
              { timeoutMs: 20_000, label: "complete official GSAP coverage" },
            );
          },
          assert: async () => {
            const text = await ctx.waitFor(
              `(() => {
                const text = document.body.innerText;
                return text.includes("iPolloWork 特效预设")
                  && text.includes("82")
                  && text.includes("插件 19/19")
                  && text.includes("缓动 6/6")
                  ? text
                  : false;
              })()`,
              { timeoutMs: 20_000, label: "stable GSAP coverage summary" },
            );
            ctx.assert(text.includes("iPolloWork 特效预设") && text.includes("82"), "82 local effect presets are not reported.");
            ctx.assert(text.includes("GSAP 3.15.0 官网能力"), "Official GSAP baseline label is missing.");
            ctx.assert(text.includes("插件 19/19"), "Official plugin coverage is not 19/19.");
            ctx.assert(text.includes("缓动 6/6"), "Official ease coverage is not 6/6.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "official-gsap-coverage",
            requireText: ["82", "GSAP 3.15.0", "插件 19/19", "缓动 6/6"],
          },
        });
      },
    },
    {
      name: "Official tools and ease extensions are filterable",
      run: async (ctx) => {
        await ctx.prove("Official workflow tools and ease extensions are explicit, searchable catalog capabilities.", {
          voiceover: vo[2],
          action: async () => {
            await clickTextButton(ctx, "特效库");
            await ctx.waitForText("iPolloWork 特效预设", { timeoutMs: 20_000 });
            await clickTextButton(ctx, "GSDevTools");
            await ctx.waitForText("GSDevTools Official Demo", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const gsDevToolsText = await ctx.eval("document.body.innerText");
            ctx.assert(gsDevToolsText.includes("GSDevTools Official Demo"), "GSDevTools tool entry is missing.");
            await clickTextButton(ctx, "CustomWiggle");
            await ctx.waitForText("CustomWiggle Official Demo", { timeoutMs: 20_000 });
            const customWiggleText = await ctx.eval("document.body.innerText");
            ctx.assert(customWiggleText.includes("CustomWiggle Official Demo"), "CustomWiggle ease entry is missing.");
            ctx.assert(customWiggleText.includes("GSAP Official"), "Official source badge is missing.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "official-gsap-tool-and-ease",
            requireText: ["CustomWiggle Official Demo", "GSAP Official", "CustomWiggle"],
          },
        });
      },
    },
    {
      name: "Animation catalog remains independently available",
      run: async (ctx) => {
        await ctx.prove("Switching back to 动画库 shows the independent 69-animation preset count.", {
          voiceover: vo[3],
          action: async () => {
            await clickTextButton(ctx, "动画库");
            await ctx.waitForText("iPolloWork 动画预设", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const text = await ctx.eval("document.body.innerText");
            ctx.assert(text.includes("iPolloWork 动画预设") && text.includes("69"), "69 animation presets are not reported.");
            ctx.assert(!text.includes("插件 19/19"), "GSAP effect coverage leaked into the animation library.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "independent-animation-library",
            requireText: ["动画库", "特效库", "iPolloWork 动画预设", "69"],
          },
        });
      },
    },
  ],
};
