import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("right-panel-controls");
const ADD_ENTRY = 'button[aria-label="Add side panel entry"], button[aria-label="添加侧面板入口"]';
const OUTPUT_FILES = 'button[aria-label="Output files"], button[aria-label="产出文件"]';
const PANEL_TOGGLE = '[data-testid="right-panel-toggle"]';
const OUTPUT_POPOVER = '[data-testid="conversation-files-popover"]';

async function ensureDesignPanel(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  if (await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)}))`)) await pressEscape(ctx);
  if (await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(ADD_ENTRY)}))`)) return;
  const hasSelectedSession = await ctx.eval(`window.__ipolloworkControl.snapshot().route.includes("/session/")`);
  if (!hasSelectedSession) {
    await ctx.waitFor(
      `window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`,
      { timeoutMs: 30_000, label: "create task action" },
    );
    await ctx.control("session.create_task");
    await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes("/session/")`, {
      timeoutMs: 60_000,
      label: "active task",
    });
  }
  await ctx.waitFor(
    `window.__ipolloworkControl.listActions().some((action) => action.id === "eval.design.seed_html" && !action.disabled)`,
    { timeoutMs: 30_000, label: "Design seed action" },
  );
  await ctx.control("eval.design.seed_html");
  await ctx.waitFor(`Boolean(document.querySelector('[data-testid="design-panel"]'))`, {
    timeoutMs: 30_000,
    label: "open Design panel",
  });
}

async function pressEscape(ctx) {
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

export default {
  id: "right-panel-controls",
  title: "Right-panel controls, tabs, and output files keep the active work in place",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the right-panel flow can run."
      : null;
  },
  steps: [
    {
      name: "The add button follows the final tab",
      run: async (ctx) => {
        await ctx.prove("The add action belongs to the tab strip", {
          voiceover: vo[0],
          action: async () => {
            await ensureDesignPanel(ctx);
            await ctx.trustedClick(ADD_ENTRY);
            await ctx.waitFor(`Boolean(document.querySelector('[data-slot="dropdown-menu-content"]'))`, {
              timeoutMs: 10_000,
              label: "side-panel launcher menu",
            });
          },
          assert: async () => {
            const metrics = await ctx.eval(`(() => {
              const add = document.querySelector(${JSON.stringify(ADD_ENTRY)});
              const tabs = Array.from(document.querySelectorAll('button[aria-label^="Select tab:"]'));
              const lastTab = tabs.at(-1);
              const expand = document.querySelector('button[aria-label="Expand panel"]');
              const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
              if (!add || !lastTab || !expand) return null;
              const addRect = add.getBoundingClientRect();
              const tabRect = lastTab.getBoundingClientRect();
              const expandRect = expand.getBoundingClientRect();
              return {
                addAfterTab: addRect.left >= tabRect.right - 1,
                addBeforeControls: addRect.right <= expandRect.left + 1,
                menuOpen: Boolean(menu),
                selectedLauncherItems: menu?.querySelectorAll('[aria-current="page"]').length ?? -1,
                highlightedLauncherItems: menu?.querySelectorAll('[data-highlighted]').length ?? -1,
                designDisabled: document.querySelector('[data-testid="side-panel-launcher-design"]')?.hasAttribute("data-disabled") ?? false,
                webDisabled: document.querySelector('[data-testid="side-panel-launcher-web"]')?.hasAttribute("data-disabled") ?? true,
              };
            })()`);
            ctx.assert(metrics?.addAfterTab, "The add action does not follow the final tab.");
            ctx.assert(metrics?.addBeforeControls, "The add action is still grouped with the panel controls.");
            ctx.assert(metrics?.menuOpen && metrics.selectedLauncherItems === 0 && metrics.highlightedLauncherItems === 0, `The launcher menu starts with an active or highlighted item: ${JSON.stringify(metrics)}`);
            ctx.assert(metrics?.designDisabled && !metrics.webDisabled, `Singleton and repeatable launchers do not expose the correct availability: ${JSON.stringify(metrics)}`);
          },
          screenshot: { name: "add-action-follows-tabs", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "The panel edge owns expand and collapse",
      run: async (ctx) => {
        await ctx.prove("The panel control moves to the open panel and preserves its tab", {
          voiceover: vo[1],
          action: async () => {
            if (await ctx.eval(`Boolean(document.querySelector('[data-slot="dropdown-menu-content"]'))`)) await pressEscape(ctx);
            const before = await ctx.eval(`(() => {
              const panelToggle = document.querySelector(${JSON.stringify(PANEL_TOGGLE)});
              const mainToggle = document.querySelector('[data-testid="session-header-actions"] ${PANEL_TOGGLE}');
              const expand = document.querySelector('button[aria-label="Expand panel"]');
              const close = document.querySelector('button[aria-label="Close panel"]');
              return { panelToggle: Boolean(panelToggle), mainToggle: Boolean(mainToggle), expand: Boolean(expand), close: Boolean(close) };
            })()`);
            ctx.assert(before.panelToggle && before.expand && !before.mainToggle && !before.close, `Unexpected open-panel controls: ${JSON.stringify(before)}`);
            await ctx.eval(`document.querySelector(${JSON.stringify(PANEL_TOGGLE)})?.click()`);
            await ctx.waitFor(`!document.querySelector(${JSON.stringify(ADD_ENTRY)})`, { timeoutMs: 10_000, label: "collapsed right panel" });
            await ctx.eval(`document.querySelector('[data-testid="session-header-actions"] ${PANEL_TOGGLE}')?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(ADD_ENTRY)}))`, { timeoutMs: 10_000, label: "restored right panel" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              activeTab: Boolean(document.querySelector('button[aria-label^="Select tab:"][aria-selected="true"]')),
              panelToggleCount: document.querySelectorAll(${JSON.stringify(PANEL_TOGGLE)}).length,
              expand: Boolean(document.querySelector('button[aria-label="Expand panel"]')),
            }))()`);
            ctx.assert(state.activeTab && state.panelToggleCount === 1 && state.expand, `The panel state was not restored: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "expand-and-collapse-controls", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Output files open above the current panel",
      run: async (ctx) => {
        await ctx.prove("Output files are a temporary overlay while work is open", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`document.querySelector(${JSON.stringify(OUTPUT_FILES)})?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)}))`, {
              timeoutMs: 10_000,
              label: "output files popover",
            });
            const fileCardCenter = await ctx.eval(`(() => {
              const card = document.querySelector(${JSON.stringify(OUTPUT_POPOVER)} + ' [data-testid="conversation-files-outputs-view"] button');
              if (!card) return null;
              const rect = card.getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            })()`);
            ctx.assert(fileCardCenter, "The output overlay did not render a file card.");
            await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: fileCardCenter.x, y: fileCardCenter.y });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const popover = document.querySelector(${JSON.stringify(OUTPUT_POPOVER)});
              const outputView = popover?.querySelector('[data-testid="conversation-files-outputs-view"]');
              const outputCard = outputView?.firstElementChild;
              const popoverRect = popover?.getBoundingClientRect();
              const outputViewRect = outputView?.getBoundingClientRect();
              const outputCardRect = outputCard?.getBoundingClientRect();
              const modeButtons = Array.from(popover?.querySelectorAll('[data-testid^="conversation-files-mode-"]') ?? []);
              return {
                popover: Boolean(popover),
                panelOpen: Boolean(document.querySelector(${JSON.stringify(ADD_ENTRY)})),
                selectedTab: Boolean(document.querySelector('button[aria-label^="Select tab:"][aria-selected="true"]')),
                compactWidth: Boolean(popoverRect && popoverRect.width <= 440.5),
                contentSizedHeight: Boolean(popoverRect && popoverRect.height < 360),
                opaqueSurface: Boolean(popover && !getComputedStyle(popover).backgroundColor.startsWith("rgba")),
                modeIconCount: modeButtons.reduce((count, button) => count + button.querySelectorAll("svg").length, 0),
                closeButton: Boolean(popover?.querySelector('button[aria-label="Close"], button[aria-label="关闭"]')),
                singleColumnFillsWidth: Boolean(outputViewRect && outputCardRect && outputCardRect.width >= outputViewRect.width - 1),
                fileCardShadow: outputCard ? getComputedStyle(outputCard.querySelector("button")).boxShadow : null,
                fileCardTransform: outputCard ? getComputedStyle(outputCard.querySelector("button")).transform : null,
              };
            })()`);
            ctx.assert(state.popover && state.panelOpen && state.selectedTab, `The output overlay replaced current work: ${JSON.stringify(state)}`);
            ctx.assert(state.compactWidth && state.contentSizedHeight && state.opaqueSurface, `The output overlay is not a compact opaque surface: ${JSON.stringify(state)}`);
            ctx.assert(state.modeIconCount === 0 && state.closeButton, `The output overlay header is not using the text-only mode control and close action: ${JSON.stringify(state)}`);
            ctx.assert(state.singleColumnFillsWidth, `A single output does not fill the compact list: ${JSON.stringify(state)}`);
            ctx.assert(state.fileCardShadow === "none" && state.fileCardTransform === "none", `The reused conversation file card adds lift or shadow on hover: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "output-files-over-current-panel", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Selecting or dismissing the overlay preserves navigation",
      run: async (ctx) => {
        await ctx.prove("Output selection closes the overlay and Escape dismisses it", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`document.querySelector('[data-testid="conversation-files-mode-directory"]')?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)} + ' [data-testid="conversation-files-directory-toolbar"]'))`, {
              timeoutMs: 10_000,
              label: "workspace directory in output overlay",
            });
            await ctx.eval(`(() => {
              const input = document.querySelector(${JSON.stringify(OUTPUT_POPOVER)} + ' input');
              if (!input) return false;
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, "entry.html");
              input.dispatchEvent(new Event("input", { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)} + ' button[role="treeitem"][title$="entry.html"]'))`, {
              timeoutMs: 10_000,
              label: "openable workspace file",
            });
            const selected = await ctx.eval(`(() => {
              const popover = document.querySelector(${JSON.stringify(OUTPUT_POPOVER)});
              const output = popover?.querySelector('button[role="treeitem"][title$="entry.html"]');
              output?.click();
              return Boolean(output);
            })()`);
            ctx.assert(selected, "No openable output was available in the file overlay.");
            await ctx.waitFor(`!document.querySelector(${JSON.stringify(OUTPUT_POPOVER)})`, { timeoutMs: 10_000, label: "overlay closed after selection" });
            await ctx.eval(`document.querySelector(${JSON.stringify(OUTPUT_FILES)})?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)}))`, { timeoutMs: 10_000, label: "reopened output files popover" });
            await pressEscape(ctx);
            await ctx.waitFor(`!document.querySelector(${JSON.stringify(OUTPUT_POPOVER)})`, { timeoutMs: 10_000, label: "overlay dismissed with Escape" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              popover: Boolean(document.querySelector(${JSON.stringify(OUTPUT_POPOVER)})),
              activeTab: Boolean(document.querySelector('button[aria-label^="Select tab:"][aria-selected="true"]')),
              panelToggleCount: document.querySelectorAll(${JSON.stringify(PANEL_TOGGLE)}).length,
            }))()`);
            ctx.assert(!state.popover && state.activeTab && state.panelToggleCount === 1, `The underlying panel was not preserved: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "output-overlay-dismissed", rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
