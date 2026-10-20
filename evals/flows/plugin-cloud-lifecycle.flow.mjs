import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("plugin-cloud-lifecycle");
const row = '[data-testid="plugin-package-list-item"]';
const cloud = "http://127.0.0.1:5399";
async function state() { return (await fetch(cloud + "/proof/state")).json(); }
async function source(ctx, name) {
  ctx.assert(await ctx.eval(`(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find(node => node.innerText.trim() === ${JSON.stringify(name)}); tab?.click(); return Boolean(tab); })()`), "Missing tab: " + name);
}
async function action(ctx, name, text) {
  ctx.assert(await ctx.eval(`(() => { const item = [...document.querySelectorAll('${row}')].find(node => node.innerText.includes(${JSON.stringify(name)})); const button = [...(item?.querySelectorAll('button') ?? [])].find(node => node.innerText.trim() === ${JSON.stringify(text)} || node.getAttribute('aria-label') === ${JSON.stringify(text + ' ' + name)}); button?.click(); return Boolean(button); })()`), "Missing action: " + name + " / " + text);
}
export default {
  id: "plugin-cloud-lifecycle", title: "Personal local collection and Public online lifecycle", kind: "user-facing", preserveTheme: true,
  cdpTarget: { title: "Cloud plugin lifecycle proof" },
  precondition: async () => { const value = await state(); return value.installed || value.local ? "Start a fresh plugin-cloud-fixture." : null; },
  steps: [{ name: "Verify both independent marketplace sources", run: async ctx => {
    await ctx.prove("Personal displays uninstalled local collection entries without fetching the online catalog", {
      voiceover: vo[0], action: async () => { await source(ctx, "个人"); await ctx.waitFor("document.body.innerText.includes('本地插件集助手')"); },
      assert: async () => { const value = await state(); ctx.assert(value.local === null && value.catalogRequests === 0, "Personal auto-installed a package or requested online catalog"); await ctx.expectNoText("云端工作流助手"); },
      screenshot: { name: "personal-local-collection", requireText: ["本地插件集助手", "安装"] },
    });
    await ctx.prove("Personal installs packages from the local collection", {
      voiceover: vo[1], action: async () => { await action(ctx, "本地插件集助手", "安装"); await ctx.waitFor("Boolean(document.querySelector('[data-testid=plugin-installed-tile]'))"); },
      assert: async () => { ctx.assert((await state()).local === "1.0.0", "Local version 1.0.0 not persisted"); },
      screenshot: { name: "personal-installed", requireText: ["本地插件集助手", "已安装"] },
    });
    await ctx.prove("Personal updates against the local collection version", {
      voiceover: vo[2], action: async () => { await ctx.eval("document.querySelector('[data-testid=proof-local-update]').click()"); await ctx.waitFor("document.body.innerText.includes('更新 · v1.1.0')"); await action(ctx, "本地插件集助手", "更新 · v1.1.0"); await ctx.waitFor("!document.body.innerText.includes('更新 · v1.1.0') && document.body.innerText.includes('v1.1.0')"); },
      assert: async () => { const value = await state(); ctx.assert(value.local === "1.1.0" && value.catalogRequests === 0, "Local update used the wrong source"); },
      screenshot: { name: "personal-updated", requireText: ["本地插件集助手", "v1.1.0"] },
    });
    await ctx.prove("Personal uninstall retains the local catalog entry for reinstall", {
      voiceover: vo[3], action: async () => { await action(ctx, "本地插件集助手", "卸载插件"); await ctx.waitFor("!document.querySelector('[data-testid=plugin-installed-tile]') && document.body.innerText.includes('安装')"); },
      assert: async () => { ctx.assert((await state()).local === null, "Local uninstall did not persist"); },
      screenshot: { name: "personal-uninstalled", requireText: ["本地插件集助手", "安装"] },
    });
    await ctx.prove("Public fetches the online catalog and installs its downloaded package", {
      voiceover: vo[4], action: async () => { await source(ctx, "公开"); await ctx.waitFor("document.body.innerText.includes('云端工作流助手')"); await action(ctx, "云端工作流助手", "安装"); await ctx.waitFor("document.body.innerText.includes('已安装') && Boolean(document.querySelector('[data-testid=plugin-installed-tile]'))"); },
      assert: async () => { const value = await state(); ctx.assert(value.installed?.version === "1.0.0" && value.catalogRequests > 0, "Public did not use the online installation path"); },
      screenshot: { name: "public-installed", requireText: ["云端工作流助手", "已安装"] },
    });
    await ctx.prove("Public updates from the online version without changing user-owned files", {
      voiceover: vo[5], action: async () => { await ctx.eval("document.querySelector('[data-testid=proof-update]').click()"); await ctx.waitFor(`(() => { const item = [...document.querySelectorAll('${row}')].find(node => node.innerText.includes('云端工作流助手')); return item?.innerText.includes('更新'); })()`); await action(ctx, "云端工作流助手", "更新"); await ctx.waitFor(`(() => { const item = [...document.querySelectorAll('${row}')].find(node => node.innerText.includes('云端工作流助手')); return item?.innerText.includes('已安装') && !item.innerText.includes('更新'); })()`); },
      assert: async () => { const value = await state(); ctx.assert(value.installed?.version === "1.1.0", "Online update not persisted"); ctx.assert(value.userFile === "# User-owned content\nKeep this file.\n", "User-owned file changed"); },
      screenshot: { name: "public-updated", requireText: ["云端工作流助手", "v1.1.0"] },
    });
    await ctx.prove("A corrupt online update preserves the installed version", {
      voiceover: vo[6], action: async () => { await ctx.eval("document.querySelector('[data-testid=proof-corrupt]').click()"); await ctx.waitFor(`document.querySelector('${row}')?.innerText.includes('更新')`); await action(ctx, "云端工作流助手", "更新"); await ctx.waitFor("Boolean(document.querySelector('[role=alert]'))"); },
      assert: async () => { ctx.assert((await state()).installed?.version === "1.1.0", "Corrupt update replaced the installed package"); },
      screenshot: { name: "public-corrupt-preserved", requireText: ["云端工作流助手"] },
    });
    await ctx.prove("Public uninstall persists and Personal remains available during an online outage", {
      voiceover: vo[7], action: async () => { await action(ctx, "云端工作流助手", "卸载插件"); await ctx.waitFor("!document.querySelector('[data-testid=plugin-installed-tile]')"); await source(ctx, "个人"); await ctx.eval("document.querySelector('[data-testid=proof-offline]').click()"); await ctx.waitFor("document.body.innerText.includes('本地插件集助手') && !document.querySelector('[data-testid=plugin-library-loading]')"); },
      assert: async () => { ctx.assert((await state()).installed === null, "Public uninstall did not persist"); await ctx.expectNoText("云端工作流助手"); },
      screenshot: { name: "public-uninstalled-personal-offline", requireText: ["本地插件集助手", "安装"] },
    });
  } }],
};
