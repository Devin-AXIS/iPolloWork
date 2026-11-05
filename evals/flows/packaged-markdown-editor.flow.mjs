import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export default {
  id: "packaged-markdown-editor",
  title: "Generated Markdown opens, edits, saves and reopens in the installed Linux app",
  kind: "user-facing",
  requiredEnv: ["IPOLLOWORK_EVAL_PACKAGED_MARKDOWN_EDITOR"],
  steps: [{
    name: "Open and edit a generated Markdown file on a case-sensitive filesystem",
    run: async ctx => {
      let fixture;
      try {
        await ctx.prove("Linux 安装版点击生成的 iPolloWork简介.md 后加载正确文件及 Markdown 编辑器", {
          voiceover: "点击生成的 Markdown 文件，右侧会显示文件正文，并且可以直接编辑。",
          action: async () => {
            ctx.assert(await ctx.eval("location.protocol === 'file:'"), "Use the installed production renderer");
            await ctx.navigateHash('/session');
            await ctx.waitFor(`window.__ipolloworkControl?.listActions().some(action => action.id === 'session.create_task' && !action.disabled)`, { timeoutMs: 60_000 });
            await ctx.control('session.create_task');
            await ctx.waitFor(`(() => { const route = window.__ipollowork?.slice?.('route'); return route?.selectedSessionId && window.__owReactQueryClient?.getQueryData(['react-session-snapshot', route.selectedWorkspaceId, route.selectedSessionId]); })()`, { timeoutMs: 60_000 });
            // Only the model's write result is a fixture. Files, resolution,
            // the delivered card, editor and autosave use production code.
            fixture = await ctx.eval(`(async () => {
              const route = window.__ipollowork.slice('route');
              const workspaceId = route.selectedWorkspaceId, sessionId = route.selectedSessionId;
              const path = 'reports/md-proof-' + Date.now() + '/技能整理/iPolloWork简介.md';
              const pendingPath = path;
              const key = ['react-session-snapshot', workspaceId, sessionId];
              const client = window.__owReactQueryClient;
              const original = client.getQueryData(key);
              const fetchOriginal = window.fetch;
              const proof = window.__markdownProof = { workspaceId, path, pendingPath, falseObserved: false, original, key, fetchOriginal };
              window.fetch = async (...args) => {
                const response = await fetchOriginal(...args);
                if (response.url.endsWith('/artifacts/resolve')) {
                  const result = await response.clone().json();
                  if (result.items.some(item => item.value === pendingPath && item.exists === false)) proof.falseObserved = true;
                }
                return response;
              };
              const created = Date.now();
              proof.publish = completed => client.setQueryData(key, { ...original, messages: [
                { id: 'md-proof-user', role: 'user', parts: [{ type: 'text', text: '生成 Markdown 验证文档' }] },
                { id: 'md-proof-assistant', role: 'assistant', metadata: { ipollowork: { created, ...(completed ? { completed: Date.now() } : {}) } }, parts: [
                  { type: 'dynamic-tool', toolName: 'bash', toolCallId: 'md-proof-write', state: completed ? 'output-available' : 'input-available', input: { command: 'Generate the requested Markdown file' }, ...(completed ? { output: 'Command completed with exit code 0' } : {}) },
                  { type: 'text', text: (completed ? '已创建文件 ' : '准备生成文件 ') + path + '，内容如下：' }
                ] }
              ] });
              proof.publish(false);
              const root = route.workspaces.find(workspace => workspace.id === workspaceId).path;
              return { path, absolutePath: root.replace(/\\/$/, '') + '/' + path };
            })()`, { awaitPromise: true });
            await ctx.waitFor('window.__markdownProof?.falseObserved === true', { timeoutMs: 30_000, label: 'missing pending path observed before generation' });
            // Execute an actual shell write after the same filename was resolved
            // as missing; only the model messages are fixtures.
            execFileSync('bash', ['-c', 'mkdir -p -- "$(dirname -- "$1")" && printf "%s" "$2" > "$1"', '--', fixture.absolutePath, '# Linux Markdown proof\n\n这是实际生成的 Markdown 正文。\n']);
            await ctx.eval('window.__markdownProof.publish(true)');
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).some(card => card.dataset.artifactPath === window.__markdownProof.path && !card.disabled)`, { timeoutMs: 60_000, label: 'shell-generated Chinese Markdown card' });
            await ctx.eval(`Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).find(card => card.dataset.artifactPath === window.__markdownProof.path).click()`);
            await ctx.waitFor(`document.querySelector('.cm-editor .cm-content[contenteditable="true"]')?.textContent.includes('Linux Markdown proof')`, { timeoutMs: 30_000, label: 'generated Markdown loaded in editable panel' });
          },
          assert: async () => {
            ctx.assert((await readFile(fixture.absolutePath, 'utf8')).includes('这是实际生成的 Markdown 正文'), 'The editor opens the real generated file');
            ctx.assert(await ctx.eval(`document.querySelectorAll('[data-testid="artifact-file-card"]').length === 1`), 'A basename mention does not create a second broken file card');
          },
          screenshot: { name: 'linux-generated-markdown-editor', requireText: ['iPolloWork简介.md', 'Linux Markdown proof'], rejectText: ['File not found', 'Something went wrong'] },
        });
        await ctx.prove("修改 Markdown 自动保存到原文件，关闭重开后内容保留", {
          voiceover: "修改正文后会自动保存，关闭再打开，修改后的内容仍然保留。",
          action: async () => {
            await ctx.trustedClick('.cm-editor .cm-content');
            await ctx.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', modifiers: 2, windowsVirtualKeyCode: 35 });
            await ctx.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
            await ctx.client.send('Input.insertText', { text: '\n\nSaved Linux Markdown edit：修改已保存。\n' });
            let saved = false;
            for (let attempt = 0; attempt < 60; attempt++) {
              if ((await readFile(fixture.absolutePath, 'utf8')).includes('Saved Linux Markdown edit')) { saved = true; break; }
              await delay(300);
            }
            ctx.assert(saved, 'Autosave writes the edit to the original file');
            await ctx.trustedClick('button[aria-label="Close artifact"]');
            await ctx.waitFor(`!document.querySelector('.cm-editor')`);
            await ctx.eval(`window.__owReactQueryClient.removeQueries({ queryKey: ['artifact-panel', window.__markdownProof.workspaceId] })`);
            await ctx.eval(`Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).find(card => card.dataset.artifactPath === window.__markdownProof.path).click()`);
            await ctx.waitFor(`document.querySelector('.cm-editor .cm-content')?.textContent.includes('Saved Linux Markdown edit')`, { timeoutMs: 30_000 });
          },
          assert: async () => {
            const text = await readFile(fixture.absolutePath, 'utf8');
            ctx.assert(text.includes('Linux Markdown proof') && text.includes('Saved Linux Markdown edit'), 'Original content and edits survive a disk reload');
            ctx.recordEvidence({ type: 'assertion', status: 'passed', assertion: 'Generated Markdown is editable and survives autosave plus cache-cleared reopening', actual: { path: fixture.path, diskVerified: true } });
          },
          screenshot: { name: 'linux-markdown-edit-saved', requireText: ['iPolloWork简介.md', 'Saved Linux Markdown edit'], rejectText: ['File not found', 'Could not save'] },
        });
        await ctx.prove("下载中文文件名的 Markdown，下载文件包含已保存的正文", {
          voiceover: "点击文件卡片上的下载，得到包含最新修改的 Markdown 文件。",
          action: async () => {
            fixture.downloadDirectory = await mkdtemp(join(tmpdir(), 'ipollowork-md-download-'));
            await ctx.client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: fixture.downloadDirectory });
            await ctx.eval(`(() => {
              const card = Array.from(document.querySelectorAll('[data-testid="artifact-file-card"]')).find(card => card.dataset.artifactPath === window.__markdownProof.path);
              card.closest('[data-testid="artifact-file-shell"]').querySelector('[data-testid="artifact-file-actions"] button').click();
            })()`);
            let downloaded = false;
            for (let attempt = 0; attempt < 60; attempt++) {
              const files = await readdir(fixture.downloadDirectory);
              if (files.includes('iPolloWork简介.md')) { downloaded = true; break; }
              await delay(300);
            }
            ctx.assert(downloaded, 'The download button saves the Chinese filename on Linux');
          },
          assert: async () => {
            const disk = await readFile(fixture.absolutePath, 'utf8');
            const downloaded = await readFile(join(fixture.downloadDirectory, 'iPolloWork简介.md'), 'utf8');
            ctx.assert(downloaded === disk && downloaded.includes('Saved Linux Markdown edit'), 'Downloaded Markdown matches the edited file byte for byte');
            ctx.recordEvidence({ type: 'assertion', status: 'passed', assertion: 'The real download preserves the UTF-8 filename and saved Markdown content', actual: { filename: 'iPolloWork简介.md', bytes: Buffer.byteLength(downloaded) } });
          },
          screenshot: { name: 'linux-markdown-downloaded', requireText: ['iPolloWork简介.md', 'Saved Linux Markdown edit'], rejectText: ['File not found', 'Could not save'] },
        });
      } finally {
        await ctx.eval(`(() => { const proof = window.__markdownProof; if (proof) { window.fetch = proof.fetchOriginal; window.__owReactQueryClient.setQueryData(proof.key, proof.original); delete window.__markdownProof; } })()`).catch(() => undefined);
      }
    },
  }],
};
