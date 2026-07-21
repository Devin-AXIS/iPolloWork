import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("design-slide-editing");
const activeSlideIndex = "[...document.querySelectorAll('.slide')].findIndex((slide) => slide.getAttribute('aria-hidden') === 'false')";
const activeSlideHeading = '.slide[aria-hidden="false"] h1';
const editedHeading = "Edited directly in Design";

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.eval(`(() => {
    const stop = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Stop' && !button.disabled);
    stop?.click();
    return Boolean(stop);
  })()`);
  await ctx.waitFor("window.__ipolloworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)", { timeoutMs: 30_000, label: "create task action" });
  await ctx.control("session.create_task");
  await ctx.waitFor("window.__ipolloworkControl.snapshot().route.includes('/session/')", { timeoutMs: 60_000, label: "active task" });
}

async function withPreviewClient(ctx, callback) {
  const targets = await listTargets(ctx.cdpBaseUrl);
  const target = targets.find((entry) => entry.type === "iframe" && entry.url === "about:srcdoc" && entry.webSocketDebuggerUrl);
  if (!target) return null;
  const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
  try {
    return await callback(client);
  } finally {
    client.close();
  }
}

async function frameEval(ctx, expression) {
  return withPreviewClient(ctx, (client) => evaluate(client, expression));
}

async function waitForFrame(ctx, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (await frameEval(ctx, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function clickFrame(ctx, selector, label) {
  const clicked = await withPreviewClient(ctx, async (client) => evaluate(client, `(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return null;
      target.click();
      return true;
    })()`));
  ctx.assert(clicked, `${label} was not available.`);
}

async function editAndMoveFrameHeading(ctx) {
  const result = await withPreviewClient(ctx, async (client) => {
    const beganEditing = await evaluate(client, `(() => {
      const heading = document.querySelector(${JSON.stringify(activeSlideHeading)});
      if (!heading) return false;
      heading.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return heading.getAttribute("contenteditable") === "true";
    })()`);
    if (!beganEditing) return null;
    return evaluate(client, `(() => {
      const heading = document.querySelector(${JSON.stringify(activeSlideHeading)});
      if (!heading) return null;
      heading.textContent = ${JSON.stringify(editedHeading)};
      heading.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(editedHeading)} }));
      heading.blur();
      const overlay = document.querySelector("#ipollowork-design-transform-overlay");
      if (!overlay) return null;
      const rect = overlay.getBoundingClientRect();
      overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, clientX: rect.left + 10, clientY: rect.top + 10 }));
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 1, clientX: rect.left + 34, clientY: rect.top + 26 }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, clientX: rect.left + 34, clientY: rect.top + 26 }));
      return { text: heading.textContent || "", left: heading.style.left, top: heading.style.top };
    })()`);
  });
  ctx.assert(result?.text === editedHeading && result.left === "24px" && result.top === "16px", `Direct edit or drag did not stick: ${JSON.stringify(result)}`);
}

async function openDeck(ctx) {
  await ctx.control("eval.design.seed_deck");
  await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", { timeoutMs: 30_000, label: "initial Design preview" });
  await waitForFrame(ctx, "document.title === 'iPolloWork Slide Editing Demo'", "deck preview");
}

export default {
  id: "design-slide-editing",
  title: "Multi-slide Design editing preserves the active page and native navigation",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the deck Design flow can run."
      : null;
  },
  steps: [
    {
      name: "Entering edit mode preserves the current slide",
      run: async (ctx) => {
        await ctx.prove("Opening Edit page on slide two keeps the same loaded deck and exposes a compact page indicator", {
          voiceover: vo[0],
          action: async () => {
            await ensureSession(ctx);
            await openDeck(ctx);
            await clickFrame(ctx, '[data-action="next"]', "Preview next slide");
            await waitForFrame(ctx, `${activeSlideIndex} === 1`, "second preview slide");
            await ctx.eval(`(() => {
              const frame = document.querySelector('[data-testid="design-panel"] iframe');
              if (!frame) return false;
              frame.dataset.slideEditingIdentity = crypto.randomUUID();
              return true;
            })()`);
            await ctx.trustedClick('[aria-label="Edit page"]');
          },
          assert: async () => {
            await waitForFrame(ctx, `${activeSlideIndex} === 1 && document.documentElement.dataset.ipolloworkDesignMode === 'editing'`, "slide two remains in edit mode");
            await ctx.waitFor(`(() => {
              const frame = document.querySelector('[data-testid="design-panel"] iframe');
              const pager = document.querySelector('[data-testid="design-deck-navigation"]');
              return Boolean(frame?.dataset.slideEditingIdentity) && pager?.textContent?.includes('2 / 3');
            })()`, { timeoutMs: 10_000, label: "slide two remains in edit mode" });
          },
          screenshot: { name: "edit-mode-keeps-second-slide", requireText: ["Edit page", "2 / 3"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Native and compact controls continue navigation while editing",
      run: async (ctx) => {
        await ctx.prove("The deck stays paged while its heading is typed into directly and dragged to a new position", {
          voiceover: vo[1],
          action: async () => {
            await clickFrame(ctx, '[data-action="next"]', "Edit-mode native next slide");
            await waitForFrame(ctx, `${activeSlideIndex} === 2`, "third slide after native navigation");
            await ctx.trustedClick('[aria-label="Previous slide"]');
            await waitForFrame(ctx, `${activeSlideIndex} === 1`, "second slide after compact navigation");
            await clickFrame(ctx, activeSlideHeading, "Select second-slide heading");
            await editAndMoveFrameHeading(ctx);
          },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"design-floating-toolbar\"]'))", { timeoutMs: 10_000, label: "second-slide editing toolbar" });
            const page = await frameEval(ctx, activeSlideIndex);
            const frameState = await frameEval(ctx, `(() => {
              const heading = document.querySelector(${JSON.stringify(activeSlideHeading)});
              return { text: heading?.textContent || "", left: heading?.style.left || "", top: heading?.style.top || "" };
            })()`);
            const state = await ctx.eval(`(() => ({
              editing: document.querySelector('[aria-label="Edit page"]')?.getAttribute('data-state') || '',
              pager: document.querySelector('[data-testid="design-deck-navigation"]')?.textContent || '',
              textTools: Boolean(document.querySelector('[aria-label="Edit selected text"]')),
              hasWorkspaceFilePicker: Boolean(document.querySelector('[aria-label="HTML file"]')),
              hasVersionPicker: Boolean(document.querySelector('[aria-label="Design version"]')),
            }))()`);
            ctx.assert(page === 1 && state.pager.includes("2 / 3") && state.textTools && frameState?.text === editedHeading && frameState.left === "24px" && frameState.top === "16px" && !state.hasWorkspaceFilePicker && !state.hasVersionPicker, `Editing navigation state is wrong: ${JSON.stringify({ ...state, frameState, page })}`);
          },
          screenshot: { name: "native-and-compact-navigation-in-edit-mode", requireText: ["2 / 3", "Edit text"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "HTML and presentation downloads remain available",
      run: async (ctx) => {
        await ctx.prove("The Design download menu keeps the clean HTML file alongside the existing PDF and PPTX presentation exports", {
          voiceover: vo[2],
          action: async () => {
            await ctx.trustedClick('[aria-label="Download"]');
          },
          assert: async () => {
            const formats = await ctx.eval(`(() => document.body.innerText)()`);
            ctx.assert(formats.includes("Download HTML") && formats.includes("Download PDF") && formats.includes("Download PPTX"), `Design download formats are incomplete: ${formats}`);
          },
          screenshot: { name: "html-pdf-pptx-downloads", requireText: ["Download HTML", "Download PDF", "Download PPTX"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
