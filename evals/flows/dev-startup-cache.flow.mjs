import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default {
  id: "dev-startup-cache",
  title: "Unchanged desktop development builds are reused without hiding source changes",
  kind: "internal",
  steps: [{
    name: "Cached startup reaches the desktop and invalidates changed or missing inputs",
    run: async (ctx) => {
      await ctx.prove("Unchanged sidecars, plugins and server are skipped while the desktop still loads", {
        voiceover: "再次启动开发版时，未变化的构建会直接复用，桌面窗口仍然正常打开。源码修改或产物缺失时，相关构建会重新执行。",
        action: async () => {
          const logPath = ctx.env.IPOLLOWORK_EVAL_STARTUP_LOG;
          ctx.assert(Boolean(logPath), "IPOLLOWORK_EVAL_STARTUP_LOG points to the measured startup log");
          const log = await readFile(logPath, "utf8");
          ctx.output("Measured development startup", log.split(/\r?\n/).filter((line) => /\[electron-dev\]|\[startup\]|MEASURE/.test(line)).join("\n"));
          for (const name of ["sidecars", "labelu-data-annotation", "short-video-studio", "xiaohongshu-ops", "ipollo-onto", "server"]) {
            ctx.assert(log.includes(`${name}: unchanged, skipped`), `${name} reused its previous outputs`);
          }
          ctx.assert(!log.includes(": building..."), "No cached stage rebuilt during the measured restart");
          ctx.assert(/\[startup\] main window loaded/.test(log), "Electron finished loading its main window");
          if (ctx.env.IPOLLOWORK_EVAL_STARTUP_BASELINE_LOG) {
            const before = await readFile(ctx.env.IPOLLOWORK_EVAL_STARTUP_BASELINE_LOG, "utf8");
            const built = [...before.matchAll(/: built \((\d+)ms\)/g)];
            const skipped = [...log.matchAll(/: unchanged, skipped \((\d+)ms\)/g)];
            ctx.assert(built.length === 6 && skipped.length === 6, "Both measurements contain the same six build stages");
            ctx.output("Preparation measurement (same checkout, first build then unchanged restart)", JSON.stringify({
              firstBuildMs: built.reduce((sum, entry) => sum + Number(entry[1]), 0),
              unchangedRestartMs: skipped.reduce((sum, entry) => sum + Number(entry[1]), 0),
            }, null, 2));
          }
          const check = spawnSync(process.execPath, ["--test", "--test-name-pattern=development build cache", "apps/desktop/electron/dev-cloud-default.test.mjs"], {
            cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true,
          });
          ctx.output("Cache invalidation regression", check.stdout + check.stderr);
          ctx.assert(check.status === 0, "Edits, deletions, missing artifacts, corrupt stamps and failed builds are handled");
        },
        assert: async () => {
          await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "desktop control ready" });
          const text = await ctx.eval("document.body.innerText");
          ctx.assert(text.trim().length > 0, "The renderer displays the desktop interface");
        },
        screenshot: { name: "cached-desktop-startup" },
      });
    },
  }],
};
