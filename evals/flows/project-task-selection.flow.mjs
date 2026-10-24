export default {
  id: "project-task-selection",
  title: "Project-first task entry and sidebar selection",
  kind: "user-facing",
  steps: [
    {
      name: "Show extension loading and start tasks from workspace views",
      run: async (ctx) => {
        await ctx.prove("Extensions show immediate loading feedback while the library initializes", {
          voiceover: "从左侧打开扩展后，内容加载期间会立即出现清晰的加载反馈，不再留下一整块空白页面。",
          action: async () => {
            await ctx.client.send("Emulation.clearDeviceMetricsOverride");
            await ctx.navigateHash("/");
            await ctx.waitFor(`(() => {
              const button = [...document.querySelectorAll('button')]
                .find((candidate) => ['扩展', 'Extensions'].includes(candidate.textContent?.trim() ?? '') && candidate.getClientRects().length > 0);
              if (!button) return false;
              button.click();
              return true;
            })()`, {
              timeoutMs: 30_000,
              label: "open Extensions from the primary sidebar",
            });
            await ctx.waitFor(`Boolean(document.querySelector('[data-testid="extensions-loading"][role="status"]'))`, {
              timeoutMs: 5_000,
              label: "visible Extensions loading feedback",
            });
          },
          assert: async () => {
            const loadingState = await ctx.eval(`(() => {
              const status = document.querySelector('[data-testid="extensions-loading"]');
              return {
                visible: Boolean(status?.getClientRects().length),
                hasSpinner: Boolean(status?.querySelector('.animate-spin')),
                label: status?.textContent?.trim() ?? '',
              };
            })()`);
            ctx.assert(loadingState.visible, "The Extensions loading status should be visible.");
            ctx.assert(loadingState.hasSpinner, "The Extensions loading status should include a spinner.");
            ctx.assert(Boolean(loadingState.label), "The Extensions loading status should have a localized label.");
          },
          screenshot: {
            name: "extensions-loading-feedback",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });

        await ctx.prove("New task exits both Extensions and Schedule and opens the conversation starter", {
          voiceover: "无论当前停留在扩展还是日程，点击左侧新建任务都会立即返回新对话输入页。",
          action: async () => {
            for (const label of ["扩展", "日程"]) {
              await ctx.waitFor(label === "扩展"
                ? `Boolean(document.querySelector('[data-settings-shell][data-settings-compact]'))`
                : `Boolean(document.querySelector('[data-testid="work-center"]'))`, {
                timeoutMs: 30_000,
                label: `${label} workspace view`,
              });
              const created = await ctx.eval(`(() => {
                const button = [...document.querySelectorAll('button')]
                  .find((candidate) => ['新建任务', '新建对话', 'New task', 'New conversation'].includes(candidate.textContent?.trim() ?? '')
                    && candidate.getClientRects().length > 0);
                button?.click();
                return Boolean(button);
              })()`);
              ctx.assert(created, `The new-task action should be available from ${label}.`);
              await ctx.waitFor(`Boolean(document.querySelector('[data-testid="initial-project-task-starter"]'))
                && !document.querySelector('[data-settings-shell][data-settings-compact]')
                && !document.querySelector('[data-testid="work-center"]')`, {
                timeoutMs: 30_000,
                label: `new-task starter from ${label}`,
              });
              if (label === "扩展") {
                const openedSchedule = await ctx.eval(`(() => {
                  const button = [...document.querySelectorAll('button')]
                    .find((candidate) => ['日程', 'Schedule'].includes(candidate.textContent?.trim() ?? '') && candidate.getClientRects().length > 0);
                  button?.click();
                  return Boolean(button);
                })()`);
                ctx.assert(openedSchedule, "Schedule should be available from the conversation starter.");
              }
            }
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              starterVisible: Boolean(document.querySelector('[data-testid="initial-project-task-starter"]')?.getClientRects().length),
              extensionsOpen: Boolean(document.querySelector('[data-settings-shell][data-settings-compact]')),
              scheduleOpen: Boolean(document.querySelector('[data-testid="work-center"]')),
            }))()`);
            ctx.assert(state.starterVisible, "The new-conversation starter should be visible.");
            ctx.assert(!state.extensionsOpen && !state.scheduleOpen, "The previous full workspace view should be closed.");
          },
          screenshot: {
            name: "new-task-from-workspace-views",
            rejectText: ["Something went wrong"],
            hashIncludes: "/session",
          },
        });
      },
    },
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
              const selectedProject = document.querySelector('[data-testid="project-row"][data-selected="true"]');
              const selectedConversation = document.querySelector('[data-sidebar="menu-sub-button"][data-active]');
              const conversation = document.querySelector('[data-sidebar="menu-sub-button"]');
              if ((selectedProject || !selectedConversation) && conversation) conversation.click();
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
        await ctx.eval(`(() => {
          const row = document.querySelector('[data-testid="project-row"][data-project-id="${before.projectId}"]');
          if (row?.getAttribute('aria-expanded') === 'false') row.click();
          return true;
        })()`);
        await ctx.waitFor(`document.querySelector('[data-testid="project-row"][data-project-id="${before.projectId}"]')?.getAttribute('aria-expanded') === 'true'`, {
          timeoutMs: 10_000,
          label: "project restored after toggle proof",
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
