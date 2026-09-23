import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("workspace-skill-auto-projection");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default {
  id: "workspace-skill-auto-projection",
  title: "New local workspaces receive current built-in Skills automatically",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "Workspace creation completes after Skill projection",
    run: async (ctx) => {
      await ctx.prove("A new workspace is returned with its current engine Skill already installed", {
        voiceover: vo[0],
        assert: async () => {
          const result = spawnSync("bun", ["test", "src/workspace-activate.e2e.test.ts", "-t", "projects current bundled Skills before a new local workspace is returned"], {
            cwd: join(root, "apps", "server"),
            encoding: "utf8",
            timeout: 60_000,
          });
          const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
          ctx.output("Automatic Skill projection integration test", output);
          ctx.assert(result.status === 0, `Skill projection test failed: ${output}`);
          ctx.assert(output.includes("1 pass") && output.includes("0 fail"), "The focused projection test did not report one passing experience.");
        },
      });
    },
  }],
};
