import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
export default {
  id: "video-html-delivery-gate",
  title: "Video HTML delivery rejects missing dependencies and preserves safe repairs",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Reuse the editable Studio storyboard before media production",
    run: async (ctx) => {
      await ctx.prove("The native storyboard preserves asset, camera and soundtrack decisions when narration is edited", {
        voiceover: "制作计划仍使用现有故事板。编辑旁白不会丢失素材选择、运镜和声音安排，也不会修改其他镜头。这是文件及编辑接口验证，不是模型生成或播放验收。",
        assert: async () => {
          const result = await exec("bun", ["--eval", `
            import assert from "node:assert/strict";
            import { mkdir, readFile, writeFile } from "node:fs/promises";
            import { join } from "node:path";
            import { parseStoryboard, setFrameVoiceover } from "./vendor/hyperframes/packages/core/src/storyboard/index.ts";
            const project = join(${JSON.stringify(ctx.outDir)}, "workspace/video/script-first");
            await mkdir(project, { recursive: true });
            const path = join(project, "STORYBOARD.md");
            const direction = "Asset: reuse assets/interface.png; no image/video generation needed.\\nCamera: overview to detail, land on search results; keep captions fixed.\\nMotion: screenshot-zoom, reveal the matched result.\\nSound: measured narration; quiet music bed; one SFX on the result reveal.";
            const source = ["---", "format: 1920x1080", "message: Find the answer faster", "audience: researchers", "---", "", "## Frame 1 — Find", "- scene: Search results reveal", "- duration: 5s", "- transition_in: cut", "- status: outline", "- voiceover: Find the answer.", "", direction, "", "## Frame 2 — Decide", "- scene: Compare the evidence", "- duration: 4s", "- status: outline", "- voiceover: Compare your sources.", "", "Asset: editable comparison component; deliberate locked shot."].join("\\n");
            await writeFile(path, source);
            const before = parseStoryboard(await readFile(path, "utf8"));
            assert.equal(before.frames.length, 2);
            assert.equal(before.warnings.length, 0);
            assert.equal(before.frames[0].status, "outline");
            assert.equal(before.frames[0].src, undefined);
            assert.equal(before.frames[0].narrative, direction);
            await writeFile(path, setFrameVoiceover(await readFile(path, "utf8"), 1, "Find the right answer with its source."));
            const after = parseStoryboard(await readFile(path, "utf8"));
            assert.equal(after.frames[0].voiceover, "Find the right answer with its source.");
            assert.equal(after.frames[0].narrative, direction);
            assert.deepEqual(after.frames[1], before.frames[1]);
            console.log("PASS: native storyboard parses both shots; editing narration preserves the production plan and the other shot.");
          `], { cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 60000 });
          ctx.output("Native storyboard round trip", result.stdout + result.stderr);
          ctx.assert(result.stdout.includes("PASS:"), "The existing storyboard parser and editor preserve the saved plan");
        },
      });
    },
  }, {
    name: "Require the requested soundtrack using the shared delivery action",
    run: async (ctx) => {
      await ctx.prove("Requested music and sound effects cannot pass with absent clips or a same-named file at the wrong path", {
        voiceover: "客户端识别配乐和音效要求，服务端检查实际项目文件及音轨。漏放音效或引用错误目录会失败，修正到真实文件后通过。不消耗生成额度，也不把这个检查说成试听通过。",
        assert: async () => {
          for (const [file, pattern] of [
            ["./apps/app/tests/video-hyperframes-panel.test.ts", "requires requested sound effects"],
            ["./apps/server/src/artifact-media.test.ts", "MCP calls without session metadata"],
            ["./apps/server/src/artifact-media.test.ts", "metadata-free media checks"],
            ["./apps/server/src/extensions/media-center.test.ts", "checks requested soundtrack"],
            ["./apps/server/src/extensions/media-center.test.ts", "requires a deliberate, synchronized storyboard music decision"],
            ["./apps/server/src/extensions/media-center.test.ts", "validates music and SFX"],
            ["./apps/server/src/extensions/media-center.test.ts", "does not count commented audio"],
          ]) {
            const result = await exec("bun", ["test", file, "-t", pattern], {
              cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 60000,
            });
            const output = result.stdout + result.stderr;
            ctx.output(pattern, output);
            ctx.assert(/1 pass/.test(output) && /0 fail/.test(output), `${pattern}: delivery contract assertions passed`);
          }
        },
      });
    },
  }, {
    name: "Validate the media completion gate and exported package",
    run: async (ctx) => {
      await ctx.prove("The server rejects missing animation dependencies and exports registry repairs", {
        voiceover: "The video completion check reports missing animation dependencies; after they are supplied, the exported package includes safe timeline initialization.",
        assert: async () => {
          for (const [file, pattern] of [
            ["./apps/server/src/extensions/media-center.test.ts", "blocks missing GSAP"],
            ["./apps/server/src/templates.test.ts", "blocks broken video delivery"],
          ]) {
            const result = await exec("bun", ["test", file, "-t", pattern], {
              cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 60000,
            });
            const output = result.stdout + result.stderr;
            ctx.output(pattern, output);
            ctx.assert(/1 pass/.test(output) && /0 fail/.test(output), `${pattern}: server action and filesystem assertions passed`);
          }
        },
      });
    },
  }],
};
