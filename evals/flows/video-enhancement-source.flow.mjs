// Internal proof of source-duration invariants and bounded enhancement execution.
// Uses the shipped GSAP and real server APIs; AI providers are test doubles.
// No cloud generation or review-video export. Graphical preview is not proven here.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
function check(ctx, name, args, expected) {
  const result = spawnSync("bun", ["test", ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const output = result.stdout + result.stderr;
  ctx.output(name, output);
  ctx.assert(result.status === 0 && output.includes(expected) && /0 fail/u.test(output), `${name}: ${expected}, zero failures`);
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion: `${name}: ${expected}, zero failures`, actual: output.slice(-450) });
}
export default {
  id: "video-enhancement-source", title: "智能增强 · 完整源视频与有限返修保护", kind: "internal", requiresApp: false,
  steps: [{ name: "完整时长、原声与静止段校验", async run(ctx) {
    await ctx.prove("完整原视频不会为通过校验而被裁短或加速，真实播放允许叠加层静止", {
      voiceover: "这项验证直接运行生成的时间轴，并确认完整原视频、原声和尾段受到保护，正常播放不会再引起无意义的补动画返修。",
      action: async () => check(ctx, "Source and validator regression tests", ["./apps/server/src/extensions/video-components.test.ts", "./apps/server/src/extensions/video-enhancement.test.ts"], "100 pass"),
    });
  } }, { name: "三种引擎达到上限后停止并保留草稿", async run(ctx) {
    await ctx.prove("编排达到时间上限时通过原生取消接口停止本轮，保留源视频和草稿", {
      voiceover: "三种引擎都通过真实服务接口验证超时停止和草稿保留；这里使用模拟的模型服务，不会产生云端生成费用。",
      action: async () => check(ctx, "Native cancellation and ordinary session completion", ["./apps/server/src/session-read-model.e2e.test.ts", "--test-name-pattern", "over-budget enhancement|canonical prompts|earlier turn"], "16 pass"),
    });
  } }, { name: "继续使用预览验收", async run(ctx) {
    await ctx.prove("验收走现有 Studio 预览接口并正确处理缺失或过期证据", {
      voiceover: "增强结果继续通过工作台预览验收，不导出验收视频；这项服务接口验证不替代图形界面的人工观看。",
      action: async () => check(ctx, "Studio preview acceptance API", ["./apps/server/src/extensions/video-render.test.ts", "--test-name-pattern", "preview acceptance"], "1 pass"),
    });
  } }],
};
