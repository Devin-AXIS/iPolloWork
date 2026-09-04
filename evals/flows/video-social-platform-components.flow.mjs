import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-social-platform-components");

async function openComponentCatalog(ctx) {
  const componentsAvailable = await ctx.eval(
    'Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))',
  );
  if (!componentsAvailable) {
    await ctx.clickText("Properties", { selector: 'button[aria-label="Properties"]' });
  }
  await ctx.clickText("Components", { selector: 'button[aria-label="Components"]' });
  await ctx.waitFor('Boolean(document.querySelector("[data-testid=\\"block-catalog-search\\"]"))', {
    label: "component catalog",
  });
}

export default {
  id: "video-social-platform-components",
  title: "Video Studio exposes editable social components for four major platforms",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "The Social category contains the full platform collection",
      run: async (ctx) => {
        let categoryOptions = [];
        await ctx.prove("The Social category contains nineteen reusable components", {
          voiceover: vo[0],
          action: async () => {
            await openComponentCatalog(ctx);
            await ctx.fill('[data-testid="block-catalog-search"]', "");
            await ctx.waitFor(
              `[...document.querySelectorAll('select[aria-label="Component category"] option')].some((option) => option.textContent?.trim() === "All components · 84")`,
              { label: "unfiltered component totals" },
            );
            await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              if (!select) return false;
              select.value = 'social';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`);
            categoryOptions = await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              return [...(select?.options || [])].map((option) => option.textContent?.trim());
            })()`);
            await ctx.fill('[data-testid="block-catalog-search"]', "instagram");
            await ctx.waitFor(
              'document.querySelectorAll("[data-block-name^=\\"instagram-\\"]").length === 4',
              { label: "Instagram component cards" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              return {
                cards: [...document.querySelectorAll("[data-block-name]")].map((card) => card.getAttribute("data-block-name")),
              };
            })()`);
            ctx.assert(
              categoryOptions.includes("All components · 84"),
              "The component total is not 84.",
            );
            ctx.assert(
              categoryOptions.includes("Social Media · 19"),
              "The Social Media category total is not 19.",
            );
            for (const name of [
              "instagram-post",
              "instagram-story",
              "instagram-reel",
              "instagram-carousel",
            ]) {
              ctx.assert(state.cards.includes(name), `Missing social component ${name}.`);
            }
          },
          screenshot: {
            name: "social-instagram-components",
            fromSurface: false,
            requireText: [
              "Social Media · 4",
              "Instagram Post",
              "Instagram Story",
              "Instagram Reel",
              "Instagram Carousel",
            ],
          },
        });
      },
    },
    {
      name: "A structured social component exposes editable rows",
      run: async (ctx) => {
        await ctx.prove("X Poll inserts with editable structured data and variables", {
          voiceover: vo[1],
          action: async () => {
            await ctx.fill('[data-testid="block-catalog-search"]', "x poll");
            await ctx.waitFor('Boolean(document.querySelector("[data-block-name=\\"x-poll\\"]"))', {
              label: "X Poll card",
            });
            await ctx.clickText("Insert component", {
              selector: '[data-block-name="x-poll"] button',
            });
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"]"))',
              { timeoutMs: 20_000, label: "X Poll properties" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              contract: document.querySelector("[data-component-data-contract]")?.getAttribute("data-component-data-contract"),
              rows: document.querySelectorAll("[data-component-data-row]").length,
              timeline: Boolean(document.querySelector('[aria-label="Select X Poll"]')),
              text: document.body.innerText,
            }))()`);
            ctx.assert(state.contract === "category-value", "The X Poll data contract is missing.");
            ctx.assert(state.rows === 4, `Expected four poll rows, received ${state.rows}.`);
            ctx.assert(state.timeline, "X Poll was not inserted on the timeline.");
            ctx.assert(
              state.text.includes("Component variables"),
              "The component variable panel is missing.",
            );
          },
          screenshot: {
            name: "x-poll-properties",
            fromSurface: false,
            requireText: ["X Poll", "Component variables", "Data overrides", "Leading Choice"],
          },
        });
      },
    },
  ],
};
