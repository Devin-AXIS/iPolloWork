const accessTriggerScript = `Array.from(document.querySelectorAll('button'))
  .find((button) => button.getClientRects().length > 0
    && /^(权限|Access):/.test(button.getAttribute('aria-label') ?? ''))`;

async function openProjectAccessSelector(ctx, projectName, storageKey) {
  await ctx.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const project = document.querySelector('[data-testid="project-row"][title="${projectName}"]')
      ?? Array.from(document.querySelectorAll('[data-testid="project-row"]'))
        .find((row) => row.textContent?.trim().toLowerCase() === '${projectName}');
    const projectId = project?.getAttribute('data-project-id');
    if (projectId) sessionStorage.setItem('${storageKey}', projectId);
    project?.click();
    return Boolean(project);
  })()`);
  await ctx.waitFor(`location.hash.includes('/workspace/' + sessionStorage.getItem('${storageKey}') + '/')
    && window.__ipolloworkControl.listActions()
      .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
    timeoutMs: 45_000,
    label: `ready ${projectName} project`,
  });
  await ctx.control("session.create_task");
  await ctx.waitFor(`Boolean(${accessTriggerScript})`, {
    timeoutMs: 45_000,
    label: `${projectName} access trigger`,
  });
  const opened = await ctx.eval(`(() => {
    const trigger = ${accessTriggerScript};
    trigger?.click();
    return Boolean(trigger);
  })()`);
  ctx.assert(opened, `Could not open the ${projectName} access selector.`);
}

export default {
  id: "composer-access-mode",
  title: "Composer exposes engine-native access controls beside the model",
  kind: "user-facing",
  steps: [
    {
      name: "Open the Codex access selector",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("The composer shows Codex access modes immediately beside the model", {
          voiceover: "模型右侧现在会显示当前 Codex 权限，打开后可以直接查看只读、自动、精细控制和完全访问四种原生模式。",
          action: async () => {
            await openProjectAccessSelector(ctx, "codex", "fraimz-access-codex-project-id");
          },
          assert: async () => {
            await ctx.waitFor(`['只读', '自动', '精细控制', '完全访问'].every((label) => document.body.innerText.includes(label))
              || ['Read only', 'Auto', 'Granular', 'Full access'].every((label) => document.body.innerText.includes(label))`, {
              timeoutMs: 15_000,
              label: "Codex access options",
            });
          },
          screenshot: {
            name: "composer-codex-access-options",
            rejectText: ["Could not switch access mode"],
          },
        });
      },
    },
    {
      name: "Guard full access with a warning",
      run: async (ctx) => {
        await ctx.prove("Full access requires an explicit risk confirmation", {
          voiceover: "选择完全访问不会静默生效，界面会先明确说明它能够越过工作区沙箱并取消审批。",
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const option = Array.from(document.querySelectorAll('[data-access-mode-option="full-access"]'))
                .find((element) => element.getClientRects().length > 0);
              option?.click();
              return Boolean(option);
            })()`);
            ctx.assert(clicked, "Could not choose the full-access option.");
          },
          assert: async () => {
            await ctx.waitFor(`document.body.innerText.includes('启用完全访问？')
              || document.body.innerText.includes('Enable full access?')`, {
              timeoutMs: 10_000,
              label: "full access warning",
            });
          },
          screenshot: {
            name: "composer-full-access-warning",
            rejectText: ["Could not switch access mode"],
          },
        });
      },
    },
    {
      name: "Open the DSH access selector without waiting for a session projection",
      run: async (ctx) => {
        await ctx.prove("The new-task composer always shows all three native DSH permission presets", {
          voiceover: "DSH 新任务不再等待会话权限投影，模型右侧会稳定显示只读、工作区写入和完全访问三档。",
          action: async () => {
            await openProjectAccessSelector(ctx, "dsh", "fraimz-access-dsh-project-id");
          },
          assert: async () => {
            await ctx.waitFor(`['read-only', 'workspace-write', 'danger-full-access'].every((id) =>
              Boolean(document.querySelector('[data-access-mode-option="' + id + '"]')))`, {
              timeoutMs: 15_000,
              label: "DSH access options",
            });
          },
          screenshot: {
            name: "composer-dsh-access-options",
            rejectText: ["Could not switch access mode"],
          },
        });
      },
    },
    {
      name: "Open the OpenCode access selector",
      run: async (ctx) => {
        await ctx.prove("The new-task composer shows OpenCode permission rules beside the model", {
          voiceover: "OpenCode 也使用同一个位置，并提供智能体默认、只读、操作前询问和完全访问四种有效规则。",
          action: async () => {
            await openProjectAccessSelector(ctx, "open", "fraimz-access-opencode-project-id");
          },
          assert: async () => {
            await ctx.waitFor(`['default', 'read-only', 'ask', 'full-access'].every((id) =>
              Boolean(document.querySelector('[data-access-mode-option="' + id + '"]')))`, {
              timeoutMs: 15_000,
              label: "OpenCode access options",
            });
          },
          screenshot: {
            name: "composer-opencode-access-options",
            rejectText: ["Could not switch access mode"],
          },
        });
      },
    },
  ],
};
