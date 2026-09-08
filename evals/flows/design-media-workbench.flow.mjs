// Run image-selection-fixture.mjs --media plus the app and Studio dev servers.
// Real editor/plugin UI and local files; generated image/video responses are simulated.
import { connect, evaluate, pickAppTarget } from "../runner/cdp.mjs";

const design = "document.querySelector('iframe[title^=\"Design preview:\"]')?.contentDocument";
const image = "document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument";
const video = "document.querySelector('iframe[title=\"视频控制台\"]')?.contentDocument";
const witness = ctx => ctx.eval("fetch('http://127.0.0.1:5274/witness').then(r=>r.json())", { awaitPromise: true });
const select = async (ctx, id) => {
  await ctx.waitFor(`Boolean(${design}?.getElementById(${JSON.stringify(id)}))`);
  await ctx.eval(`${design}.getElementById(${JSON.stringify(id)}).click()`);
  await ctx.waitFor(`${design}?.getElementById(${JSON.stringify(id)})?.hasAttribute('data-ipollowork-design-primary')`);
};
async function imageEdit(ctx, mode) {
  await ctx.eval(`${image}.querySelector('#parameters').click()`);
  await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
  await ctx.fill('textarea[name="prompt"]', "把画面改成蓝色测试图片");
  await ctx.clickText("生成编辑结果", { selector: "button" });
  await ctx.waitFor(`${image}?.querySelector('#saveReview')?.hidden === false`);
  await ctx.eval(`${image}.querySelector(${JSON.stringify(mode === "copy" ? "#saveCopy" : "#overwriteEdit")}).click()`);
  if (mode === "overwrite") await ctx.eval(`${image}.querySelector('#overwriteEdit').click()`);
}
async function chooseFile(ctx, path) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1 });
  const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[aria-label="选择媒体"]' });
  ctx.assert(nodeId, "Media file input is available");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [path] });
}
async function editVideo(ctx) {
  await ctx.waitFor(`${video}?.querySelector('#player')?.readyState >= 2`);
  await ctx.eval(`${video}.querySelector('#settings').click()`);
  await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
  await ctx.fill('textarea[name="prompt"]', "保持构图，调整背景色调（模拟验证）");
  const button = await ctx.eval("[...document.querySelectorAll('button')].filter(e=>!e.disabled&&/生成|编辑/.test(e.textContent)).map(e=>e.textContent)");
  ctx.log(JSON.stringify(button));
  await ctx.clickText("生成编辑结果", { selector: "button" });
  await ctx.waitFor(`${video}?.body.innerText.includes('使用此版本')`);
  await ctx.eval(`[...${video}.querySelectorAll('button')].find(e=>e.textContent==='使用此版本').click()`);
  await ctx.waitForText("替换当前素材");
  await ctx.clickText("替换当前素材", { selector: "button" });
}
export default {
  id: "design-media-workbench", title: "媒体填充、精简工具栏及跨控制台编辑", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5274" },
  steps: [{ name: "真实 Design 与视频控制台，本地样例和模拟生成", async run(ctx) {
    await ctx.client.send("Page.bringToFront");
    // The fixture is opened before this flow; avoid reloading Vite's large
    // development module graph while Chromium is capturing the same surface.
    await ctx.clickText("Design 验证", { selector: "button" });
    await ctx.waitFor(`${design}?.getElementById('hero')?.complete`, { timeoutMs: 60000 });
    await ctx.clickText("编辑", { selector: "button" });
    await ctx.waitFor(`${design}?.documentElement.getAttribute("data-ipollowork-design-mode") === "editing"`);
    const setup = await ctx.eval("fetch('http://127.0.0.1:5274/setup').then(r=>r.json()).then(r=>({root:r.root}))", { awaitPromise: true });
    await ctx.prove("选中图片只增加一个编辑图标，悬停出现文字气泡", {
      voiceover: "选中图片后，工具栏只多一个图片编辑图标。鼠标停上去，就能看到熟悉的文字提示。",
      action: async () => {
        await select(ctx, "hero");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"在图片工作台编辑\"]'))");
        const point = await ctx.eval("(()=>{const r=document.querySelector('[aria-label=\"在图片工作台编辑\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
        await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await ctx.waitFor("document.body.innerText.includes('在图片工作台编辑')");
      },
      assert: async () => ctx.assert(await ctx.eval("document.querySelector('[aria-label=\"在图片工作台编辑\"]').textContent.trim()==='' && !document.querySelector('[aria-label=\"在视频控制台编辑\"]')"), "One icon-only action, appropriate to the selected media"),
      screenshot: { name: "compact-media-tooltip", requireText: ["在图片工作台编辑"] },
    });
    await ctx.prove("另存为图片后只替换当前元素，保留原图引用", {
      voiceover: "点击图标打开原图片。另存为保留新旧两版，再点替换当前素材，只更新当前选中的图片。",
      action: async () => {
        await ctx.eval("document.querySelector('[aria-label=\"在图片工作台编辑\"]').click()");
        await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width === 800`);
        await imageEdit(ctx, "copy");
        await ctx.waitForText("替换当前素材");
        await ctx.clickText("替换当前素材", { selector: "button" });
        await ctx.waitFor(`${design}?.getElementById('hero')?.complete && !document.querySelector('[data-testid="media-workbench"]')`);
      },
      assert: async () => {
        const state = await witness(ctx);
        ctx.assert(state.designHtml.includes("-edited-"), "Copy was written to HTML");
        ctx.assert(/id="other" src="assets\/source.png"/.test(state.designHtml), "Other image still uses its original source");
        ctx.assert(!state.designHtml.includes("blob:"), "Preview-only URLs are not serialized");
      },
      screenshot: { name: "design-copy-selected-only", requireText: ["Design 验证"] },
    });
    await ctx.prove("覆盖后 Design 解码新图片，不使用旧预览缓存", {
      voiceover: "覆盖原图后返回 Design，画布会显示更新后的图片，不需要重新打开文件。",
      action: async () => {
        await select(ctx, "other");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"在图片工作台编辑\"]'))");
        await ctx.eval("document.querySelector('[aria-label=\"在图片工作台编辑\"]').click()");
        await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width === 800`);
        await imageEdit(ctx, "overwrite");
        await ctx.waitForText("已刷新使用该文件的画面。");
        await ctx.clickText("返回 Design", { selector: "button" });
        await ctx.waitFor(`${design}?.getElementById('other')?.naturalWidth > 0 && ${design}?.getElementById('other')?.complete`);
      },
      assert: async () => {
        const blue = await ctx.eval(`(()=>{const d=${design},i=d.getElementById('other'),c=d.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,400,250,1,1,0,0,1,1);const p=c.getContext('2d').getImageData(0,0,1,1).data;return p[2]>p[0];})()`);
        ctx.assert(blue, "Preview decoded overwritten blue pixels");
      },
      screenshot: { name: "design-overwrite-refresh", requireText: ["Design 验证"] },
    });
    await ctx.prove("填充图片和视频能保存并重新显示，文字布局保持不变", {
      voiceover: "在填充面板选择本机图片或视频。素材填入当前图层，文字和尺寸保持原样，保存后仍能正常显示。",
      action: async () => {
        await select(ctx, "fill");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"Toggle advanced design settings\"]'))");
        await ctx.eval("document.querySelector('[aria-label=\"Toggle advanced design settings\"]').click()");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"图片填充\"]'))");
        await ctx.eval("document.querySelector('[aria-label=\"图片填充\"]').click()");
        await ctx.clickText("选择媒体", { selector: "button" });
        await chooseFile(ctx, setup.root + "/source.png");
        await ctx.waitFor(`${design}?.getElementById('fill')?.style.backgroundImage.includes('blob:')`);
        await ctx.eval("document.querySelector('[aria-label=\"保存设计\"]').click()");
        await ctx.waitFor("fetch('http://127.0.0.1:5274/witness').then(r=>r.json()).then(r=>r.designHtml.includes('background-image: url') && !r.designHtml.includes('blob:'))");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"视频填充\"]'))");
        await ctx.eval("document.querySelector('[aria-label=\"视频填充\"]').click()");
        await ctx.clickText("选择媒体", { selector: "button" });
        await chooseFile(ctx, setup.root + "/video/selection-proof/assets/background.mp4");
        await ctx.waitFor(`${design}?.querySelector('#fill > video')?.readyState >= 2`);
        await ctx.eval("document.querySelector('[aria-label=\"保存设计\"]').click()");
        await ctx.waitFor("fetch('http://127.0.0.1:5274/witness').then(r=>r.json()).then(r=>r.designHtml.includes('data-ipw-media-background') && !r.designHtml.includes('blob:'))");
      },
      assert: async () => {
        const state = await witness(ctx);
        ctx.assert(state.designHtml.includes("data-ipw-media-background") && !state.designHtml.includes("blob:"), "Saved HTML contains a real video asset reference");
        ctx.assert(state.designHtml.includes("保持布局和文字"), "Layer text retained");
      },
      screenshot: { name: "design-video-fill", requireText: ["填充", "选择媒体"] },
    });
    await ctx.prove("HTML 选中的视频整体送入视频控制台，新版本只替换当前素材", {
      voiceover: "选中视频，点击视频编辑图标。控制台收到的是整段视频，选择编辑结果后，只替换当前元素，原视频继续保留。",
      action: async () => {
        await select(ctx, "clip");
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"在视频控制台编辑\"]'))");
        await ctx.eval("document.querySelector('[aria-label=\"在视频控制台编辑\"]').click()");
        await editVideo(ctx);
        await ctx.waitFor(`${design}?.getElementById('clip')?.readyState >= 2 && !document.querySelector('[data-testid="media-workbench"]')`);
      },
      assert: async () => {
        const state = await witness(ctx);
        ctx.assert(state.designHtml.includes('id="clip" src="../../video/selection-proof/renders/mock-edit.mp4"'), "Only selected video reference updated");
        ctx.assert(state.designHtml.includes("data-ipw-media-background"), "Background fill retained");
        ctx.output("Saved media witness", JSON.stringify(state));
      },
      screenshot: { name: "design-edited-video", requireText: ["Design 验证"] },
    });
  } }, { name: "Video Studio 整段视频跳转与定点替换", async run(ctx) {
    await ctx.clickText("Video Studio 验证", { selector: "button" });
    let target;
    for (let attempt = 0; attempt < 40 && !target; attempt++) {
      try { target = await pickAppTarget(ctx.cdpBaseUrl, { urlIncludes: "localhost:5192" }); }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    ctx.assert(target, "Embedded Studio has a browser target");
    const connection = await connect(target.webSocketDebuggerUrl);
    const studioEval = expression => evaluate(connection, expression, { awaitPromise: true });
    const player = "document.querySelector('hyperframes-player')";
    const frame = `${player}?.shadowRoot?.querySelector('iframe')`;
    const doc = `${frame}?.contentDocument`;
    const waitStudio = async expression => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const value = await studioEval(expression);
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error(`Video Studio did not reach: ${expression}`);
    };
    let playhead;
    const before = await witness(ctx);
    try {
      await ctx.prove("Video Studio 选择整段视频，图标跳转并传入精确素材", {
        voiceover: "在视频预览中选中整段视频，工具栏显示视频编辑图标。它打开原视频，不会把视频帧当作图片。",
        action: async () => {
          await waitStudio(`Boolean(document.querySelector('[aria-label="选择 Video Background"]')) && ${doc}?.getElementById('video-background')?.readyState >= 2`);
          await studioEval("document.querySelector('[aria-label=\"选择 Video Background\"]').click()");
          const point = await studioEval(`(()=>{const f=${frame},r=f.getBoundingClientRect();return{x:r.x+r.width*.96,y:r.y+r.height*.88}})()`);
          point.y += await ctx.eval("document.querySelector('iframe[title=\"Video Studio\"]').getBoundingClientRect().y");
          for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await ctx.client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
          await waitStudio("Boolean(document.querySelector('[aria-label=\"在视频控制台编辑\"]'))");
          ctx.assert(await studioEval("!document.querySelector('[aria-label=\"在图片工作台编辑\"]')"), "Video has no image/frame edit action");
          playhead = await studioEval(`${player}.currentTime`);
          await studioEval("document.querySelector('[aria-label=\"在视频控制台编辑\"]').click()");
          await ctx.waitFor(`${video}?.querySelector('#player')?.readyState >= 2`);
        },
        assert: async () => ctx.assert(await ctx.eval("document.querySelector('[data-testid=\"media-workbench\"]').textContent.includes('video/selection-proof/assets/background.mp4')"), "Console launch carries the selected source"),
        screenshot: { name: "video-studio-open-selected-clip", requireText: ["返回视频", "assets/background.mp4"] },
      });
      await ctx.prove("视频新版本只替换当前片段，原素材、布局、时长与播放位置保留", {
        voiceover: "编辑完成后选择使用此版本，再确认替换当前素材。原视频仍保留，当前片段的布局、时间轴和播放位置不变。",
        action: async () => {
          await editVideo(ctx);
          await ctx.waitFor("!document.querySelector('[data-testid=\"media-workbench\"]')");
          await waitStudio(`${doc}?.getElementById('video-background')?.getAttribute('src').includes('mock-edit.mp4')`);
        },
        assert: async () => {
          const after = await witness(ctx);
          ctx.assert(after.actions.some(item => item.action === "submit" && item.sourcePath === "video/selection-proof/assets/background.mp4"), "Provider receives whole selected video");
          ctx.assert(after.videoAssets.includes("background.mp4") && after.videoAssets.length === before.videoAssets.length + 1, "Original retained, one distinct edited clip imported");
          ctx.assert(await studioEval(`${doc}.getElementById('hero-image').getAttribute('src') === 'assets/source.png'`), "Unselected image source is unchanged");
          ctx.assert(after.videoHtml.includes('data-duration="6"') && after.videoHtml.includes('width:960px;height:600px'), "Source timing and geometry retained");
          ctx.assert(Math.abs(await studioEval(`${player}.currentTime`) - playhead) < .1, "Playhead retained");
          ctx.output("Video Studio saved source", after.videoHtml);
        },
        screenshot: { name: "video-studio-replace-selected-clip", requireText: ["Video Studio 验证"] },
      });
      await ctx.prove("取消编辑不替换素材，文字图层没有媒体编辑入口", {
        voiceover: "只打开后返回，不会替换素材。选中文字图层时，不显示多余的图片或视频编辑图标。",
        action: async () => {
          await studioEval("document.querySelector('[aria-label=\"选择 Video Background\"]').click()");
          await waitStudio("Boolean(document.querySelector('[aria-label=\"在视频控制台编辑\"]'))");
          await studioEval("document.querySelector('[aria-label=\"在视频控制台编辑\"]').click()");
          await ctx.waitForText("返回视频");
          await ctx.clickText("返回视频", { selector: "button" });
          await studioEval("document.querySelector('[aria-label=\"选择 Title\"]').click()");
          await waitStudio("!document.querySelector('[aria-label=\"在视频控制台编辑\"]') && !document.querySelector('[aria-label=\"在图片工作台编辑\"]')");
        },
        assert: async () => ctx.assert((await witness(ctx)).videoAssets.length === before.videoAssets.length + 1, "Cancel created no extra material or replacement"),
        screenshot: { name: "video-studio-cancel-and-text", requireText: ["Video Studio 验证"] },
      });
    } finally { connection.close(); }
  } }],
};
