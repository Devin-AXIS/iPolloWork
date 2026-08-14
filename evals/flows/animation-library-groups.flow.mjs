import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("animation-library-groups");
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI_ENTRY = join(REPO_ROOT, "vendor/hyperframes/packages/cli/bin/hyperframes.mjs");

const PROJECT_SOURCE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #eef1f5; }
      body { font-family: Inter, Arial, sans-serif; }
      #demo-card {
        position: absolute; left: 570px; top: 290px; width: 780px; height: 500px;
        display: grid; place-items: center; border-radius: 64px;
        background: linear-gradient(145deg, #ffffff, #dce4ed);
        color: #17191d; font-size: 112px; font-weight: 750;
        box-shadow: 0 60px 140px rgba(36, 49, 64, 0.18);
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="6" data-width="1920" data-height="1080" data-fps="30">
      <div id="demo-card" class="clip" data-hf-id="demo-card" data-start="0" data-duration="6" data-track-index="1">Motion</div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.main = gsap.timeline({ paused: true });
    </script>
  </body>
</html>`;

const PROJECT_CONFIG = `${JSON.stringify(
  {
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
    paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
  },
  null,
  2,
)}\n`;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startPreview(projectDir) {
  const port = await availablePort();
  if (!port) throw new Error("Could not reserve a preview port.");
  const output = [];
  const child = spawn(
    process.execPath,
    [CLI_ENTRY, "preview", projectDir, "--port", String(port), "--no-open"],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`HyperFrames preview exited early (${child.exitCode}): ${output.join("").slice(-2000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return { child, port };
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for HyperFrames preview: ${output.join("").slice(-2000)}`);
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForPaint(ctx) {
  await ctx.eval(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    { awaitPromise: true },
  );
}

async function clickMatching(ctx, expression, failureMessage) {
  const clicked = await ctx.eval(`(() => {
    const button = ${expression};
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, failureMessage);
  await waitForPaint(ctx);
}

async function openAnimationTab(ctx) {
  const openedInspector = await ctx.eval(`(() => {
    const labels = new Set(["Properties", "属性"]);
    const animationVisible = [...document.querySelectorAll("button")]
      .some((candidate) => ["Animation", "动画"].includes(candidate.innerText.trim()));
    if (animationVisible) return true;
    const toggle = [...document.querySelectorAll("button")]
      .find((candidate) => labels.has(candidate.getAttribute("aria-label")));
    toggle?.click();
    return Boolean(toggle);
  })()`);
  ctx.assert(openedInspector, "The Properties inspector could not be opened.");
  await ctx.waitFor(
    `[...document.querySelectorAll("button")]
      .some((candidate) => ["Animation", "动画"].includes(candidate.innerText.trim()))`,
    { timeoutMs: 20_000, label: "Animation inspector tab" },
  );
  await clickMatching(
    ctx,
    `[...document.querySelectorAll("button")].find((candidate) => ["Animation", "动画"].includes(candidate.innerText.trim()))`,
    "The Animation inspector tab is unavailable.",
  );
  await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="animation-templates-tab"]\'))', {
    timeoutMs: 20_000,
    label: "Animation inspector",
  });
}

async function clearTimelineSelection(ctx) {
  const point = await ctx.eval(`(() => {
    const timeline = document.querySelector(".hf-timeline-scroll");
    if (!(timeline instanceof HTMLElement)) return null;
    const rect = timeline.getBoundingClientRect();
    return { x: rect.right - 40, y: rect.bottom - 30 };
  })()`);
  ctx.assert(point, "The timeline background is unavailable for clearing selection.");
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await ctx.client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await waitForPaint(ctx);
}

async function clickCardAction(ctx, templateId, action) {
  await clickMatching(
    ctx,
    `document.querySelector('[data-testid="animation-template-card"][data-template-id="${templateId}"] button[data-animation-action="${action}"]')`,
    `The ${action} action for ${templateId} is unavailable.`,
  );
}

const screenshotDefaults = {
  rejectText: ["Something went wrong", "Console errors in preview", "保存动画失败"],
};

export default {
  id: "animation-library-groups",
  title: "Animation templates are grouped by usage and editable in place",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 60_000,
      label: "iPolloWork control API",
    });
    ctx.appUrl = await ctx.eval("location.href");
    return null;
  },
  steps: [
    {
      name: "Animation library grouping, application, editing, and localization",
      run: async (ctx) => {
        const projectDir = await mkdtemp(join(tmpdir(), "ipw-animation-library-proof-"));
        let preview = null;

        try {
          await writeFile(join(projectDir, "index.html"), PROJECT_SOURCE);
          await writeFile(join(projectDir, "hyperframes.json"), PROJECT_CONFIG);
          preview = await startPreview(projectDir);
          const studioUrl = `http://127.0.0.1:${preview.port}/#project/${encodeURIComponent(basename(projectDir))}?v=1&t=0&tab=design&locale=zh&ipolloworkTheme=light`;
          await ctx.eval(`location.assign(${JSON.stringify(studioUrl)})`);
          await ctx.waitFor('document.title === "HyperFrames Studio"', {
            timeoutMs: 60_000,
            label: "isolated Video Studio",
          });
          await ctx.waitFor(
            'Boolean(document.querySelector(\'.hf-timeline-root [role="button"][aria-label^="选择 "], .hf-timeline-root [role="button"][aria-label^="Select "]\'))',
            { timeoutMs: 60_000, label: "demo-card timeline layer" },
          );

          await ctx.prove("Toolbar matches Figma and omits the inactive record prompt", {
            claim: "The timeline toolbar uses the Figma SVG dimensions, including the 6 by 16.667 pixel divider and 24 pixel diamond and trash assets, while the unselected inspector omits Record gesture.",
            voiceover: vo[0],
            action: async () => {
              const openedInspector = await ctx.eval(`(() => {
                if (document.body.innerText.includes("未选择任何元素")) return true;
                const labels = new Set(["Properties", "属性"]);
                const toggle = [...document.querySelectorAll("button")]
                  .find((candidate) => labels.has(candidate.getAttribute("aria-label")));
                toggle?.click();
                return Boolean(toggle);
              })()`);
              ctx.assert(openedInspector, "The Properties inspector could not be opened.");
              await ctx.waitFor('document.body.innerText.includes("未选择任何元素")', {
                timeoutMs: 20_000,
                label: "unselected property inspector",
              });
              await ctx.waitFor(
                `(() => {
                  const toolbar = document.querySelector('[data-testid="figma-timeline-toolbar"]');
                  return toolbar?.firstElementChild?.querySelectorAll('img').length >= 7;
                })()`,
                { timeoutMs: 20_000, label: "complete Figma timeline toolbar" },
              );
              await waitForPaint(ctx);
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const toolbar = document.querySelector('[data-testid="figma-timeline-toolbar"]');
                const leftGroup = toolbar?.firstElementChild;
                const icons = [...(leftGroup?.querySelectorAll('img') ?? [])].slice(0, 7);
                return {
                  sizes: icons.map((icon) => ({
                    width: icon.getBoundingClientRect().width,
                    height: icon.getBoundingClientRect().height,
                  })),
                  hasEmptyState: document.body.innerText.includes("未选择任何元素"),
                  hasAgentPrompt: document.body.innerText.includes("向 Agent 描述修改"),
                  hasRecordPrompt: document.body.innerText.includes("录制手势"),
                };
              })()`);
              const expected = [
                [16, 16],
                [16, 16],
                [6, 16.667],
                [16, 16],
                [16, 16],
                [24, 24],
                [24, 24],
              ];
              ctx.assert(state.sizes.length === expected.length, `Unexpected toolbar icons: ${JSON.stringify(state)}.`);
              state.sizes.forEach((size, index) => {
                const [width, height] = expected[index];
                ctx.assert(
                  Math.abs(size.width - width) < 0.1 && Math.abs(size.height - height) < 0.1,
                  `Toolbar icon ${index} has the wrong Figma dimensions: ${JSON.stringify(size)}.`,
                );
              });
              ctx.assert(state.hasEmptyState && state.hasAgentPrompt, "The unselected inspector is unavailable.");
              ctx.assert(!state.hasRecordPrompt, "The inactive Record gesture prompt is still visible.");
            },
            screenshot: {
              name: "figma-toolbar-without-record-prompt",
              requireText: ["未选择任何元素", "向 Agent 描述修改"],
              ...screenshotDefaults,
              rejectText: [...screenshotDefaults.rejectText, "录制手势"],
            },
          });

          await ctx.prove("AI editing status matches Figma below the video canvas", {
            claim: "While AI editing is active, a borderless teal status card sits below the canvas on a transparent row with a rotating pale-teal loader.",
            voiceover: vo[1],
            action: async () => {
              await ctx.eval(`window.postMessage({
                type: "ipollowork:studio-ai-editing",
                projectId: ${JSON.stringify(basename(projectDir))},
                active: true,
              }, "*")`);
              await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="studio-ai-editing-status"]\'))', {
                timeoutMs: 10_000,
                label: "AI editing canvas status",
              });
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const status = document.querySelector('[data-testid="studio-ai-editing-status"]');
                const canvas = document.querySelector('[data-preview-pan-surface="true"]');
                const controls = document.querySelector('[data-testid="figma-player-controls"]');
                const icon = status?.querySelector('svg');
                if (!(status instanceof HTMLElement) || !(canvas instanceof HTMLElement) || !(controls instanceof HTMLElement)) {
                  return null;
                }
                const statusRect = status.getBoundingClientRect();
                const canvasRect = canvas.getBoundingClientRect();
                const controlsRect = controls.getBoundingClientRect();
                const statusStyle = getComputedStyle(status);
                const iconStyle = icon ? getComputedStyle(icon) : null;
                return {
                  text: status.innerText.trim(),
                  width: statusRect.width,
                  height: statusRect.height,
                  background: statusStyle.backgroundColor,
                  borderWidth: statusStyle.borderTopWidth,
                  color: statusStyle.color,
                  iconColor: iconStyle?.color,
                  iconAnimation: iconStyle?.animationName,
                  belowCanvas: Math.abs(statusRect.top - canvasRect.bottom) < 1,
                  aboveControls: statusRect.bottom <= controlsRect.top,
                  centered: Math.abs(
                    statusRect.left + statusRect.width / 2 - (canvasRect.left + canvasRect.width / 2),
                  ) < 1,
                };
              })()`);
              ctx.assert(state, "The AI editing status or its canvas anchors are missing.");
              ctx.assert(state.text === "AI 修改视频中，建议不要手动修改", `Unexpected status copy: ${state.text}.`);
              ctx.assert(state.width >= 241 && state.height === 34, `Unexpected status size: ${JSON.stringify(state)}.`);
              ctx.assert(
                state.background === "rgb(8, 123, 130)" &&
                  state.borderWidth === "0px" &&
                  state.color === "rgb(169, 231, 234)",
                `Unexpected status card colors or border: ${JSON.stringify(state)}.`,
              );
              ctx.assert(
                state.iconColor === "rgb(169, 231, 234)" && state.iconAnimation !== "none",
                `The teal loader is not rotating: ${JSON.stringify(state)}.`,
              );
              ctx.assert(
                state.belowCanvas && state.aboveControls && state.centered,
                `The status is not directly below the centered canvas: ${JSON.stringify(state)}.`,
              );
            },
            screenshot: {
              name: "ai-editing-status-below-canvas",
              requireText: ["AI 修改视频中，建议不要手动修改"],
              ...screenshotDefaults,
            },
          });

          await ctx.eval(`window.postMessage({
            type: "ipollowork:studio-ai-editing",
            projectId: ${JSON.stringify(basename(projectDir))},
            active: false,
          }, "*")`);
          await ctx.waitFor('!document.querySelector(\'[data-testid="studio-ai-editing-status"]\')', {
            timeoutMs: 10_000,
            label: "AI editing canvas status to close",
          });
          await clearTimelineSelection(ctx);
          await openAnimationTab(ctx);

          await ctx.prove("No selection keeps the full library browsable and blocks application", {
            claim: "With no selected element, Animation shows all 43 templates; Apply performs no mutation and presents a white, black-text selection prompt.",
            voiceover: vo[2],
            action: async () => {
              await clickCardAction(ctx, "general-fade-in", "apply");
              await ctx.waitFor(
                `[...document.querySelectorAll('[role="status"]')]
                  .some((toast) => toast.innerText.includes("请先在视频播放区选中元素"))`,
                { timeoutMs: 10_000, label: "select-element application prompt" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const root = document.querySelector('[data-testid="animation-templates-tab"]');
                const body = root?.innerText ?? "";
                const prompt = "请先在视频播放区选中元素";
                const toast = [...document.querySelectorAll('[role="status"]')]
                  .find((candidate) => candidate.innerText.includes(prompt));
                const toastSurface = toast?.querySelector('[data-testid="studio-toast-surface"]');
                const toastText = toastSurface?.querySelector('span');
                const fadeIn = root?.querySelector('[data-testid="animation-template-card"][data-template-id="general-fade-in"]');
                return {
                  hasSearch: Boolean(root?.querySelector('input[type="search"]')),
                  filters: root?.querySelectorAll('[data-testid="animation-category-filter"]').length ?? -1,
                  hasSelectedSummary: body.includes("已选中："),
                  cards: root?.querySelectorAll('[data-testid="animation-template-card"]').length ?? -1,
                  fadeInState: fadeIn?.getAttribute("data-state"),
                  used: Boolean(root?.querySelector('[data-testid="animation-used-section"]')),
                  unused: Boolean(root?.querySelector('[data-testid="animation-unused-section"]')),
                  toastBackground: toastSurface ? getComputedStyle(toastSurface).backgroundColor : "",
                  toastColor: toastText ? getComputedStyle(toastText).color : "",
                  toastRadius: toastSurface ? getComputedStyle(toastSurface).borderRadius : "",
                  toastBorder: toastSurface ? getComputedStyle(toastSurface).borderTopWidth : "",
                  toastFont: toastText ? getComputedStyle(toastText).fontFamily : "",
                };
              })()`);
              ctx.assert(state.hasSearch, "The animation search field is missing.");
              ctx.assert(state.filters === 3, `Expected three library filters, received ${state.filters}.`);
              ctx.assert(!state.hasSelectedSummary, "A selected-element summary appeared without a selection.");
              ctx.assert(state.cards === 43, `Expected all 43 animation cards, received ${state.cards}.`);
              ctx.assert(state.fadeInState === "available", "Apply changed the unselected Fade In card.");
              ctx.assert(!state.used && !state.unused, "Usage groups appeared without a selected element.");
              ctx.assert(
                state.toastBackground === "rgb(255, 255, 255)" && state.toastColor === "rgb(0, 0, 0)",
                `Unexpected selection prompt styling: ${JSON.stringify(state)}.`,
              );
              ctx.assert(
                state.toastRadius === "6px" &&
                  state.toastBorder === "0px" &&
                  /system-ui|-apple-system|Segoe UI/.test(state.toastFont),
                `The selection prompt does not use the approved shape and system font: ${JSON.stringify(state)}.`,
              );
            },
            screenshot: {
              name: "animation-unselected-library",
              requireText: ["全部 43", "盒子与自动化", "文字动画", "淡入", "请先在视频播放区选中元素"],
              ...screenshotDefaults,
            },
          });

          await ctx.eval(`(() => {
            const dismiss = [...document.querySelectorAll('[role="status"]')]
              .find((toast) => toast.innerText.includes("请先在视频播放区选中元素"))
              ?.querySelector('button');
            dismiss?.click();
            return Boolean(dismiss);
          })()`);
          await waitForPaint(ctx);

          await ctx.prove("Selecting an element reveals categories without empty usage groups", {
            claim: "A selected element with no applied animation shows the category filters and available cards directly, without empty In use or Unused headers.",
            voiceover: vo[3],
            action: async () => {
              await clickMatching(
                ctx,
                'document.querySelector(\'.hf-timeline-root [role="button"][aria-label^="选择 "], .hf-timeline-root [role="button"][aria-label^="Select "]\')',
                "The demo-card timeline layer could not be selected.",
              );
              await ctx.waitFor(
                'document.querySelector(\'[data-testid="animation-category-filter"][data-category="all"]\')?.getAttribute("aria-pressed") === "true"',
                { timeoutMs: 20_000, label: "selected-element animation categories" },
              );
              await ctx.eval(`(() => {
                const input = document.querySelector('[data-testid="animation-templates-tab"] input[type="search"]');
                if (!(input instanceof HTMLInputElement)) return false;
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                setter?.call(input, "淡入");
                input.dispatchEvent(new Event("input", { bubbles: true }));
                return true;
              })()`);
              await waitForPaint(ctx);
            },
            assert: async () => {
              const state = await ctx.eval(`(() => ({
                filters: [...document.querySelectorAll('[data-testid="animation-category-filter"]')]
                  .map((button) => {
                    const style = getComputedStyle(button);
                    return {
                      category: button.dataset.category,
                      label: button.innerText.trim(),
                      backgroundColor: style.backgroundColor,
                      color: style.color,
                    };
                  }),
                used: Boolean(document.querySelector('[data-testid="animation-used-section"]')),
                unused: Boolean(document.querySelector('[data-testid="animation-unused-section"]')),
                cards: document.querySelectorAll('[data-testid="animation-template-card"]').length,
                body: document.querySelector('[data-testid="animation-templates-tab"]')?.innerText ?? "",
              }))()`);
              ctx.assert(
                state.filters.length === 3 &&
                  state.filters[0]?.category === "all" &&
                  state.filters[0]?.label.startsWith("全部 ") &&
                  state.filters[1]?.category === "box-automation" &&
                  state.filters[1]?.label === "盒子与自动化" &&
                  state.filters[2]?.category === "text" &&
                  state.filters[2]?.label === "文字动画",
                `Unexpected category filters: ${JSON.stringify(state.filters)}.`,
              );
              ctx.assert(
                state.filters[0]?.backgroundColor === "rgb(0, 0, 0)" &&
                  state.filters[0]?.color === "rgb(255, 255, 255)" &&
                  state.filters.slice(1).every(
                    (filter) =>
                      filter.backgroundColor === "rgb(245, 246, 249)" &&
                      filter.color === "rgb(90, 103, 116)",
                  ),
                `Category filter backgrounds are incorrect: ${JSON.stringify(state.filters)}.`,
              );
              ctx.assert(!state.used && !state.unused, "Empty usage group headers are still present.");
              ctx.assert(state.cards === 1, `Search should leave one Fade In card, received ${state.cards}.`);
              ctx.assert(!state.body.includes("已使用") && !state.body.includes("未使用"), "Empty usage group labels are still visible.");
            },
            screenshot: {
              name: "animation-category-usage-groups",
              requireText: ["全部", "盒子与自动化", "文字动画", "淡入"],
              ...screenshotDefaults,
              rejectText: [...screenshotDefaults.rejectText, "已使用", "未使用"],
            },
          });

          await ctx.eval(`(() => {
            const input = document.querySelector('[data-testid="animation-templates-tab"] input[type="search"]');
            if (!(input instanceof HTMLInputElement)) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(input, "");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          })()`);
          await waitForPaint(ctx);

          await ctx.prove("Applying an unused animation promotes its card into In use", {
            claim: "Apply exposes a loading state, then moves Fade In to In use with the applied badge, Edit, and Remove actions.",
            voiceover: vo[4],
            action: async () => {
              const observing = await ctx.eval(`(() => {
                const card = document.querySelector('[data-testid="animation-template-card"][data-template-id="general-fade-in"]');
                if (!card) return false;
                window.__animationLoadingSeen = card.getAttribute("data-state") === "loading";
                const observer = new MutationObserver(() => {
                  if (card.getAttribute("data-state") === "loading") window.__animationLoadingSeen = true;
                });
                observer.observe(card, { attributes: true, attributeFilter: ["data-state"] });
                window.__animationLoadingObserver = observer;
                return true;
              })()`);
              ctx.assert(observing, "Fade In could not be observed before applying.");
              await clickCardAction(ctx, "general-fade-in", "apply");
              await ctx.waitFor(
                'document.querySelector(\'[data-testid="animation-template-card"][data-template-id="general-fade-in"]\')?.getAttribute("data-state") === "applied"',
                { timeoutMs: 30_000, label: "Fade In applied card state" },
              );
              const hoverPoint = await ctx.eval(`(() => {
                const preview = document.querySelector('[data-testid="animation-template-card"][data-template-id="general-fade-in"] .hf-animation-template-preview');
                if (!(preview instanceof HTMLElement)) return null;
                const rect = preview.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
              })()`);
              ctx.assert(hoverPoint, "The applied Fade In preview could not be hovered.");
              await ctx.client.send("Input.dispatchMouseEvent", {
                type: "mouseMoved",
                x: hoverPoint.x,
                y: hoverPoint.y,
              });
              await ctx.waitFor(
                'getComputedStyle(document.querySelector(\'[data-testid="animation-card-hover-border"]\')).opacity === "1"',
                { timeoutMs: 10_000, label: "complete card hover border" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                window.__animationLoadingObserver?.disconnect();
                const card = document.querySelector('[data-testid="animation-template-card"][data-template-id="general-fade-in"]');
                const preview = card?.querySelector('.hf-animation-template-preview');
                const hoverBorder = card?.querySelector('[data-testid="animation-card-hover-border"]');
                const removeButton = card?.querySelector('button[data-animation-action="remove"]');
                const hoverStyle = hoverBorder ? getComputedStyle(hoverBorder) : null;
                const removeStyle = removeButton ? getComputedStyle(removeButton) : null;
                const previewRect = preview?.getBoundingClientRect();
                const hoverRect = hoverBorder?.getBoundingClientRect();
                return {
                  loadingSeen: window.__animationLoadingSeen === true,
                  section: card?.closest('section')?.getAttribute("data-testid"),
                  state: card?.getAttribute("data-state"),
                  applied: card?.getAttribute("data-applied"),
                  edit: Boolean(card?.querySelector('button[data-animation-action="edit"]')),
                  remove: Boolean(card?.querySelector('button[data-animation-action="remove"]')),
                  text: card?.innerText ?? "",
                  hoverOpacity: hoverStyle?.opacity,
                  hoverBorders: hoverStyle
                    ? [hoverStyle.borderTopWidth, hoverStyle.borderRightWidth, hoverStyle.borderBottomWidth, hoverStyle.borderLeftWidth]
                    : [],
                  hoverBoundsMatch: Boolean(previewRect && hoverRect) &&
                    Math.abs(previewRect.left - hoverRect.left) < 0.5 &&
                    Math.abs(previewRect.top - hoverRect.top) < 0.5 &&
                    Math.abs(previewRect.right - hoverRect.right) < 0.5 &&
                    Math.abs(previewRect.bottom - hoverRect.bottom) < 0.5,
                  removeBorders: removeStyle
                    ? [removeStyle.borderTopWidth, removeStyle.borderRightWidth, removeStyle.borderBottomWidth, removeStyle.borderLeftWidth]
                    : [],
                  usedSection: Boolean(document.querySelector('[data-testid="animation-used-section"]')),
                  unusedSection: Boolean(document.querySelector('[data-testid="animation-unused-section"]')),
                  toastBackground: (() => {
                    const toast = [...document.querySelectorAll('[role="status"]')]
                      .find((candidate) => candidate.innerText.includes("动画已应用"));
                    const surface = toast?.querySelector('[data-testid="studio-toast-surface"]');
                    return surface ? getComputedStyle(surface).backgroundColor : "";
                  })(),
                  toastColor: (() => {
                    const toast = [...document.querySelectorAll('[role="status"]')]
                      .find((candidate) => candidate.innerText.includes("动画已应用"));
                    const text = toast?.querySelector('[data-testid="studio-toast-surface"] span');
                    return text ? getComputedStyle(text).color : "";
                  })(),
                };
              })()`);
              ctx.assert(state.loadingSeen, "The apply loading state was never observable.");
              ctx.assert(state.section === "animation-used-section", `Fade In stayed in ${state.section}.`);
              ctx.assert(state.state === "applied" && state.applied === "true", "Fade In lacks its applied state markers.");
              ctx.assert(state.edit && state.remove, "Edit or Remove is missing from the applied card.");
              ctx.assert(state.text.includes("已应用"), "The applied badge is missing.");
              ctx.assert(state.usedSection && state.unusedSection, "Usage groups did not appear after applying an animation.");
              ctx.assert(
                state.toastBackground === "rgb(255, 255, 255)" && state.toastColor === "rgb(0, 0, 0)",
                `Unexpected applied toast styling: ${JSON.stringify(state)}.`,
              );
              ctx.assert(
                state.hoverOpacity === "1" &&
                  state.hoverBoundsMatch &&
                  state.hoverBorders.every((width) => width === "2px"),
                `The hovered card does not show a complete inset border: ${JSON.stringify(state)}.`,
              );
              ctx.assert(
                state.removeBorders.length === 4 && state.removeBorders.every((width) => width === "0px"),
                `Remove still has an outline: ${JSON.stringify(state.removeBorders)}.`,
              );
            },
            screenshot: {
              name: "animation-applied-card",
              requireText: ["淡入", "已应用", "编辑", "取消应用"],
              ...screenshotDefaults,
            },
          });

          await ctx.prove("Edit opens a compact localized animation settings popover", {
            claim: "Edit opens a wider anchored popover with direct timing inputs, speed, loop, and a single done action.",
            voiceover: vo[5],
            action: async () => {
              await clickCardAction(ctx, "general-fade-in", "edit");
              await ctx.waitFor('Boolean(document.querySelector(\'[data-testid="animation-editor-popover"]\'))', {
                timeoutMs: 20_000,
                label: "animation editor popover",
              });
              await clickMatching(
                ctx,
                'document.querySelector(\'[data-testid="animation-editor-popover"] [data-animation-control="loop"]\')',
                "The loop control is unavailable.",
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const editor = document.querySelector('[data-testid="animation-editor-popover"]');
                return {
                  text: editor?.innerText ?? "",
                  dialog: editor?.getAttribute("role"),
                  speed: Boolean(editor?.querySelector('[data-animation-control="speed"]')),
                  loop: editor?.querySelector('[data-animation-control="loop"]')?.getAttribute("aria-checked"),
                  done: Boolean(editor?.querySelector('button[data-animation-action="done"]')),
                  remove: Boolean(editor?.querySelector('button[data-animation-action="remove"]')),
                  width: editor?.getBoundingClientRect().width,
                  timeInputs: [...(editor?.querySelectorAll('input[type="number"]') ?? [])].map((input) => {
                    const style = getComputedStyle(input);
                    return { width: input.getBoundingClientRect().width, appearance: style.appearance };
                  }),
                };
              })()`);
              ctx.assert(state.dialog === "dialog", "The editor is not exposed as a dialog.");
              for (const label of ["开始", "结束", "倍速", "循环播放", "完成"]) {
                ctx.assert(state.text.includes(label), `${label} is missing from the editor.`);
              }
              ctx.assert(!state.text.includes("预览"), "The removed preview block is still visible.");
              ctx.assert(!state.text.includes("取消应用") && !state.remove, "Remove is still visible inside the editor.");
              ctx.assert(state.speed && state.done, "Speed or Done is missing from the editor.");
              ctx.assert(state.loop === "true", "Loop did not update in the editor.");
              ctx.assert(
                state.width === 200 &&
                  state.timeInputs.length === 2 &&
                  state.timeInputs.every((input) => input.width >= 30 && input.appearance === "textfield"),
                `The direct timing inputs are still too narrow or expose steppers: ${JSON.stringify(state)}.`,
              );
            },
            screenshot: {
              name: "animation-editor-popover",
              requireText: ["开始", "结束", "倍速", "循环播放", "完成"],
              ...screenshotDefaults,
            },
          });

          await clickMatching(
            ctx,
            'document.querySelector(\'[data-testid="animation-editor-popover"] button[data-animation-action="done"]\')',
            "The edited animation could not be saved.",
          );
          await ctx.waitFor('!document.querySelector(\'[data-testid="animation-editor-popover"]\')', {
            timeoutMs: 30_000,
            label: "saved editor to close",
          });

          await ctx.prove("Remove returns the animation to Unused and the whole module switches to English", {
            claim: "Remove returns Fade In to the direct available list, hides the now-empty usage groups, and a live locale switch updates the category labels.",
            voiceover: vo[6],
            action: async () => {
              await clickCardAction(ctx, "general-fade-in", "remove");
              await ctx.waitFor(
                'document.querySelector(\'[data-testid="animation-template-card"][data-template-id="general-fade-in"]\')?.getAttribute("data-state") === "available"',
                { timeoutMs: 30_000, label: "Fade In returned to Unused" },
              );
              await ctx.eval('window.postMessage({ type: "ipollowork:studio-locale", locale: "en" }, "*")');
              await ctx.waitFor(
                'document.querySelector(\'[data-testid="animation-category-filter"][data-category="all"]\')?.innerText.trim().startsWith("All ")',
                { timeoutMs: 20_000, label: "English animation module" },
              );
            },
            assert: async () => {
              const state = await ctx.eval(`(() => {
                const card = document.querySelector('[data-testid="animation-template-card"][data-template-id="general-fade-in"]');
                const root = document.querySelector('[data-testid="animation-templates-tab"]');
                return {
                  section: card?.closest('section')?.getAttribute("data-testid"),
                  state: card?.getAttribute("data-state"),
                  filters: [...document.querySelectorAll('[data-testid="animation-category-filter"]')]
                    .map((button) => button.innerText.trim()),
                  body: root?.innerText ?? "",
                };
              })()`);
              ctx.assert(!state.section, `Fade In unexpectedly remained inside ${state.section}.`);
              ctx.assert(state.state === "available", `Unexpected final Fade In state: ${state.state}.`);
              ctx.assert(
                state.filters.length === 3 &&
                  state.filters[0]?.startsWith("All ") &&
                  state.filters[1] === "Box & Automation" &&
                  state.filters[2] === "Text",
                `Unexpected English filters: ${JSON.stringify(state.filters)}.`,
              );
              ctx.assert(!state.body.includes("In use") && !state.body.includes("Unused"), "Empty English group labels are still visible.");
              ctx.assert(!state.body.includes("已使用") && !state.body.includes("未使用"), "Chinese group labels remained after the locale switch.");
            },
            screenshot: {
              name: "animation-removed-english",
              requireText: ["All", "Box & Automation", "Text", "Fade In"],
              ...screenshotDefaults,
              rejectText: [...screenshotDefaults.rejectText, "In use", "Unused", "已使用", "未使用"],
            },
          });
        } finally {
          await stopPreview(preview?.child);
          await rm(projectDir, { recursive: true, force: true });
          if (ctx.appUrl) {
            try {
              await ctx.eval(`location.assign(${JSON.stringify(ctx.appUrl)})`);
            } catch {
              // Navigation tears down the isolated Studio execution context.
            }
          }
        }
      },
    },
  ],
};
