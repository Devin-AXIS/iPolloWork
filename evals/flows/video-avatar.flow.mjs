import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { fileURLToPath } from "node:url";
const narration = await loadVoiceoverParagraphs("video-avatar");
export default {
  id: "video-avatar", title: "Choose RunningHub or HeyGen in the existing avatar sidebar (simulated provider)", kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html" }, preserveTheme: true,
  steps: [
    { name: "Upload a portrait in the existing avatar panel", run: async ctx => {
      await ctx.prove("The original avatar panel saves an uploaded portrait and project narration", { voiceover: narration[0],
        action: async () => {
          await ctx.eval("history.replaceState(null, '', location.pathname + '?panel=avatar&profiles&audio')");
          await ctx.client.send("Page.reload", { ignoreCache: true });
          await ctx.waitFor("Boolean(window.avatarProof)");
          await ctx.waitForText("创建数字人");
          await ctx.clickText("创建数字人");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-avatar-panel] input[type=file]'))");
          const { root } = await ctx.client.send("DOM.getDocument");
          const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=video-avatar-panel] input[type=file]" });
          await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [fileURLToPath(new URL("../../apps/app/public/default-brand-avatar.jpg", import.meta.url))] });
          await ctx.waitFor("window.avatarProof.profiles[0]?.imagePath.endsWith('.jpg')");
          await ctx.trustedClick("#avatar-audio-clip");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:last-of-type");
          await ctx.clickText("保存设置");
          await ctx.waitFor("window.avatarProof.profiles[0]?.audioClipId === 'scene-two'");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("window.avatarProof.profiles[0]?.imageName === 'default-brand-avatar.jpg' && !window.avatarProof.requests.some(r=>r.action==='submit')"), "Saving portrait and narration must not generate a video");
          ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].find(el=>el.textContent==='生成数字人片段')?.disabled"), "Generation requires an explicit provider selection");
        },
        screenshot: { name: "avatar-original-upload-flow", requireText: ["名称", "default-brand-avatar.jpg", "配音片段"] },
      });
    } },
    { name: "Choose RunningHub and HeyGen before generating", run: async ctx => {
      await ctx.prove("Each submission uses the selected provider and its resolution while retaining photo, narration and orientation", { voiceover: narration[1],
        action: async () => {
          await ctx.trustedClick('[role="radio"][aria-label^="横屏"]');
          await ctx.trustedClick("#avatar-generation-method");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:first-of-type");
          await ctx.waitForText("使用 RunningHub 账户余额生成");
          ctx.assert(await ctx.eval("document.querySelector('#avatar-generation-method').textContent.includes('RunningHub · MiniMax H3')"), "The selected RunningHub service has a readable label");
          await ctx.clickText("生成数字人片段");
          await ctx.waitForText("成片已保存到素材库");
          await ctx.eval("document.querySelector('[data-testid=avatar-task-dialog] [data-slot=dialog-close]').click()");
          await ctx.waitFor("!document.querySelector('[data-testid=avatar-task-dialog]')");
          await ctx.trustedClick("#avatar-generation-method");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:last-of-type");
          await ctx.waitForText("生成片段使用订阅套餐积分");
          ctx.assert(await ctx.eval("document.querySelector('#avatar-generation-method').textContent.includes('HeyGen · Avatar IV')"), "The selected HeyGen service has a readable label");
          await ctx.clickText("生成数字人片段");
          await ctx.waitForText("成片已保存到素材库");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("(() => {const submits=window.avatarProof.requests.filter(r=>r.action==='submit');const [runninghub,heygen]=submits.map(r=>r.args);return submits.length===2 && runninghub.model==='minimax-h3-avatar' && runninghub.resolution==='0.258048MP' && heygen.model==='heygen-avatar-iv' && heygen.resolution==='1080p' && submits.every(({args})=>args.avatarClipId==='scene-two' && args.avatarProfileId===window.avatarProof.profiles[0].id && args.ratio==='16:9' && args.duration==='4' && args.imageRefs===window.avatarProof.profiles[0].imagePath)})()"), "Both provider routes retain the same saved avatar and narration, with their own resolution");
          ctx.assert(await ctx.eval("window.avatarProof.jobs.length===2 && window.avatarProof.jobs[0].model==='heygen-avatar-iv' && window.avatarProof.jobs[1].model==='minimax-h3-avatar'"), "Switching providers preserves existing tasks");
        },
        screenshot: { name: "avatar-heygen-result", requireText: ["成片已保存到素材库", "插入当前视频"] },
      });
    } },
    { name: "Preview and insert at the selected narration start", run: async ctx => {
      await ctx.prove("The original result preview inserts the clip at its narration start", { voiceover: narration[2],
        action: async () => {
          await ctx.clickText("预览数字人");
          await ctx.waitFor("(() => {const video=document.querySelector('[data-testid=avatar-task-dialog] video[src]');return video && video.readyState>=2 && video.videoWidth>0 && !video.error})()");
          await ctx.clickText("插入当前视频");
          await ctx.waitForText("已按配音起点 4.2 秒插入时间线");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("(() => {const inserts=window.avatarProof.requests.filter(r=>r.action==='asset-insert');return inserts.length===1 && inserts[0].start===4.2 && inserts[0].duration===4 && inserts[0].path.endsWith('result.mp4') && window.avatarProof.requests.filter(r=>r.action==='submit').length===2})()"), "Insert must retain narration timing and never regenerate");
          ctx.assert(await ctx.eval("(() => {const records=[...document.querySelectorAll('[data-testid=avatar-job-card]')];return records.length===2 && records.some(el=>el.textContent.includes('RunningHub')) && records.some(el=>el.textContent.includes('HeyGen'))})()"), "History identifies both providers");
        },
        screenshot: { name: "avatar-insert-at-narration-start", requireText: ["4.2 秒插入时间线", "生成记录", "RunningHub", "HeyGen"] },
      });
    } },
    { name: "Free plans block long narration and use 720p for short clips", run: async ctx => {
      await ctx.prove("A Free account cannot submit 71.6 seconds; a shorter selected clip uses 720p and the free quota", { voiceover: narration[3],
        action: async () => {
          const url = await ctx.eval("location.origin + location.pathname + '?panel=avatar&profiles&audio&freePlan'");
          await ctx.client.send("Page.navigate", { url });
          await ctx.waitForText("创建数字人");
          await ctx.clickText("创建数字人");
          await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-avatar-panel] input[type=file]'))");
          const { root } = await ctx.client.send("DOM.getDocument");
          const { nodeId } = await ctx.client.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid=video-avatar-panel] input[type=file]" });
          await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [fileURLToPath(new URL("../../apps/app/public/default-brand-avatar.jpg", import.meta.url))] });
          await ctx.waitFor("Boolean(window.avatarProof.profiles[0]?.imagePath)");
          await ctx.trustedClick("#avatar-audio-clip");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:first-of-type");
          await ctx.trustedClick("#avatar-generation-method");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:last-of-type");
          await ctx.waitForText("最长 60 秒，当前 71.6 秒");
          ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].find(el=>el.textContent==='生成数字人片段')?.disabled && !window.avatarProof.requests.some(r=>r.action==='submit')"), "The long narration is blocked without a submission");
          await ctx.trustedClick("#avatar-audio-clip");
          await ctx.trustedClick("[role=presentation][data-open] [role=option]:last-of-type");
          await ctx.waitFor("![...document.querySelectorAll('button')].find(el=>el.textContent==='生成数字人片段')?.disabled");
          await ctx.clickText("生成数字人片段");
          await ctx.waitForText("成片已保存到素材库");
          await ctx.eval("document.querySelector('[data-testid=avatar-task-dialog] [data-slot=dialog-close]').click()");
          await ctx.waitFor("!document.querySelector('[data-testid=avatar-task-dialog]')");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("(() => {const submits=window.avatarProof.requests.filter(r=>r.action==='submit');return submits.length===1 && submits[0].args.model==='heygen-avatar-iv' && submits[0].args.resolution==='720p' && submits[0].args.duration==='4' && submits[0].args.avatarClipId==='scene-two'})()"), "The shorter Free submission uses 720p and the selected narration");
        },
        screenshot: { name: "avatar-free-plan-720p", requireText: ["Free 套餐", "720p", "最长 60 秒", "免费账户的视频配额"] },
      });
    } },
  ],
};
