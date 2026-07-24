import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("pc-markdown-editor");
const artifactPrefix = `pc-markdown-${Date.now().toString(36)}`;
const artifactName = (index) => `${artifactPrefix}-${String(index).padStart(2, "0")}`;
const richMarkdown = `

![iPolloWork editor preview](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='720'%20height='220'%3E%3Crect%20width='720'%20height='220'%20rx='28'%20fill='%23f4f4f5'/%3E%3Ctext%20x='40'%20y='125'%20font-size='34'%20fill='%2318181b'%3EiPolloWork%20Markdown%3C/text%3E%3C/svg%3E)

\`\`\`ts
const editor = "ready";
\`\`\`

| Block | Status |
| --- | --- |
| Image | Ready |
| Table | Ready |`;

async function openMarkdownArtifact(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "control API" });
  const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
  ctx.assert(route.includes("/session/"), `Open the signed-in iPolloWork client on a session before running this flow; current route: ${route}`);

  await ctx.eval(`(() => {
    const ready = window.__ipolloworkControl.listActions().some((action) => action.id === "eval.artifact_tabs.seed_overflow" && !action.disabled);
    if (ready) return;
    const button = [...document.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === "Browser" && !item.disabled);
    button?.click();
  })()`);
  await ctx.waitFor(`window.__ipolloworkControl.listActions().some((action) => action.id === "eval.artifact_tabs.seed_overflow" && !action.disabled)`, { timeoutMs: 30_000, label: "artifact seed action" });
  await ctx.control("eval.artifact_tabs.seed_overflow", { count: 12, prefix: artifactPrefix });
  await ctx.waitFor(`document.querySelectorAll('button[aria-label^="Select tab: ${artifactPrefix}"]').length >= 12`, { timeoutMs: 30_000, label: "seeded Markdown tabs" });
  await ctx.eval(`(() => {
    const tabs = [...document.querySelectorAll('button[aria-label^="Select tab: ${artifactPrefix}"]')];
    tabs[tabs.length - 1]?.click();
  })()`);
  await ctx.waitFor(`document.querySelector(".cm-editor .cm-content")?.textContent?.includes("${artifactName(12)}")`, { timeoutMs: 30_000, label: "Markdown editor" });
}

export default {
  id: "pc-markdown-editor",
  title: "PC Markdown files support Notion-like direct editing",
  kind: "user-facing",
  steps: [
    {
      name: "Open a clean editable Markdown document",
      run: async (ctx) => {
        await ctx.prove("The existing right-side Markdown browser opens a clean, directly editable document", {
          voiceover: vo[0],
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 780, deviceScaleFactor: 1, mobile: false });
            await openMarkdownArtifact(ctx);
          },
          assert: async () => {
            const result = await ctx.eval(`({
              editor: Boolean(document.querySelector(".cm-editor .cm-content[contenteditable=true]")),
              renderedHeading: Boolean(document.querySelector(".cm-md-h1")),
              separateSourceMode: document.body.innerText.includes("Markdown source"),
            })`);
            ctx.assert(result.editor, "Markdown document is not directly editable.");
            ctx.assert(result.renderedHeading, "Markdown heading is not rendered inline.");
            ctx.assert(!result.separateSourceMode, "A separate Markdown source mode is visible.");
          },
          screenshot: { name: "pc-markdown-clean-editor", requireText: [artifactName(12)], rejectText: ["Markdown source"] },
        });
      },
    },
    {
      name: "Use the slash block menu",
      run: async (ctx) => {
        await ctx.prove("Typing slash opens a cursor-anchored, keyboard-filterable block menu", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              const view = window.__artifactEditorView;
              const end = view.state.doc.length;
              view.dispatch({ changes: { from: end, insert: "\\n/" }, selection: { anchor: end + 2 } });
              view.focus();
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector("[data-markdown-slash-menu]"))`, { timeoutMs: 5_000, label: "slash menu" });
          },
          assert: async () => {
            for (const label of ["Basic blocks", "Heading 1", "Image", "Table", "Code block"]) await ctx.expectText(label);
          },
          screenshot: { name: "pc-markdown-slash-menu", requireText: ["Basic blocks", "Heading 1", "Image", "Table", "Code block"] },
        });
      },
    },
    {
      name: "Format a text selection",
      run: async (ctx) => {
        await ctx.prove("Selecting text reveals a compact Markdown-safe floating toolbar", {
          voiceover: vo[2],
          action: async () => {
            await ctx.eval(`(() => {
              const view = window.__artifactEditorView;
              const text = view.state.doc.toString();
              const start = text.indexOf("Generated by");
              if (text.endsWith("\\n/")) view.dispatch({ changes: { from: text.length - 2, to: text.length, insert: "" } });
              view.dispatch({ selection: { anchor: start, head: start + 12 } });
              view.focus();
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector("[data-markdown-selection-toolbar]"))`, { timeoutMs: 5_000, label: "selection toolbar" });
          },
          assert: async () => {
            const labels = await ctx.eval(`[...document.querySelectorAll("[data-markdown-selection-toolbar] button")].map((button) => button.getAttribute("aria-label") || button.textContent?.trim())`);
            for (const label of ["Bold", "Italic", "Strikethrough", "Inline code", "Link"]) ctx.assert(labels.includes(label), `Missing ${label} selection action.`);
          },
          screenshot: { name: "pc-markdown-selection-toolbar", requireText: [artifactName(12)] },
        });
      },
    },
    {
      name: "Automatically save the Markdown file",
      run: async (ctx) => {
        await ctx.prove("A formatting edit saves automatically and remains after reopening the artifact", {
          voiceover: vo[3],
          action: async () => {
            await ctx.eval(`document.querySelector('[data-markdown-selection-toolbar] button[aria-label="Bold"]')?.click()`);
            await ctx.waitFor(`document.body.innerText.includes("Saved")`, { timeoutMs: 15_000, label: "automatic save" });
            await ctx.eval(`document.querySelector('button[aria-label^="Select tab: ${artifactName(11)}"]')?.click()`);
            await ctx.waitFor(`document.querySelector(".cm-editor .cm-content")?.textContent?.includes("${artifactName(11)}")`, { timeoutMs: 10_000, label: "second artifact" });
            await ctx.eval(`document.querySelector('button[aria-label^="Select tab: ${artifactName(12)}"]')?.click()`);
            await ctx.waitFor(`window.__artifactEditorView?.state.doc.toString().includes("Generated by")`, { timeoutMs: 10_000, label: "reopened edited artifact" });
          },
          assert: async () => {
            const content = await ctx.eval(`window.__artifactEditorView.state.doc.toString()`);
            ctx.assert(content.includes("**Generated by**"), `Reopened Markdown did not preserve the bold edit: ${content}`);
            await ctx.expectText("Saved");
          },
          screenshot: { name: "pc-markdown-auto-saved", requireText: ["Saved", artifactName(12)], rejectText: ["Save failed"] },
        });
      },
    },
    {
      name: "Render rich Markdown blocks directly",
      run: async (ctx) => {
        await ctx.prove("Images, code blocks, and tables render directly while remaining Markdown", {
          voiceover: vo[4],
          action: async () => {
            await ctx.eval(`(() => {
              const view = window.__artifactEditorView;
              const end = view.state.doc.length;
              view.dispatch({ changes: { from: end, insert: ${JSON.stringify(richMarkdown)} }, selection: { anchor: 0 } });
              view.focus();
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector("[data-markdown-image] img") && document.querySelector("[data-markdown-table]") && document.querySelector("[data-markdown-code-block]"))`, { timeoutMs: 10_000, label: "rich Markdown rendering" });
          },
          assert: async () => {
            const result = await ctx.eval(`({
              imageAlt: document.querySelector("[data-markdown-image] img")?.getAttribute("alt"),
              tableText: document.querySelector("[data-markdown-table]")?.textContent,
              codeText: document.querySelector("[data-markdown-code-block]")?.textContent,
            })`);
            ctx.assert(result.imageAlt === "iPolloWork editor preview", `Unexpected image description: ${result.imageAlt}`);
            ctx.assert(result.tableText?.includes("Image") && result.tableText?.includes("Ready"), `Table did not render expected cells: ${result.tableText}`);
            ctx.assert(result.codeText?.includes("editor") && result.codeText?.includes("ready"), `Code block did not render expected code: ${result.codeText}`);
          },
          screenshot: { name: "pc-markdown-rich-blocks", requireText: ["Block", "Status", "Image", "Ready"] },
        });
      },
    },
    {
      name: "Replace an existing image",
      run: async (ctx) => {
        await ctx.prove("A rendered image exposes a focused replace and description editor", {
          voiceover: vo[5],
          action: async () => {
            await ctx.eval(`document.querySelector('[data-markdown-image-action="edit"]')?.click()`);
            await ctx.waitFor(`Boolean(document.querySelector("[data-markdown-image-editor]"))`, { timeoutMs: 5_000, label: "image editor" });
          },
          assert: async () => {
            const result = await ctx.eval(`({
              values: [...document.querySelectorAll("[data-markdown-image-editor] input")].map((input) => input.value),
              submit: document.querySelector("[data-markdown-image-editor] button[type=submit]")?.textContent,
            })`);
            ctx.assert(result.values.some((value) => value.includes("data:image/svg+xml")), "The image URL is not editable.");
            ctx.assert(result.values.includes("iPolloWork editor preview"), "The image description is not editable.");
            ctx.assert(result.submit?.includes("Update image"), "The image update action is missing.");
          },
          screenshot: { name: "pc-markdown-image-editor", requireText: ["Image URL", "Description", "Update image"] },
        });
      },
    },
  ],
};
