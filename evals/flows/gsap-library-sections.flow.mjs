import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("gsap-library-sections");
const STUDIO_SCREENSHOT_TARGETS = {
  rejectText: ["Console errors in preview", "composition script error", "Something went wrong"],
};

const selectors = {
  animation: '[data-testid="block-catalog-animation"]',
  scene: '[data-testid="block-catalog-scene"]',
  search: '[data-testid="block-catalog-search"]',
  text: '[data-testid="catalog-scroll-text-animation"]',
  interface: '[data-testid="catalog-scroll-interface-animation"]',
  transition: '[data-testid="catalog-scroll-transition-scene"]',
  background: '[data-testid="catalog-scroll-background-scene"]',
  card: '[data-testid="block-catalog-card"]',
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
  const embeddedStudioUrl = await ctx.eval(`(() => {
    const frame = [...document.querySelectorAll("iframe")].find((candidate) =>
      candidate.src.includes("/#project/")
    );
    return frame?.src ?? null;
  })()`);
  const studioUrl =
    embeddedStudioUrl ??
    "http://localhost:3002/#project/hyperframes-preview?v=1&t=0&tab=design&locale=zh";
  let openedStudioTarget = false;
  while (Date.now() < deadline) {
    const targets = await listTargets(ctx.cdpBaseUrl);
    const studio = targets.find(
      (target) =>
        (target.type === "page" || target.type === "iframe") &&
        target.webSocketDebuggerUrl &&
        target.url.includes("/#project/") &&
        (target.url.includes("localhost:") || target.url.includes("127.0.0.1:")),
    );
    if (studio) {
      const previous = ctx.client;
      ctx.client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, studio));
      previous?.close();
      await ctx.client.send("Page.enable").catch(() => undefined);
      return;
    }
    if (!openedStudioTarget) {
      const opened = await ctx.eval(
        `Boolean(window.open(${JSON.stringify(studioUrl)}, "_blank", "width=1280,height=900"))`,
      );
      if (!opened) throw new Error("Studio project target could not be opened.");
      openedStudioTarget = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Studio project target did not open.");
}

async function setSearch(ctx, value) {
  await ctx.eval(`(() => {
    const input = document.querySelector(${JSON.stringify(selectors.search)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function waitForPaint(ctx) {
  await ctx.eval(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    { awaitPromise: true },
  );
}

async function proveWithScreenshotRetry(ctx, name, options) {
  const { screenshot, ...proof } = options;
  await ctx.prove(name, proof);
  if (!screenshot) return;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const targets = await listTargets(ctx.cdpBaseUrl);
      const studioClient = ctx.client;
      const studioTarget = targets.find((target) => target.id === studioClient.targetId);
      const topLevel = studioTarget?.parentId
        ? targets.find(
            (target) =>
              target.id === studioTarget.parentId &&
              target.type === "page" &&
              target.webSocketDebuggerUrl,
          )
        : studioTarget;
      const screenshotClient =
        topLevel && topLevel.id !== studioClient.targetId
          ? await connect(debuggerUrlFor(ctx.cdpBaseUrl, topLevel))
          : studioClient;
      ctx.client = screenshotClient;
      try {
        await ctx.screenshot(screenshot.name, {
          ...screenshot,
          claim: proof.claim ?? name,
        });
      } finally {
        ctx.client = studioClient;
        if (screenshotClient !== studioClient) screenshotClient.close();
      }
      return;
    } catch (error) {
      lastError = error;
      await waitForPaint(ctx);
    }
  }
  throw lastError;
}

async function wheelInside(ctx, selector, deltaY = 480, modifiers = 0) {
  const point = await ctx.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  ctx.assert(point, `Missing scroll container ${selector}.`);
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
    modifiers,
  });
}

async function waitDensityStep(ctx) {
  await ctx.eval(`new Promise((resolve) => setTimeout(() => resolve(true), 160))`, {
    awaitPromise: true,
  });
}

async function visibleCardPoints(ctx, sectionSelector) {
  return ctx.eval(`(() => {
    const root = document.querySelector(${JSON.stringify(sectionSelector)});
    if (!(root instanceof HTMLElement)) return [];
    const rootRect = root.getBoundingClientRect();
    return [...root.querySelectorAll(${JSON.stringify(selectors.card)})]
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          name: card.getAttribute("data-block-name"),
          x: rect.left + rect.width / 2,
          y: rect.top + Math.min(20, rect.height / 3),
          visible: rect.bottom > rootRect.top && rect.top < rootRect.bottom,
        };
      })
      .filter((card) => card.visible)
      .slice(0, 2);
  })()`);
}

export default {
  id: "gsap-library-sections",
  title: "Animation and scene libraries use independent lazy-loading sections",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await connectStudioTarget(ctx);
    const navigationReady = await ctx.eval(
      `["设计", "动画", "场景", "导出"].every((label) =>
        [...document.querySelectorAll("button")].some((button) => button.innerText.trim() === label)
      )`,
    );
    if (!navigationReady) {
      await clickTextButton(ctx, "设计");
    }
    await ctx.waitFor(
      `["设计", "动画", "场景", "导出"].every((label) =>
        [...document.querySelectorAll("button")].some((button) => button.innerText.trim() === label)
      )`,
      { timeoutMs: 60_000, label: "Studio library navigation" },
    );
    return null;
  },
  steps: [
    {
      name: "Navigation and animation sections",
      run: async (ctx) => {
        await proveWithScreenshotRetry(
          ctx,
          "Animation opens below the four-item navigation with a fixed shared search.",
          {
            voiceover: vo[0],
            action: async () => {
              await clickTextButton(ctx, "动画");
              await ctx.waitFor(
                `Boolean(document.querySelector(${JSON.stringify(selectors.search)}))`,
                { timeoutMs: 20_000, label: "animation search input" },
              );
              await setSearch(ctx, "");
              await ctx.waitFor(
                `Boolean(document.querySelector(${JSON.stringify(selectors.animation)}))
                && document.body.innerText.includes("文字动画")
                && document.body.innerText.includes("界面动画")
                && document.querySelectorAll(${JSON.stringify(selectors.card)}).length === 100`,
                { timeoutMs: 20_000, label: "animation library sections" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
              const buttons = [...document.querySelectorAll("button")].map((button) => button.innerText.trim());
              const search = document.querySelector(${JSON.stringify(selectors.search)});
              const textSection = document.querySelector('[data-testid="catalog-section-text-animation"]');
              const interfaceSection = document.querySelector('[data-testid="catalog-section-interface-animation"]');
              return {
                buttons,
                searchTop: search?.getBoundingClientRect().top,
                textTop: textSection?.getBoundingClientRect().top,
                interfaceTop: interfaceSection?.getBoundingClientRect().top,
                textCount: textSection?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
                interfaceCount: interfaceSection?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
              };
            })()`);
              for (const label of ["设计", "动画", "场景", "导出"]) {
                ctx.assert(state.buttons.includes(label), `${label} navigation item is missing.`);
              }
              ctx.assert(
                state.searchTop < state.textTop,
                "Search is not fixed above the animation sections.",
              );
              ctx.assert(
                state.textTop < state.interfaceTop,
                "Animation sections are not vertically ordered.",
              );
              ctx.assert(
                state.textCount === 20,
                `Expected 20 text animations, received ${state.textCount}.`,
              );
              ctx.assert(
                state.interfaceCount === 80,
                `Expected 80 interface animations, received ${state.interfaceCount}.`,
              );
            },
            screenshot: {
              ...STUDIO_SCREENSHOT_TARGETS,
              name: "animation-library-sections",
            },
          },
        );
      },
    },
    {
      name: "Independent scrolling and card density",
      run: async (ctx) => {
        await proveWithScreenshotRetry(
          ctx,
          "Each animation section scrolls independently and Ctrl-wheel scales both grids from one to four columns.",
          {
            voiceover: vo[1],
            action: async () => {
              await ctx.eval(`(() => {
              document.querySelector(${JSON.stringify(selectors.text)})?.scrollTo(0, 0);
              document.querySelector(${JSON.stringify(selectors.interface)})?.scrollTo(0, 0);
            })()`);
              await wheelInside(ctx, selectors.text);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.text)})?.scrollTop > 0`,
                { timeoutMs: 10_000, label: "text section wheel scroll" },
              );
            },
            assert: async () => {
              let state = await ctx.eval(`(() => {
              const text = document.querySelector(${JSON.stringify(selectors.text)});
              const ui = document.querySelector(${JSON.stringify(selectors.interface)});
              const page = document.querySelector(${JSON.stringify(selectors.animation)});
              const columns = text?.querySelector(".grid");
              return {
                textTop: text?.scrollTop,
                interfaceTop: ui?.scrollTop,
                noTextX: text ? text.scrollWidth <= text.clientWidth : false,
                noInterfaceX: ui ? ui.scrollWidth <= ui.clientWidth : false,
                columns: columns ? getComputedStyle(columns).gridTemplateColumns.split(" ").length : 0,
                catalogColumns: page?.getAttribute("data-catalog-columns"),
                pageContained: page ? page.scrollHeight <= page.clientHeight : false,
              };
            })()`);
              ctx.assert(state.textTop > 0, "Text animations did not scroll.");
              ctx.assert(
                state.interfaceTop === 0,
                "Text wheel movement changed interface animations.",
              );
              ctx.assert(
                state.noTextX && state.noInterfaceX,
                "An animation section has horizontal overflow.",
              );
              ctx.assert(
                state.columns === 3 && state.catalogColumns === "3",
                `Expected the default three-column grid, received ${state.columns}.`,
              );
              ctx.assert(
                state.pageContained,
                "The animation page created a third content scrollbar.",
              );

              await ctx.eval(`(() => {
              document.querySelector(${JSON.stringify(selectors.text)})?.scrollTo(0, 0);
              document.querySelector(${JSON.stringify(selectors.interface)})?.scrollTo(0, 0);
            })()`);
              await wheelInside(ctx, selectors.interface);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.interface)})?.scrollTop > 0`,
                { timeoutMs: 10_000, label: "interface section wheel scroll" },
              );
              state = await ctx.eval(`(() => ({
              textTop: document.querySelector(${JSON.stringify(selectors.text)})?.scrollTop,
              interfaceTop: document.querySelector(${JSON.stringify(selectors.interface)})?.scrollTop,
            }))()`);
              ctx.assert(state.textTop === 0, "Interface wheel movement changed text animations.");
              ctx.assert(state.interfaceTop > 0, "Interface animations did not scroll.");

              await wheelInside(ctx, selectors.interface, 480, 2);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.animation)})
                  ?.getAttribute("data-catalog-columns") === "4"`,
                { timeoutMs: 10_000, label: "four-column Ctrl-wheel density" },
              );
              await waitDensityStep(ctx);
              await wheelInside(ctx, selectors.interface, -480, 2);
              await waitDensityStep(ctx);
              await wheelInside(ctx, selectors.interface, -480, 2);
              await waitDensityStep(ctx);
              await wheelInside(ctx, selectors.interface, -480, 2);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.animation)})
                  ?.getAttribute("data-catalog-columns") === "1"`,
                { timeoutMs: 10_000, label: "one-column Ctrl-wheel density" },
              );
              state = await ctx.eval(`(() => {
              const grids = [...document.querySelectorAll('[data-testid^="catalog-grid-"]')];
              return {
                columns: grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length),
                noX: grids.every((grid) => grid.scrollWidth <= grid.clientWidth),
              };
            })()`);
              ctx.assert(
                state.columns.every((count) => count === 1),
                `Ctrl-wheel did not synchronize both grids at one column: ${state.columns}.`,
              );
              ctx.assert(state.noX, "One-column density introduced horizontal overflow.");
              ctx.recordEvidence({
                type: "assertion",
                status: "passed",
                assertion: "Ctrl-wheel changed both independent catalog grids through four and one columns.",
              });

              await waitDensityStep(ctx);
              await wheelInside(ctx, selectors.interface, 480, 2);
              await waitDensityStep(ctx);
              await wheelInside(ctx, selectors.interface, 480, 2);
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.animation)})
                  ?.getAttribute("data-catalog-columns") === "3"`,
                { timeoutMs: 10_000, label: "restore three-column density" },
              );
            },
            screenshot: {
              ...STUDIO_SCREENSHOT_TARGETS,
              name: "independent-animation-scroll",
            },
          },
        );
      },
    },
    {
      name: "Search preserves sections",
      run: async (ctx) => {
        await proveWithScreenshotRetry(
          ctx,
          "Search keeps results in their original animation section and resets both scroll positions.",
          {
            voiceover: vo[2],
            action: async () => {
              await ctx.eval(`(() => {
              const text = document.querySelector(${JSON.stringify(selectors.text)});
              const ui = document.querySelector(${JSON.stringify(selectors.interface)});
              if (text) text.scrollTop = text.scrollHeight;
              if (ui) ui.scrollTop = ui.scrollHeight;
            })()`);
              await setSearch(ctx, "caption");
              await ctx.waitFor(
                `document.querySelector('[data-testid="catalog-section-interface-animation"]')
                ?.innerText.includes("没有匹配的预设")`,
                { timeoutMs: 10_000, label: "section-preserving search result" },
              );
              await waitForPaint(ctx);
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
              textCards: document.querySelector('[data-testid="catalog-section-text-animation"]')
                ?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
              interfaceCards: document.querySelector('[data-testid="catalog-section-interface-animation"]')
                ?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
              textTop: document.querySelector(${JSON.stringify(selectors.text)})?.scrollTop,
              interfaceTop: document.querySelector(${JSON.stringify(selectors.interface)})?.scrollTop,
              body: document.body.innerText,
            }))()`);
              ctx.assert(state.textCards > 0, "Matching text animations disappeared.");
              ctx.assert(
                state.interfaceCards === 0,
                "Search mixed results into interface animations.",
              );
              ctx.assert(
                state.body.includes("没有匹配的预设"),
                "The unmatched section has no empty state.",
              );
              ctx.assert(
                state.textTop === 0 && state.interfaceTop === 0,
                "Search did not reset both sections.",
              );
              ctx.assert(
                state.body.includes("文字动画") && state.body.includes("界面动画"),
                "Search removed an original section.",
              );
            },
            screenshot: {
              ...STUDIO_SCREENSHOT_TARGETS,
              name: "section-preserving-animation-search",
            },
          },
        );
      },
    },
    {
      name: "Delayed single-card preview",
      run: async (ctx) => {
        await proveWithScreenshotRetry(
          ctx,
          "Hover intent lazily starts at most one card preview at normal 1× speed.",
          {
            voiceover: vo[3],
            action: async () => {
              await setSearch(ctx, "");
              await ctx.waitFor(
                `document.querySelectorAll(${JSON.stringify(selectors.card)}).length === 100`,
                { timeoutMs: 10_000, label: "animation cards after clearing search" },
              );
              await waitForPaint(ctx);
              const cards = await visibleCardPoints(ctx, selectors.interface);
              ctx.assert(cards.length >= 2, "Two visible interface-animation cards are required.");

              await ctx.client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: cards[0].x,
                y: cards[0].y,
              });
              await ctx.eval(`new Promise((resolve) => setTimeout(() => resolve(true), 75))`, {
                awaitPromise: true,
              });
              await ctx.client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: 2,
                y: 2,
              });
              await ctx.eval(`new Promise((resolve) => setTimeout(() => resolve(true), 200))`, {
                awaitPromise: true,
              });
              ctx.assert(
                await ctx.eval(
                  `document.querySelectorAll(${JSON.stringify(selectors.card)} + " video").length === 0`,
                ),
                "A fast pointer pass initialized a preview.",
              );

              await ctx.client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: cards[0].x,
                y: cards[0].y,
              });
              await ctx.waitFor(
                `document.querySelectorAll(${JSON.stringify(selectors.card)} + " video").length === 1`,
                { timeoutMs: 15_000, label: "lazy card preview" },
              );
              await ctx.client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: cards[1].x,
                y: cards[1].y,
              });
              await ctx.waitFor(
                `(() => {
                const videos = document.querySelectorAll(${JSON.stringify(selectors.card)} + " video");
                const active = document.querySelector(
                  ${JSON.stringify(selectors.card)} + ${JSON.stringify(`[data-block-name="${cards[0].name}"]`)}
                );
                return videos.length === 1 && !active?.querySelector("video");
              })()`,
                { timeoutMs: 15_000, label: "single active card preview" },
              );
              await ctx.eval(`(() => {
                const video = document.querySelector(${JSON.stringify(selectors.card)} + " video");
                if (!(video instanceof HTMLVideoElement)) return false;
                video.playbackRate = 2;
                video.dispatchEvent(new Event("ratechange"));
                return true;
              })()`);
              await ctx.waitFor(
                `(() => {
                  const video = document.querySelector(${JSON.stringify(selectors.card)} + " video");
                  return video instanceof HTMLVideoElement
                    && video.playbackRate === 1
                    && video.defaultPlaybackRate === 1;
                })()`,
                { timeoutMs: 10_000, label: "normal preview playback rate" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
              videos: document.querySelectorAll(${JSON.stringify(selectors.card)} + " video").length,
              initialResources: performance.getEntriesByType("resource")
                .filter((entry) => entry.name.includes("blockPreviewRuntime")).length,
              playbackRate: document.querySelector(${JSON.stringify(selectors.card)} + " video")?.playbackRate,
              defaultPlaybackRate: document.querySelector(${JSON.stringify(selectors.card)} + " video")?.defaultPlaybackRate,
            }))()`);
              ctx.assert(
                state.videos === 1,
                `Expected one active preview, received ${state.videos}.`,
              );
              ctx.assert(
                state.initialResources === 1,
                `Preview runtime should be loaded once, received ${state.initialResources} resources.`,
              );
              ctx.assert(
                state.playbackRate === 1 && state.defaultPlaybackRate === 1,
                `Expected normal 1× preview playback, received ${state.playbackRate}.`,
              );
            },
            screenshot: {
              ...STUDIO_SCREENSHOT_TARGETS,
              name: "lazy-single-card-preview",
            },
          },
        );
      },
    },
    {
      name: "Scene sections and original add flow",
      run: async (ctx) => {
        await proveWithScreenshotRetry(
          ctx,
          "Scenes clean the old preview, keep two independent sections, and preserve card adding.",
          {
            voiceover: vo[4],
            action: async () => {
              await clickTextButton(ctx, "场景");
              await ctx.waitFor(
                `Boolean(document.querySelector(${JSON.stringify(selectors.scene)}))
                && document.body.innerText.includes("转场场景")
                && document.body.innerText.includes("背景场景")`,
                { timeoutMs: 20_000, label: "scene library sections" },
              );
              await waitForPaint(ctx);
              const firstCard = await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(selectors.transition)} + " " + ${JSON.stringify(selectors.card)});
              if (!(card instanceof HTMLElement)) return false;
              card.click();
              return true;
            })()`);
              ctx.assert(firstCard, "No transition-scene card was available to add.");
              await ctx.waitFor(
                `document.querySelector(${JSON.stringify(selectors.transition)})?.innerText.includes("已添加")`,
                { timeoutMs: 10_000, label: "original card add feedback" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
              const transition = document.querySelector('[data-testid="catalog-section-transition-scene"]');
              const background = document.querySelector('[data-testid="catalog-section-background-scene"]');
              const transitionScroll = document.querySelector(${JSON.stringify(selectors.transition)});
              const backgroundScroll = document.querySelector(${JSON.stringify(selectors.background)});
              return {
                animationAbsent: !document.querySelector(${JSON.stringify(selectors.animation)}),
                videos: document.querySelectorAll(${JSON.stringify(selectors.card)} + " video").length,
                transitionCount: transition?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
                backgroundCount: background?.querySelectorAll(${JSON.stringify(selectors.card)}).length,
                catalogColumns: document.querySelector(${JSON.stringify(selectors.scene)})
                  ?.getAttribute("data-catalog-columns"),
                independentRoots: transitionScroll !== backgroundScroll,
                noX: transitionScroll && backgroundScroll
                  ? transitionScroll.scrollWidth <= transitionScroll.clientWidth
                    && backgroundScroll.scrollWidth <= backgroundScroll.clientWidth
                  : false,
                added: transitionScroll?.innerText.includes("已添加"),
              };
            })()`);
              ctx.assert(
                state.animationAbsent,
                "Animation library remained mounted after the page switch.",
              );
              ctx.assert(
                state.videos === 0,
                "Animation preview resources survived the page switch.",
              );
              ctx.assert(
                state.transitionCount === 27,
                `Expected 27 transition scenes, received ${state.transitionCount}.`,
              );
              ctx.assert(
                state.backgroundCount === 24,
                `Expected 24 background scenes, received ${state.backgroundCount}.`,
              );
              ctx.assert(
                state.catalogColumns === "3",
                `Expected persisted three-column scenes, received ${state.catalogColumns}.`,
              );
              ctx.assert(state.independentRoots, "Scene sections share a scroll root.");
              ctx.assert(state.noX, "A scene section has horizontal overflow.");
              ctx.assert(state.added, "Clicking a scene card did not use the existing add flow.");
              ctx.recordEvidence({
                type: "assertion",
                status: "passed",
                assertion: "Clicking a scene card immediately showed the existing 已添加 feedback.",
              });
            },
            screenshot: {
              ...STUDIO_SCREENSHOT_TARGETS,
              name: "scene-library-sections-and-add",
            },
          },
        );
      },
    },
  ],
};
