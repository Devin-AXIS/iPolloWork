import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default {
  id: "douyin-browser-upload-runtime",
  title: "Douyin browser publishing accepts the plugin's private video",
  kind: "internal",
  requiresApp: false,
  steps: [{
    name: "The desktop host resolves the server workspace and uploads only Douyin's asset",
    run: async (ctx) => {
      let result;
      await ctx.prove("The browser host accepts the Douyin plugin video without widening file access", {
        voiceover: "The AI can now hand the Douyin plugin's own video to the browser uploader, while files from other plugins remain blocked.",
        action: async () => {
          result = spawnSync(process.execPath, [
            "--test",
            "--test-name-pattern",
            "uploads only the named plugin|browser upload workspaces use",
            "apps/desktop/electron/browser-runtime.test.mjs",
            "apps/desktop/electron/workspace-store.test.mjs",
          ], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
          ctx.output("Focused browser-upload regression", `${result.stdout}\n${result.stderr}`.trim());
        },
        assert: async () => {
          const output = `${result.stdout}\n${result.stderr}`;
          ctx.assert(result.status === 0, `Focused browser-upload tests exited ${String(result.status)}.`);
          ctx.assert(output.includes("browser upload workspaces use the server workspace identity and runtime storage"), "Server workspace identity regression was not exercised.");
          ctx.assert(output.includes("uploads only the named plugin's file from its registered runtime storage"), "Plugin-private upload boundary regression was not exercised.");
        },
      });
    },
  }, {
    name: "A rejected draft update exposes a correctable error and creation retries do not duplicate drafts",
    run: async (ctx) => {
      let result;
      await ctx.prove("Draft creation can recover from an invented ID without duplicate drafts or publication", {
        voiceover: "The plugin explains that a new draft must omit the ID, then saves exactly one local draft when the same creation request is retried. This check never publishes to Douyin.",
        action: async () => {
          result = spawnSync(process.execPath, ["--test", "--test-name-pattern", "native plugin entry", "examples/plugin-packages/douyin-ops/tests/workbench.test.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
          ctx.output("Native plugin draft recovery", `${result.stdout}\n${result.stderr}`.trim());
        },
        assert: async () => {
          ctx.assert(result.status === 0, `Native draft recovery exited ${String(result.status)}`);
          ctx.assert(result.stdout.includes("ok 1 - native plugin entry") || result.stdout.includes("ok 2 - native plugin entry"), "Native bridge recovery test did not execute.");
        },
      });
    },
  }],
};
