export default {
  id: "long-avatar", title: "Long avatar progress and segment retry (simulated provider)", kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html?long" }, preserveTheme: true,
  steps: [{name:"Long narration and selective retry",run:async ctx=>{
    await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:1280,height:1600,deviceScaleFactor:1,mobile:false});
    await ctx.client.send("Page.reload");
    await ctx.waitForText("数字人视频");
    await ctx.waitFor("document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'true'");
    await ctx.prove("Long narration shows saved segment progress and per-segment retry",{
      voiceover:"默认动作强调自然眨眼和放松表情。五十八秒配音使用标准模式分段生成；第一段已保存，第二段失败时可以单独重试。",
      action:async()=>{await ctx.waitForText("已完成 1/5 段");},
      assert:async()=>{ctx.assert(await ctx.eval(`Boolean(document.querySelector('[aria-label="竖屏 384×672"]'))`),"Standard dimensions remain on the compact ratio control");await ctx.expectText("第 2/5 段失败");await ctx.expectText("预览此段");ctx.assert(await ctx.eval(`document.querySelector('[data-testid=video-avatar-panel] textarea').value.includes('自然眨眼')`),"Natural expressions are the editable default");},
      screenshot:{name:"long-avatar-progress",requireText:["已完成 1/5 段","重试此段"]},
    });
    await ctx.prove("Retry targets only the failed segment and preserves the completed output",{
      voiceover:"点击第二段的重试后，第一段保持已保存，不会重新生成。",
      action:async()=>{await ctx.eval(`(() => {const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent==='重试此段（计费）');buttons[0].click();})()`);await ctx.waitForText("只重试第 2 段");},
      assert:async()=>{ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r=>r.action==='retry-segment').length===1&&window.avatarProof.requests.find(r=>r.action==='retry-segment').args.index===1&&window.avatarProof.jobs[0].avatarSequence.segments[0].path==='saved-first.mp4'`),"Only failed segment was retried; first output remains");},
      screenshot:{name:"long-avatar-retry",requireText:["只重试第 2 段","已完成 1/5 段"]},
    });
    await ctx.prove("Custom avatar duration exceeds the old limit and keeps the duration visible", {
      voiceover:"不使用配音时，可以填写更长的数字人时长。超过十五秒会自动分段拼接，时长和分段进度仍然可见。",
      action:async()=>{
        await ctx.trustedClick('[role="switch"]');
        await ctx.fill('[aria-label="数字人视频时长"]',"720");
        ctx.assert(Boolean(process.env.IPOLLOWORK_AVATAR_TEST_IMAGE),"Provide a local reference image");
        const {root}=await ctx.client.send("DOM.getDocument");
        const {nodeId}=await ctx.client.send("DOM.querySelector",{nodeId:root.nodeId,selector:'[data-testid="video-avatar-panel"] input[type="file"]'});
        await ctx.client.send("DOM.setFileInputFiles",{nodeId,files:[process.env.IPOLLOWORK_AVATAR_TEST_IMAGE]});
        await ctx.waitFor("Boolean(document.querySelector('[aria-label=\"替换人物图片\"]')) && !document.querySelector('[data-testid=video-avatar-panel] [aria-label=\"选择人物图片\"]').disabled");
        await ctx.clickText("生成数字人",{selector:"button"});
        await ctx.waitForText("已自动加入当前 Video Studio 素材库");
      },
      assert:async()=>{
        ctx.assert(await ctx.eval(`window.avatarProof.requests.some(r=>r.action==='submit'&&r.args.duration==='720'&&r.args.avatarSource==='video-content')`),"Custom long duration is submitted unchanged");
        ctx.assert(await ctx.eval(`document.querySelector('[aria-label="数字人视频时长"]').value==='720'&&!document.querySelector('[aria-label="数字人视频时长"]').hasAttribute('max')`),"Duration remains visible without the old maximum");
        await ctx.expectText("已完成 1/5 段");
        await ctx.expectText("58.0 秒");
      },
      screenshot:{name:"long-avatar-custom-duration",requireText:["生成时长","超过 15 秒将自动分段生成并拼接","点击替换图片"]},
    });
    await ctx.prove("Narrated avatars still follow the full audio automatically",{
      voiceover:"使用配音时，数字人自动跟随完整配音生成，不需要手动填写时长。",
      action:async()=>{
        await ctx.trustedClick('[role="switch"]');
        await ctx.clickText("生成数字人",{selector:"button"});
        await ctx.waitFor(`window.avatarProof.requests.some(r=>r.action==='submit'&&r.args.avatarSource==='video-audio')`);
      },
      assert:async()=>{
        ctx.assert(await ctx.eval(`window.avatarProof.requests.some(r=>r.action==='submit'&&r.args.duration==='58'&&r.args.avatarSource==='video-audio')`),"Full narration is submitted without truncating to fifteen seconds");
        await ctx.expectText("跟随配音 · 58.0 秒");
      },
      screenshot:{name:"long-avatar-full-audio",requireText:["58.0 秒"]},
    });
  }}],
};
