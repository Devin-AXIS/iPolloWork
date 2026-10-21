import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function waitForFile(ctx, path, expected) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await readFile(path, "utf8") === expected) return;
    await delay(250);
  }
  ctx.assert(false, "Markdown autosave did not write the expected content");
}

export default {
  id: "markdown-dev-editor",
  title: "开发版 Markdown 文件卡片打开、编辑和下载",
  kind: "user-facing",
  steps: [{ name: "生成文件在开发版中可编辑和下载", async run(ctx) {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    const file = await ctx.eval(`(() => {
      const card = Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).find(card => /\\.md$/i.test(card.dataset.artifactPath));
      const route = window.__ipollowork.slice('route');
      return card ? { path: card.dataset.artifactPath, root: route.workspaces.find(item => item.id === route.selectedWorkspaceId).path } : null;
    })()`);
    ctx.assert(file, "Open a session containing a generated Markdown file card before running this flow");
    const absolutePath = isAbsolute(file.path) ? file.path : join(file.root, file.path);
    const original = await readFile(absolutePath, "utf8");
    const edited = `${original}\n\nMarkdown editor verification：自动保存与下载。\n`;
    const selector = `[data-testid="artifact-file-card"][data-artifact-path=${JSON.stringify(file.path)}]`;
    const downloadDirectory = await mkdtemp(join(tmpdir(), "ipollowork-markdown-dev-download-"));
    let downloaded;
    try {
      await ctx.prove("开发版点击生成的 Markdown 卡片不会崩溃，编辑自动保存且下载正文一致", {
        voiceover: "点击生成的 Markdown 文件，右侧正常显示可编辑正文；修改后自动保存，下载文件包含最新内容。验证完成后恢复原文。",
        action: async () => {
          await ctx.trustedClick(selector);
          await ctx.waitFor("Boolean(document.querySelector('.cm-editor .cm-content[contenteditable=true]'))");
          ctx.assert(await ctx.eval(`window.__artifactEditorView.state.doc.toString() === ${JSON.stringify(original)}`), "Editor loads the actual generated file");
          await ctx.trustedClick(".cm-editor .cm-content");
          await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", modifiers: 2, windowsVirtualKeyCode: 35 });
          await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35 });
          await ctx.client.send("Input.insertText", { text: edited.slice(original.length) });
          await waitForFile(ctx, absolutePath, edited);
          await ctx.client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory });
          await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).closest('[data-testid="artifact-file-shell"]').querySelector('[data-testid="artifact-file-actions"] button').click()`);
          const name = file.path.split(/[\\/]/).at(-1);
          for (let attempt = 0; attempt < 40; attempt++) {
            downloaded = await readFile(join(downloadDirectory, name), "utf8").catch(() => null);
            if (downloaded !== null) break;
            await delay(250);
          }
          ctx.assert(downloaded === edited, "The real download contains the exact saved Markdown content");
          // Restore the user's file through the same editor and autosave path.
          await ctx.eval(`(() => { const view = window.__artifactEditorView; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(original)} } }); })()`);
          await waitForFile(ctx, absolutePath, original);
          await ctx.trustedClick('button[aria-label="Close artifact"]');
          await ctx.waitFor("!document.querySelector('.cm-editor')");
          await ctx.trustedClick(selector);
          await ctx.waitFor(`window.__artifactEditorView?.state.doc.toString() === ${JSON.stringify(original)}`);
        },
        assert: async () => {
          ctx.assert(await readFile(absolutePath, "utf8") === original, "Original Markdown content is restored after verification");
          await ctx.expectNoText("iPolloWork 暂时无法响应");
          await ctx.expectNoText("File not found");
          ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Generated file opens in the real editor; native input autosaves, download matches, and original content is restored", actual: { path: file.path, downloadedBytes: Buffer.byteLength(downloaded) } });
        },
        screenshot: { name: "markdown-dev-editor-ready", requireText: [file.path.split(/[\\/]/).at(-1)], rejectText: ["iPolloWork 暂时无法响应", "File not found"] },
      });
    } finally {
      await ctx.client.send("Page.setDownloadBehavior", { behavior: "default" });
      if (await readFile(absolutePath, "utf8") !== original) {
        await ctx.eval(`document.querySelector('button[aria-label="Close artifact"]')?.click()`);
        await writeFile(absolutePath, original, "utf8");
      }
    }
  } }],
};
