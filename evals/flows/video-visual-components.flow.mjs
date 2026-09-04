import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-visual-components");
const TITLE_SELECTOR = '[data-variable-id="title"] input';
const UPDATED_TITLE = "Route intelligence, one reusable system";

export default {
  id: "video-visual-components",
  title: "Video Studio exposes reusable, theme-linked visual components beside Theme",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "Components are discoverable beside Theme",
      run: async (ctx) => {
        await ctx.prove("Components is a first-class Video Studio tab beside Theme", {
          voiceover: vo[0],
          action: async () => {
            const propertiesOpen = await ctx.eval(
              'Boolean(document.querySelector("button[aria-label=\\"组件\\"]"))',
            );
            if (!propertiesOpen) {
              await ctx.trustedClick('button[aria-label="属性"]');
            }
            await ctx.trustedClick('button[aria-label="组件"]');
            await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="组件分类"]');
              if (!select) return false;
              select.value = 'maps';
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(
              "Boolean(document.querySelector('[data-block-name=\"route-map\"]'))",
              {
                label: "Route Map component card",
              },
            );
            await ctx.eval(
              "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
              { awaitPromise: true },
            );
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const labels = [...document.querySelectorAll('button[aria-label]')]
                .map((button) => button.getAttribute('aria-label'));
              return {
                ordered: labels.indexOf('主题') < labels.indexOf('组件') &&
                  labels.indexOf('组件') < labels.indexOf('动画'),
                card: Boolean(document.querySelector('[data-block-name="route-map"]')),
                text: document.body.innerText,
              };
            })()`);
            ctx.assert(
              result.ordered,
              "Components is not immediately between Style and Animation.",
            );
            ctx.assert(result.card, "Route Map component card is missing.");
            ctx.assert(result.text.includes("全部组件 · 84"), "Component total is missing.");
            ctx.assert(result.text.includes("地图与路径 · 12"), "Maps category count is missing.");
          },
          screenshot: {
            name: "components-next-to-theme",
            requireText: ["组件", "全部组件 · 84", "地图与路径 · 12", "China Map", "World Map"],
          },
        });
      },
    },
    {
      name: "Adding a component opens its variable contract",
      run: async (ctx) => {
        await ctx.prove("Route Map inserts into the native timeline and opens reusable variables", {
          voiceover: vo[1],
          action: async () => {
            await ctx.trustedClick('[data-block-name="route-map"] button');
            await ctx.waitFor(
              "Boolean(document.querySelector('[data-testid=\"block-params-panel\"]'))",
              {
                timeoutMs: 20_000,
                label: "component variable panel",
              },
            );
          },
          assert: async () => {
            await ctx.expectText("组件变量");
            await ctx.expectText("跟随主题");
            await ctx.expectText("AI 可编辑区域");
            const source = await ctx.eval(
              `fetch('/api/projects/' +
              location.hash.match(/#?project\\/([^?]+)/)?.[1] +
              '/files/index.html').then((response) => response.json()).then((data) => data.content)`,
              { awaitPromise: true },
            );
            ctx.assert(
              source.includes('data-composition-src="compositions/route-map.html"'),
              "The Route Map was not inserted into the host composition.",
            );
          },
          screenshot: {
            name: "component-variable-contract",
            requireText: ["Route Map", "组件变量", "跟随主题", "AI 可编辑区域"],
          },
        });
      },
    },
    {
      name: "One instance can be changed without editing the reusable source",
      run: async (ctx) => {
        const reusableSourceBefore = await ctx.eval(
          `fetch('/api/projects/' +
          location.hash.match(/#?project\\/([^?]+)/)?.[1] +
          '/files/compositions%2Froute-map.html').then((response) => response.json()).then((data) => data.content)`,
          { awaitPromise: true },
        );
        await ctx.prove(
          "A variable edit updates only the current Route Map instance and its preview",
          {
            voiceover: vo[2],
            action: async () => {
              await ctx.trustedClick(TITLE_SELECTOR);
              await ctx.fill(TITLE_SELECTOR, UPDATED_TITLE);
              await ctx.eval(`(() => {
              const input = document.querySelector(${JSON.stringify(TITLE_SELECTOR)});
              input.blur();
              return true;
            })()`);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(TITLE_SELECTOR)})?.value === ${JSON.stringify(UPDATED_TITLE)} && !document.body.innerText.includes('Saving')`,
                { timeoutMs: 20_000, label: "component variable save" },
              );
            },
            assert: async () => {
              const result = await ctx.eval(
                `Promise.all([fetch('/api/projects/' +
              location.hash.match(/#?project\\/([^?]+)/)?.[1] +
              '/files/index.html').then((response) => response.json()), fetch('/api/projects/' +
              location.hash.match(/#?project\\/([^?]+)/)?.[1] +
              '/files/compositions%2Froute-map.html').then((response) => response.json())]).then(([host, component]) => ({
                reusableSource: component.content,
                source: host.content,
              })).then(({ source, reusableSource }) => ({
                instanceValue: source.includes('"title":"${UPDATED_TITLE}"'),
                componentSource: source.includes('data-composition-src="compositions/route-map.html"'),
                reusableSource,
              }))`,
                { awaitPromise: true },
              );
              ctx.assert(
                result.instanceValue,
                "The current instance did not persist its title variable.",
              );
              ctx.assert(
                result.componentSource,
                "The reusable component source reference was lost.",
              );
              ctx.assert(
                result.reusableSource === reusableSourceBefore,
                "The reusable Route Map source changed while editing one instance.",
              );
            },
            screenshot: {
              name: "component-instance-variable",
              requireText: ["组件变量", "跟随主题", "Title", "Origin", "Destination"],
              rejectText: ["Saving"],
            },
          },
        );
      },
    },
  ],
};
