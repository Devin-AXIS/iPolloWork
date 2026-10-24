import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const fixture = new URL("../../vendor/hyperframes/packages/studio/data/projects/storyboard-table-layout-eval/", import.meta.url);
const script = new URL("STORYBOARD.md", fixture);
const vo = await loadVoiceoverParagraphs("video-script-table");
const label = value => `[aria-label=${JSON.stringify(value)}]`;
const url = "http://127.0.0.1:5198/?view=storyboard&locale=zh#project/storyboard-table-layout-eval";
async function click(ctx, selector) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

export default {
  id: "hyperframes-upgrade",
  title: "Upgraded runtime retains the current embedded script editing and theme contracts",
  kind: "internal",
  preserveTheme: true,
  cdpTarget: { urlIncludes: "project/storyboard-table-layout-eval" },
  steps: [{
    name: "Save and reopen the current script UI with narration, material settings and spatial camera",
    async run(ctx) {
      await mkdir(fixture, { recursive: true });
      const originalComposition = await readFile(new URL("index.html", fixture), "utf8");
      ctx.assert(originalComposition.includes("Script table verification"), "Only the dedicated evaluation project is used");
      await writeFile(script, "# Storyboard\n\n## Frame 1 — Upgrade opening\n- duration: 5s\n- scene: A product opening\n- narration: Original narration\n\n## Frame 2 — Original ending\n- duration: 5s\n- scene: Product ending\n");
      await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
      await ctx.client.send("Page.navigate", { url });
      await ctx.waitFor(`document.querySelector(${JSON.stringify(label("镜头内容 1"))})?.value === 'A product opening'`);
      await ctx.prove("The embedded Chinese script editor still edits the original narration and shot content", {
        voiceover: vo[0],
        async action() {
          await ctx.fill(label("镜头内容 1"), "升级后开场\n保留原有的内容编辑");
          await ctx.fill(label("旁白 1"), "从一个想法，到一支数字团队。");
        },
        async assert() {
          await ctx.waitForText("未保存修改");
          ctx.assert(await ctx.eval(`document.querySelector(${JSON.stringify(label("旁白 1"))}).value.includes('数字团队')`), "Narration remains editable");
        },
        screenshot: { name: "embedded-script-edit", requireText: ["脚本表", "未保存修改"] },
      });
      await ctx.prove("Material direction and native spatial recipes retain the current modal editing workflow", {
        voiceover: vo[1],
        async action() {
          await click(ctx, '[data-testid="storyboard-picture-picker-1"]');
          await ctx.waitForText("画面与素材");
          await click(ctx, `${label("素材来源 1")} button:nth-child(3)`);
          await ctx.fill(label("素材需求 / 生成描述 1"), "冷白晨光中的未来城市，留出文字区域");
          await click(ctx, "#storyboard-shot-settings summary");
          await ctx.waitFor(`Array.from(document.querySelector(${JSON.stringify(label("空间运镜编排 1"))})?.options ?? []).some(o => o.value === 'depth-layer-moves')`);
          await ctx.eval(`(()=>{const e=document.querySelector(${JSON.stringify(label("空间运镜编排 1"))});e.value='depth-layer-moves';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        },
        async assert() {
          ctx.assert(await ctx.eval(`document.querySelector(${JSON.stringify(label("空间运镜编排 1"))}).value === 'depth-layer-moves'`), "The original camera registry options are available");
        },
        screenshot: { name: "material-and-spatial-camera", requireText: ["画面与素材", "更多设置"] },
      });
      await ctx.clickText("应用到脚本");
      await ctx.waitFor("!document.querySelector('#storyboard-shot-settings')");
      await ctx.clickText("保存脚本");
      await ctx.waitForText("已保存");
      const saved = await readFile(script, "utf8");
      for (const expected of ["升级后开场", "数字团队", "冷白晨光", "depth-layer-moves"]) {
        ctx.assert(saved.includes(expected), `Actual saved Markdown retains ${expected}`);
      }
      await ctx.prove("Saved shots reopen correctly in both embedded themes and retain their source composition", {
        voiceover: vo[2],
        async action() {
          await ctx.client.send("Page.navigate", { url });
          await ctx.waitFor(`document.querySelector(${JSON.stringify(label("镜头内容 1"))})?.value.includes('升级后开场')`);
          await ctx.eval("window.postMessage({type:'ipollowork:studio-theme',theme:'dark'}, '*')");
          await ctx.waitFor("document.documentElement.dataset.ipolloworkTheme === 'dark'");
        },
        async assert() {
          ctx.assert(await readFile(new URL("index.html", fixture), "utf8") === originalComposition, "Planning and saving leaves the authored video unchanged");
          ctx.assert(await ctx.eval("document.querySelectorAll('tr[data-shot]').length === 2"), "Both original shots remain after reopening");
        },
        screenshot: { name: "saved-script-dark", requireText: ["脚本表", "Spatial Camera Suite"] },
      });
    },
  }],
};
