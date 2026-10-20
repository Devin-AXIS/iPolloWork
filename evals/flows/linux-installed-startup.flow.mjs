import { readFileSync, statSync } from "node:fs";

export default {
  id: "linux-installed-startup",
  title: "A desktop user opens the installed Ubuntu application with its sandbox enabled",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_INSTALLED_LINUX"],
  steps: [
    {
      name: "The installed application opens without manual permission repair",
      run: async (ctx) => {
        await ctx.prove("A regular user can open the installed application when unprivileged user namespaces are disabled", {
          voiceover: "安装完成后直接打开 iPollo，应用正常显示，不需要再手动修改权限。",
          action: async () => {
            await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "installed application control API" });
            await ctx.waitFor("document.body.innerText.trim().length > 40 && Boolean(document.querySelector('button, a, input'))", { label: "usable application window" });
          },
          assert: async () => {
            ctx.assert(process.platform === "linux" && process.getuid() !== 0, "Startup proof must run as a regular Linux user");
            ctx.assert(readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim() === "0", "The regression environment must restrict unprivileged user namespaces");
            const helper = statSync("/opt/iPollo/chrome-sandbox");
            ctx.assert(helper.uid === 0 && helper.gid === 0 && (helper.mode & 0o7777) === 0o4755, "The installed Chromium sandbox helper must be root:root with mode 4755");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "Installed sandbox ownership and mode are root:root / 4755", actual: { uid: helper.uid, gid: helper.gid, mode: (helper.mode & 0o7777).toString(8) } });
            const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
            ctx.assert(typeof route === "string" && route.length > 0, "The installed application must report an active route");
            ctx.recordEvidence({ type: "assertion", status: "passed", assertion: "The installed application has rendered its initial route", actual: route });
          },
          screenshot: { name: "installed-ubuntu-app", rejectText: ["Something went wrong", "SUID sandbox helper binary"] },
        });
      },
    },
  ],
};
