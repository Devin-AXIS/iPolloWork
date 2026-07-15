import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("design-slide-editing");
const activeSlideIndex = "[...document.querySelectorAll('.slide')].findIndex((slide) => slide.getAttribute('aria-hidden') === 'false')";

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
          screenshot: { name: "edit-mode-keeps-second-slide", requireText: ["Edit page", "2 / 3", "Edit second slide"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Native and compact controls continue navigation while editing",
      run: async (ctx) => {
        await ctx.prove("The deck's native next button and the compact pager both work during editing, so another slide can be selected immediately", {
          voiceover: vo[1],
          action: async () => {
            await clickFrame(ctx, '[data-action="next"]', "Edit-mode native next slide");
            await waitForFrame(ctx, `${activeSlideIndex} === 2`, "third slide after native navigation");
            await ctx.trustedClick('[aria-label="Previous slide"]');
            await waitForFrame(ctx, `${activeSlideIndex} === 1`, "second slide after compact navigation");
            await clickFrame(ctx, "h1", "Select second-slide heading");
          },
          assert: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"design-floating-toolbar\"]'))", { timeoutMs: 10_000, label: "second-slide editing toolbar" });
            const page = await frameEval(ctx, activeSlideIndex);
            const state = await ctx.eval(`(() => ({
              editing: document.querySelector('[aria-label="Edit page"]')?.getAttribute('data-state') || '',
              pager: document.querySelector('[data-testid="design-deck-navigation"]')?.textContent || '',
              textTools: Boolean(document.querySelector('[aria-label="Edit selected text"]')),
              hasWorkspaceFilePicker: Boolean(document.querySelector('[aria-label="HTML file"]')),
              hasVersionPicker: Boolean(document.querySelector('[aria-label="Design version"]')),
            }))()`);
            ctx.assert(page === 1 && state.pager.includes("2 / 3") && state.textTools && !state.hasWorkspaceFilePicker && !state.hasVersionPicker, `Editing navigation state is wrong: ${JSON.stringify({ ...state, page })}`);
          },
          screenshot: { name: "native-and-compact-navigation-in-edit-mode", requireText: ["2 / 3", "Edit second slide", "Edit text"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
