const projectRow = '[data-testid="project-row"][data-selected="true"]';
const engineMenuInfo = '[data-testid="project-engine-menu-info"]';
const engineLabel = '[data-testid="conversation-project-engine"]';

export default {
  id: "project-engine-lock",
  title: "New conversations inherit the project engine",
  kind: "user-facing",
  preserveTheme: true,
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    return await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(projectRow)}))`)
      ? null : "Open a named project with an installed engine before running this proof.";
  },
  steps: [{
    name: "Open a new conversation in the current project",
    run: async (ctx) => {
      const previousHash = await ctx.eval("location.hash");
      const projectId = await ctx.eval(`document.querySelector(${JSON.stringify(projectRow)}).dataset.projectId`);
      const projectSelector = `[data-project-id=${JSON.stringify(projectId)}]`;

      await ctx.trustedClick(`[data-testid="project-actions-menu"]${projectSelector}`);
      const engine = await ctx.waitFor(`document.querySelector(${JSON.stringify(engineMenuInfo)})?.textContent.trim()`);
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ctx.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await ctx.waitFor(`!document.querySelector(${JSON.stringify(engineMenuInfo)})`);

      try {
        await ctx.prove("The new conversation shows the project's engine without a switcher", {
          voiceover: "在项目里打开新对话，输入框上方显示项目绑定的引擎名称。",
          action: async () => {
            await ctx.trustedClick(`[data-testid="project-new-conversation-button"]${projectSelector}`);
            await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(engineLabel)}))`);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const label = document.querySelector(${JSON.stringify(engineLabel)});
              return {
                engine: label?.textContent.trim(),
                interactive: label?.matches('button, [role], [tabindex]'),
                hasPicker: Boolean(document.querySelector('[data-testid="conversation-engine-picker"]')),
                hasComposer: Boolean(document.querySelector('[data-testid="new-conversation-starter-composer-shell"] [contenteditable="true"]')),
              };
            })()`);
            ctx.assert(state.engine === engine && !state.interactive && !state.hasPicker && state.hasComposer,
              "The composer shows the same engine as the project menu and has no engine switcher");
          },
          screenshot: { name: "project-engine", requireText: [engine], hashIncludes: `/workspace/${projectId}/session` },
        });
      } finally {
        await ctx.navigateHash(previousHash.slice(1));
      }
    },
  }],
};
