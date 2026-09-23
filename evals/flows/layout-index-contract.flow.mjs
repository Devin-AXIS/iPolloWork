import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

// Internal contract demo: actual service tests create isolated sessions on disk.
// This does not claim real-model generation, UI rendering or export acceptance.
export default {
  id: "layout-index-contract",
  title: "Shared relationship index routes to independent PPT, website and video layouts",
  kind: "internal",
  requiresApp: false,
  steps: [
    {
      name: "Materialize isolated, app-owned references",
      run: async (ctx) => {
        let result;
        await ctx.prove("Template and custom sessions receive the common index and only their own type library", {
          voiceover: "PPT, website and video tasks share a content relationship index. Each receives its own layout files, and imported templates cannot replace the index.",
          action: async () => {
            result = spawnSync("bun", ["test", "src/templates.test.ts", "--test-name-pattern",
              "shared layouts materialize|unified layout index|initializes every authoring|legacy slide|build copies strict|video layout index"], {
              cwd: resolve(root, "apps/server"), encoding: "utf8",
            });
            ctx.output("Service materialization, isolation and package override checks", result.stdout + result.stderr);
          },
          assert: async () => {
            ctx.assert(result.status === 0, "Service checks exited successfully");
            ctx.assert(/6 pass/.test(result.stderr), "All six filesystem/service checks ran");
            ctx.assert(/0 fail/.test(result.stderr), "No materialization or isolation check failed");
          },
        });
      },
    },
    {
      name: "Route model instructions without expanding the prompt budget",
      run: async (ctx) => {
        let result;
        await ctx.prove("Template and custom prompts read the common index before the correct category catalog", {
          voiceover: "The generation instructions select the deliverable type before matching its content relationship. A fitting local layout or a new composition remains allowed.",
          action: async () => {
            result = spawnSync("bun", ["test", "--isolate", "tests/template-brief.test.ts"], {
              cwd: resolve(root, "apps/app"), encoding: "utf8",
            });
            ctx.output("Prompt routing and existing template behavior checks", result.stdout + result.stderr);
          },
          assert: async () => {
            ctx.assert(result.status === 0, "Prompt checks exited successfully");
            ctx.assert(/unified layout index routes/.test(result.stderr), "Active-type routing check ran");
            ctx.assert(/0 fail/.test(result.stderr), "Prompt routing and length checks passed");
          },
        });
      },
    },
  ],
};
