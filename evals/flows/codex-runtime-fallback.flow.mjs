export default {
  id: "codex-runtime-fallback",
  title: "Codex workspace starts with a launchable local runtime",
  kind: "user-facing",
  steps: [{
    name: "Open the Codex workspace",
    run: async (ctx) => {
      await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
        timeoutMs: 60_000,
        label: "window.__ipolloworkControl",
      });
      await ctx.prove("A Codex workspace opens without a blocked sidecar error", {
        voiceover: "打开 Codex 项目后，对话框正常可用，不再出现运行时被 Windows 拒绝启动的错误。",
        action: async () => {
          const projectId = await ctx.eval(`(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const project = document.querySelector('[data-testid="project-row"][title="codex"]')
              ?? Array.from(document.querySelectorAll('[data-testid="project-row"]'))
                .find((row) => row.textContent?.trim().toLowerCase() === 'codex');
            const id = project?.getAttribute('data-project-id') ?? '';
            project?.click();
            return id;
          })()`);
          ctx.assert(Boolean(projectId), "Could not open the Codex project.");
          await ctx.waitFor(`location.hash.includes('/workspace/${projectId}/')
            && window.__ipolloworkControl.listActions()
              .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
            timeoutMs: 45_000,
            label: "ready Codex project",
          });
          await ctx.control("session.create_task");
          await ctx.eval("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
          await ctx.waitFor(`location.hash.includes('/workspace/${projectId}/session/')
            && !document.querySelector('[data-testid="session-loading-animation"]')
            && Boolean(document.querySelector('[data-testid="new-conversation-starter-composer-shell"], [data-testid="composer-placeholder"], [contenteditable="true"]'))
            && !document.body.innerText.includes('launch blocked')
            && !document.body.innerText.includes('spawn EPERM')`, {
            timeoutMs: 45_000,
            label: "ready Codex composer",
          });
        },
        assert: async () => {
          const state = await ctx.eval(`(() => ({
            composerVisible: Boolean(document.querySelector('[data-testid="new-conversation-starter-composer-shell"], [data-testid="composer-placeholder"], [contenteditable="true"]')),
            loading: Boolean(document.querySelector('[data-testid="session-loading-animation"]')),
            sessionRoute: location.hash.includes('/session/'),
            launchBlocked: document.body.innerText.includes('launch blocked'),
            spawnEperm: document.body.innerText.includes('spawn EPERM'),
          }))()`);
          ctx.assert(state.composerVisible, "The Codex composer is not visible.");
          ctx.assert(!state.loading, "The Codex session is still loading.");
          ctx.assert(state.sessionRoute, "The Codex session route is not active.");
          ctx.assert(!state.launchBlocked, "A launch-blocked error is still visible.");
          ctx.assert(!state.spawnEperm, "spawn EPERM is still visible.");
        },
        screenshot: {
          name: "codex-runtime-fallback",
          requireText: ["codex"],
          rejectText: ["launch blocked", "spawn EPERM", "Codex Harness request failed"],
          hashIncludes: ["/workspace/"],
        },
      });
    },
  }],
};
