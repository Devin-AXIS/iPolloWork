import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const voiceovers = await loadVoiceoverParagraphs("heygen-subscription");
const card = `([...document.querySelectorAll('[data-slot="card"]')].find(el => el.textContent.includes('HeyGen')))`;
const connected = `${card}?.textContent.includes('HeyGen · 已授权')`;
export default {
  id: "heygen-subscription", title: "HeyGen 订阅积分与真实 OAuth 授权入口（不生成视频）", kind: "user-facing", preserveTheme: true,
  steps: [{ name: "选择订阅积分", async run(ctx) {
    await ctx.prove("用户可选择并持久保存订阅积分，界面明确禁止自动切换 API 扣费", {
      voiceover: voiceovers[0],
      action: async () => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)");
        const workspace = await ctx.eval("location.hash.match(/#(\\/workspace\\/[^/]+)/)?.[1]");
        await ctx.navigateHash(`${workspace ?? ""}/settings/authorizations`);
        await ctx.waitFor(`Boolean(${card})`, { timeoutMs: 30_000 });
        await ctx.eval(`${card}.scrollIntoView({block:'center'});[...${card}.querySelectorAll('button')].find(el=>el.textContent==='订阅积分').click()`);
        await ctx.waitFor(`${card}?.querySelector('button[aria-pressed=true]')?.textContent==='订阅积分'`);
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`${card}.textContent.includes('不会自动改用 API 余额')`), "Billing fallback disclosure is visible");
        const service = await ctx.eval(`(async()=>{
          const info=await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const response=await fetch(info.baseUrl+'/authorization-services',{headers:{'x-ipollowork-host-token':info.hostToken}});
          return (await response.json()).items.find(item=>item.id==='heygen-video');
        })()`, { awaitPromise: true });
        ctx.assert(service.subscription?.mode === "subscription", "The real server persists subscription billing");
        ctx.assert(!JSON.stringify(service).includes("accessToken"), "No OAuth credential is exposed in the catalog");
      },
      screenshot: { name: "heygen-subscription-selected", requireText: ["订阅积分", "API 余额", "HeyGen"] },
    });
  } }, { name: "发起官方 OAuth 授权", async run(ctx) {
    await ctx.prove("登录入口能向 HeyGen 发起真实 OAuth 授权并显示待登录状态", {
      voiceover: voiceovers[1],
      action: async () => {
        if (!await ctx.eval(connected)) await ctx.eval(`[...${card}.querySelectorAll('button')].find(el=>el.textContent.includes('登录 HeyGen')).click()`);
        await ctx.waitFor(`${connected} || ${card}?.textContent.includes('请在浏览器完成 HeyGen 授权')`, { timeoutMs: 65_000 });
        await ctx.eval(`${card}.scrollIntoView({block:'center'})`);
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`${connected} || ${card}?.textContent.includes('请在浏览器完成 HeyGen 授权')`), "Official authorization started or an existing authorized account is present");
        ctx.assert(await ctx.eval(`${card}?.querySelector('button[aria-pressed=true]')?.textContent==='订阅积分'`), "OAuth never switches the billing preference to the API wallet");
      },
      screenshot: { name: "heygen-official-oauth-started", requireText: ["HeyGen", "订阅积分"] },
    });
  } }, { name: "验证已授权账户", async run(ctx) {
    await ctx.prove("浏览器授权完成后，软件通过官方只读接口验证账户并显示实际套餐", {
      voiceover: voiceovers[2],
      action: async () => {
        await ctx.waitFor(connected);
        await ctx.eval(`[...${card}.querySelectorAll('button')].find(el=>el.textContent.includes('测试连接')).click()`);
        await ctx.waitFor(`${card}?.textContent.includes('HeyGen 订阅授权已验证')`, { timeoutMs: 30_000 });
        await ctx.eval(`${card}.scrollIntoView({block:'center'})`);
      },
      assert: async () => {
        ctx.assert(await ctx.eval(`${card}.textContent.includes('当前套餐：')`), "The live account plan is shown");
        ctx.assert(await ctx.eval(`${card}.textContent.includes('本次未生成视频')`), "This is a read-only account test");
        ctx.assert(await ctx.eval(`${card}?.querySelector('button[aria-pressed=true]')?.textContent==='订阅积分'`), "Subscription remains the selected billing channel");
      },
      screenshot: { name: "heygen-authorized-account-verified", requireText: ["HeyGen 订阅授权已验证", "当前套餐", "本次未生成视频"] },
    });
  } }],
};
