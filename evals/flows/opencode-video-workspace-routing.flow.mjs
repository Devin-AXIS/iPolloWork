import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export default {
  id: "opencode-video-workspace-routing",
  title: "OpenCode video export uses the current project despite a stale workspace id",
  kind: "internal",
  steps: [{
    name: "Resolve the existing OpenCode video in its actual project",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)");
      const route = await ctx.eval("window.__ipollowork.snapshot().route");
      const current = route.workspaces.find((workspace) => workspace.displayNameResolved?.toLowerCase() === "opencode");
      const stale = route.workspaces.find((workspace) => workspace.id !== current?.id);
      ctx.assert(current && stale, "The app must have an OpenCode project and another registered project");
      const sessions = route.sessionsByWorkspaceId[current.id] ?? [];
      let sourcePath = "";
      let videoSessionId = "";
      for (const session of sessions) {
        const candidate = `video/${session.id}-artifact-video/index.html`;
        if (await access(join(current.path, candidate)).then(() => true, () => false)) {
          sourcePath = candidate;
          videoSessionId = session.id;
          break;
        }
      }
      ctx.assert(sourcePath && videoSessionId, "The OpenCode project must contain a video from an existing session");

      let result;
      await ctx.prove("The media tool resolves the OpenCode session directory", {
        voiceover: "回到已有的 OpenCode 视频任务，导出工具从当前项目找到源文件，不会再到另一个项目里寻找。",
        action: async () => {
          await ctx.navigateHash(`/workspace/${current.id}/session`);
          await ctx.waitFor(`window.__ipollowork?.snapshot()?.route?.selectedWorkspaceId === ${JSON.stringify(current.id)}`);
          result = await ctx.eval(`(async () => {
            const base = localStorage.getItem("ipollowork.server.urlOverride");
            const token = localStorage.getItem("ipollowork.server.token");
            const response = await fetch(base + "/engine-tools/call", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify({
                name: "ipollowork_extension_call",
                args: { extensionId: "media", action: "video_render_status", args: {
                  sourcePath: ${JSON.stringify(sourcePath)},
                  operationKey: "fraimz-routing-no-export",
                } },
                context: { workspaceId: ${JSON.stringify(stale.id)}, directory: ${JSON.stringify(current.path)} },
              }),
            });
            const body = await response.json();
            return { status: response.status, code: body.code, message: body.message };
          })()`, { awaitPromise: true });
        },
        assert: async () => {
          ctx.assert(result.status === 404 && result.code === "render_not_found", JSON.stringify(result));
          ctx.output("OpenCode export path resolution", JSON.stringify({ sourcePath, currentWorkspace: current.id, staleWorkspace: stale.id, result }, null, 2));
        },
        screenshot: { name: "opencode-video-source-project", requireText: ["opencode"] },
      });

      const renderDirectory = join(current.path, sourcePath.replace(/\/index\.html$/, "/renders"));
      const existingRenders = new Set((await readdir(renderDirectory).catch(() => [])).filter((name) => name.endsWith(".mp4")));
      let exportedPath = "";
      await ctx.prove("OpenCode automatically exports the existing video to MP4", {
        voiceover: "在现有 OpenCode 视频任务中提出导出需求，应用自动完成 MP4 渲染，不再要求用户点击导出。",
        action: async () => {
          await ctx.navigateHash(`/workspace/${current.id}/session/${videoSessionId}`);
          await ctx.waitFor(`(() => {
            const route = window.__ipollowork?.snapshot()?.route;
            return route?.selectedWorkspaceId === ${JSON.stringify(current.id)}
              && route?.selectedSessionId === ${JSON.stringify(videoSessionId)}
              && Boolean(document.querySelector('[data-chat-transcript]'));
          })()`, { timeoutMs: 30_000, label: "existing OpenCode video task loaded" });
          const selectedModel = await ctx.eval(`(() => { const editor = document.querySelector('[contenteditable="true"]'); return editor?.parentElement?.parentElement?.textContent ?? ''; })()`);
          ctx.assert(/GPT-5\.5/i.test(selectedModel), "The OpenCode export proof requires the already selected GPT-5.5 model");
          const prompt = `请把已有的 ${sourcePath} 视频自动导出成 MP4，不要让我手动导出；不要发布到抖音。`;
          const pasted = await ctx.eval(`(() => {
            const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]') || document.querySelector('[contenteditable="true"]');
            if (!editor) return false;
            editor.focus();
            const data = new DataTransfer();
            data.setData('text/plain', ${JSON.stringify(prompt)});
            editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
            return true;
          })()`);
          ctx.assert(pasted, "OpenCode composer did not accept the export request");
          await ctx.waitFor(`Array.from(document.querySelectorAll('[contenteditable="true"]')).some((editor) => editor.textContent?.includes(${JSON.stringify(sourcePath)}))`, { timeoutMs: 15_000 });
          const submitted = await ctx.eval(`(() => {
            const button = Array.from(document.querySelectorAll('button')).find((entry) => /运行任务|Run task|Send/i.test(entry.getAttribute('title') ?? entry.textContent ?? '') && !entry.disabled)
              || Array.from(document.querySelectorAll('button')).find((entry) => entry.querySelector('svg[class*="arrow-up"]') && !entry.disabled);
            button?.click(); return Boolean(button);
          })()`);
          ctx.assert(submitted, "OpenCode could not submit the export request");
          for (let attempt = 0; attempt < 150; attempt += 1) {
            const names = (await readdir(renderDirectory).catch(() => [])).filter((name) => name.endsWith(".mp4") && !existingRenders.has(name));
            for (const name of names) {
              const candidate = join(renderDirectory, name);
              if ((await stat(candidate).catch(() => null))?.size > 0) { exportedPath = candidate; break; }
            }
            if (exportedPath) break;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        },
        assert: async () => {
          ctx.assert(exportedPath, "OpenCode ended without automatically exporting a new MP4");
          ctx.output("OpenCode automatic MP4 export", JSON.stringify({ path: exportedPath, size: (await stat(exportedPath)).size }, null, 2));
        },
        screenshot: { name: "opencode-automatic-mp4-export", requireText: ["MP4", "导出"] },
      });
    },
  }],
};
