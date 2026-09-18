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
