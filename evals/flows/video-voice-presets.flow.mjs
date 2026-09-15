// Reuses the real voice-panel fixture; provider calls and project writes are simulated.
export default {
  id: "video-voice-presets", title: "Grouped official voices and readable saved selection",
  kind: "user-facing", cdpTarget: { urlIncludes: "video-avatar-proof.html" }, preserveTheme: true,
  steps: [{ name: "Browse and select distinctive presets", run: async ctx => {
    await ctx.client.send("Page.reload");
    await ctx.waitFor("document.querySelector('[aria-label=\"百炼官方音色\"]')?.textContent.includes('龙安洋')");
    await ctx.prove("The dropdown offers 16 named voices grouped by use", {
      voiceover: "百炼音色现在按用途分组，既有日常讲解，也有童声、角色声和方言可选。",
      action: async () => { await ctx.eval("document.querySelector('[aria-label=\"百炼官方音色\"]').click()"); },
      assert: async () => {
        await ctx.waitFor("document.querySelectorAll('[role=option]').length === 16");
        for (const group of ["通用讲解", "温暖陪伴", "角色童声", "广告营销", "方言特色"]) await ctx.expectText(group);
        for (const name of ["龙机器", "龙猴哥", "龙老伯", "龙呼呼", "龙安粤", "龙陕哥"]) await ctx.expectText(name);
      },
      screenshot: { name: "grouped-voices", requireText: ["通用讲解", "龙安洋", "龙安智"] },
    });
    await ctx.prove("Selecting a character voice shows its Chinese name and saves the matching v3 ID", {
      voiceover: "选择龙机器后，下拉框显示中文名称和声音特点，当前视频保存对应音色。",
      action: async () => {
        await ctx.eval("[...document.querySelectorAll('[role=option]')].find(e => e.textContent.includes('龙机器')).setAttribute('data-eval-voice', 'robot')");
        await ctx.trustedClick('[data-eval-voice="robot"]');
      },
      assert: async () => {
        await ctx.waitFor("window.avatarProof.requests.some(r => r.action === 'save-voice' && r.settings.voiceId === 'longjiqi_v3' && r.settings.model === 'cosyvoice-v3-flash' && r.path === 'video/avatar-proof/voiceover.json')");
        await ctx.waitFor("document.querySelector('[aria-label=\"百炼官方音色\"]')?.textContent.includes('龙机器')");
        await ctx.expectText("呆萌机器人声，适合趣味短片");
        ctx.assert(await ctx.eval("!window.avatarProof.requests.some(r => r.action === 'speech_synthesize')"), "Browsing voices does not synthesize audio");
      },
      screenshot: { name: "saved-character-voice", requireText: ["龙机器", "呆萌机器人声", "longjiqi_v3"] },
    });
  } }],
};
