import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("wechat-official-plugin");
const COMMENT_TOGGLE = '[role="switch"][aria-label="开关评论运营"]';

async function pluginButton(ctx, labels) {
  const found = await hasPluginButton(ctx, labels);
  if (!found) return false;
  await ctx.eval(`(() => {
    const labels = ${JSON.stringify(labels)};
    [...document.querySelectorAll('button')]
      .find((entry) => labels.includes(entry.textContent?.trim() ?? '') && entry.parentElement?.innerText?.includes('微信公众号'))
      ?.click();
  })()`);
  return true;
}

async function hasPluginButton(ctx, labels) {
  return ctx.eval(`(() => {
    const labels = ${JSON.stringify(labels)};
    return [...document.querySelectorAll('button')].some((entry) => {
      if (!labels.includes(entry.textContent?.trim() ?? '')) return false;
      return entry.parentElement?.innerText?.includes('微信公众号') ?? false;
    });
  })()`);
}

async function selectPersonalResourceScope(ctx) {
  await ctx.waitFor(`[...document.querySelectorAll('button')].some((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''))`, {
    timeoutMs: 30_000,
    label: "personal resource scope",
  });
  await ctx.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => ['个人', 'Personal'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
  })()`);
}

export default {
  id: "wechat-official-plugin",
  title: "Install and configure the WeChat Official Account plugin",
  kind: "user-facing",
  steps: [
    {
      name: "Find WeChat Official Account in the plugin catalog",
      run: async (ctx) => {
        await ctx.prove("WeChat Official Account appears as an official operating plugin in the catalog", {
          voiceover: vo[0],
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await selectPersonalResourceScope(ctx);
            await ctx.waitFor("document.body.innerText.includes('独立插件包')", {
              timeoutMs: 30_000,
              label: "plugin catalog loaded",
            });
            const alreadyInstalled = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll('button')].find((entry) => {
                if (!['授权连接', '打开'].includes(entry.textContent?.trim() ?? '')) return false;
                return entry.parentElement?.innerText?.includes('微信公众号') ?? false;
              });
              button?.click();
              return Boolean(button);
            })()`);
            if (alreadyInstalled) {
              await ctx.waitFor("location.hash.includes('/settings/extensions/plugin/wechat-official') && document.body.innerText.includes('卸载插件')", {
                timeoutMs: 30_000,
                label: "existing WeChat Official Account detail",
              });
              const canRemove = await ctx.eval("[...document.querySelectorAll('button')].some((entry) => entry.textContent?.trim() === '卸载插件')");
              ctx.assert(canRemove, "Could not find the prior WeChat Official Account uninstall action");
              await ctx.eval("[...document.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === '卸载插件')?.click()");
              await ctx.waitFor("location.hash.endsWith('/settings/extensions') && [...document.querySelectorAll('button')].some((entry) => entry.textContent?.trim() === '安装' && entry.parentElement?.innerText?.includes('微信公众号'))", {
                timeoutMs: 30_000,
                label: "WeChat Official Account returned to catalog",
              });
            }
            await ctx.waitFor("document.body.innerText.includes('微信公众号')", {
              timeoutMs: 30_000,
              label: "WeChat Official Account catalog item",
            });
          },
          assert: async () => {
            await ctx.expectText("微信公众号");
            await ctx.expectText("管理公众号图文、草稿、发布、评论、消息、粉丝、菜单与运营工作流。");
            await ctx.expectText("安装");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "wechat-official-catalog",
            requireText: ["独立插件包", "微信公众号", "管理公众号图文、草稿、发布、评论", "安装"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions",
          },
        });
      },
    },
    {
      name: "Install and open the WeChat Official Account detail",
      run: async (ctx) => {
        await ctx.prove("Installing WeChat Official Account opens one protected service with seven separate operating skills", {
          voiceover: vo[1],
          action: async () => {
            const installed = await pluginButton(ctx, ["安装"]);
            ctx.assert(installed, "Could not find the WeChat Official Account install action");
            await ctx.waitFor("[...document.querySelectorAll('button')].some((entry) => entry.textContent?.trim() === '授权连接' && entry.parentElement?.innerText?.includes('微信公众号'))", {
              timeoutMs: 45_000,
              label: "WeChat Official Account installed",
            });
            const opened = await pluginButton(ctx, ["授权连接"]);
            ctx.assert(opened, "Could not find the WeChat Official Account detail action");
            await ctx.waitFor("location.hash.includes('/settings/extensions/plugin/wechat-official') && document.body.innerText.includes('技能 7')", {
              timeoutMs: 30_000,
              label: "WeChat Official Account detail",
            });
          },
          assert: async () => {
            await ctx.expectText("应用 1");
            await ctx.expectText("技能 7");
            await ctx.expectText("公众号内容创作");
            await ctx.expectText("评论运营");
            await ctx.expectText("消息自动化");
            await ctx.expectText("粉丝与菜单运营");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "wechat-official-detail",
            requireText: ["微信公众号", "应用 1", "技能 7", "公众号内容创作", "评论运营"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/extensions/plugin/wechat-official",
          },
        });
      },
    },
    {
      name: "Disable only Comment Operations",
      run: async (ctx) => {
        await ctx.prove("An operator can turn off Comment Operations without removing publishing or other account workflows", {
          voiceover: vo[2],
          action: async () => {
            const toggled = await ctx.eval(`(() => {
              const toggle = document.querySelector(${JSON.stringify(COMMENT_TOGGLE)});
              toggle?.scrollIntoView({ block: 'center' });
              toggle?.click();
              return Boolean(toggle);
            })()`);
            ctx.assert(toggled, "Could not find the Comment Operations skill toggle");
            await ctx.waitFor(`document.querySelector(${JSON.stringify(COMMENT_TOGGLE)})?.getAttribute('aria-checked') === 'false'`, {
              timeoutMs: 30_000,
              label: "Comment Operations disabled",
            });
          },
          assert: async () => {
            const commentEnabled = await ctx.eval(`document.querySelector(${JSON.stringify(COMMENT_TOGGLE)})?.getAttribute('aria-checked')`);
            ctx.assert(commentEnabled === "false", `Expected Comment Operations off, received ${commentEnabled}`);
            await ctx.expectText("草稿与发布");
            await ctx.expectText("消息自动化");
          },
          screenshot: {
            name: "wechat-official-comments-disabled",
            requireText: ["技能 7", "评论运营", "草稿与发布", "消息自动化"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Inspect the protected account connection form",
      run: async (ctx) => {
        await ctx.prove("The connection action opens the shared authorization dialog, which keeps AppID and AppSecret inside Authorization Center and states the account requirement", {
          voiceover: vo[3],
          action: async () => {
            const opened = await ctx.eval(`(() => {
              const button = [...document.querySelectorAll('button')]
                .find((entry) => entry.textContent?.trim() === '配置授权');
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(opened, "Could not open the WeChat authorization dialog");
            const shown = await ctx.waitFor(`(() => {
              const field = document.querySelector('input[placeholder="wx…"]');
              field?.scrollIntoView({ block: 'center' });
              return Boolean(field);
            })()`, { timeoutMs: 30_000, label: "WeChat authorization dialog" });
            ctx.assert(shown, "Could not find the WeChat AppID field");
          },
          assert: async () => {
            await ctx.expectText("连接微信公众号");
            await ctx.expectText("AppID");
            await ctx.expectText("AppSecret");
            await ctx.expectText("加密授权仓库");
            await ctx.expectNoText("Something went wrong");
          },
          screenshot: {
            name: "wechat-official-authorization",
            requireText: ["连接微信公众号", "AppID", "AppSecret", "加密授权仓库"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
  ],
};
