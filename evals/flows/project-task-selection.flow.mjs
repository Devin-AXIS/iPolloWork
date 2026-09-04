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
            await ctx.eval(`(() => {
              const hasSelection = document.querySelector('[data-testid="project-row"][data-selected="true"]')
                || document.querySelector('[data-sidebar="menu-sub-button"][data-active]');
              if (!hasSelection) document.querySelector('[data-sidebar="menu-sub-button"]')?.click();
              return true;
            })()`);
            await ctx.waitFor(`document.querySelectorAll('[data-testid="project-row"][data-selected="true"]').length
              + document.querySelectorAll('[data-sidebar="menu-sub-button"][data-active]').length === 1`, {
              timeoutMs: 30_000,
              label: "single sidebar selection",
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
      name: "Toggle a project without leaving the current page",
      run: async (ctx) => {
        let before = null;
        await ctx.prove("Project rows only expand and collapse while their adjacent actions stay independent", {
          voiceover: "单击项目名称只负责展开或收起；旁边的加号继续新建会话，更多按钮继续打开项目菜单，不会意外切换当前页面。",
          action: async () => {
            before = await ctx.eval(`(() => {
              const row = document.querySelector('[data-testid="project-row"]');
              if (!row) return null;
              const projectId = row.getAttribute('data-project-id');
              const state = {
                projectId,
                expanded: row.getAttribute('aria-expanded'),
                url: location.href,
              };
              row.click();
              return state;
            })()`);
            ctx.assert(before?.projectId, "A project row is required to prove expand and collapse.");
            await ctx.waitFor(`document.querySelector('[data-testid="project-row"][data-project-id="${before.projectId}"]')?.getAttribute('aria-expanded') !== ${JSON.stringify(before.expanded)}`, {
              timeoutMs: 10_000,
              label: "project expansion toggled",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const row = document.querySelector('[data-testid="project-row"][data-project-id="${before.projectId}"]');
              return {
                expanded: row?.getAttribute('aria-expanded'),
                url: location.href,
                hasNewConversation: Boolean(document.querySelector('[data-testid="project-new-conversation-button"][data-project-id="${before.projectId}"]')),
                hasActionsMenu: Boolean(document.querySelector('[data-testid="project-actions-menu"][data-project-id="${before.projectId}"]')),
              };
            })()`);
            ctx.assert(state.expanded !== before.expanded, "The project row should toggle its expanded state.");
            ctx.assert(state.url === before.url, "Expanding or collapsing a project must not navigate away.");
            ctx.assert(state.hasNewConversation, "The project new-conversation action should remain available.");
            ctx.assert(state.hasActionsMenu, "The project actions menu should remain available.");
          },
          screenshot: {
            name: "project-row-toggled",
            rejectText: ["未分组", "Ungrouped", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Return to the current conversation from full workspace views",
      run: async (ctx) => {
        let conversationLabel = null;
        await ctx.prove("Schedule and Extensions switch directly back to the selected conversation without close buttons", {
          voiceover: "进入日程或扩展后，直接点击左侧当前会话就能返回对话；这些页面不再显示多余的右上角关闭按钮。",
          action: async () => {
            conversationLabel = await ctx.eval(`(() => {
              const conversation = document.querySelector('[data-sidebar="menu-sub-button"]');
              if (!conversation) return null;
              const label = conversation.textContent?.trim() || null;
              conversation.click();
              return label;
            })()`);
            ctx.assert(Boolean(conversationLabel), "An existing visible conversation is required to prove direct navigation.");
            await ctx.waitFor(`location.hash.includes('/session/') && !location.hash.endsWith('/session')`, {
              timeoutMs: 30_000,
              label: "selected conversation",
            });

            for (const label of ["日程", "扩展"]) {
              await ctx.eval(`(() => {
                const button = [...document.querySelectorAll('button')]
                  .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
                if (!button) throw new Error(${JSON.stringify(`${label} navigation was not found`)});
                button.click();
                return true;
              })()`);
              await ctx.waitFor(label === "日程"
                ? `Boolean(document.querySelector('[data-testid="work-center"]'))`
                : `Boolean(document.querySelector('[data-settings-shell][data-settings-compact]'))`, {
                timeoutMs: 30_000,
                label: `${label} workspace view`,
              });
              await ctx.eval(`(() => {
                const selected = [...document.querySelectorAll('[data-sidebar="menu-sub-button"]')]
                  .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(conversationLabel)});
                if (!selected) throw new Error('Selected conversation entry was not found');
                selected.click();
                return true;
              })()`);
              await ctx.waitFor(`!document.querySelector('[data-testid="work-center"]') && !document.querySelector('[data-settings-shell][data-settings-compact]')`, {
                timeoutMs: 30_000,
                label: `conversation restored from ${label}`,
              });
              await ctx.waitFor(`Boolean(document.querySelector('[data-session-surface-id]'))`, {
                timeoutMs: 30_000,
                label: `conversation content restored from ${label}`,
              });
            }
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              hasConversation: Boolean(document.querySelector('[data-session-surface-id]')),
              hasFloatingClose: [...document.querySelectorAll('button')].some((button) => (
                button.querySelector('svg.lucide-x') && getComputedStyle(button).position === 'absolute'
              )),
            }))()`);
            ctx.assert(state.hasConversation, "The selected conversation should be visible again.");
            ctx.assert(!state.hasFloatingClose, "Full workspace views should not add a floating close button.");
          },
          screenshot: {
            name: "conversation-restored-from-workspace-views",
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
