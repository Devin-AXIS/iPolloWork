import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-component-second-batch");

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
  id: "video-component-second-batch",
  title: "Video Studio exposes the second component-library expansion",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "The consolidated component categories are available",
      run: async (ctx) => {
        await ctx.prove("The library exposes thirteen clear bilingual component categories", {
          voiceover: vo[0],
          action: async () => {
            await openComponentCatalog(ctx);
            await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              if (!select) return false;
              select.value = 'brand';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-block-name=\\"pricing-plans\\"]"))',
              { label: "brand and marketing component cards" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              return {
                options: [...(select?.options || [])].map((option) => option.textContent?.trim()),
                brandCards: document.querySelectorAll('[data-testid="block-catalog-card"]').length,
                commerceCards: document.querySelectorAll('[data-block-name="pricing-plans"], [data-block-name="offer-card"]').length,
              };
            })()`);
            ctx.assert(
              state.options.includes("All components · 84"),
              "The component total is not 84.",
            );
            ctx.assert(
              state.options.includes("Social Media · 19"),
              "Social category count is missing.",
            );
            ctx.assert(state.options.includes("Code Demos · 3"), "Code category count is missing.");
            ctx.assert(
              state.options.includes("Product Showcase · 3"),
              "Product category count is missing.",
            );
            ctx.assert(
              state.options.includes("Brand & Marketing · 5"),
              "Brand category count is missing.",
            );
            ctx.assert(state.brandCards === 5, "The brand and marketing category is incomplete.");
            ctx.assert(state.commerceCards === 2, "The migrated commerce components are missing.");
          },
          screenshot: {
            name: "second-batch-categories",
            fromSurface: false,
            requireText: [
              "Brand & Marketing · 5",
              "Brand Palette",
              "Campaign Lockup",
              "Offer Card",
              "Pricing Plans",
            ],
          },
        });
      },
    },
    {
      name: "A second-batch component exposes editable structured properties",
      run: async (ctx) => {
        await ctx.prove("Pricing Plans inserts with four editable properties", {
          voiceover: vo[1],
          action: async () => {
            await ctx.clickText("Insert component", {
              selector: '[data-block-name="pricing-plans"] button',
            });
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"]"))',
              { timeoutMs: 20_000, label: "Pricing Plans properties" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              contract: document.querySelector('[data-component-data-contract]')?.getAttribute('data-component-data-contract'),
              rows: document.querySelectorAll('[data-component-data-row]').length,
              timeline: Boolean(document.querySelector('[aria-label="Select Pricing Plans"]')),
              text: document.body.innerText,
            }))()`);
            ctx.assert(
              state.contract === "category-value",
              "The pricing data contract is missing.",
            );
            ctx.assert(state.rows === 3, `Expected three pricing rows, received ${state.rows}.`);
            ctx.assert(state.timeline, "Pricing Plans was not inserted on the timeline.");
            ctx.assert(
              state.text.includes("Component variables"),
              "The component variable panel is missing.",
            );
          },
          screenshot: {
            name: "pricing-plans-properties",
            fromSurface: false,
            requireText: [
              "Pricing Plans",
              "Component variables",
              "Data overrides",
              "Featured plan",
            ],
          },
        });
      },
    },
  ],
};
