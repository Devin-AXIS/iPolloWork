import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("gsap-catalog-scrollbar");
const CATALOG_SELECTOR = '[data-testid="block-catalog-scroll"]';
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

async function connectStudioTarget(ctx) {
  const deadline = Date.now() + 60_000;
  let openedStudio = false;
  while (Date.now() < deadline) {
    const targets = await listTargets(ctx.cdpBaseUrl);
    const studio = targets.find(
      (target) =>
        (target.type === "page" || target.type === "iframe") &&
        target.webSocketDebuggerUrl &&
        target.url.includes("#project/"),
    );
    if (studio) {
      const previous = ctx.client;
      ctx.client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, studio));
      previous?.close();
      await ctx.client.send("Page.enable").catch(() => undefined);
      return;
    }
    if (!openedStudio) {
      if (!await ctx.eval(`Boolean(document.querySelector('button[title="打开视频工作台"]'))`)) {
        await ctx.trustedClick('button[aria-label="查看对话输出"]');
        await ctx.waitFor(`Boolean(document.querySelector('button[title="打开视频工作台"]'))`, {
          timeoutMs: 20_000,
          label: "video workspace output",
        });
      }
      await ctx.trustedClick('button[title="打开视频工作台"]');
      openedStudio = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Studio project target did not open.");
}

async function getCatalogState(ctx) {
  return ctx.eval(`(() => {
    const catalog = document.querySelector(${JSON.stringify(CATALOG_SELECTOR)});
    const search = document.querySelector('input[placeholder*="搜索"]');
    const category = [...document.querySelectorAll("button")]
      .find((button) => button.innerText.trim() === "全部");
    if (!(catalog instanceof HTMLElement) || !(search instanceof HTMLElement) || !category) {
      return null;
    }
    const rect = catalog.getBoundingClientRect();
    return {
      clientHeight: catalog.clientHeight,
      clientWidth: catalog.clientWidth,
      offsetWidth: catalog.offsetWidth,
      scrollHeight: catalog.scrollHeight,
      scrollTop: catalog.scrollTop,
      maxScrollTop: catalog.scrollHeight - catalog.clientHeight,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      searchTop: search.getBoundingClientRect().top,
      categoryTop: category.getBoundingClientRect().top,
      scrollbarGutter: getComputedStyle(catalog).scrollbarGutter,
    };
  })()`);
}

async function dragCatalogScrollbar(ctx, ratio) {
  const state = await getCatalogState(ctx);
  ctx.assert(state, "Animation catalog scroll container is missing.");
  const trackHeight = state.rect.bottom - state.rect.top;
  const thumbHeight = Math.max(28, trackHeight * (state.clientHeight / state.scrollHeight));
  const startY = state.rect.top + thumbHeight / 2;
  const endY = state.rect.top + thumbHeight / 2 + (trackHeight - thumbHeight) * ratio;
  const x = state.rect.right - Math.max(3, (state.offsetWidth - state.clientWidth) / 2);

  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: startY });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y: startY,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y: endY,
    button: "left",
    buttons: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y: endY,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function waitForCatalogPaint(ctx) {
  await ctx.eval(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    { awaitPromise: true },
  );
}

export default {
  id: "gsap-catalog-scrollbar",
  title: "Browse the complete GSAP catalog without a mouse wheel",
  kind: "user-facing",
  cdpTarget: { title: "iPollo Work" },
  preserveTheme: true,
  precondition: async (ctx) => {
    await connectStudioTarget(ctx);
    if (!await ctx.eval(`document.body.innerText.includes("动画库")`)) {
      await clickTextButton(ctx, "设计");
    }
    await ctx.waitFor(
      `document.body.innerText.includes("动画库") && document.body.innerText.includes("特效库")`,
      { timeoutMs: 60_000, label: "Studio catalog tabs" },
    );
    return null;
  },
  steps: [
    {
      name: "Persistent scrollbar is visible",
      run: async (ctx) => {
        await ctx.prove("The animation catalog exposes a persistent draggable scrollbar.", {
          voiceover: vo[0],
          action: async () => {
            await clickTextButton(ctx, "动画库");
            await ctx.waitForText("iPolloWork 动画预设", { timeoutMs: 20_000 });
            await ctx.eval(
              `document.querySelector(${JSON.stringify(CATALOG_SELECTOR)})?.scrollTo({ top: 0, behavior: "instant" })`,
            );
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(CATALOG_SELECTOR)})?.scrollTop === 0`,
              { timeoutMs: 10_000, label: "catalog start" },
            );
            await waitForCatalogPaint(ctx);
          },
          assert: async () => {
            const state = await getCatalogState(ctx);
            ctx.assert(state, "Animation catalog scroll container is missing.");
            ctx.assert(state.scrollHeight > state.clientHeight, "Animation catalog is not scrollable.");
            ctx.assert(
              state.offsetWidth - state.clientWidth >= 8,
              "The persistent scrollbar does not reserve visible width.",
            );
            ctx.assert(
              state.scrollbarGutter.includes("stable"),
              "The animation catalog does not reserve a stable scrollbar gutter.",
            );
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "persistent-animation-catalog-scrollbar",
            requireText: ["动画库", "iPolloWork 动画预设", "69", "全部"],
          },
        });
      },
    },
    {
      name: "Scrollbar drag moves only the catalog",
      run: async (ctx) => {
        await ctx.prove("Dragging the scrollbar moves templates while search and filters stay fixed.", {
          voiceover: vo[1],
          action: async () => {
            const before = await getCatalogState(ctx);
            ctx.assert(before, "Animation catalog scroll container is missing before dragging.");
            await ctx.eval(
              `document.querySelector(${JSON.stringify(CATALOG_SELECTOR)})?.scrollTo({ top: 0, behavior: "instant" })`,
            );
            await waitForCatalogPaint(ctx);
            await dragCatalogScrollbar(ctx, 0.55);
            await ctx.waitFor(
              `document.querySelector(${JSON.stringify(CATALOG_SELECTOR)})?.scrollTop > 0`,
              { timeoutMs: 10_000, label: "catalog scrollbar drag" },
            );
            await waitForCatalogPaint(ctx);
          },
          assert: async () => {
            const state = await getCatalogState(ctx);
            ctx.assert(state, "Animation catalog scroll container is missing after dragging.");
            ctx.assert(state.scrollTop > 0, "Dragging the scrollbar did not move the catalog.");
            ctx.assert(state.searchTop > 0, "Search moved outside the visible panel.");
            ctx.assert(state.categoryTop > state.searchTop, "Category filters moved out of position.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "animation-catalog-dragged",
            requireText: ["动画库", "iPolloWork 动画预设", "全部"],
          },
        });
      },
    },
    {
      name: "Last catalog row is reachable",
      run: async (ctx) => {
        await ctx.prove("Dragging to the bottom reveals the final animation presets.", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(
              `document.querySelector(${JSON.stringify(CATALOG_SELECTOR)})?.scrollTo({ top: 0, behavior: "instant" })`,
            );
            await waitForCatalogPaint(ctx);
            await dragCatalogScrollbar(ctx, 1);
            await ctx.waitFor(
              `(() => {
                const catalog = document.querySelector(${JSON.stringify(CATALOG_SELECTOR)});
                return catalog && catalog.scrollTop >= catalog.scrollHeight - catalog.clientHeight - 2;
              })()`,
              { timeoutMs: 10_000, label: "catalog bottom" },
            );
            await waitForCatalogPaint(ctx);
          },
          assert: async () => {
            const state = await getCatalogState(ctx);
            ctx.assert(state, "Animation catalog scroll container is missing at the bottom.");
            ctx.assert(
              state.scrollTop >= state.maxScrollTop - 2,
              "The final animation catalog row is not reachable.",
            );
            const lastCardVisible = await ctx.eval(`(() => {
              const catalog = document.querySelector(${JSON.stringify(CATALOG_SELECTOR)});
              const cards = catalog?.querySelectorAll('[data-testid="block-catalog-card"]');
              const last = cards?.item((cards?.length ?? 0) - 1);
              if (!catalog || !last) return false;
              const catalogRect = catalog.getBoundingClientRect();
              const lastRect = last.getBoundingClientRect();
              return lastRect.bottom <= catalogRect.bottom && lastRect.bottom > catalogRect.top;
            })()`);
            ctx.assert(lastCardVisible, "The final animation preset is not visible at the bottom.");
          },
          screenshot: {
            ...STUDIO_SCREENSHOT_TARGETS,
            name: "animation-catalog-last-row",
            requireText: ["动画库", "iPolloWork 动画预设", "全部"],
          },
        });
      },
    },
  ],
};
