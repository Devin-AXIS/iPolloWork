import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const narration = await loadVoiceoverParagraphs("video-avatar");
export default {
  id: "video-avatar", title: "VideoStudio avatar component integration (simulated provider)", kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html" }, preserveTheme: true,
  steps: [
    { name: "Open the real voice panel", run: async ctx => {
      await ctx.waitForText("数字人视频");
      await ctx.prove("Avatar is available next to both voice tabs", { voiceover: narration[0],
        action: async () => { await ctx.clickText("数字人视频"); await ctx.waitFor("Boolean(document.querySelector('[data-testid=video-avatar-panel]'))"); },
        assert: async () => { await ctx.expectText("百炼音色"); await ctx.expectText("我的声音"); await ctx.expectText("上传配音"); },
        screenshot: { name: "avatar-entry", requireText: ["百炼音色", "我的声音", "上传配音"] },
      });
    } },
    { name: "Choose landscape with uploaded inputs", run: async ctx => {
      await ctx.prove("Both orientations retain the low-cost defaults", { voiceover: narration[1],
        action: async () => {
          for (const [i, name, type] of [[0, 'person.png', 'image/png'], [1, 'voice.wav', 'audio/wav']]) {
            await ctx.eval(`(() => { const input=document.querySelectorAll('[data-testid=video-avatar-panel] input[type=file]')[${i}]; const transfer=new DataTransfer(); transfer.items.add(new File(['fixture'],${JSON.stringify(name)},{type:${JSON.stringify(type)}})); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
            await ctx.waitFor(`window.avatarProof.requests.filter(r=>r.action==='upload').length===${i + 1}`);
          }
          await ctx.waitFor("window.avatarProof.requests.filter(r=>r.action==='upload').length===2");
          await ctx.eval(`document.querySelector('[aria-label="数字人画幅"]').click()`);
          await ctx.clickText("横屏 1024×576");
        },
        assert: async () => { await ctx.expectText("音频从 0 秒开始"); await ctx.expectText("6 步"); await ctx.expectText("match"); await ctx.expectText("横屏 1024×576"); },
        screenshot: { name: "avatar-landscape", requireText: ["横屏 1024×576", "match"] },
      });
    } },
    { name: "Submit and use the simulated result", run: async ctx => {
      await ctx.prove("The chosen image and audio reach the job request", { voiceover: narration[2],
        action: async () => { await ctx.clickText("生成数字人视频（付费）"); await ctx.waitForText("模拟生成完成"); await ctx.clickText("添加到项目素材"); },
        assert: async () => {
          ctx.assert(await ctx.eval(`(() => {const r=window.avatarProof.requests.find(r=>r.action==='submit');return r?.args.model==='minimax-h3-avatar'&&r.args.ratio==='16:9'&&r.args.duration==='10'&&r.args.imageRefs.endsWith('.png')&&r.args.audioRefs.endsWith('.wav')&&window.avatarProof.added.length===1})()`), "Submission and add-to-project callback carry selected media");
        },
        screenshot: { name: "avatar-result", requireText: ["模拟生成完成", "已添加到当前项目素材"] },
      });
    } },
  ],
};
