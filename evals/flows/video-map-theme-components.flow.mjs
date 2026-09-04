import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("video-map-theme-components");
const PROOF_PROJECT_ID = "ipw-map-property-proof-final";
const PROPERTY_INPUT_DEBOUNCE_MS = 700;

async function openMapCatalog(ctx, time = 4) {
  const origin = await ctx.eval("location.origin");
  await ctx.client.send("Page.navigate", {
    url: `${origin}/#project/${PROOF_PROJECT_ID}?t=${time}&tab=components`,
  });
  await ctx.waitFor('document.readyState === "complete"', { label: "fresh Studio page" });
  await ctx.eval('window.postMessage({ type: "ipollowork:studio-locale", locale: "en" }, "*")');
  await ctx.waitFor('document.documentElement.lang === "en"', { label: "English Studio locale" });
  const paramsOpen = await ctx.eval(
    'Boolean(document.querySelector("button[aria-label=\\"Close parameters\\"]"))',
  );
  if (paramsOpen) await ctx.trustedClick('button[aria-label="Close parameters"]');
  const componentsVisible = await ctx.eval(
    'Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))',
  );
  if (!componentsVisible) {
    await ctx.trustedClick('button[aria-label="Properties"]');
    await ctx.waitFor('Boolean(document.querySelector("button[aria-label=\\"Components\\"]"))', {
      label: "properties panel tabs",
    });
  }
  await ctx.trustedClick('button[aria-label="Components"]');
  await ctx.waitFor('Boolean(document.querySelector("[data-testid=\\"block-catalog-search\\"]"))', {
    label: "component catalog",
  });
  await ctx.eval(`(() => {
    const select = document.querySelector('select[aria-label="Component category"]');
    if (!select) return false;
    select.value = 'maps';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await ctx.waitFor(
    'Boolean(document.querySelector("[data-block-name=\\"china-map\\"]")) && Boolean(document.querySelector("[data-block-name=\\"world-map\\"]"))',
    { label: "China and World map cards" },
  );
}

async function openMapProperties(ctx, name, title, time) {
  const hasMap = await ctx.eval(
    `fetch('/api/projects/${PROOF_PROJECT_ID}/files/index.html').then((response) => response.json()).then((data) =>
      data.content.includes(${JSON.stringify(`data-composition-src="compositions/${name}.html"`)}))`,
    { awaitPromise: true },
  );
  if (!hasMap) {
    await openMapCatalog(ctx, time);
    await ctx.trustedClick(`[data-block-name="${name}"] button`);
  } else {
    await ctx.waitFor(
      `Boolean(document.querySelector(${JSON.stringify(`[role="button"][aria-label="Select ${title}"]`)}))`,
      { timeoutMs: 20_000, label: `${title} timeline item` },
    );
    await ctx.trustedClick(`[role="button"][aria-label="Select ${title}"]`);
  }
  await ctx.waitFor(
    'Boolean(document.querySelector("[data-testid=\\"block-params-panel\\"] input[aria-label=\\"Title\\"]"))',
    { timeoutMs: 20_000, label: `${title} properties` },
  );
}

async function inspectCatalogMap(ctx, name, shapeSelector, markerSelector) {
  const point = await ctx.eval(`(() => {
    const card = document.querySelector('[data-block-name="${name}"]');
    card?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = card?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (point) {
    await ctx.client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
  }
  await ctx.waitFor(`Boolean(document.querySelector('[data-block-name="${name}"] iframe'))`, {
    label: `${name} live preview`,
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const previewTarget = (await listTargets(ctx.cdpBaseUrl)).find(
      (target) =>
        target.type === "iframe" &&
        target.url.includes(`/api/registry/blocks/${name}/preview`) &&
        target.webSocketDebuggerUrl,
    );
    if (previewTarget) {
      const previewClient = await connect(debuggerUrlFor(ctx.cdpBaseUrl, previewTarget));
      try {
        const inspection = await evaluate(
          previewClient,
          `(() => ({
          shapeCount: document.querySelectorAll('${shapeSelector}').length,
          markerRadii: [...document.querySelectorAll('${markerSelector}')]
            .map((marker) => Number(marker.getAttribute('r')))
            .filter(Number.isFinite),
        }))()`,
        );
        if (inspection.markerRadii.length) return inspection;
      } finally {
        previewClient.close();
      }
    }
    const { root } = await ctx.client.send("DOM.getDocument", { depth: -1, pierce: true });
    const nodes = [root];
    const matchingShapes = [];
    const matchingMarkers = [];
    while (nodes.length) {
      const node = nodes.pop();
      if (!node) continue;
      const attributes = Object.fromEntries(
        Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, index) => [
          node.attributes[index * 2],
          node.attributes[index * 2 + 1],
        ]),
      );
      const classes = String(attributes.class ?? "").split(/\s+/);
      if (classes.includes(shapeSelector.slice(1))) matchingShapes.push(node);
      if (classes.includes(markerSelector.slice(1))) matchingMarkers.push(attributes);
      nodes.push(
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
        ...(node.pseudoElements ?? []),
        ...(node.contentDocument ? [node.contentDocument] : []),
        ...(node.templateContent ? [node.templateContent] : []),
      );
    }
    const markerRadii = matchingMarkers
      .map((attributes) => Number(attributes.r))
      .filter(Number.isFinite);
    if (markerRadii.length) {
      return { shapeCount: matchingShapes.length, markerRadii };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${name} rendered markers.`);
}

function textFromNode(node) {
  return [node.nodeValue ?? "", ...(node.children ?? []).map(textFromNode)].join("");
}

async function waitForPiercedText(ctx, className, expectedText) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { root } = await ctx.client.send("DOM.getDocument", { depth: -1, pierce: true });
    const nodes = [root];
    while (nodes.length) {
      const node = nodes.pop();
      if (!node) continue;
      const attributes = Object.fromEntries(
        Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, index) => [
          node.attributes[index * 2],
          node.attributes[index * 2 + 1],
        ]),
      );
      if (
        String(attributes.class ?? "")
          .split(/\s+/)
          .includes(className)
      ) {
        const text = textFromNode(node).trim();
        if (text === expectedText) return text;
      }
      nodes.push(
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
        ...(node.pseudoElements ?? []),
        ...(node.contentDocument ? [node.contentDocument] : []),
        ...(node.templateContent ? [node.templateContent] : []),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for .${className} to render ${expectedText}.`);
}

export default {
  id: "video-map-theme-components",
  title: "Video Studio provides accurate, editable maps with restrained markers",
  kind: "user-facing",
  cdpTarget: { urlIncludes: ":3387" },
  preserveTheme: true,
  steps: [
    {
      name: "China and World maps are discoverable in the expanded map collection",
      run: async (ctx) => {
        let mapInspection = {
          china: { shapeCount: 0, markerRadii: [] },
          world: { shapeCount: 0, markerRadii: [] },
        };
        await ctx.prove(
          "China Map and World Map use accurate boundaries and compact data markers",
          {
            voiceover: vo[0],
            action: async () => {
              await openMapCatalog(ctx);
              mapInspection = {
                china: await inspectCatalogMap(ctx, "china-map", ".cm-region", ".cm-dot"),
                world: await inspectCatalogMap(ctx, "world-map", ".wm-country", ".wm-dot"),
              };
              await inspectCatalogMap(ctx, "china-map", ".cm-region", ".cm-dot");
              await ctx.eval("new Promise((resolve) => setTimeout(resolve, 1400))", {
                awaitPromise: true,
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
              const select = document.querySelector('select[aria-label="Component category"]');
              return {
                options: [...(select?.options || [])].map((option) => option.textContent?.trim()),
                cards: document.querySelectorAll('[data-testid="block-catalog-card"]').length,
                china: Boolean(document.querySelector('[data-block-name="china-map"]')),
                world: Boolean(document.querySelector('[data-block-name="world-map"]')),
              };
            })()`);
              ctx.assert(
                state.options.includes("All components · 84"),
                "The component total is not 84.",
              );
              ctx.assert(state.options.includes("Maps & Routes · 12"), "The map total is not 12.");
              ctx.assert(state.cards === 12, `Expected twelve map cards, received ${state.cards}.`);
              ctx.assert(state.china && state.world, "China Map or World Map is missing.");
              ctx.assert(
                mapInspection.china.shapeCount >= 34 && mapInspection.china.shapeCount % 34 === 0,
                `Expected one or more complete 34-path China previews, received ${mapInspection.china.shapeCount} paths.`,
              );
              ctx.assert(
                mapInspection.world.shapeCount >= 170,
                `Expected at least 170 real country paths, received ${mapInspection.world.shapeCount}.`,
              );
              ctx.assert(
                Math.max(0, ...mapInspection.china.markerRadii) <= 13,
                `China Map marker radius exceeded 13px: ${mapInspection.china.markerRadii.join(", ")}.`,
              );
              ctx.assert(
                Math.max(0, ...mapInspection.world.markerRadii) <= 15,
                `World Map marker radius exceeded 15px: ${mapInspection.world.markerRadii.join(", ")}.`,
              );
            },
            screenshot: {
              name: "china-world-map-catalog",
              requireText: ["Maps & Routes · 12", "China Map"],
            },
          },
        );
      },
    },
    {
      name: "Map properties debounce once and update the player",
      run: async (ctx) => {
        let expectedTitle = "";
        let earlyState = null;
        let previewTitle = "";
        await ctx.prove(
          "A right-panel map edit stays focused, saves once, and changes the player",
          {
            voiceover: vo[1],
            action: async () => {
              await openMapProperties(ctx, "world-map", "World Map", 4);
              const titleSelector = '[data-testid="block-params-panel"] input[aria-label="Title"]';
              const currentTitle = await ctx.eval(
                `document.querySelector(${JSON.stringify(titleSelector)})?.value`,
              );
              expectedTitle =
                currentTitle === "Verified world outlook"
                  ? "Verified global outlook"
                  : "Verified world outlook";
              await ctx.eval(`(() => {
              window.__mapProofWrites = 0;
              if (!window.__mapProofOriginalFetch) window.__mapProofOriginalFetch = window.fetch;
              window.fetch = function(input, init) {
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
                if (method === 'PUT' && url.includes('/projects/${PROOF_PROJECT_ID}/files/index.html')) {
                  window.__mapProofWrites += 1;
                }
                return window.__mapProofOriginalFetch.apply(this, arguments);
              };
            })()`);
              await ctx.trustedClick(titleSelector);
              await ctx.fill(titleSelector, expectedTitle);
              await ctx.eval(
                `new Promise((resolve) => setTimeout(resolve, ${Math.floor(PROPERTY_INPUT_DEBOUNCE_MS / 2)}))`,
                { awaitPromise: true },
              );
              earlyState = await ctx.eval(
                `Promise.all([
                fetch('/api/projects/${PROOF_PROJECT_ID}/files/index.html').then((response) => response.json()),
                Promise.resolve({
                  focused: document.activeElement === document.querySelector(${JSON.stringify(titleSelector)}),
                  writes: window.__mapProofWrites,
                }),
              ]).then(([file, ui]) => ({ ...ui, source: file.content }))`,
                { awaitPromise: true },
              );
              previewTitle = await waitForPiercedText(ctx, "wm-title", expectedTitle);
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
              focused: document.activeElement === document.querySelector('[data-testid="block-params-panel"] input[aria-label="Title"]'),
              writes: window.__mapProofWrites,
            }))()`);
              ctx.assert(
                earlyState?.focused,
                "The title field lost focus before the debounce elapsed.",
              );
              ctx.assert(
                earlyState?.writes === 0,
                "The title was written before the debounce elapsed.",
              );
              ctx.assert(
                !earlyState?.source.includes(expectedTitle),
                "The project source changed before the debounce elapsed.",
              );
              ctx.assert(
                state.writes === 1,
                `Expected one debounced write, received ${state.writes}.`,
              );
              ctx.assert(state.focused, "The title field lost focus when the preview refreshed.");
              ctx.assert(
                previewTitle === expectedTitle,
                "The left player did not render the edited title.",
              );
            },
            screenshot: {
              name: "world-map-property-player-sync",
              requireText: ["World Map", "Title"],
              rejectText: ["Saving"],
            },
          },
        );
      },
    },
    {
      name: "China Map properties use the same player synchronization path",
      run: async (ctx) => {
        let expectedTitle = "";
        let previewTitle = "";
        await ctx.prove("China Map property changes also render in the left player", {
          voiceover: vo[2],
          action: async () => {
            await openMapProperties(ctx, "china-map", "China Map", 16);
            const titleSelector = '[data-testid="block-params-panel"] input[aria-label="Title"]';
            const currentTitle = await ctx.eval(
              `document.querySelector(${JSON.stringify(titleSelector)})?.value`,
            );
            expectedTitle =
              currentTitle === "已验证中国区域趋势" ? "已验证中国增长趋势" : "已验证中国区域趋势";
            await ctx.trustedClick(titleSelector);
            await ctx.fill(titleSelector, expectedTitle);
            previewTitle = await waitForPiercedText(ctx, "cm-title", expectedTitle);
          },
          assert: async () => {
            const state = await ctx.eval(
              `Promise.all([
                fetch('/api/projects/${PROOF_PROJECT_ID}/files/index.html').then((response) => response.json()),
                Promise.resolve({
                  focused: document.activeElement === document.querySelector('[data-testid="block-params-panel"] input[aria-label="Title"]'),
                }),
              ]).then(([file, ui]) => ({ ...ui, source: file.content }))`,
              { awaitPromise: true },
            );
            ctx.assert(
              state.focused,
              "The China Map title field lost focus after the player refresh.",
            );
            ctx.assert(
              state.source.includes(expectedTitle),
              "The China Map title did not persist.",
            );
            ctx.assert(
              previewTitle === expectedTitle,
              "The left player did not render the edited China Map title.",
            );
          },
          screenshot: {
            name: "china-map-property-player-sync",
            requireText: ["China Map", "Title"],
            rejectText: ["Saving"],
          },
        });
      },
    },
  ],
};
