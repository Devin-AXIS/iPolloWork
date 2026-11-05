import { mkdir, readFile, writeFile } from "node:fs/promises";

const projectId = `official-editing-history-eval-${Date.now()}`;
const fixture = new URL(`../../vendor/hyperframes/packages/studio/data/projects/${projectId}/`, import.meta.url);
const url = `http://127.0.0.1:5198/?locale=zh#project/${projectId}`;
const html = title => `<!doctype html><html><head><meta charset="utf-8"><title>History evaluation</title><style>html,body{margin:0;background:#15253a;color:white}main{width:1920px;height:1080px;display:grid;place-items:center}h1{font:112px sans-serif}</style></head><body><main data-composition-id="main" data-duration="1" data-width="1920" data-height="1080"><h1 id="title">${title}</h1></main><script>window.__timelines={};</script></body></html>`;
const original = html("原始标题");
const edited = html("编辑后的标题");
async function press(ctx, shift = false) {
  await ctx.client.send("Page.bringToFront");
  await ctx.eval("document.activeElement?.blur()");
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: shift ? "Z" : "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: shift ? 10 : 2 });
  await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: shift ? "Z" : "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 0 });
}
const previewTitle = `document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe')?.contentDocument?.querySelector('#title')?.textContent === TITLE`;

export default {
  id: "hyperframes-editing-history",
  title: "Old edit history migrates and keeps real undo, redo and outside file reloads working",
  kind: "internal",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5198" },
  steps: [{
    name: "Migrate the legacy history and use the current editor keyboard workflow",
    async run(ctx) {
      await mkdir(fixture, { recursive: true });
      await writeFile(new URL("index.html", fixture), edited);
      await ctx.eval(`(async () => {
        const db = await new Promise((resolve,reject) => { const request=indexedDB.open('hyperframes-studio-edit-history',1); request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('project-history'))request.result.createObjectStore('project-history')}; request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
        await new Promise((resolve,reject) => {const tx=db.transaction('project-history','readwrite'); tx.objectStore('project-history').put({version:1,updatedAt:Date.now(),undo:[{id:'legacy-proof',projectId:${JSON.stringify(projectId)},label:'Edit title',kind:'source',createdAt:Date.now(),files:{'index.html':{before:${JSON.stringify(original)},after:${JSON.stringify(edited)}}}}],redo:[]},${JSON.stringify(projectId)}); tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
      })()`, { awaitPromise: true });
      await ctx.client.send("Page.navigate", { url });
      const deadline = Date.now() + 20_000;
      while (!await ctx.eval(`fetch('/api/projects/${projectId}/history').then(r=>r.json()).then(h=>h.back?.id==='ipw-legacy:legacy-proof')`, { awaitPromise: true })) {
        if (Date.now() > deadline) throw new Error("Legacy history did not become available");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await ctx.waitFor(previewTitle.replace("TITLE", JSON.stringify("编辑后的标题")));
      await ctx.prove("The old undo record works in the current editor and restores the saved file and preview", {
        voiceover: "旧编辑记录迁移后，仍然可以撤销，画面和文件一起恢复原来的标题。",
        action: () => press(ctx),
        async assert() {
          await ctx.waitFor(previewTitle.replace("TITLE", JSON.stringify("原始标题")));
          ctx.assert((await readFile(new URL("index.html", fixture), "utf8")) === original, "Undo restored the real project file");
        },
        screenshot: { name: "official-history-undo", requireText: ["编辑"] },
      });
      await ctx.prove("Redo remains available after moving the history into the official project store", {
        voiceover: "重做也保留了下来，可以回到刚才修改后的标题。",
        action: () => press(ctx, true),
        async assert() {
          await ctx.waitFor(previewTitle.replace("TITLE", JSON.stringify("编辑后的标题")));
          ctx.assert((await readFile(new URL("index.html", fixture), "utf8")) === edited, "Redo restored the edited file");
        },
        screenshot: { name: "official-history-redo", requireText: ["编辑"] },
      });
      await ctx.prove("An outside file write reloads the current preview instead of disappearing inside a save time window", {
        voiceover: "文件在外部更新后，编辑器会显示新内容，不会把它误当作自己的保存而忽略。",
        async action() {
          await writeFile(new URL("index.html", fixture), html("外部更新的标题"));
        },
        async assert() { await ctx.waitFor(previewTitle.replace("TITLE", JSON.stringify("外部更新的标题"))); },
        screenshot: { name: "official-external-reload", requireText: ["编辑"] },
      });
    },
  }],
};
