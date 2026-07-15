import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";
import { fileURLToPath } from "node:url";

const vo = await loadVoiceoverParagraphs("design-html-editor");
const HEADING = "Design visually in iPolloWork";
const INLINE_HEADING = "Edit directly like a slide";
const IMAGE_FIXTURE = fileURLToPath(new URL("../../packages/docs/images/ipollowork-providers.png", import.meta.url));

async function ensureSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.eval(`(() => {
    const stop = [...document.querySelectorAll('button')].find((button) => (button.textContent || '').trim() === 'Stop' && !button.disabled);
    stop?.click();
    return Boolean(stop);
  })()`);
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((a) => a.id === "session.create_task" && !a.disabled)`, {
    timeoutMs: 30_000,
    label: "create task action",
  });
  await ctx.control("session.create_task");
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes("/session/")`, {
    timeoutMs: 60_000,
    label: "active task",
  });
}

async function clickWithMouse(ctx, selector, label) {
  const point = await ctx.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return null;
    element.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  ctx.assert(point, `${label} was not available.`);
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
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

async function clickPreviewElement(ctx, selector, label) {
  const clicked = await withPreviewClient(ctx, (client) => evaluate(client, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`));
  ctx.assert(clicked, `${label}: Design preview element was not available.`);
}

async function setInputValue(ctx, selector, value, label) {
  const changed = await ctx.eval(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return input.value === ${JSON.stringify(value)};
  })()`);
  ctx.assert(changed, `${label} could not be updated.`);
}

async function editPreviewHeadingDirectly(ctx, value) {
  const updated = await withPreviewClient(ctx, async (client) => {
    const beganEditing = await evaluate(client, `(() => {
      const heading = document.querySelector("h1");
      if (!heading) return false;
      heading.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return heading.getAttribute("contenteditable") === "true";
    })()`);
    if (!beganEditing) return "";
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 4, commands: ["SelectAll"] });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
    await client.send("Input.insertText", { text: value });
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape" });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    return evaluate(client, "document.querySelector('h1')?.textContent || ''");
  });
  ctx.assert(updated.includes(value), `Direct heading editing did not update the preview: ${updated}`);
}

async function chooseImageFixture(ctx) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[aria-label="Choose replacement image"]',
  });
  ctx.assert(Boolean(nodeId), "The replacement image input was not found.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [IMAGE_FIXTURE] });
}

export default {
  id: "design-html-editor",
  title: "Edit and save a local HTML page in iPolloWork's dedicated Design space",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the Design flow can run."
      : null;
  },
  steps: [
    {
      name: "Design is an additive task tool",
      run: async (ctx) => {
        await ctx.prove("An existing task keeps its Browser and Extensions tools and adds Design beside them", {
          voiceover: vo[0],
          action: async () => { await ensureSession(ctx); },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              electron: navigator.userAgent.includes("Electron/"),
              browser: Boolean(document.querySelector('button[aria-label="Browser"]:not([disabled])')),
              design: Boolean(document.querySelector('button[aria-label="Design"]:not([disabled])')),
              extensions: Boolean(document.querySelector('button[aria-label="Extensions"]:not([disabled])')),
            }))()`);
            ctx.assert(state.electron, "The proof must run in Electron.");
            ctx.assert(state.browser && state.design && state.extensions, `Task tools are incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "design-rail", rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "A local HTML file opens in Design",
      run: async (ctx) => {
        await ctx.prove("Design opens a local HTML file in its own preview without replacing Browser", {
          voiceover: vo[1],
          action: async () => {
            await ctx.waitFor(`window.__ipolloworkControl.listActions().some((a) => a.id === "eval.design.seed_html" && !a.disabled)`, {
              timeoutMs: 30_000,
              label: "Design seed action",
            });
            await ctx.control("eval.design.seed_html");
            await ctx.waitFor(`document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === "true"`, {
              timeoutMs: 30_000,
              label: "loaded Design preview",
            });
          },
          assert: async () => {
            await ctx.expectText("Local HTML only");
            const state = await ctx.eval(`(() => ({
              file: [...document.querySelectorAll('[data-testid="design-panel"] p')].map((element) => (element.textContent || '').trim()).find((text) => text === "entry.html") || "",
              hasWorkspaceFilePicker: Boolean(document.querySelector('[aria-label="HTML file"]')),
              browser: Boolean(document.querySelector('button[aria-label="Browser"]:not([disabled])')),
              edit: Boolean(document.querySelector('[aria-label="Edit page"]')),
            }))()`);
            ctx.assert(state.file.includes("entry.html") && !state.hasWorkspaceFilePicker, `Unexpected Design source state: ${JSON.stringify(state)}`);
            ctx.assert(state.browser && state.edit, "Browser or Edit page control disappeared.");
          },
          screenshot: { name: "local-html-preview", requireText: ["Design", "Local HTML only", "Edit page", "Save"] },
        });
      },
    },
    {
      name: "Click-to-select opens a compact floating toolbar",
      run: async (ctx) => {
        await ctx.prove("Edit page outlines the heading and places a compact toolbar beside the selection", {
          voiceover: vo[2],
          action: async () => {
            await clickWithMouse(ctx, '[aria-label="Edit page"]', "Edit page");
            await new Promise((resolve) => setTimeout(resolve, 750));
            await clickPreviewElement(ctx, "h1", "Select heading");
          },
          assert: async () => {
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="design-floating-toolbar"]'))`, { timeoutMs: 10_000, label: "floating Design toolbar" });
            const state = await ctx.eval(`(() => ({
              editText: Boolean(document.querySelector('[aria-label="Edit selected text"]')),
              fontSize: Boolean(document.querySelector('[aria-label="Change selected font size"]')),
              color: Boolean(document.querySelector('[aria-label="Change selected text color"]')),
              inspectorClosed: !document.querySelector('[aria-label="Design inspector"]'),
            }))()`);
            ctx.assert(state.editText && state.fontSize && state.color && state.inspectorClosed, `The compact editing state is wrong: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "heading-selected", requireText: ["Edit text"], rejectText: ["Presentation"] },
        });
      },
    },
    {
      name: "Text edits in the popover and directly on the page",
      run: async (ctx) => {
        await ctx.prove("Text can be changed from the compact popover or by double-clicking and typing on the page", {
          voiceover: vo[3],
          action: async () => {
            await clickWithMouse(ctx, '[aria-label="Edit selected text"]', "Edit selected text");
            await setInputValue(ctx, '[aria-label="Quick edit text"]', HEADING, "Quick heading text");
            await clickWithMouse(ctx, '[aria-label="Done quick editing"]', "Done quick editing");
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="Change selected font size"]'))`, {
              timeoutMs: 5_000,
              label: "Quick font size",
            });
            await clickWithMouse(ctx, '[aria-label="Change selected font size"]', "Quick font size");
            await setInputValue(ctx, '[aria-label="Quick font size"]', "36", "Quick font size value");
            await clickWithMouse(ctx, '[aria-label="Done quick editing"]', "Done font size editing");
            await clickWithMouse(ctx, '[aria-label="Change selected text color"]', "Quick text color");
            await clickWithMouse(ctx, '[aria-label="Set text color #2563eb"]', "Blue text color");
            await clickWithMouse(ctx, '[aria-label="Done quick editing"]', "Done color editing");
            await editPreviewHeadingDirectly(ctx, INLINE_HEADING);
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="Edit selected text"]'))`, {
              timeoutMs: 5_000,
              label: "Edited heading selection",
            });
            await clickWithMouse(ctx, '[aria-label="Edit selected text"]', "Reopen text popover");
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              toolbar: Boolean(document.querySelector('[data-testid="design-floating-toolbar"]')),
              quickText: document.querySelector('[aria-label="Quick edit text"]')?.value || "",
              saveEnabled: ![...document.querySelectorAll('[data-testid="design-panel"] button')]
                .find((button) => (button.textContent || '').includes('Save'))?.disabled,
            }))()`);
            ctx.assert(state.toolbar && state.quickText.includes(INLINE_HEADING) && state.saveEnabled, `Direct text editing did not stick: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "text-edited-in-place", requireText: ["Save"], rejectText: ["Presentation"] },
        });
      },
    },
    {
      name: "Images replace directly from the canvas",
      run: async (ctx) => {
        await ctx.prove("Selecting an image exposes compact replace controls and a local image can be placed in the page", {
          voiceover: vo[4],
          action: async () => {
            await clickPreviewElement(ctx, "img", "Select image");
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label="Upload replacement image"]'))`, { timeoutMs: 10_000, label: "image replacement button" });
            await chooseImageFixture(ctx);
            await ctx.waitForText("Image replaced in the design.", { timeoutMs: 10_000 });
          },
          assert: async () => {
            await ctx.expectNoText("Something went wrong");
            const state = await ctx.eval(`(() => ({
              replace: Boolean(document.querySelector('[aria-label="Upload replacement image"]')),
              url: Boolean(document.querySelector('[aria-label="Edit image URL"]')),
              inspectorClosed: !document.querySelector('[aria-label="Design inspector"]'),
            }))()`);
            ctx.assert(state.replace && state.url && state.inspectorClosed, `Image tools are incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "image-replaced", requireText: ["Replace", "Save"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Saving persists without disturbing the task",
      run: async (ctx) => {
        await ctx.prove("Undo, save, close, and reopen preserve the direct text and image workflow without disturbing the task", {
          voiceover: vo[5],
          action: async () => {
            await clickPreviewElement(ctx, "h1", "Select heading for advanced styling");
            await clickWithMouse(ctx, '[aria-label="Toggle advanced design settings"]', "Advanced design settings");
            await ctx.waitForText("Design properties", { timeoutMs: 10_000 });
            await clickWithMouse(ctx, '[aria-label="Apply Heading text preset"]', "Heading text preset");
            await setInputValue(ctx, '[aria-label="Design text color"]', "#6d28d9", "Text color");
            await ctx.screenshot("advanced-properties-modern", {
              claim: "Advanced properties use modern presets, steppers, alignment controls, and color swatches",
              voiceover: vo[5],
              requireText: ["Design properties", "Display", "Heading", "Body"],
              rejectText: ["Something went wrong"],
            });
            await clickWithMouse(ctx, '[aria-label="Undo design change"]', "Undo design change");
            await ctx.eval(`(() => {
              const panel = document.querySelector('[data-testid="design-panel"]');
              const save = [...panel.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Save'));
              save?.click();
              return Boolean(save);
            })()`);
            await ctx.waitForText("Design saved to the workspace.", { timeoutMs: 20_000 });
            await clickWithMouse(ctx, '[aria-label="Close Design"]', "Close Design");
            await clickWithMouse(ctx, 'button[aria-label="Design"]', "Design");
            await ctx.waitFor(`document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === "true"`, { timeoutMs: 20_000, label: "reopened loaded Design preview" });
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              file: [...document.querySelectorAll('[data-testid="design-panel"] p')].map((element) => (element.textContent || '').trim()).find((text) => text === "entry.html") || "",
              hasWorkspaceFilePicker: Boolean(document.querySelector('[aria-label="HTML file"]')),
              browser: Boolean(document.querySelector('button[aria-label="Browser"]:not([disabled])')),
              extensions: Boolean(document.querySelector('button[aria-label="Extensions"]:not([disabled])')),
              saveDisabled: [...document.querySelectorAll('[data-testid="design-panel"] button')]
                .find((button) => (button.textContent || '').includes('Save'))?.disabled === true,
            }))()`);
            ctx.assert(state.file.includes("entry.html") && !state.hasWorkspaceFilePicker, `Saved file was not reopened: ${JSON.stringify(state)}`);
            ctx.assert(state.browser && state.extensions && state.saveDisabled, `Task tools or saved state regressed: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "saved-and-reopened", requireText: ["Design", "entry.html", "Save"] },
        });
      },
    },
  ],
};
