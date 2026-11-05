import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const voiceovers = await loadVoiceoverParagraphs("image-layer-authorization");

export default {
  id: "image-layer-authorization",
  title: "图片分层授权入口（不验证模型输出）",
  kind: "user-facing",
  steps: [{
    name: "显示统一授权入口",
    async run(ctx) {
      await ctx.prove("授权中心显示 fal 且保留原图片渠道", {
        voiceover: voiceovers[0],
        action: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl)");
          const workspace = await ctx.eval("location.hash.match(/#(\\/workspace\\/[^/]+)/)?.[1]");
          await ctx.navigateHash(`${workspace ?? ""}/settings/authorizations`);
          await ctx.waitForText("fal ·");
        },
        assert: async () => {
          await ctx.expectText("fal ·");
          await ctx.expectText("OpenAI");
        },
        screenshot: { name: "fal-authorization", requireText: ["fal ·", "OpenAI"] },
      });
    },
  }, {
    name: "提供安全密钥输入",
    async run(ctx) {
      await ctx.prove("密钥输入采用密码控件并显示外部处理说明", {
        voiceover: voiceovers[1],
        action: async () => {
          await ctx.eval(`(() => {
            const cards = [...document.querySelectorAll('[data-slot="card"]')];
            const card = cards.find(el => el.textContent.includes('fal ·'));
            const button = card && [...card.querySelectorAll('button')].find(el => /配置|编辑|Configure|Edit/.test(el.textContent));
            if (!button) throw new Error('fal configuration button missing');
            button.click();
          })()`);
          await ctx.waitForText("fal API key");
          await ctx.waitFor("(() => { const dialog = document.querySelector('[role=dialog]'); return dialog && !dialog.getAnimations({subtree:true}).some(animation => animation.playState === 'running'); })()");
        },
        assert: async () => {
          ctx.assert(await ctx.eval("Boolean(document.querySelector('[role=dialog] input[type=password]'))"), "API key must be masked");
          ctx.assert(await ctx.eval("/实际处理会将所选图片发送给 fal|processing sends the selected image to fal/.test(document.body.innerText)"), "External processing disclosure missing");
        },
        screenshot: { name: "fal-key-input", requireText: ["fal API key", "fal.ai/dashboard/keys"] },
      });
    },
  }],
};
