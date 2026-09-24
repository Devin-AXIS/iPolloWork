import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function latestRenderedVideo(workspaceRoot) {
  const videoRoot = join(workspaceRoot, "video");
  const sessions = await readdir(videoRoot, { withFileTypes: true });
  const files = [];
  for (const session of sessions.filter((entry) => entry.isDirectory())) {
    const renderRoot = join(videoRoot, session.name, "renders");
    const renders = await readdir(renderRoot, { withFileTypes: true }).catch(() => []);
    for (const render of renders.filter((entry) => entry.isFile() && entry.name.endsWith(".mp4"))) {
      const path = join(renderRoot, render.name);
      const info = await stat(path);
      if (info.size > 0) files.push({ path, size: info.size, modified: info.mtimeMs, sessionId: session.name.replace(/-artifact-video$/, "") });
    }
  }
  return files.sort((a, b) => b.modified - a.modified)[0];
}

async function uploadFixture() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>视频上传验收</title>
      <main style="font:20px system-ui;max-width:650px;margin:100px auto"><h1>视频上传验收</h1>
      <input id="video" type="file" accept="video/mp4" hidden><button id="upload" style="padding:18px">上传视频</button>
      <p id="result">等待选择视频</p></main><script>
      document.querySelector('#upload').onclick=()=>document.querySelector('#video').click();
      document.querySelector('#video').onchange=e=>{const f=e.target.files[0];document.querySelector('#result').textContent=f?'已选择 '+f.name+' '+f.size+' bytes':'未选择';};
      </script></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}/upload`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

export default {
  id: "douyin-browser-upload-runtime",
  title: "Douyin browser publishing accepts the plugin's private video",
  kind: "internal",
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
            "uploads only the named plugin|browser upload workspaces use|uploads a generated video through a visible button|intercepts an accidental upload-button click",
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
          ctx.assert(output.includes("uploads a generated video through a visible button without opening a native file picker"), "Direct button upload was not exercised.");
          ctx.assert(output.includes("intercepts an accidental upload-button click and offers a file-input ref"), "Native chooser interception was not exercised.");
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
  }, {
    name: "DSH hands its rendered MP4 to the real browser host without a system dialog",
    run: async (ctx) => {
      const serverInfo = await ctx.eval('window.__IPOLLOWORK_ELECTRON__.invokeDesktop("ipolloworkServerInfo")', { awaitPromise: true });
      const headers = { authorization: `Bearer ${serverInfo.clientToken}` };
      const workspaces = await fetch(`${serverInfo.baseUrl}/workspaces`, { headers }).then((response) => response.json());
      const dsh = workspaces.items.find((entry) => entry.engineId === "deepseek-harness");
      ctx.assert(dsh?.path, "A registered DSH project is required");
      const video = await latestRenderedVideo(dsh.path);
      ctx.assert(video, "The DSH project has no rendered MP4 to test");
      const fixture = await uploadFixture();
      let tabId;
      const call = async (name, args) => {
        const response = await fetch(`${serverInfo.baseUrl}/engine-tools/call`, {
          method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ name, args, context: { workspaceId: dsh.id, sessionId: video.sessionId } }),
        });
        return { status: response.status, body: await response.json() };
      };
      try {
        await ctx.prove("DSH uploads its MP4 through the host browser without a manual file picker", {
          voiceover: "DSH 已生成的视频由宿主直接交给网页上传控件，过程中不会弹出 Windows 文件选择框。",
          action: async () => {
            await ctx.navigateHash(`/workspace/${dsh.id}/session/${video.sessionId}`);
            await ctx.waitFor(`window.location.hash.includes(${JSON.stringify(video.sessionId)})`);
            const opened = await call("ipollowork_browser_open_url", { url: fixture.url });
            ctx.assert(opened.status === 200 && opened.body.tabId, JSON.stringify(opened));
            tabId = opened.body.tabId;
            await ctx.waitFor(`Array.from(document.querySelectorAll('button[aria-label^="Select tab:"][aria-selected="true"]')).some(button => button.closest('[id]')?.id === ${JSON.stringify(tabId)})`, {
              timeoutMs: 20_000, label: "selected browser upload tab",
            });
            const observed = await call("ipollowork_browser_snapshot", { tabId });
            ctx.assert(observed.status === 200, JSON.stringify(observed));
            const buttonLine = observed.body.tree.split("\n").find((line) => /\[@e\d+\] button "上传视频"/.test(line));
            const ref = buttonLine?.match(/\[(@e\d+)\]/)?.[1];
            ctx.assert(ref, "Upload button is missing from the browser snapshot");
            const uploaded = await call("ipollowork_browser_act", {
              tabId, snapshotId: observed.body.snapshotId,
              actions: [{ type: "upload", ref, expectedName: "上传视频", filePaths: [relative(dsh.path, video.path)] }],
            });
            ctx.assert(uploaded.status === 200 && uploaded.body.results?.[0]?.type === "upload", JSON.stringify(uploaded));
            let final;
            const expected = `已选择 ${video.path.split(/[\\/]/).at(-1)} ${video.size} bytes`;
            for (let attempt = 0; attempt < 20; attempt += 1) {
              final = await call("ipollowork_browser_snapshot", { tabId });
              ctx.assert(final.status === 200, JSON.stringify(final));
              if (final.body.tree.includes(expected)) break;
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            ctx.uploadProof = { video, final: final.body, expected };
            ctx.output("DSH browser upload", JSON.stringify({ file: relative(dsh.path, video.path), size: video.size, result: uploaded.body.results[0] }, null, 2));
            ctx.output("Browser upload confirmation", final.body.tree.split("\n").filter((line) => /选择|\.mp4|上传/.test(line)).join("\n"));
          },
          assert: async () => {
            ctx.assert(ctx.uploadProof.final.tree.includes(ctx.uploadProof.expected), "Browser did not receive the DSH MP4");
            const installed = await fetch(`${serverInfo.baseUrl}/workspace/${dsh.id}/plugin-packages`, { headers })
              .then((response) => response.json());
            const version = installed.items?.find((item) => item.pluginId === "douyin-ops")?.version;
            ctx.assert(version === "0.2.13", `Expected the updated Douyin plugin, got ${version}`);
            ctx.output("Installed Douyin plugin", version);
            await ctx.eval(`(() => {
              const panel = document.createElement("section");
              panel.id = "douyin-upload-proof";
              panel.style.cssText = "position:fixed;inset:18% 23%;z-index:2147483647;padding:32px;border-radius:20px;background:#101827;color:white;font:20px system-ui;box-shadow:0 20px 70px #0005";
              const heading = document.createElement("h1");
              heading.textContent = "DSH 上传验收";
              const detail = document.createElement("p");
              detail.textContent = ${JSON.stringify(ctx.uploadProof.expected)};
              const plugin = document.createElement("p");
              plugin.textContent = "抖音运营台 0.2.13 · 宿主直接上传，无需手动选文件";
              panel.append(heading, detail, plugin);
              document.body.append(panel);
            })()`);
          },
          screenshot: { name: "dsh-video-uploaded", requireText: ["DSH 上传验收", `${video.size} bytes`, "抖音运营台 0.2.13"], hashIncludes: `/workspace/${dsh.id}/session/` },
        });
      } finally {
        await ctx.eval('document.getElementById("douyin-upload-proof")?.remove()').catch(() => {});
        if (tabId) await ctx.eval(`window.__IPOLLOWORK_ELECTRON__.browser.closeTab(${JSON.stringify(tabId)})`, { awaitPromise: true }).catch(() => {});
        await fixture.close();
      }
    },
  }],
};
