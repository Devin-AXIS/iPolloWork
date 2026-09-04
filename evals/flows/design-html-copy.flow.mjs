import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("design-html-copy");
const COPY_BUTTON = '[data-testid="copy-selected-html"]';
const HTML_TEXTAREA = '[aria-label="Selected element HTML code"]';

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.eval(`(() => {
    const stop = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Stop' && !button.disabled);
    stop?.click();
    return Boolean(stop);
  })()`);
  await ctx.waitFor("window.__ipolloworkControl.listActions().some((action) => action.id === 'session.create_task' && !action.disabled)", {
    timeoutMs: 30_000,
    label: "create task action",
  });
  await ctx.control("session.create_task");
  await ctx.waitFor("window.__ipolloworkControl.snapshot().route.includes('/session/')", {
    timeoutMs: 60_000,
    label: "active task",
  });
}

async function selectPreviewHeading(ctx) {
  const selected = await ctx.eval(`(() => {
    const frame = document.querySelector('[data-testid="design-panel"] iframe');
    const heading = frame?.contentDocument?.querySelector("h1");
    if (!heading) return false;
    heading.click();
    return true;
  })()`);
  ctx.assert(selected, "The seeded Design heading was not available.");
}

async function openHtmlInspector(ctx) {
  await ensureSession(ctx);
  await ctx.waitFor("window.__ipolloworkControl.listActions().some((action) => action.id === 'eval.design.seed_html' && !action.disabled)", {
    timeoutMs: 30_000,
    label: "Design seed action",
  });
  await ctx.control("eval.design.seed_html");
  await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", {
    timeoutMs: 30_000,
    label: "loaded Design preview",
  });
  await new Promise((resolve) => setTimeout(resolve, 750));
  await ctx.eval("document.querySelector('[aria-label=\"Edit\"]')?.click()");
  await ctx.waitFor("document.querySelector('[aria-label=\"Edit\"]')?.getAttribute('aria-checked') === 'true'", {
    timeoutMs: 10_000,
    label: "enabled Design editing",
  });
  await selectPreviewHeading(ctx);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"design-floating-toolbar\"]'))", {
    timeoutMs: 10_000,
    label: "selected Design heading",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await ctx.eval("document.querySelector('[data-testid=\"design-properties-button\"]')?.click()");
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(COPY_BUTTON)}))`, {
    timeoutMs: 10_000,
    label: "HTML copy action",
  });
  await ctx.eval(`(() => {
    const textarea = document.querySelector(${JSON.stringify(HTML_TEXTAREA)});
    textarea?.closest('section')?.scrollIntoView({ block: 'end', behavior: 'instant' });
    return Boolean(textarea);
  })()`);
}

async function copiedState(ctx) {
  return ctx.eval(`(() => {
    const button = document.querySelector(${JSON.stringify(COPY_BUTTON)});
    const textarea = document.querySelector(${JSON.stringify(HTML_TEXTAREA)});
    return {
      buttonText: button?.textContent?.trim() || '',
      disabled: button?.disabled ?? true,
      html: textarea?.value || '',
      label: button?.getAttribute('aria-label') || '',
    };
  })()`);
}

export default {
  id: "design-html-copy",
  title: "Selected Design element HTML can be copied repeatedly from the inspector",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the Design HTML copy flow can run."
      : null;
  },
  steps: [
    {
      name: "The HTML section exposes a right-aligned copy icon",
      run: async (ctx) => {
        await ctx.prove("The selected element HTML has a copy action in the section heading", {
          voiceover: vo[0],
          action: async () => {
            await openHtmlInspector(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const button = document.querySelector(${JSON.stringify(COPY_BUTTON)});
              const section = button?.closest('section');
              const heading = section?.querySelector('h3');
              const textarea = section?.querySelector(${JSON.stringify(HTML_TEXTAREA)});
              const buttonRect = button?.getBoundingClientRect();
              const headingRect = heading?.getBoundingClientRect();
              return {
                heading: heading?.textContent?.trim() || '',
                html: textarea?.value || '',
                copyIcon: Boolean(button?.querySelector('.lucide-copy')),
                rightAligned: Boolean(buttonRect && headingRect && buttonRect.left > headingRect.right),
                disabled: button?.disabled ?? true,
              };
            })()`);
            ctx.assert(state.heading === "HTML" && Boolean(state.html), `The HTML section is incomplete: ${JSON.stringify(state)}`);
            ctx.assert(state.copyIcon && state.rightAligned && !state.disabled, `The copy action is not ready: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "html-copy-action", requireText: ["HTML"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Clicking copies the exact selected HTML",
      run: async (ctx) => {
        await ctx.prove("One click copies the complete selected element HTML", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`document.querySelector(${JSON.stringify(COPY_BUTTON)})?.click()`);
          },
          assert: async () => {
            const state = await copiedState(ctx);
            const clipboard = await ctx.eval("navigator.clipboard.readText()", { awaitPromise: true });
            ctx.assert(Boolean(state.html) && clipboard === state.html, "The clipboard does not match the selected element HTML.");
          },
        });
      },
    },
    {
      name: "Copy feedback lasts two seconds",
      run: async (ctx) => {
        await ctx.prove("The copied label and check icon appear immediately, then restore after two seconds", {
          voiceover: vo[2],
          assert: async () => {
            const feedback = await copiedState(ctx);
            ctx.assert(Boolean(feedback.buttonText) && !feedback.disabled, `Copy feedback was not visible: ${JSON.stringify(feedback)}`);
            await ctx.screenshot("html-copy-feedback", {
              claim: "The HTML copy action visibly confirms success",
              voiceover: vo[2],
              requireText: ["HTML", feedback.buttonText],
              rejectText: ["Something went wrong"],
            });
            await ctx.waitFor(`(() => {
              const button = document.querySelector(${JSON.stringify(COPY_BUTTON)});
              return !button?.textContent?.trim() && Boolean(button?.querySelector('.lucide-copy'));
            })()`, { timeoutMs: 3_000, label: "two-second copy feedback to clear" });
          },
          screenshot: { name: "html-copy-feedback-restored", requireText: ["HTML"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Repeated copies stay enabled and restart feedback",
      run: async (ctx) => {
        await ctx.prove("A second click copies again and restarts the two-second confirmation window", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`document.querySelector(${JSON.stringify(COPY_BUTTON)})?.click()`);
            await new Promise((resolve) => setTimeout(resolve, 1_200));
            await ctx.eval(`document.querySelector(${JSON.stringify(COPY_BUTTON)})?.click()`);
            await new Promise((resolve) => setTimeout(resolve, 1_100));
          },
          assert: async () => {
            const state = await copiedState(ctx);
            const clipboard = await ctx.eval("navigator.clipboard.readText()", { awaitPromise: true });
            ctx.assert(Boolean(state.buttonText) && !state.disabled, `Repeated copy feedback expired too early: ${JSON.stringify(state)}`);
            ctx.assert(Boolean(state.html) && clipboard === state.html, "Repeated copy did not preserve the current HTML in the clipboard.");
          },
          screenshot: { name: "html-copy-repeated", requireText: ["HTML"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
