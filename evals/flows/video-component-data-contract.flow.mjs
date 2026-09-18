import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("video-component-data-contract");
const DENSITY_SELECTOR = 'input[aria-label="Population density 1"]';
let expectedDensity = "321";

async function openUsMapDataForm(ctx) {
  await ctx.eval("location.reload(); true");
  await ctx.waitFor("document.readyState === 'complete'", {
    timeoutMs: 20_000,
    label: "Studio reload",
  });
  const hasUsMap = await ctx.eval(
    `fetch('/api/projects/' + (location.hash.match(/#?project\\/([^?]+)/)?.[1] || 'desktop') +
      '/files/index.html').then((response) => response.json()).then((data) =>
        data.content.includes('data-composition-src="compositions/us-map.html"'))`,
    { awaitPromise: true },
  );
  if (hasUsMap) {
    await ctx.waitFor(
      'Boolean(document.querySelector("[role=\\"button\\"][aria-label=\\"Select Us Map\\"]"))',
      { timeoutMs: 20_000, label: "US Map timeline item" },
    );
    await ctx.trustedClick('[role="button"][aria-label="Select Us Map"]');
  } else {
    await ctx.waitFor(
      `document.querySelector('[role="button"][aria-label="Select Ipollowork Video Placeholder"]') ||
        document.body.innerText.includes('Drop media here')`,
      { timeoutMs: 20_000, label: "Studio project loaded" },
    );
    const hasPlaceholder = await ctx.eval(
      'Boolean(document.querySelector("[role=\\"button\\"][aria-label=\\"Select Ipollowork Video Placeholder\\"]"))',
    );
    if (hasPlaceholder) {
      await ctx.trustedClick('[role="button"][aria-label="Select Ipollowork Video Placeholder"]');
      await ctx.trustedClick('button[aria-label="Delete selected element"]');
      await ctx.waitFor(
        '!document.querySelector("[role=\\"button\\"][aria-label=\\"Select Ipollowork Video Placeholder\\"]")',
        { label: "starter placeholder removed" },
      );
    }

    const inspectorOpen = await ctx.eval(
      'Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))',
    );
    if (!inspectorOpen) await ctx.trustedClick('button[aria-label="Properties"]');
    await ctx.trustedClick('button[aria-label="Components"]');
    await ctx.eval(`(() => {
      const select = document.querySelector('select[aria-label="Component category"]');
      if (!select) return false;
      select.value = 'maps';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await ctx.waitFor('Boolean(document.querySelector(\'[data-block-name="us-map"]\'))', {
      label: "US Map component card",
    });
    await ctx.trustedClick('[data-block-name="us-map"] button');
  }

  await ctx.waitFor(
    'Boolean(document.querySelector(\'[data-component-data-contract="region-value"]\'))',
    { timeoutMs: 20_000, label: "US Map structured data form" },
  );
}

export default {
  id: "video-component-data-contract",
  title: "Video components share one AI-readable data contract",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3003" },
  preserveTheme: true,
  steps: [
    {
      name: "US Map exposes normalized data rows",
      run: async (ctx) => {
        await ctx.prove("A data-driven map uses a typed form that AI can read", {
          voiceover: vo[0],
          action: async () => openUsMapDataForm(ctx),
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              rows: document.querySelectorAll('[data-component-data-row]').length,
              contract: document.querySelector('[data-component-data-contract]')?.getAttribute('data-component-data-contract'),
              firstRegion: document.querySelector('input[aria-label="State code 1"]')?.value,
              highlight: document.querySelector('button[aria-label="Highlight"]')?.textContent?.trim(),
              text: document.body.innerText,
            }))()`);
            ctx.assert(state.contract === "region-value", "The semantic region-value contract is missing.");
            ctx.assert(state.rows === 5, `Expected five editable rows, received ${state.rows}.`);
            ctx.assert(state.firstRegion === "CA", "The first normalized region is not CA.");
            ctx.assert(state.highlight === "NJ", "Highlight is not derived from the data rows.");
            ctx.assert(
              state.text.toLowerCase().includes("ai-readable · validated"),
              "AI validation status is missing.",
            );
          },
          screenshot: {
            name: "map-structured-data-form",
            requireText: ["US Map", "Data overrides", "AI-READABLE · VALIDATED", "State code", "Population density"],
          },
        });
      },
    },
    {
      name: "A row edit persists only on the current instance",
      run: async (ctx) => {
        const reusableSourceBefore = await ctx.eval(
          `fetch('/api/projects/' + (location.hash.match(/#?project\\/([^?]+)/)?.[1] || 'desktop') +
            '/files/compositions%2Fus-map.html').then((response) => response.json()).then((data) => data.content)`,
          { awaitPromise: true },
        );
        await ctx.prove("Editing one row saves the instance without rewriting the component", {
          voiceover: vo[1],
          action: async () => {
            const currentDensity = await ctx.eval(
              `document.querySelector(${JSON.stringify(DENSITY_SELECTOR)})?.value`,
            );
            expectedDensity = currentDensity === "321" ? "322" : "321";
            await ctx.trustedClick(DENSITY_SELECTOR);
            await ctx.fill(DENSITY_SELECTOR, expectedDensity);
            await ctx.eval(`document.querySelector(${JSON.stringify(DENSITY_SELECTOR)})?.blur()`);
            await ctx.eval(
              `new Promise((resolve, reject) => {
                const startedAt = Date.now();
                const poll = () => fetch('/api/projects/' + (location.hash.match(/#?project\\/([^?]+)/)?.[1] || 'desktop') + '/files/index.html')
                  .then((response) => response.json())
                  .then((data) => {
                    if (data.content.includes('CA:${expectedDensity},TX:112.8')) return resolve(true);
                    if (Date.now() - startedAt > 15_000) return reject(new Error('normalized data row save timed out'));
                    setTimeout(poll, 200);
                  })
                  .catch(reject);
                poll();
              })`,
              { awaitPromise: true },
            );
          },
          assert: async () => {
            const result = await ctx.eval(
              `Promise.all([
                fetch('/api/projects/' + (location.hash.match(/#?project\\/([^?]+)/)?.[1] || 'desktop') + '/files/index.html').then((response) => response.json()),
                fetch('/api/projects/' + (location.hash.match(/#?project\\/([^?]+)/)?.[1] || 'desktop') + '/files/compositions%2Fus-map.html').then((response) => response.json()),
              ]).then(([host, component]) => ({ host: host.content, reusable: component.content }))`,
              { awaitPromise: true },
            );
            ctx.assert(
              result.host.includes(`CA:${expectedDensity},TX:112.8`),
              "The normalized row did not persist on this component instance.",
            );
            ctx.assert(
              result.host.includes('data-composition-src="compositions/us-map.html"'),
              "The HyperFrames composition reference was lost.",
            );
            ctx.assert(
              result.reusable === reusableSourceBefore,
              "Editing an instance unexpectedly rewrote the reusable component source.",
            );
          },
          screenshot: {
            name: "map-instance-data-save",
            requireText: ["US Map", "Data overrides", "Highlight"],
            rejectText: ["Saving"],
          },
        });
      },
    },
  ],
};
