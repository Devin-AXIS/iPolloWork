const ITEM_TITLE = "负责人智能体选择验证";

export default {
  id: "work-item-agent-assignee",
  title: "Task owners come from the current project's Agents",
  kind: "user-facing",
  steps: [
    {
      name: "Choose a project Agent as task owner",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        await ctx.waitFor("!document.querySelector('[data-testid=startup-logo-animation]')", {
          timeoutMs: 30_000,
          label: "startup overlay dismissed",
        });
        await ctx.eval(`(() => {
          document.querySelector('[data-slot="sheet-close"]')?.click();
          [...document.querySelectorAll('[role="dialog"]')].forEach((dialog) => {
            const cancel = [...dialog.querySelectorAll("button")]
              .find((button) => button.textContent?.trim() === "取消");
            cancel?.click();
          });
          return true;
        })()`);
        await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-project-overview]'))", {
          label: "project overview navigation",
        });
        await ctx.eval("document.querySelector('[data-testid=session-header-project-overview]').click(); true");
        await ctx.waitFor("document.querySelectorAll('[data-testid=project-agent-tab]').length > 0", {
          timeoutMs: 30_000,
          label: "Agents in the current project overview",
        });
        const projectAgentNames = await ctx.eval(`(() => [...document.querySelectorAll('[data-testid="project-agent-tab"]')]
          .map((button) => [...button.querySelectorAll("span")]
            .find((span) => span.className.includes("text-[12px]") && span.className.includes("font-medium"))
            ?.textContent?.trim() || "")
          .filter(Boolean))()`);
        ctx.assert(projectAgentNames.length > 0, "Expected at least one Agent in the current project overview.");

        await ctx.prove("Task owners are selected from the current project's Agent list", {
          voiceover: "In a new task, Owner now lets me choose one of the Agents already configured in this project.",
          action: async () => {
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=session-header-work-tasks]'))", {
              label: "project task navigation",
            });
            await ctx.eval("document.querySelector('[data-testid=session-header-work-tasks]').click(); true");
            await ctx.waitFor(`Boolean([...document.querySelectorAll("header button")]
              .find((button) => button.textContent?.trim() === "新建任务"))`, {
              label: "new task action",
            });
            await ctx.eval(`(() => {
              const button = [...document.querySelectorAll("header button")]
                .find((candidate) => candidate.textContent?.trim() === "新建任务");
              if (!button) throw new Error("New task action not found");
              button.click();
              return true;
            })()`);
            await ctx.waitFor(`(() => {
              const select = document.querySelector("#work-item-assignee");
              return select instanceof HTMLSelectElement
                && select.options.length === ${JSON.stringify(projectAgentNames.length + 1)};
            })()`, { label: "project Agent owner options" });
            await ctx.eval(`(() => {
              const title = document.querySelector("#work-item-title");
              const select = document.querySelector("#work-item-assignee");
              if (!(title instanceof HTMLInputElement) || !(select instanceof HTMLSelectElement)) {
                throw new Error("Task owner form controls not found");
              }
              title.value = ${JSON.stringify(ITEM_TITLE)};
              title.dispatchEvent(new Event("input", { bubbles: true }));
              select.selectedIndex = 1;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor('document.querySelector("#work-item-assignee")?.selectedIndex === 1', {
              label: "selected project Agent owner",
            });
          },
          assert: async () => {
            const options = await ctx.eval(`(() => {
              const select = document.querySelector("#work-item-assignee");
              if (!(select instanceof HTMLSelectElement)) return [];
              return [...select.options].slice(1).map((option) => ({ value: option.value, label: option.textContent?.trim() || "" }));
            })()`);
            ctx.assert(
              JSON.stringify(options.map((option) => option.label)) === JSON.stringify(projectAgentNames),
              "Expected task owner options to match the current project Agent configuration.",
            );
            await ctx.expectText("负责人");
            await ctx.expectText(projectAgentNames[0]);
          },
          screenshot: {
            name: "task-owner-project-agent",
            requireText: ["新建任务", "负责人", projectAgentNames[0]],
          },
        });
      },
    },
  ],
};
