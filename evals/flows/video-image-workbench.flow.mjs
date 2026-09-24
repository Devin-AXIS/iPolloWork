import { connect, pickAppTarget, evaluate } from "../runner/cdp.mjs";

const studio = `document.querySelector('iframe[title="图片工作台"]')?.contentDocument`;
const player = `document.querySelector('hyperframes-player')`;
const preview = `${player}?.shadowRoot?.querySelector('iframe')`;
const videoDoc = `${preview}?.contentDocument`;
async function video(ctx, expression) {
  const target = await pickAppTarget(ctx.cdpBaseUrl, { urlIncludes: "localhost:5192" });
  const connection = await connect(target.webSocketDebuggerUrl);
  try { return await evaluate(connection, expression, { awaitPromise: true }); }
  finally { connection.close(); }
}
async function waitVideo(ctx, expression) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await video(ctx, expression);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Video assertion timed out: ${expression}`);
}
async function selectVideoElement(ctx, id) {
  const label = { "hero-image": "Hero Image", "image-background": "Image Background", "video-background": "Video Background" }[id];
  await waitVideo(ctx, `Boolean(document.querySelector('[aria-label="选择 ${label}"]')) && ${videoDoc}?.getElementById('hero-image')?.complete`);
  await video(ctx, `document.querySelector('[aria-label="选择 ${label}"]').click()`);
  await waitVideo(ctx, `document.querySelector('[aria-label="选择 ${label}"]')?.getAttribute('aria-pressed') === 'true'`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const point = await waitVideo(ctx, `(() => {const f=${preview};const e=f?.contentDocument?.getElementById(${JSON.stringify(id)});if(!e)return null; const r=f.getBoundingClientRect(), b=e.getBoundingClientRect();if(r.width<100||b.width<100||b.height<50)return null;return {x:r.x+(b.x+b.width*.5)*r.width/f.contentWindow.innerWidth,y:r.y+(b.y+b.height*.5)*r.height/f.contentWindow.innerHeight};})()`);
  if (id === "video-background") { point.x += 350; point.y += 170; }
  point.y += await ctx.eval(`document.querySelector('iframe[title="Video Studio"]').getBoundingClientRect().y`);
  ctx.log(`Select ${id} at ${JSON.stringify(point)}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await ctx.client.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
}
async function openImage(ctx, id) {
  await selectVideoElement(ctx, id);
  await waitVideo(ctx, `Boolean(document.querySelector('[aria-label="在图片工作台编辑"]'))`);
  await video(ctx, `document.querySelector('[aria-label="在图片工作台编辑"]').click()`);
  await ctx.waitFor(`${studio}?.querySelector('#imageCanvas')?.width === 800`, { timeoutMs: 60_000 });
}
async function pluginClick(ctx, selector) {
  await ctx.waitFor(`${studio}?.querySelector(${JSON.stringify(selector)})?.disabled === false`);
  await ctx.eval(`${studio}.querySelector(${JSON.stringify(selector)}).click()`);
}
async function edit(ctx) {
  if (!await ctx.eval(`Boolean(document.querySelector('textarea[name="prompt"]'))`)) await pluginClick(ctx, "#parameters");
  await ctx.fill('textarea[name="prompt"]', "把选中部分改成蓝色测试图，保留其他部分");
  await pluginClick(ctx, '[data-tool="rectangle"]');
  const area = await ctx.waitFor(`(()=>{const f=document.querySelector('iframe[title="图片工作台"]'), r=f?.contentDocument?.querySelector('#selectionCanvas')?.getBoundingClientRect(); if(!r||r.width<100)return null;const o=f.getBoundingClientRect();return{x:o.x+r.x,y:o.y+r.y,width:r.width,height:r.height};})()`);
  const start = { x: area.x + area.width * .35, y: area.y + area.height * .35 };
  const end = { x: area.x + area.width * .65, y: area.y + area.height * .65 };
  await ctx.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
  await ctx.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
  await ctx.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
  await ctx.waitFor(`${studio}?.querySelector('#clearSelection')?.disabled === false`);
  await ctx.clickText('生成编辑结果', { selector: 'button' });
  await ctx.waitFor(`${studio}?.querySelector('#saveReview')?.hidden === false`);
}
const witness = ctx => ctx.eval(`fetch('http://127.0.0.1:5274/witness').then(r=>r.json())`, { awaitPromise: true });

export default {
  id: "video-image-workbench", title: "视频中的图片跳转、覆盖刷新与另存为替换", kind: "user-facing", preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_EVAL_VIDEO_RETURN_URL"],
  steps: [{ name: "独立视频素材联动（模拟模型，真实 UI 和文件保存）", async run(ctx) {
    try {
      await ctx.client.send("Page.navigate", { url: "http://127.0.0.1:5274/" });
      await ctx.client.send("Page.bringToFront");
      await ctx.waitForText("视频图片联动验证", { timeoutMs: 60_000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      const before = await witness(ctx);
      let playhead;
      await ctx.prove("预览中选中的独立图片可跳转至图片工作台", {
        voiceover: "在视频预览中点击独立图片，再点击图片工作台按钮，打开的就是选中的原素材。",
        action: async () => {
          playhead = await waitVideo(ctx, `${player} && {time:${player}.currentTime}`);
          await openImage(ctx, "hero-image");
        },
        assert: async () => ctx.assert(await ctx.eval(`${studio}.querySelector('#sourceMeta').textContent.includes('source.png')`), "Selected source is decoded in Image Studio"),
        screenshot: { name: "open-selected-image", requireText: ["返回视频", "assets/source.png"] },
      });
      await ctx.prove("覆盖后视频中同一素材的所有引用刷新且播放位置保留", {
        voiceover: "编辑后确认覆盖原图，返回视频可看到所有引用该图片的位置同步更新，播放位置保持不变。",
        action: async () => {
          await edit(ctx); await pluginClick(ctx, "#overwriteEdit"); await pluginClick(ctx, "#overwriteEdit");
          await ctx.waitForText("原图已覆盖，视频素材已刷新。"); await ctx.clickText("返回视频", { selector: "button" });
          await waitVideo(ctx, `${videoDoc}?.getElementById('hero-image')?.complete`);
        },
        assert: async () => {
          const after = await witness(ctx);
          ctx.assert(after.videoAssets.length === before.videoAssets.length, "Overwrite creates no extra video asset");
          const pixels = await waitVideo(ctx, `(()=>{const d=${videoDoc};if(!d)return null;const pixels=['hero-image','other-image'].map(id=>{const i=d.getElementById(id);if(!i?.complete||!i.naturalWidth)return null;const c=d.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,400,250,1,1,0,0,1,1);return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);});return pixels.every(p=>p&&p[2]>p[0])?pixels:null;})()`);
          ctx.assert(pixels.every(pixel => pixel[2] > pixel[0]), "Both visible images decoded the blue edited pixels instead of stale cache");
          ctx.assert(Math.abs((await video(ctx, `${player}.currentTime`)) - playhead.time) < .1, "Playhead preserved");
          ctx.output("Overwrite witness", JSON.stringify({ pixels, actions: after.actions }));
        },
        screenshot: { name: "overwrite-video-refresh", requireText: ["视频图片联动验证"] },
      });
      await ctx.prove("图片背景另存为后只替换当前元素并保留原图", {
        voiceover: "图片背景也能跳转编辑。另存为保留两版，再点击替换当前视频图片，只改变选中的背景引用。",
        action: async () => {
          await openImage(ctx, "image-background"); await edit(ctx); await pluginClick(ctx, "#saveCopy");
          await ctx.waitForText("替换当前视频图片"); await ctx.clickText("替换当前视频图片", { selector: "button" });
          await ctx.waitFor(`!document.querySelector('[data-testid="video-image-workbench"]')`);
          await waitVideo(ctx, `${videoDoc}?.getElementById('image-background')?.style.backgroundImage.includes('-edited-')`);
        },
        assert: async () => {
          const after = await witness(ctx);
          ctx.assert(after.videoAssets.length === before.videoAssets.length + 1, "One distinct image was imported into the video project");
          ctx.assert(await video(ctx, `${videoDoc}.getElementById('hero-image').getAttribute('src') === 'assets/source.png' && ${videoDoc}.getElementById('other-image').getAttribute('src') === 'assets/source.png'`), "Other image references remain original");
          ctx.assert(await video(ctx, `${videoDoc}.getElementById('image-background').style.left === '630px' && ${videoDoc}.getElementById('image-background').style.width === '260px'`), "Selected background geometry preserved");
          ctx.output("Copy witness", JSON.stringify({ videoAssets: after.videoAssets, artifacts: after.artifacts, videoHtml: after.videoHtml }));
        },
        screenshot: { name: "copy-replace-selected-background", requireText: ["视频图片联动验证"] },
      });
      await ctx.prove("视频背景作为视频整体，不提供图片工作台入口", {
        voiceover: "选择视频背景时不会出现图片编辑入口，不会尝试选择视频画面里的图片。",
        action: () => selectVideoElement(ctx, "video-background"),
        assert: async () => {
          await waitVideo(ctx, `document.querySelector('[aria-label="选择 Video Background"]')?.getAttribute('aria-pressed') === 'true'`);
          ctx.assert(await video(ctx, `!document.querySelector('[aria-label="在图片工作台编辑"]') && ${videoDoc}.getElementById('video-background').getAttribute('src') === 'assets/background.mp4'`), "Video background is unchanged and has no image edit action");
        },
        screenshot: { name: "video-background-no-image-action", requireText: ["视频图片联动验证"] },
      });
    } catch (error) {
      await ctx.screenshot("failure-before-return", { requireText: ["视频图片联动验证"] });
      throw error;
    } finally {
      await ctx.client.send("Page.navigate", { url: ctx.env.IPOLLOWORK_EVAL_VIDEO_RETURN_URL });
    }
  } }],
};
