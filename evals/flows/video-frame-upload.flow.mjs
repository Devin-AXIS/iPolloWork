// Run image-selection-fixture.mjs --frames and the worktree Vite server on 5188.
// Uses the production host/plugin controls and guarded server file import/read.
import { selectOption } from "./video-console.flow.mjs";

const inspector = 'document.querySelector(\'[data-testid="workspace-app-inspector"]\')';
const field = id => `document.querySelector('[data-inspector-field="${id}"]')`;
const value = id => `document.querySelector('input[name="${id}"]')?.value`;
const preview = id => `${field(id)}?.querySelector('img')`;
async function upload(ctx, id, path) {
  const result = await ctx.client.send("Runtime.evaluate", { expression: `document.querySelector('input[data-media-field="${id}"]')` });
  await ctx.client.send("DOM.setFileInputFiles", { objectId: result.result.objectId, files: [path] });
  await ctx.waitFor(`${preview(id)}?.complete && ${preview(id)}?.naturalWidth > 0 && !document.querySelector('[aria-label="更换${id === "firstFrame" ? "首帧" : "尾帧"}图片"]').disabled`);
}

export default {
  id: "video-frame-upload", title: "右侧上传和预览首尾帧，移除重复素材区域", kind: "user-facing", preserveTheme: true,
  cdpTarget: { urlIncludes: "127.0.0.1:5190" },
  steps: [{ name: "首尾帧上传、更换、移除与模式切换（不调用生成服务）", async run(ctx) {
    await ctx.waitFor(`${inspector}?.innerText.includes('视频参数')`, { timeoutMs: 30000 });
    const setup = await ctx.eval("fetch('/setup').then(r=>r.json()).then(r=>({root:r.root}))", { awaitPromise: true });
    await ctx.prove("两个模型在右侧各自上传首尾帧，显示正确缩略图且保留提示词", {
      voiceover: "首帧和尾帧可以直接在右侧上传并预览，原来中间重复的素材区域已经移除。更换或移除只影响对应的图片。",
      action: async () => {
        for (const model of ["MiniMax H3 · RunningHub 工作流", "Seedance 2.5 · 火山引擎 Ark"]) {
          await selectOption(ctx, "视频模型", model);
          await selectOption(ctx, "生成方式", "首尾帧生视频");
          await ctx.fill('textarea[name="prompt"]', "保留首尾帧测试提示词，不生成视频");
          await upload(ctx, "firstFrame", setup.root + "/source.png");
          await upload(ctx, "lastFrame", setup.root + "/last.png");
          ctx.assert(await ctx.eval(`${value("firstFrame")} !== ${value("lastFrame")}`), "First and last inputs have distinct real workspace paths");
          ctx.assert(await ctx.eval(`document.querySelector('textarea[name="prompt"]').value === '保留首尾帧测试提示词，不生成视频'`), "Uploading does not lose the typed prompt");
        }
        const last = await ctx.eval(value("lastFrame"));
        await upload(ctx, "firstFrame", setup.root + "/last.png");
        ctx.assert(await ctx.eval(value("lastFrame")) === last, "Replacing the first frame leaves the last frame unchanged");
        await ctx.eval(`document.querySelector('button[aria-label="移除首帧图片"]').click()`);
        await ctx.waitFor(`${value("firstFrame")} === ''`);
        ctx.assert(await ctx.eval(value("lastFrame")) === last, "Removing first frame leaves last frame intact");
        await upload(ctx, "firstFrame", setup.root + "/source.png");
      },
      assert: async () => {
        for (const [id, blue] of [["firstFrame", false], ["lastFrame", true]]) {
          const isBlue = await ctx.eval(`(()=>{const i=${preview(id)},c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(i,0,0,1,1,0,0,1,1);const p=c.getContext('2d').getImageData(0,0,1,1).data;return p[2]>p[0]})()`);
          ctx.assert(isBlue === blue, `${id} preview pixels match the uploaded file`);
        }
        ctx.assert(await ctx.eval(`!document.querySelector('iframe[title="视频控制台"]').contentDocument.querySelector('.material')`), "The duplicated material section is removed");
        const witness = await ctx.eval("fetch('/witness').then(r=>r.json())", { awaitPromise: true });
        ctx.assert(witness.requests.length === 0 && witness.videoJobs.length === 0, "No generation or provider request was made");
        await ctx.eval(`${field("firstFrame")}.scrollIntoView({block:'center'})`);
      }, screenshot: { name: "inline-frame-previews", requireText: ["视频参数", "首帧图片", "尾帧图片"] },
    });
    await ctx.prove("切换到首帧模式清除尾帧，窄面板仍能上传和查看", {
      voiceover: "切换成首帧生视频后，尾帧控件会收起并清除，不会误传到下一次生成；再切回时需要重新选择尾帧。",
      action: async () => {
        const first = await ctx.eval(value("firstFrame"));
        await selectOption(ctx, "生成方式", "首帧生视频");
        ctx.assert(await ctx.eval(`!${field("lastFrame")}`), "First-only mode hides the last frame");
        ctx.assert(await ctx.eval(value("firstFrame")) === first, "First frame survives a compatible mode change");
        await selectOption(ctx, "生成方式", "首尾帧生视频");
        ctx.assert(await ctx.eval(value("lastFrame")) === "", "The hidden last frame was cleared, not silently reused");
        await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 900, deviceScaleFactor: 1, mobile: false });
        await ctx.eval(`${field("firstFrame")}.scrollIntoView({block:'center'})`);
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`(()=>{const p=${inspector},r=p.getBoundingClientRect();return r.width>=300&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1})()`), "The existing 310px inspector has no horizontal overflow");
        await ctx.waitFor(`${preview("firstFrame")}?.complete && ${preview("firstFrame")}.naturalWidth > 0`);
      }, screenshot: { name: "first-frame-mode-and-narrow-panel", requireText: ["视频参数", "点击上传尾帧图片"] },
    });
    await ctx.client.send("Emulation.clearDeviceMetricsOverride");
  } }],
};
