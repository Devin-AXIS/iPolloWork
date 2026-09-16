export default {
  id: "long-avatar", title: "Long avatar progress and segment retry (simulated provider)", kind: "user-facing",
  cdpTarget: { urlIncludes: "video-avatar-proof.html?long" }, preserveTheme: true,
  steps: [{name:"Long narration and selective retry",run:async ctx=>{
    await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:1280,height:1600,deviceScaleFactor:1,mobile:false});
    await ctx.client.send("Page.reload");
    await ctx.waitForText("数字人视频");
    await ctx.clickText("数字人视频",{selector:"[role=tab]"});
    await ctx.waitFor(`(() => {const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='使用配音');return button&&!button.disabled;})()`);
    await ctx.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='使用配音').click()`);
    await ctx.prove("Long narration shows saved segment progress and per-segment retry",{
      voiceover:"五十八秒配音可以自动分段；第一段已保存，第二段失败时可以单独重试。",
      action:async()=>{await ctx.waitForText("已完成 1/5 段");},
      assert:async()=>{await ctx.expectText("超过 15 秒会自动分段生成并拼接");await ctx.expectText("第 2/5 段失败");},
      screenshot:{name:"long-avatar-progress",requireText:["已完成 1/5 段","重试此段"]},
    });
    await ctx.prove("Retry targets only the failed segment and preserves the completed output",{
      voiceover:"点击第二段的重试后，第一段保持已保存，不会重新生成。",
      action:async()=>{await ctx.eval(`(() => {const buttons=[...document.querySelectorAll('button')].filter(b=>b.textContent==='重试此段（计费）');buttons[0].click();})()`);await ctx.waitForText("只重试第 2 段");},
      assert:async()=>{ctx.assert(await ctx.eval(`window.avatarProof.requests.filter(r=>r.action==='retry-segment').length===1&&window.avatarProof.requests.find(r=>r.action==='retry-segment').args.index===1&&window.avatarProof.jobs[0].avatarSequence.segments[0].path==='saved-first.mp4'`),"Only failed segment was retried; first output remains");},
      screenshot:{name:"long-avatar-retry",requireText:["只重试第 2 段","已完成 1/5 段"]},
    });
  }}],
};
