import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default {
  id: "schedule-chat-auto-execution",
  title: "AI-created schedules can start with automatic execution enabled",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "The schedule tools preserve explicit automatic execution",
    run: async (ctx) => {
      let result;
      await ctx.prove("An AI-created schedule enables execution only when the user explicitly requests it", {
        voiceover: "After confirmation, the requested recurring task is ready to run automatically, while an ordinary scheduled task stays planned.",
        action: async () => {
          if (!process.env.npm_execpath) throw new Error("pnpm executable path is unavailable");
          result = spawnSync(process.execPath, [
            process.env.npm_execpath,
            "--filter",
            "ipollowork-server",
            "exec",
            "bun",
            "test",
            "src/extensions-connect-gating.test.ts",
            "src/opencode-plugins/ipollowork-extensions-preview.test.ts",
            "--test-name-pattern",
            "previews and atomically imports|omits UI-control tools",
          ], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 120_000,
          });
          ctx.output("Focused AI schedule regression", `${result.stdout}\n${result.stderr}`.trim());
        },
        assert: async () => {
          const output = `${result.stdout}\n${result.stderr}`;
          ctx.assert(result.status === 0, `Focused AI schedule tests exited ${String(result.status)}.`);
          ctx.assert(output.includes("previews and atomically imports confirmed AI plans"), "The automatic schedule import regression was not exercised.");
          ctx.assert(output.includes("omits UI-control tools and steering by default"), "The AI tool schema regression was not exercised.");
        },
      });
    },
  }],
};
