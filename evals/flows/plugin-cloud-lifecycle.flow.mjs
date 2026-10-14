import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
const vo = await loadVoiceoverParagraphs("plugin-cloud-lifecycle");
const row = '[data-testid="plugin-package-list-item"]';
const cloud = "http://127.0.0.1:5399";
async function state() { const response = await fetch(cloud + "/proof/state"); return response.json(); }
async function clickButton(ctx, text) {
  ctx.assert(await ctx.eval(`(() => { const button = [...document.querySelectorAll('button')].find(node => node.innerText.trim() === ${JSON.stringify(text)}); button?.click(); return Boolean(button); })()`), "Missing button: " + text);
}
async function source(ctx, name) {
  ctx.assert(await ctx.eval(`(() => { const tab = [...document.querySelectorAll('[role="tab"]')].find(node => node.innerText.trim() === ${JSON.stringify(name)}); tab?.click(); return Boolean(tab); })()`), "Missing tab: " + name);
}
export default {
  id: "plugin-cloud-lifecycle", title: "Public download, Personal management and safe cloud updates", kind: "user-facing",
  cdpTarget: { title: "Cloud plugin lifecycle proof" },
  precondition: async () => (await state()).installed ? "Start a fresh plugin-cloud-fixture before this journey." : null,
  steps: [{ name: "Complete the isolated cloud plugin journey", run: async ctx => {
    await ctx.prove("Personal does not display uninstalled optional plugins", {
      voiceover: vo[0], action: async () => { await source(ctx, "个人"); await ctx.waitFor("document.body.innerText.includes('还没有安装插件')"); },
      assert: async () => { ctx.assert((await state()).installed === null, "A plugin was installed without a download"); ctx.assert(await ctx.eval(`document.querySelectorAll('${row}').length === 0`), "Uninstalled plugin shown in Personal"); },
      screenshot: { name: "personal-empty", requireText: ["还没有安装插件"] },
    });
    await ctx.prove("Public download installs a complete package and Personal shows its version", {
      voiceover: vo[1], action: async () => { await source(ctx, "公开"); await ctx.waitFor("document.body.innerText.includes('云端工作流助手')"); await clickButton(ctx, "安装"); await ctx.waitFor("document.body.innerText.includes('已安装') && document.querySelector('[data-testid=plugin-installed-tile]') !== null"); await source(ctx, "个人"); },
      assert: async () => { ctx.assert((await state()).installed?.version === "1.0.0", "Host did not persist version 1.0.0"); },
      screenshot: { name: "download-installed", requireText: ["云端工作流助手", "1.0.0"] },
    });
    await ctx.prove("Personal detects a newer cloud version for a disabled plugin", {
      voiceover: vo[2], action: async () => { await clickButton(ctx, "打开"); await ctx.eval("document.querySelector('[role=switch]').click()"); await ctx.waitFor("document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false'"); await ctx.eval("document.querySelector('[data-testid=proof-update]').click()"); await ctx.waitFor("document.body.innerText.includes('更新 · v1.1.0')"); },
      assert: async () => { ctx.assert((await state()).installed?.enabled === false, "Plugin must remain disabled before updating"); },
      screenshot: { name: "cloud-update-detected", requireText: ["已停用", "更新 · v1.1.0"] },
    });
    await ctx.prove("Update preserves disabled state and user-owned content", {
      voiceover: vo[3], action: async () => { await clickButton(ctx, "更新 · v1.1.0"); await ctx.waitFor("document.body.innerText.includes('v1.1.0') && !document.body.innerText.includes('更新 · v1.1.0')"); },
      assert: async () => { const observed = await state(); ctx.assert(observed.installed.version === "1.1.0" && observed.installed.enabled === false, "Update lost version or disabled state"); ctx.assert(observed.userFile === "# User-owned content\nKeep this file.\n", "User-owned file changed"); },
      screenshot: { name: "updated-preserved", requireText: ["1.1.0", "已停用"] },
    });
    await ctx.prove("A corrupted cloud update leaves the current installation unchanged", {
      voiceover: vo[4], action: async () => { await ctx.eval("document.querySelector('[data-testid=proof-corrupt]').click()"); await ctx.waitFor("document.body.innerText.includes('更新 · v1.2.0')"); await clickButton(ctx, "更新 · v1.2.0"); await ctx.waitFor("Boolean(document.querySelector('[role=alert]'))"); },
      assert: async () => { ctx.assert((await state()).installed.version === "1.1.0", "Corrupt package replaced the installed version"); },
      screenshot: { name: "corrupt-update-preserved", requireText: ["原有插件保持不变", "1.1.0"] },
    });
    await ctx.prove("Installed plugins remain available when the cloud check fails", {
      voiceover: vo[5], action: async () => { await ctx.eval("document.querySelector('[data-testid=proof-offline]').click()"); await ctx.waitFor("document.body.innerText.includes('暂时无法检查云端更新')"); },
      assert: async () => { const observed = await state(); ctx.assert(observed.installed.version === "1.1.0" && observed.installed.enabled === false, "Cloud outage changed the installation"); },
      screenshot: { name: "offline-personal", requireText: ["暂时无法检查云端更新", "云端工作流助手", "1.1.0"] },
    });
  } }],
};
