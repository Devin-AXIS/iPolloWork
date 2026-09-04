import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-component-first-batch");

async function openComponentCatalog(ctx) {
  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor('document.readyState === "complete"', { label: "fresh Studio build" });
  const propertiesOpen = await ctx.eval(
    'Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))',
  );
  if (!propertiesOpen) {
    await ctx.trustedClick('button[aria-label="Properties"]');
    await ctx.waitFor('Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))', {
      label: "properties panel tabs",
    });
  }
  await ctx.trustedClick('button[aria-label="Components"]');
  await ctx.waitFor('Boolean(document.querySelector("[data-testid=\\"block-catalog-search\\"]"))', {
    label: "component catalog",
  });
}

async function hoverBlock(ctx, blockName) {
  await ctx.eval(`(() => {
    document.querySelector('[data-block-name="${blockName}"]')?.scrollIntoView({ block: 'center' });
  })()`);
  const point = await ctx.eval(`(() => {
    const card = document.querySelector('[data-block-name="${blockName}"]');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  ctx.assert(point, `${blockName} card is not available for hover.`);
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
}

async function leaveHoveredBlock(ctx) {
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
}

export default {
  id: "video-component-first-batch",
  title: "Video Studio exposes the first batch of editable visual components",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "Related component sections are consolidated",
      run: async (ctx) => {
        await ctx.prove(
          "Related text, media, and data components use clear consolidated sections",
          {
            voiceover: vo[0],
            action: async () => {
              await openComponentCatalog(ctx);
              await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              if (!select) return false;
              select.value = 'data';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`);
              await ctx.waitFor(
                'Boolean(document.querySelector("[data-block-name=\\"kpi-dashboard\\"]"))',
                { label: "data component cards" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              const options = [...(select?.options || [])].map((option) => option.textContent?.trim());
              return {
                options,
                dataCards: document.querySelectorAll('[data-testid="block-catalog-card"]').length,
                rankingCards: document.querySelectorAll('[data-block-name="ranking-list"], [data-block-name="podium-ranking"], [data-block-name="live-leaderboard"], [data-block-name="medal-table"]').length,
              };
            })()`);
              ctx.assert(
                state.options.includes("All components · 84"),
                "The component total is not 84.",
              );
              ctx.assert(
                state.options.includes("Text & Labels · 4"),
                "Text section count is missing.",
              );
              ctx.assert(
                state.options.includes("Media & UI · 5"),
                "Media section count is missing.",
              );
              ctx.assert(
                state.options.includes("Data & Charts · 15"),
                "Data section count is missing.",
              );
              ctx.assert(
                state.dataCards === 15,
                "The data section does not contain all fifteen components.",
              );
              ctx.assert(state.rankingCards === 4, "The ranking component set is incomplete.");
            },
            screenshot: {
              name: "first-batch-sections",
              fromSurface: false,
              requireText: ["Data & Charts · 15", "Animated Bar Chart", "Bar Chart Race"],
            },
          },
        );
      },
    },
    {
      name: "Ranking components preview their real motion on hover",
      run: async (ctx) => {
        await ctx.prove("Every ranking card previews its real composition on hover", {
          voiceover: vo[1],
          action: async () => {
            await hoverBlock(ctx, "podium-ranking");
            await ctx.waitFor(
              `Boolean(document.querySelector('[data-block-name="podium-ranking"] iframe[src*="autoplay=1"].opacity-100'))`,
              { timeoutMs: 20_000, label: "podium ranking hover preview" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              previews: document.querySelectorAll('iframe[src*="autoplay=1"]').length,
              source: document.querySelector('[data-block-name="podium-ranking"] iframe[src*="autoplay=1"]')?.getAttribute('src'),
              liveLeaderboard: Boolean(document.querySelector('[data-block-name="live-leaderboard"]')),
              medalTable: Boolean(document.querySelector('[data-block-name="medal-table"]')),
            }))()`);
            ctx.assert(state.previews === 1, "Hover should activate exactly one preview.");
            ctx.assert(
              state.source?.includes("/podium-ranking/preview"),
              "Podium Ranking is not using its real registry composition.",
            );
            ctx.assert(state.liveLeaderboard, "Live Leaderboard is missing.");
            ctx.assert(state.medalTable, "Medal Table is missing.");
          },
          screenshot: {
            name: "ranking-component-hover-preview",
            fromSurface: false,
            requireText: ["Podium Ranking", "Live Leaderboard", "Medal Table"],
          },
        });
      },
    },
    {
      name: "Map components preview their real motion on hover",
      run: async (ctx) => {
        await ctx.prove("The expanded map set uses the same live hover preview", {
          voiceover: vo[2],
          action: async () => {
            await leaveHoveredBlock(ctx);
            await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              if (!select) return false;
              select.value = 'maps';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-block-name=\\"metro-network-map\\"]"))',
              { label: "expanded map component cards" },
            );
            await hoverBlock(ctx, "china-map");
            await ctx.waitFor(
              `Boolean(document.querySelector('[data-block-name="china-map"] iframe[src*="autoplay=1"].opacity-100'))`,
              { timeoutMs: 20_000, label: "China map hover preview" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              cards: document.querySelectorAll('[data-testid="block-catalog-card"]').length,
              previews: document.querySelectorAll('iframe[src*="autoplay=1"]').length,
              source: document.querySelector('[data-block-name="china-map"] iframe[src*="autoplay=1"]')?.getAttribute('src'),
              locationPulse: Boolean(document.querySelector('[data-block-name="location-pulse-map"]')),
              territoryHeat: Boolean(document.querySelector('[data-block-name="territory-heat-map"]')),
              chinaMap: Boolean(document.querySelector('[data-block-name="china-map"]')),
              worldMap: Boolean(document.querySelector('[data-block-name="world-map"]')),
            }))()`);
            ctx.assert(state.cards === 12, `Expected twelve maps, received ${state.cards}.`);
            ctx.assert(state.previews === 1, "Map hover should activate exactly one preview.");
            ctx.assert(
              state.source?.includes("/china-map/preview"),
              "China Map is not using its real registry composition.",
            );
            ctx.assert(state.locationPulse, "Location Pulse Map is missing.");
            ctx.assert(state.territoryHeat, "Territory Heat Map is missing.");
            ctx.assert(state.chinaMap, "China Map is missing.");
            ctx.assert(state.worldMap, "World Map is missing.");
          },
          screenshot: {
            name: "map-component-hover-preview",
            fromSurface: false,
            requireText: ["China Map", "World Map", "Metro Network Map", "Territory Heat Map"],
          },
        });
      },
    },
    {
      name: "The China map exposes editable properties and inherits the video theme",
      run: async (ctx) => {
        await ctx.prove("China Map inserts with editable regional data and an explicit inherited-theme contract", {
          voiceover: vo[3],
          action: async () => {
            await leaveHoveredBlock(ctx);
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-block-name=\\"china-map\\"]"))',
              { label: "China Map card" },
            );
            await ctx.trustedClick('[data-block-name="china-map"] button');
            await ctx.waitFor(
              'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"]"))',
              { timeoutMs: 20_000, label: "China Map properties" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              contract: document.querySelector('[data-component-data-contract]')?.getAttribute('data-component-data-contract'),
              rows: document.querySelectorAll('[data-component-data-row]').length,
              timeline: Boolean(document.querySelector('[aria-label="Select China Map"]')),
              text: document.body.innerText,
            }))()`);
            ctx.assert(
              state.contract === "region-value",
              "The China Map structured data contract is missing.",
            );
            ctx.assert(state.rows === 10, `Expected ten province rows, received ${state.rows}.`);
            ctx.assert(state.timeline, "The China Map clip was not inserted on the timeline.");
            ctx.assert(
              state.text.includes("Component variables"),
              "The component variable panel is missing.",
            );
            const source = await ctx.eval(
              `fetch('/api/projects/' + location.hash.match(/#?project\\/([^?]+)/)?.[1] + '/files/index.html').then((response) => response.json()).then((data) => data.content)`,
              { awaitPromise: true },
            );
            ctx.assert(
              source.includes('data-composition-src="compositions/china-map.html"') &&
                source.includes('data-ipw-theme-mode="inherit"'),
              "The inserted China Map is not explicitly linked to the video theme.",
            );
          },
          screenshot: {
            name: "china-map-properties",
            fromSurface: false,
            requireText: ["China Map", "Component variables", "Data overrides", "Follow theme", "Highlight"],
          },
        });
      },
    },
  ],
};
