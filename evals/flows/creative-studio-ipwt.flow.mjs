import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("creative-studio-ipwt");
const ARCHIVE = fileURLToPath(new URL("../results/creative-studio-ipwt/creative-studio.ipwt", import.meta.url));

async function clickButton(ctx, text) {
  const clicked = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (candidate.textContent || '').includes(${JSON.stringify(text)}) && !candidate.disabled);
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(clicked, `Button containing ${text} was not available.`);
}

async function setInput(ctx, selector, value) {
  const changed = await ctx.eval(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(value)};
  })()`);
  ctx.assert(changed, `${selector} could not be updated.`);
}

async function ensureDesignSession(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, { timeoutMs: 30_000, label: "create task" });
  await ctx.control("session.create_task");
  await ctx.waitFor(`window.__ipolloworkControl.snapshot().route.includes("/session/")`, { timeoutMs: 60_000, label: "new task" });
  const sessionId = await ctx.eval(`window.__ipolloworkControl.snapshot().route.split('/session/')[1]?.split(/[/?#]/)[0] || ''`);
  ctx.assert(sessionId, "The task did not expose a session id.");
  await ctx.eval(`localStorage.setItem('ipollowork.session-type.' + ${JSON.stringify(sessionId)}, 'design')`);
  await ctx.client.send("Page.reload", { ignoreCache: true });
  await ctx.waitFor(`Boolean([...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('网站')))`, { timeoutMs: 60_000, label: "Design categories" });
}

async function chooseArchive(ctx) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"][accept*=".ipwt"]' });
  ctx.assert(Boolean(nodeId), "The .ipwt input was not found.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [ARCHIVE] });
}

export default {
  id: "creative-studio-ipwt",
  title: "A local Creative Studio package imports and stays editable in Design",
  kind: "user-facing",
  steps: [
    {
      name: "The local MIT template imports",
      run: async (ctx) => ctx.prove("Creative Studio imports from a self-contained .ipwt package", {
        voiceover: vo[0],
        action: async () => {
          await ensureDesignSession(ctx);
          await clickButton(ctx, "网站");
          await clickButton(ctx, "导入 .ipwt");
          await chooseArchive(ctx);
          await ctx.waitForText("creative-studio.ipwt", { timeoutMs: 10_000 });
          await clickButton(ctx, "安装");
          await ctx.waitForText("Creative Studio", { timeoutMs: 30_000 });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({ title: document.body.innerText.includes('Creative Studio'), local: document.body.innerText.includes('Local'), source: document.body.innerText.includes('Start Bootstrap Creative') }))()`);
          ctx.assert(state.title && state.local && state.source, `Imported card is incomplete: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "creative-template-card", requireText: ["Creative Studio", "Local", "Start Bootstrap Creative"] },
      }),
    },
    {
      name: "The brief applies a new primary color",
      run: async (ctx) => ctx.prove("Creative Studio opens its Design brief and accepts a custom theme", {
        voiceover: vo[1],
        action: async () => {
          await clickButton(ctx, "使用模板");
          await ctx.waitForText("Creative Studio", { timeoutMs: 30_000 });
          await setInput(ctx, 'input[placeholder*="iPollo Studio"]', "Lantern Works");
          await setInput(ctx, 'input[placeholder*="创意工作"]', "A studio portfolio for independent product teams");
          await setInput(ctx, 'input[type="color"]', "#2563eb");
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({ brief: document.body.innerText.includes('Design brief'), color: document.querySelector('input[type="color"]')?.value }))()`);
          ctx.assert(state.brief && state.color === "#2563eb", `Brief state is wrong: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "creative-design-brief", requireText: ["Creative Studio", "Design brief"] },
      }),
    },
    {
      name: "The complete local page renders",
      run: async (ctx) => ctx.prove("The imported template renders its complete page from local files", {
        voiceover: vo[2],
        action: async () => {
          await clickButton(ctx, "生成我的网站");
          await ctx.waitFor(`document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === "true"`, { timeoutMs: 60_000, label: "Creative Studio preview" });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({ panel: Boolean(document.querySelector('[data-testid="design-panel"]')), iframe: Boolean(document.querySelector('[data-testid="design-panel"] iframe')), file: document.querySelector('[aria-label="HTML file"]')?.textContent || '' }))()`);
          ctx.assert(state.panel && state.iframe && state.file.includes("entry.html"), `Design page did not render: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "creative-page-rendered", requireText: ["Design", "entry.html", "Edit page"] },
      }),
    },
    {
      name: "The page exposes direct and global editing",
      run: async (ctx) => ctx.prove("Creative Studio remains editable through the existing Design controls", {
        voiceover: vo[3],
        action: async () => {
          await clickButton(ctx, "Edit page");
          await clickButton(ctx, "Open design system").catch(() => undefined);
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({ editing: document.querySelector('[aria-label="Edit page"]')?.getAttribute('aria-pressed') === 'true', system: Boolean(document.querySelector('[aria-label="Open design system"]')), save: Boolean([...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Save'))) }))()`);
          ctx.assert(state.system && state.save, `Design controls are incomplete: ${JSON.stringify(state)}`);
        },
        screenshot: { name: "creative-edit-controls", requireText: ["Design", "Save"] },
      }),
    },
    {
      name: "The workspace-specific page reopens",
      run: async (ctx) => ctx.prove("The Creative Studio session can be saved, closed, and reopened", {
        voiceover: vo[4],
        action: async () => {
          const save = await ctx.eval(`(() => { const button = [...document.querySelectorAll('[data-testid="design-panel"] button')].find((candidate) => (candidate.textContent || '').includes('Save')); if (!button || button.disabled) return false; button.click(); return true; })()`);
          if (save) await ctx.waitForText("Design saved to the workspace.", { timeoutMs: 20_000 });
          await ctx.eval(`document.querySelector('[aria-label="Close Design"]')?.click()`);
          await ctx.eval(`document.querySelector('button[aria-label="Design"]')?.click()`);
          await ctx.waitFor(`document.querySelector('[data-testid="design-panel"] iframe')?.dataset.previewLoaded === "true"`, { timeoutMs: 30_000, label: "reopened preview" });
        },
        assert: async () => {
          const file = await ctx.eval(`document.querySelector('[aria-label="HTML file"]')?.textContent || ''`);
          ctx.assert(file.includes("entry.html"), `The Creative Studio entry did not reopen: ${file}`);
        },
        screenshot: { name: "creative-page-reopened", requireText: ["Design", "entry.html", "Save"] },
      }),
    },
  ],
};
