import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connect, listTargets } from "../runner/cdp.mjs";

const runFile = promisify(execFile);
const frame = `document.querySelector('iframe[title="小红书运营台"]')`;
const entry = `document.querySelector('[data-testid="side-panel-launcher-workspace-app:xiaohongshu-ops:workspace-app:workbench"]')`;

export default {
  id: "xiaohongshu-creator-login",
  title: "Windows 小红书工作台打开官方登录入口",
  kind: "user-facing",
  steps: [{
    name: "从账号接入按钮打开默认浏览器",
    async run(ctx) {
      ctx.assert(process.platform === "win32", "This flow verifies the Windows default browser.");
      if (!await ctx.eval(`Boolean(${frame})`)) {
        if (!await ctx.eval(`Boolean(${entry})`)) {
          await ctx.eval(`document.querySelector('[aria-label="添加侧面板入口"]').click()`);
        }
        await ctx.waitFor(`Boolean(${entry})`);
        await ctx.eval(`${entry}.click()`);
      }
      await ctx.waitFor(`Boolean(${frame}?.src)`);
      const address = new URL(await ctx.eval(`${frame}.src`));
      const target = (await listTargets(ctx.cdpBaseUrl)).find(value =>
        value.type === "iframe" && value.url.startsWith(address.origin + "/"));
      ctx.assert(Boolean(target), "The workbench iframe is missing.");
      const client = await connect(target.webSocketDebuggerUrl);
      const evaluate = async expression => {
        const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true });
        ctx.assert(!result.exceptionDetails, result.exceptionDetails?.text || "Frame script failed.");
        return result.result.value;
      };
      try {
        if (await evaluate(`location.pathname !== '/accounts'`)) {
          await evaluate(`document.querySelector('a[href="/accounts"]').click()`);
        }
        for (let attempt = 0; attempt < 40; attempt++) {
          if (await evaluate(`Boolean(document.querySelector('#account-onboarding'))`)) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        await evaluate(`document.querySelector('[data-open-account-form]').click()`);
        await ctx.prove("官方创作平台在浏览器打开，运营台仍保留在右侧", {
          voiceover: "点击打开创作服务平台，默认浏览器显示小红书官方页面，右侧仍保留账号接入表单。",
          action: async () => {
            await evaluate(`document.querySelector('#account-onboarding a[target="_blank"]').click()`);
          },
          assert: async () => {
            let titles = "";
            for (let attempt = 0; attempt < 15; attempt++) {
              const result = await runFile("powershell.exe", ["-NoProfile", "-Command",
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-Process | Where-Object { $_.MainWindowTitle -and $_.ProcessName -match 'msedge|chrome|firefox|browser' } | ForEach-Object { $_.MainWindowTitle }"],
              { windowsHide: true, timeout: 5000, encoding: "utf8" });
              titles = result.stdout;
              if (/小红书.*创作|创作.*服务平台/.test(titles)) break;
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            ctx.assert(/小红书.*创作|创作.*服务平台/.test(titles), "The official creator page did not appear in the desktop browser.");
            ctx.log("Windows default browser displays the Xiaohongshu creator platform.");
            ctx.assert(await ctx.eval(`Boolean(${frame})`), "Opening the link replaced the workbench.");
            ctx.assert(await evaluate(`Boolean(document.querySelector('#account-onboarding:not([hidden])'))`), "The account form was lost.");
          },
          screenshot: "creator-login-entry",
        });
      } finally { client.close(); }
    },
  }],
};
