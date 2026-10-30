// Focused proof: image-selection-fixture --media (:5274) and Bun --history (:5190),
// Vite :5188. Production UI/read model/files; the upstream AI process is simulated.
const doc = "document.querySelector('iframe[title^=\"Design preview:\"]')?.contentDocument";
const hero = `${doc}?.getElementById('hero')`;
const click = (ctx, label) => ctx.eval(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
const select = async ctx => {
  await ctx.waitFor(`${doc}?.documentElement.getAttribute('data-ipollowork-design-mode') === 'editing'`);
  await ctx.eval(`${hero}.click()`);
  await ctx.waitFor(`${hero}?.hasAttribute('data-ipollowork-design-primary')`);
};
const saved = ctx => ctx.eval("fetch('http://127.0.0.1:5274/witness').then(r=>r.json())", { awaitPromise: true });
const upload = async (ctx, file) => {
  await ctx.clickText("选择媒体", { selector: "button" });
  const { result } = await ctx.client.send("Runtime.evaluate", { expression: "document.querySelector('input[aria-label=\"选择媒体\"]')" });
  ctx.assert(result.objectId, "Real media input exists");
  await ctx.client.send("DOM.setFileInputFiles", { objectId: result.objectId, files: [file] });
};
const box = ctx => ctx.eval(`(()=>{const r=${hero}.getBoundingClientRect();return{width:r.width,height:r.height}})()`);
export default {
  id: "design-fill-template-history", title: "填充切换和模板新会话回归", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5274" },
  steps: [{ name: "填充切换、保存、撤销", async run(ctx) {
    // Reset only the isolated fixture's selected layer for repeatable runs.
    await ctx.eval(`(async()=>{const s=await(await fetch('http://127.0.0.1:5274/witness')).json();const d=new DOMParser().parseFromString(s.designHtml,'text/html');const original=d.getElementById('other').cloneNode(true);original.id='hero';d.getElementById('hero').replaceWith(original);await fetch('http://127.0.0.1:5274/file?path=design/selection-proof/entry.html',{method:'POST',body:JSON.stringify({content:'<!DOCTYPE html>'+d.documentElement.outerHTML})});})()`, { awaitPromise: true });
    await ctx.client.send("Page.reload");
    await ctx.waitFor(`${hero}?.tagName === 'IMG' && ${hero}?.complete`, { timeoutMs: 60000 });
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 960, deviceScaleFactor: 1, mobile: false });
    await ctx.clickText("编辑", { selector: "button" });
    await ctx.waitFor(`${hero}?.complete`);
    await select(ctx);
    await click(ctx, "Toggle advanced design settings");
    await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"No fill\"]'))");
    const before = await box(ctx);
    const setup = await ctx.eval("fetch('http://127.0.0.1:5274/setup').then(r=>r.json()).then(s=>({root:s.root}))", { awaitPromise: true });
    await ctx.prove("图片可以切换无填充、纯色和渐变，撤销恢复原图及尺寸", {
      voiceover: "现在选中图片也能切换填充。无填充、纯色和渐变都会真实改变画面，撤销可恢复原图，尺寸不变。",
      action: async () => {
        for (const label of ["No fill", "Solid fill", "Gradient fill"]) {
          await click(ctx, label);
          await ctx.waitFor(`${hero}?.tagName === 'DIV'`);
          await ctx.waitFor(`document.querySelector('[aria-label=${JSON.stringify(label)}]')?.classList.contains('bg-foreground')`);
          const state = await ctx.eval(`(()=>{const e=${hero};return {image:e.style.backgroundImage,color:e.style.backgroundColor,source:e.getAttribute('src')}})()`);
          ctx.assert(state.source === null, "Old image pixels removed");
          ctx.assert(label === "Gradient fill" ? state.image.includes("gradient") : state.image === "none", label + " changes the actual layer");
          ctx.assert(label !== "Solid fill" || state.color !== "transparent", "Solid color is visible");
          const current = await box(ctx);
          ctx.assert(Math.abs(current.width-before.width)<1 && Math.abs(current.height-before.height)<1, "Rendered box retained");
          await click(ctx, "撤销设计修改");
          await ctx.waitFor(`${hero}?.tagName === 'IMG' && ${hero}?.complete && ${hero}?.naturalWidth > 0`);
          await select(ctx);
        }
        await click(ctx, "Gradient fill");
        await ctx.waitFor(`${hero}?.style.backgroundImage.includes('gradient')`);
      },
      assert: async () => ctx.assert(await ctx.eval(`${hero}.getAttribute('data-ipollowork-design-id') !== null`), "Selection identity remains usable"),
      screenshot: { name: "image-fill-switch", requireText: ["填充"], rejectText: ["暂时无法响应"] },
    });
    await click(ctx, "撤销设计修改");
    await ctx.waitFor(`${hero}?.tagName === 'IMG' && ${hero}?.complete`);
    await select(ctx);
    await ctx.prove("图片元素可上传视频填充，保存后仍能播放", {
      voiceover: "视频填充按钮现在可以点击。选中的图片能改成视频填充，保存并重新打开后，视频和图层尺寸都保留下来。",
      action: async () => {
        ctx.assert(await ctx.eval("!document.querySelector('[aria-label=\"视频填充\"]').matches(':disabled')"), "Video fill enabled on img");
        await click(ctx, "视频填充");
        await upload(ctx, setup.root + "/video/selection-proof/assets/background.mp4");
        await ctx.waitFor(`${hero}?.querySelector('video')?.readyState >= 2`);
        await click(ctx, "保存设计");
        await ctx.waitFor("fetch('http://127.0.0.1:5274/witness').then(r=>r.json()).then(s=>s.designHtml.includes('data-ipw-media-background')&&!s.designHtml.includes('blob:'))");
        await ctx.client.send("Page.reload");
        await ctx.waitFor(`${hero}?.querySelector('video')?.readyState >= 2`, { timeoutMs: 60000 });
        await ctx.clickText("编辑", { selector: "button" });
        await select(ctx);
        await click(ctx, "Toggle advanced design settings");
      },
      assert: async () => {
        const state = await saved(ctx), current = await box(ctx);
        ctx.assert(!state.designHtml.includes('blob:') && state.designHtml.includes('data-ipw-media-background'), "Disk uses a durable video reference");
        ctx.assert(Math.abs(current.width-before.width)<1 && Math.abs(current.height-before.height)<1, "Saved size retained");
      },
      screenshot: { name: "saved-video-fill", requireText: ["填充", "选择媒体"] },
    });
    await ctx.prove("视频可再换成图片或纯色，不残留旧视频", {
      voiceover: "视频填充还可以换回图片或纯色。旧视频会移除，新的图片预览和保存内容保持一致。",
      action: async () => {
        await click(ctx, "图片填充");
        await upload(ctx, setup.root + "/source.png");
        await ctx.waitFor(`${hero}?.style.backgroundImage.includes('blob:') && !${hero}?.querySelector('video')`);
        await click(ctx, "保存设计");
        await ctx.waitFor("fetch('http://127.0.0.1:5274/witness').then(r=>r.json()).then(s=>!s.designHtml.includes('data-ipw-media-background')&&s.designHtml.includes('background-image: url'))");
      },
      assert: async () => {
        const state = await saved(ctx);
        ctx.assert(!state.designHtml.includes("data-ipw-media-background") && !state.designHtml.includes("blob:"), "No stale video/preview reference remains");
        // Also cover a standalone authored video, not only the generated background.
        await ctx.eval(`${doc}.getElementById('clip').click()`);
        await ctx.waitFor(`${doc}?.getElementById('clip')?.hasAttribute('data-ipollowork-design-primary')`);
        await click(ctx, "Solid fill");
        await ctx.waitFor(`${doc}?.getElementById('clip')?.tagName === 'DIV'`);
        ctx.assert(await ctx.eval(`!${doc}.getElementById('clip').querySelector('video,source')`), "Standalone video pixels removed for solid fill");
        await select(ctx);
      },
      screenshot: { name: "video-back-to-image", requireText: ["填充"] },
    });
  } }, { name: "新模板历史及首次回复", async run(ctx) {
    await ctx.client.send("Page.navigate", { url: "http://127.0.0.1:5190/" });
    await ctx.waitForText("验证模板新会话", { timeoutMs: 60000 });
    let historyReadOffset = 0;
    await ctx.prove("新模板首次发言前正常显示对话区，不调用空历史接口", {
      voiceover: "新建模板会话后，对话区正常显示，不再出现历史接口的红色报错。这里用真实会话组件和服务端，模拟旧引擎的空历史错误。",
      action: async () => {
        historyReadOffset = await ctx.eval("fetch('http://127.0.0.1:5190/history/witness').then(r=>r.json()).then(s=>s.reads.length)", { awaitPromise: true });
        await ctx.clickText("验证模板新会话", { selector: "button" });
        await ctx.waitFor("Boolean(document.querySelector('[contenteditable=\"true\"]'))");
        await ctx.waitFor(`fetch('http://127.0.0.1:5190/history/witness').then(r=>r.json()).then(s=>s.reads.length>${historyReadOffset})`);
      },
      assert: async () => {
        const state = await ctx.eval("fetch('http://127.0.0.1:5190/history/witness').then(r=>r.json())", { awaitPromise: true });
        ctx.assert(state.reads.slice(historyReadOffset).every(read=>read.includeTurns===false), "Known new template read uses metadata only");
        await ctx.expectNoText("list_turns is not supported yet");
      },
      screenshot: { name: "new-template-no-history-error", requireText: ["AI 热点拆解"], rejectText: ["list_turns", "暂时无法响应"] },
    });
    await ctx.prove("首次发送后显示用户消息及回复，不再跳过历史", {
      voiceover: "发送第一条需求后，对话会正常显示用户消息和回复，后续历史读取不会被空会话逻辑跳过。",
      action: async () => {
        await ctx.eval("document.querySelector('[contenteditable=\"true\"]').focus()");
        await ctx.client.send("Input.insertText", { text: "新品发布预告" });
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await ctx.waitForText("视频创作需求已收到（模拟回复）");
        await ctx.waitFor("Boolean(document.querySelector('button[aria-label=\"保存为 Markdown\"]')) && !document.body.innerText.includes('处理中')");
      },
      assert: async () => {
        const state = await ctx.eval("fetch('http://127.0.0.1:5190/history/witness').then(r=>r.json())", { awaitPromise: true });
        ctx.assert(state.reads.slice(historyReadOffset).some(read=>read.includeTurns===true), "First input enables full history");
        await ctx.expectText("新品发布预告");
      },
      screenshot: { name: "first-turn-history", requireText: ["新品发布预告", "视频创作需求已收到（模拟回复）"], rejectText: ["list_turns"] },
    });
  } }],
};
