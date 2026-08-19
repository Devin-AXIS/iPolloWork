export default {
  id: "project-task-selection",
  title: "Project-first task entry and sidebar selection",
  kind: "user-facing",
  steps: [
    {
      name: "Show only one selected project or conversation",
      run: async (ctx) => {
        await ctx.prove("The sidebar hides Ungrouped and shows one exclusive selection", {
          voiceover: "左侧栏只保留普通项目；项目和会话共享同一选中样式，并且同一时间只选中一个。",
          action: async () => {
            await ctx.client.send("Emulation.clearDeviceMetricsOverride");
            await ctx.waitFor(`document.querySelectorAll('[data-testid="project-row"]').length > 0`, {
              timeoutMs: 30_000,
              label: "named project rows",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const rows = [...document.querySelectorAll('[data-testid="project-row"]')];
              const selectedProjects = rows.filter((row) => row.getAttribute('data-selected') === 'true');
              const selectedConversations = [...document.querySelectorAll('[data-sidebar="menu-sub-button"][data-active]')];
              const selected = selectedProjects[0] || selectedConversations[0];
              return {
                projectCount: rows.length,
                selectedProjectCount: selectedProjects.length,
                selectedConversationCount: selectedConversations.length,
                selectedBackground: selected ? getComputedStyle(selected).backgroundColor : '',
                hasUngrouped: /未分组|Ungrouped/.test(document.body.innerText || ''),
              };
            })()`);
            ctx.assert(state.projectCount > 0, "At least one named project should be visible.");
            ctx.assert(state.selectedProjectCount + state.selectedConversationCount === 1, "Exactly one project or conversation should be selected.");
            ctx.assert(!(state.selectedProjectCount && state.selectedConversationCount), "A project and its conversation must not both appear selected.");
            ctx.assert(state.selectedBackground !== "rgba(0, 0, 0, 0)", "The selected item should have a visible background.");
            ctx.assert(!state.hasUngrouped, "Ungrouped should not appear in the sidebar.");
          },
          screenshot: {
            name: "project-first-current-selection",
            rejectText: ["未分组", "Ungrouped", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Select a different project",
      run: async (ctx) => {
        await ctx.prove("Selecting another project moves the single current-project state", {
          voiceover: "选择另一个项目后，选中状态随之移动；之后的新任务会归入这个当前项目。",
          action: async () => {
            const targetId = await ctx.eval(`(() => {
              const target = [...document.querySelectorAll('[data-testid="project-row"]')]
                .find((row) => !location.hash.includes(row.getAttribute('data-project-id') || ''));
              if (!target) return null;
              target.click();
              return target.getAttribute('data-project-id');
            })()`);
            ctx.assert(targetId, "A second project is required to prove selection switching.");
            await ctx.waitFor(`(() => {
              const selected = [...document.querySelectorAll('[data-testid="project-row"]')]
                .filter((row) => row.getAttribute('data-selected') === 'true');
              const selectedConversations = document.querySelectorAll('[data-sidebar="menu-sub-button"][data-active]');
              return selected.length === 1
                && selected[0]?.getAttribute('data-project-id') === ${JSON.stringify(targetId)}
                && selectedConversations.length === 0;
            })()`, {
              timeoutMs: 10_000,
              label: "new current project",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const selectedProject = document.querySelector('[data-testid="project-row"][data-selected="true"]');
              const target = document.createElement('span');
              target.className = 'bg-sidebar-accent mac:bg-black/5 dark:mac:bg-white/10';
              document.body.append(target);
              const targetBackground = getComputedStyle(target).backgroundColor;
              target.remove();
              return {
                selectedProjects: document.querySelectorAll('[data-testid="project-row"][data-selected="true"]').length,
                selectedConversations: document.querySelectorAll('[data-sidebar="menu-sub-button"][data-active]').length,
                selectedBackground: selectedProject ? getComputedStyle(selectedProject).backgroundColor : '',
                targetBackground,
              };
            })()`);
            ctx.assert(state.selectedProjects === 1, `Exactly one project should be selected, found ${state.selectedProjects}.`);
            ctx.assert(state.selectedConversations === 0, "Selecting a project should clear the conversation selection.");
            ctx.assert(state.selectedBackground === state.targetBackground, "Project and conversation selections should use the same semantic color.");
          },
          screenshot: {
            name: "project-first-switched-selection",
            rejectText: ["未分组", "Ungrouped", "Something went wrong"],
          },
        });
      },
    },
  ],
};
