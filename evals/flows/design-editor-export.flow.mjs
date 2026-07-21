import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { connect, debuggerUrlFor, evaluate, listTargets } from "../runner/cdp.mjs";

const vo = await loadVoiceoverParagraphs("design-editor-export");
const EDITED_HEADING = "Edit the visible slide directly.";
const ACTIVE_HEADING = "[data-ipw-slide][aria-hidden='false'] h1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let downloadedHtml = "";
let downloadedHtmlPath = "";
let transformProof = null;

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

async function withFrame(ctx, callback) {
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
  return withFrame(ctx, (client) => evaluate(client, expression));
}

async function waitFrame(ctx, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await frameEval(ctx, expression)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function pagePointForFrameElement(ctx, selector) {
  const local = await frameEval(ctx, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  })()`);
  const frame = await ctx.eval(`(() => {
    const rect = document.querySelector('[data-testid="design-panel"] iframe')?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
  })()`);
  if (!local || !frame) return null;
  return {
    x: frame.left + local.x * frame.width / local.viewportWidth,
    y: frame.top + local.y * frame.height / local.viewportHeight,
  };
}

async function openDeck(ctx) {
  await ctx.control("eval.design.seed_deck");
  await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", { timeoutMs: 30_000, label: "Design preview" });
  await waitFrame(ctx, "document.title === 'iPolloWork Slide Editing Demo'", "deck preview");
}

async function typeInVisibleHeading(ctx) {
  const screenshotHash = async () => createHash("sha256")
    .update((await ctx.client.send("Page.captureScreenshot", { format: "png", fromSurface: true })).data)
    .digest("hex");
  const beforeHash = await screenshotHash();
  const point = await pagePointForFrameElement(ctx, ACTIVE_HEADING);
  if (!point) return null;
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 2 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 2 });
  await waitFrame(ctx, `document.querySelector(${JSON.stringify(ACTIVE_HEADING)})?.getAttribute('contenteditable') === 'true'`, "visible heading text editor");
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Control", code: "ControlLeft", modifiers: 2 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["SelectAll"] });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft" });
  await ctx.client.send("Input.insertText", { text: EDITED_HEADING });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(200);
  return {
    beforeHash,
    afterHash: await screenshotHash(),
    text: await frameEval(ctx, `document.querySelector(${JSON.stringify(ACTIVE_HEADING)})?.textContent || ''`),
  };
}

async function dragFrameElement(ctx, selector, deltaX, deltaY) {
  const point = await pagePointForFrameElement(ctx, selector);
  if (!point) return false;
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + deltaX, y: point.y + deltaY, button: "left", buttons: 1 });
  await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + deltaX, y: point.y + deltaY, button: "left", clickCount: 1 });
  await sleep(200);
  return true;
}

async function allowDownloads(ctx, downloadPath) {
  try {
    await ctx.client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath });
  } catch {
    await ctx.client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });
  }
}

async function waitForHtmlDownload(downloadPath) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const entries = await readdir(downloadPath);
    const filename = entries.find((entry) => /\.html?$/i.test(entry) && !entry.endsWith(".crdownload"));
    if (filename) return join(downloadPath, filename);
    await sleep(200);
  }
  throw new Error(`Timed out waiting for HTML download in ${downloadPath}.`);
}

async function externalBrowserPath() {
  const candidates = [
    join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard browser installation.
    }
  }
  throw new Error("No independent Chromium browser is available for downloaded HTML verification.");
}

async function inspectHtmlOutsideDesign(htmlPath) {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "ipollowork-design-browser-"));
  const browser = spawn(await externalBrowserPath(), [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDirectory}`,
    pathToFileURL(htmlPath).href,
  ], { stdio: "ignore" });
  let page = null;
  try {
    const deadline = Date.now() + 15_000;
    let cdpBaseUrl = "";
    while (Date.now() < deadline && !cdpBaseUrl) {
      try {
        const [port] = (await readFile(join(userDataDirectory, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
        if (port) cdpBaseUrl = `http://127.0.0.1:${port}`;
      } catch {
        await sleep(100);
      }
    }
    if (!cdpBaseUrl) throw new Error("The independent browser did not expose a debugging port.");
    while (Date.now() < deadline && !page) {
      const target = (await listTargets(cdpBaseUrl)).find((entry) => entry.type === "page" && entry.url.startsWith("file:") && entry.webSocketDebuggerUrl);
      if (target) page = await connect(debuggerUrlFor(cdpBaseUrl, target));
      else await sleep(150);
    }
    if (!page) throw new Error("Downloaded HTML target did not become available.");
    while (Date.now() < deadline) {
      let ready = false;
      try {
        ready = await evaluate(page, "document.readyState === 'complete'");
      } catch (error) {
        throw new Error(`Independent browser readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (ready) break;
      await sleep(100);
    }
    try {
      return await evaluate(page, `(() => ({
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      viewportHeight: window.innerHeight,
      visibleSlides: [...document.querySelectorAll('.slide')].filter((slide) => getComputedStyle(slide).display !== 'none').length,
      editorArtifacts: document.querySelectorAll('[data-ipollowork-design-id],[data-ipollowork-design-selected],[data-ipollowork-design-editing],#ipollowork-design-runtime,#ipollowork-design-deck-runtime,#ipollowork-design-transform-overlay').length,
      editedText: [...document.querySelectorAll('h1')].some((heading) => heading.textContent?.includes(${JSON.stringify(EDITED_HEADING)})),
    }))()`);
    } catch (error) {
      throw new Error(`Independent browser content check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    page?.close();
    browser.kill();
  }
}

export default {
  id: "design-editor-export",
  title: "Presentation editing is paged in Design and scrollable after HTML export",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the Design export flow can run."
      : null;
  },
  steps: [
    {
      name: "One landscape slide",
      run: async (ctx) => ctx.prove("A scrolling presentation source opens as one active 16:9 slide with app-level paging", {
        voiceover: vo[0],
        action: async () => {
          await ensureSession(ctx);
          await openDeck(ctx);
        },
        assert: async () => {
          const frame = await frameEval(ctx, `(() => {
            const slides = [...document.querySelectorAll('.slide')];
            const visible = slides.filter((slide) => getComputedStyle(slide).display !== 'none');
            return { total: slides.length, visible: visible.length, overflow: getComputedStyle(document.body).overflow };
          })()`);
          const shell = await ctx.eval(`(() => {
            const rect = document.querySelector('[data-testid="design-panel"] iframe')?.getBoundingClientRect();
            return { pager: document.querySelector('[data-testid="design-deck-navigation"]')?.textContent || '', ratio: rect ? rect.width / rect.height : 0 };
          })()`);
          ctx.assert(frame.total === 3 && frame.visible === 1 && frame.overflow === "hidden", `Unexpected active-slide state: ${JSON.stringify(frame)}`);
          ctx.assert(shell.pager.includes("1 / 3") && Math.abs(shell.ratio - 16 / 9) < 0.02, `Unexpected presentation frame: ${JSON.stringify(shell)}`);
        },
        screenshot: { name: "one-landscape-slide", requireText: ["1 / 3", "Edit page"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Direct visible text editing",
      run: async (ctx) => {
        let typing = null;
        await ctx.prove("Direct typing changes visible pixels on slide two and keeps that slide active", {
          voiceover: vo[1],
          action: async () => {
            await ctx.trustedClick('[aria-label="Next slide"]');
            await waitFrame(ctx, `document.querySelector(${JSON.stringify(ACTIVE_HEADING)})?.textContent?.includes('second slide')`, "second slide");
            await ctx.trustedClick('[aria-label="Edit page"]');
            await waitFrame(ctx, "document.documentElement.dataset.ipolloworkDesignMode === 'editing'", "deck edit mode");
            typing = await typeInVisibleHeading(ctx);
          },
          assert: async () => {
            ctx.assert(typing?.text === EDITED_HEADING && typing.beforeHash !== typing.afterHash, `Direct typing did not change visible pixels: ${JSON.stringify(typing)}`);
            const state = await frameEval(ctx, `(() => ({
              active: [...document.querySelectorAll('.slide')].findIndex((slide) => slide.getAttribute('aria-hidden') === 'false'),
              visible: [...document.querySelectorAll('.slide')].filter((slide) => getComputedStyle(slide).display !== 'none').length,
            }))()`);
            ctx.assert(state.active === 1 && state.visible === 1, `Typing targeted the wrong slide: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "direct-edit-visible-slide", requireText: ["2 / 3", "Edit text"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Canvas drag and resize",
      run: async (ctx) => ctx.prove("The selected visible heading moves and resizes from the canvas controls", {
        voiceover: vo[2],
        action: async () => {
          const rect = async () => frameEval(ctx, `(() => {
            const heading = document.querySelector(${JSON.stringify(ACTIVE_HEADING)});
            const value = heading?.getBoundingClientRect();
            return value ? { left: value.left, top: value.top, width: value.width, height: value.height, style: heading.getAttribute('style') || '' } : null;
          })()`);
          const before = await rect();
          const moved = await dragFrameElement(ctx, "#ipollowork-design-transform-overlay", 84, 44);
          const afterMove = await rect();
          const resized = await dragFrameElement(ctx, "#ipollowork-design-transform-overlay [data-handle='w']", -120, 0);
          transformProof = { before, afterMove, afterResize: await rect(), moved, resized };
        },
        assert: async () => {
          ctx.assert(transformProof?.moved && transformProof?.resized, `Transform gestures were not dispatched: ${JSON.stringify(transformProof)}`);
          ctx.assert(transformProof.afterMove.left > transformProof.before.left + 60 && transformProof.afterMove.top > transformProof.before.top + 25, `The heading did not move: ${JSON.stringify(transformProof)}`);
          ctx.assert(transformProof.afterResize.width > transformProof.afterMove.width + 80 && transformProof.afterResize.left < transformProof.afterMove.left - 80, `The heading did not resize: ${JSON.stringify(transformProof)}`);
        },
        screenshot: { name: "dragged-and-resized-visible-heading", requireText: ["2 / 3", "Edit text"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Clean scrollable HTML download",
      run: async (ctx) => ctx.prove("The real HTML download contains current visual edits, has no editor runtime, and scrolls outside Design", {
        voiceover: vo[3],
        action: async () => {
          const downloadDirectory = await mkdtemp(join(tmpdir(), "ipollowork-design-html-"));
          await allowDownloads(ctx, downloadDirectory);
          await ctx.trustedClick('[aria-label="Download"]');
          await ctx.trustedClick('[role="menuitem"]');
          downloadedHtmlPath = await waitForHtmlDownload(downloadDirectory);
          downloadedHtml = await readFile(downloadedHtmlPath, "utf8");
        },
        assert: async () => {
          ctx.assert(downloadedHtml.includes(EDITED_HEADING), "The HTML download does not contain the direct text edit.");
          ctx.assert(/style="[^"]*(?:left|top):[^\"]*(?:width|height):/i.test(downloadedHtml), "The HTML download does not contain visual transform edits.");
          ctx.assert(!/ipollowork-design-(?:runtime|deck-runtime|transform-overlay|fixed-slide-runtime|template-token-style)/i.test(downloadedHtml), "The HTML download contains an editor-only runtime or overlay.");
          ctx.assert(!/data-ipollowork-design-(?:id|selected|editing|mode|deck-original-state)/i.test(downloadedHtml), "The HTML download contains editor-only selection state.");
          ctx.assert(!/<section\b[^>]*\baria-hidden=/i.test(downloadedHtml), "The HTML download contains preview-only aria-hidden mutations.");
          const outside = await inspectHtmlOutsideDesign(downloadedHtmlPath);
          ctx.assert(outside.editedText && outside.editorArtifacts === 0, `The downloaded page is not clean: ${JSON.stringify(outside)}`);
          ctx.assert(outside.visibleSlides === 3 && outside.scrollHeight > outside.viewportHeight + 300, `The downloaded page does not scroll vertically: ${JSON.stringify(outside)}`);
        },
        screenshot: { name: "html-download-complete", requireText: ["Design downloaded as HTML."], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Save and reopen",
      run: async (ctx) => ctx.prove("Saving and reopening keeps the edited content while Design returns to one-slide paging", {
        voiceover: vo[4],
        action: async () => {
          await ctx.eval(`(() => {
            const panel = document.querySelector('[data-testid="design-panel"]');
            const save = [...panel.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Save'));
            save?.click();
            return Boolean(save);
          })()`);
          await ctx.waitForText("Design saved to the workspace.", { timeoutMs: 20_000 });
          await ctx.trustedClick('[aria-label="Close Design"]');
          await ctx.trustedClick('button[aria-label="Open right panel"]');
          await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", { timeoutMs: 20_000, label: "reopened Design preview" });
          await waitFrame(ctx, "document.title === 'iPolloWork Slide Editing Demo'", "reopened deck");
          await ctx.trustedClick('[aria-label="Next slide"]');
          await waitFrame(ctx, `document.querySelector(${JSON.stringify(ACTIVE_HEADING)})?.textContent === ${JSON.stringify(EDITED_HEADING)}`, "saved second-slide edit");
        },
        assert: async () => {
          const state = await frameEval(ctx, `(() => ({
            visible: [...document.querySelectorAll('.slide')].filter((slide) => getComputedStyle(slide).display !== 'none').length,
            text: document.querySelector(${JSON.stringify(ACTIVE_HEADING)})?.textContent || '',
          }))()`);
          ctx.assert(state.visible === 1 && state.text === EDITED_HEADING, `Saved Design state is wrong: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "saved-and-reopened-paged-deck", requireText: ["2 / 3", "Save"], rejectText: ["Something went wrong"] },
      }),
    },
    {
      name: "Document-specific export formats",
      run: async (ctx) => {
        let presentationFormats = [];
        await ctx.prove("Presentations offer HTML, PDF, and PPTX while ordinary Design pages offer HTML only", {
          voiceover: vo[5],
          action: async () => {
            await ctx.trustedClick('[aria-label="Download"]');
            await ctx.waitFor("document.querySelectorAll('[role=menuitem]').length > 0", { label: "presentation export menu" });
            presentationFormats = await ctx.eval("[...document.querySelectorAll('[role=menuitem]')].map((item) => (item.textContent || '').trim())");
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
            await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
            await ensureSession(ctx);
            await ctx.control("eval.design.seed_html");
            await ctx.waitFor("document.querySelector('[data-testid=\"design-panel\"] iframe')?.dataset.previewLoaded === 'true'", { timeoutMs: 30_000, label: "ordinary Design preview" });
            await waitFrame(ctx, "document.title === 'iPolloWork Design Demo'", "ordinary Design page");
            await ctx.trustedClick('[aria-label="Download"]');
            await ctx.waitFor("document.querySelectorAll('[role=menuitem]').length > 0", { label: "ordinary Design export menu" });
          },
          assert: async () => {
            ctx.assert(presentationFormats.some((label) => label.includes("HTML")) && presentationFormats.some((label) => label.includes("PDF")) && presentationFormats.some((label) => label.includes("PPTX")), `Presentation formats are incomplete: ${JSON.stringify(presentationFormats)}`);
            const pageFormats = await ctx.eval("[...document.querySelectorAll('[role=menuitem]')].map((item) => (item.textContent || '').trim())");
            ctx.assert(pageFormats.length === 1 && pageFormats[0].includes("HTML"), `Ordinary Design formats are wrong: ${JSON.stringify(pageFormats)}`);
          },
          screenshot: { name: "html-only-for-ordinary-design", requireText: ["Download HTML"], rejectText: ["Download PDF", "Download PPTX", "Something went wrong"] },
        });
      },
    },
  ],
};
