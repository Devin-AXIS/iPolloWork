import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("enterprise-account-membership");
let observedExtensionResourceSwitch = false;

const selectButton = (pattern) => `(() => {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
    ${pattern}.test((candidate.textContent || "").trim())
  );
  if (!button) return false;
  button.click();
  return true;
})()`;

export default {
  id: "enterprise-account-membership",
  title: "Personal and Enterprise spaces keep separate chat histories and resource sources",
  kind: "user-facing",
  spec: "evals/voiceovers/enterprise-account-membership.md",
  steps: [
    {
      name: "Setup",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 30_000 });
        await ctx.navigateHash("/settings/cloud-account");
        await ctx.expectHashIncludes("/settings/cloud-account");
        await ctx.waitFor(
          `document.body.innerText.includes("工作身份") && document.body.innerText.includes("iPollo Enterprise")`,
          { timeoutMs: 30_000, label: "joined Enterprise account list" },
        );
        const active = await ctx.eval(`Boolean(localStorage.getItem("ipollowork.enterprise-active.v1"))`);
        if (!active) {
          const clicked = await ctx.eval(selectButton("/iPollo Enterprise/u"));
          ctx.assert(clicked === true, "Expected the saved Enterprise selector button.");
          await ctx.waitFor(`Boolean(localStorage.getItem("ipollowork.enterprise-active.v1"))`, {
            timeoutMs: 5_000,
            label: "Enterprise space active",
          });
        }
      },
    },
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The account page shows Personal and the joined Enterprise in one persistent space selector", {
          voiceover: vo[0],
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const connections = JSON.parse(localStorage.getItem("ipollowork.enterprise-connections.v1") || "[]");
              return {
                count: connections.length,
                active: localStorage.getItem("ipollowork.enterprise-active.v1"),
              };
            })()`);
            ctx.assert(state?.count > 0, "Expected at least one joined Enterprise connection.");
            ctx.assert(Boolean(state?.active), "Expected the joined Enterprise to be the active space.");
          },
          screenshot: {
            name: "enterprise-account-joined-list",
            requireText: ["工作身份", "个人", "iPollo Enterprise", "退出"],
            rejectText: ["Something went wrong", "加入码无效"],
            hashIncludes: "/settings/cloud-account",
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("Selecting Personal restores only Personal chat history", {
          voiceover: vo[1],
          action: async () => {
            const clicked = await ctx.eval(selectButton("/^个人(?:个人聊天|会员|$)/u"));
            ctx.assert(clicked === true, "Expected the Personal selector button.");
            await ctx.waitFor(`!localStorage.getItem("ipollowork.enterprise-active.v1")`, {
              timeoutMs: 5_000,
              label: "Personal space active",
            });
            const returnedFromSettings = await ctx.eval(selectButton("/^返回应用$/u"));
            ctx.assert(returnedFromSettings === true, "Expected the Return to app button.");
            await ctx.waitFor(`location.hash.includes("/session")`, {
              timeoutMs: 5_000,
              label: "Personal chat route",
            });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const assignments = JSON.parse(localStorage.getItem("ipollowork.session-chat-space.v1") || "{}");
              const enterpriseIds = new Set(Object.values(assignments).flatMap((workspace) =>
                Object.entries(workspace).filter(([, space]) => String(space).startsWith("enterprise:")).map(([id]) => id)
              ));
              const visible = Array.from(document.querySelectorAll('a[href*="/session/"]'))
                .map((link) => link.getAttribute("href") || "")
                .map((href) => href.split("/session/")[1]?.split(/[?#/]/u)[0] || "")
                .filter(Boolean);
              return {
                connectionCount: JSON.parse(localStorage.getItem("ipollowork.enterprise-connections.v1") || "[]").length,
                visible,
                enterpriseIds: Array.from(enterpriseIds),
              };
            })()`);
            ctx.assert(state?.connectionCount > 0, "Switching to Personal must not remove Enterprise membership.");
            ctx.assert(
              state.visible.every((id) => !state.enterpriseIds.includes(id)),
              "Personal must not render an Enterprise chat in the sidebar.",
            );
          },
          screenshot: {
            name: "enterprise-chat-personal-history",
            requireText: ["新建对话"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("Selecting the joined Enterprise restores only that Enterprise chat history", {
          voiceover: vo[2],
          action: async () => {
            await ctx.navigateHash("/settings/cloud-account");
            await ctx.waitFor(`document.body.innerText.includes("工作身份")`, {
              timeoutMs: 5_000,
              label: "account space selector",
            });
            const clicked = await ctx.eval(selectButton("/iPollo Enterprise/u"));
            ctx.assert(clicked === true, "Expected the joined Enterprise selector button.");
            await ctx.waitFor(`Boolean(localStorage.getItem("ipollowork.enterprise-active.v1"))`, {
              timeoutMs: 5_000,
              label: "Enterprise space active",
            });
            const returned = await ctx.eval(selectButton("/^返回应用$/u"));
            ctx.assert(returned === true, "Expected the Return to app button.");
            await ctx.waitFor(`location.hash.includes("/session")`, {
              timeoutMs: 5_000,
              label: "Enterprise chat route",
            });
            await ctx.navigateHash("/settings/extensions");
            await ctx.expectHashIncludes("/settings/extensions");
            await ctx.waitFor(
              `document.body.innerText.includes("资源来源") && document.body.innerText.includes("个人") && document.body.innerText.includes("Enterprise")`,
              { timeoutMs: 5_000, label: "Enterprise extension resource switch" },
            );
            observedExtensionResourceSwitch = true;
            const returnedFromExtensions = await ctx.eval(selectButton("/^返回应用$/u"));
            ctx.assert(returnedFromExtensions === true, "Expected the Return to app button.");
            await ctx.waitFor(`location.hash.includes("/session")`, {
              timeoutMs: 5_000,
              label: "Enterprise chat route before Templates",
            });
            const templates = await ctx.eval(selectButton("/^模版$/u"));
            ctx.assert(templates === true, "Expected the Templates button.");
            await ctx.waitFor(
              `Boolean(document.querySelector('[role="dialog"]')) && document.body.innerText.includes("资源来源") && document.body.innerText.includes("个人") && document.body.innerText.includes("Enterprise")`,
              { timeoutMs: 5_000, label: "Enterprise template resource switch" },
            );
            await ctx.waitFor(
              `!document.querySelector('[data-testid="template-catalog-loading"]')`,
              { timeoutMs: 10_000, label: "Enterprise template catalog settled" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const active = localStorage.getItem("ipollowork.enterprise-active.v1") || "";
              const expectedSpace = "enterprise:" + active;
              const assignments = JSON.parse(localStorage.getItem("ipollowork.session-chat-space.v1") || "{}");
              const assignedIds = new Set(Object.values(assignments).flatMap((workspace) =>
                Object.entries(workspace).filter(([, space]) => space === expectedSpace).map(([id]) => id)
              ));
              const visible = Array.from(document.querySelectorAll('a[href*="/session/"]'))
                .map((link) => link.getAttribute("href") || "")
                .map((href) => href.split("/session/")[1]?.split(/[?#/]/u)[0] || "")
                .filter(Boolean);
              return { visible, assignedIds: Array.from(assignedIds) };
            })()`);
            ctx.assert(
              state.visible.every((id) => state.assignedIds.includes(id)),
              "Enterprise must render only chats assigned to the active Enterprise.",
            );
            ctx.assert(observedExtensionResourceSwitch, "Expected Extensions to expose the Enterprise resource switch.");
            await ctx.expectText("资源来源");
            await ctx.expectText("个人");
            await ctx.expectText("Enterprise");
          },
          screenshot: {
            name: "enterprise-template-resource-source",
            requireText: ["模版", "资源来源", "个人", "Enterprise"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Leaving an Enterprise requires explicit confirmation of the server-side membership removal", {
          voiceover: vo[3],
          action: async () => {
            await ctx.navigateHash("/settings/cloud-account");
            await ctx.waitFor(`document.body.innerText.includes("工作身份")`, {
              timeoutMs: 5_000,
              label: "account space selector",
            });
            const clicked = await ctx.eval(selectButton("/^退出$/u"));
            ctx.assert(clicked === true, "Expected the Enterprise Leave button.");
            await ctx.waitFor(`document.body.innerText.includes("退出企业")`, {
              timeoutMs: 5_000,
              label: "Enterprise leave confirmation",
            });
          },
          assert: async () => {
            await ctx.expectText("这会移除你在该企业服务器上的成员关系");
          },
          screenshot: {
            name: "enterprise-account-leave-confirmation",
            requireText: ["退出企业", "移除你在该企业服务器上的成员关系", "取消", "退出"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Cleanup",
      run: async (ctx) => {
        const cancel = await ctx.eval(selectButton("/^取消$/u"));
        ctx.assert(cancel === true, "Expected the Leave confirmation cancel button.");
      },
    },
  ],
};
