/**
 * Standard-lane proof: an explicit account provider disconnect persists and
 * removes that provider from every engine's model directory.
 */

const ENGINES = [
  { project: "opencode", label: "OpenCode" },
  { project: "codex", label: "Codex Harness" },
  { project: "dsh", label: "DeepSeek Harness" },
];

async function openEngineModelDirectory(ctx, engine) {
  await ctx.eval(`(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const back = Array.from(document.querySelectorAll("button, a"))
      .find((element) => element.textContent?.trim() === "返回应用");
    back?.click();
    return Boolean(back);
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll("button, a"))
    .some((element) => element.textContent?.trim().toLowerCase() === ${JSON.stringify(engine.project)})`, {
    timeoutMs: 30_000,
    label: `${engine.project} project entry`,
  });
  await ctx.eval(`(() => {
    const project = Array.from(document.querySelectorAll("button, a"))
      .find((element) => element.textContent?.trim().toLowerCase() === ${JSON.stringify(engine.project)});
    project?.click();
    return Boolean(project);
  })()`);
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(`[aria-label^="${engine.label}"]`)}))
    && Array.from(document.querySelectorAll("button"))
      .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
    timeoutMs: 30_000,
    label: `${engine.label} composer`,
  });
  await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  await ctx.eval(`(() => {
    const candidates = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    candidates.at(-1)?.click();
    return candidates.length > 0;
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
    .some((element) => element.innerText.includes("切换模型"))`, {
    timeoutMs: 20_000,
    label: `${engine.label} model directory`,
  });
}

async function assertOpenAiAbsentFromPicker(ctx, engineLabel) {
  const state = await ctx.eval(`(() => {
    const directories = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
      .filter((element) => element.innerText.includes("切换模型"));
    const text = directories.at(-1)?.innerText ?? "";
    return { text, hasOpenAI: /(^|\\n)OpenAI($|\\n)/.test(text) };
  })()`);
  ctx.assert(state.text.length > 0, `${engineLabel} model directory did not render.`);
  ctx.assert(!state.hasOpenAI, `OpenAI is still visible in the ${engineLabel} model directory.`);
}

export default {
  id: "provider-disconnect-across-engines",
  title: "Disconnecting one provider removes it from every agent engine",
  kind: "user-facing",
  steps: [
    {
      name: "Disconnect OpenAI and revisit provider settings",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("OpenAI stays disconnected after leaving and reopening provider settings", {
          voiceover: "在 AI 提供商页面断开 OpenAI 后，重新进入这个页面也不会恢复这条连接；用户的明确选择会覆盖本机仍然有效的官方登录。",
          action: async () => {
            await ctx.eval(`(() => {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              return true;
            })()`);
            await ctx.waitFor(`!document.querySelector('[role="alertdialog"]')`, {
              timeoutMs: 10_000,
              label: "stale disconnect confirmation to close",
            });
            await ctx.navigateHash("/settings/preferences");
            await ctx.waitFor("location.hash.includes('/settings/preferences')", {
              timeoutMs: 20_000,
              label: "stable settings route before provider disconnect",
            });
            await ctx.navigateHash("/settings/ai");
            await ctx.waitForText("AI 提供商", { timeoutMs: 30_000 });
            await ctx.waitFor(`!document.body.innerText.includes("正在加载提供商")`, {
              timeoutMs: 30_000,
              label: "provider refresh to finish after reopening settings",
            });
            const hasOpenAIConnection = await ctx.eval(`Array.from(document.querySelectorAll("button"))
              .some((candidate) => candidate.textContent?.trim() === "断开连接"
                && candidate.parentElement?.innerText.includes("OpenAI"))`);
            if (hasOpenAIConnection) {
              await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
                .some((candidate) => candidate.textContent?.trim() === "断开连接"
                  && candidate.parentElement?.innerText.includes("OpenAI")
                  && !candidate.disabled)`, {
                timeoutMs: 30_000,
                label: "enabled OpenAI disconnect button",
              });
            }
            const clickedDisconnect = hasOpenAIConnection && await ctx.eval(`(() => {
                const button = Array.from(document.querySelectorAll("button"))
                  .find((candidate) => candidate.textContent?.trim() === "断开连接"
                    && candidate.parentElement?.innerText.includes("OpenAI")
                    && !candidate.disabled);
                button?.click();
                return Boolean(button);
              })()`);
            if (clickedDisconnect) {
              await ctx.waitFor(`Boolean(document.querySelector('[role="alertdialog"]'))`, {
                timeoutMs: 10_000,
                label: "OpenAI disconnect confirmation",
              });
              await ctx.eval(`(() => {
                const dialog = document.querySelector('[role="alertdialog"]');
                const confirm = Array.from(dialog?.querySelectorAll("button") ?? [])
                  .find((button) => button.textContent?.trim() === "断开连接");
                confirm?.click();
                return Boolean(confirm);
              })()`);
              await ctx.waitFor(`!Array.from(document.querySelectorAll("span"))
                .some((element) => element.textContent?.trim() === "OpenAI")`, {
                timeoutMs: 30_000,
                label: "OpenAI connected row to disappear",
              });
            }
            await ctx.navigateHash("/settings/preferences");
            await ctx.waitFor("location.hash.includes('/settings/preferences')", {
              timeoutMs: 20_000,
              label: "leave AI provider settings",
            });
            await ctx.navigateHash("/settings/ai");
            await ctx.waitForText("AI 提供商", { timeoutMs: 30_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              hasOpenAIRow: Array.from(document.querySelectorAll("span"))
                .some((element) => element.textContent?.trim() === "OpenAI"),
              hasProviderPage: document.body.innerText.includes("AI 提供商"),
            }))()`);
            ctx.assert(state.hasProviderPage, "The AI provider page did not reopen.");
            ctx.assert(!state.hasOpenAIRow, "OpenAI reappeared after reopening provider settings.");
          },
          screenshot: {
            name: "openai-disconnect-persists",
            requireText: ["AI 提供商", "iPolloWork Built-in Models"],
            rejectText: ["OpenAI"],
            hashIncludes: "/settings/ai",
          },
        });
      },
    },
    ...ENGINES.map((engine) => ({
      name: `${engine.label} hides explicitly disconnected OpenAI models`,
      run: async (ctx) => {
        await ctx.prove(`${engine.label} no longer offers OpenAI models`, {
          voiceover: `切换到 ${engine.label} 后，模型列表也不再出现 OpenAI。一次断开会同步作用于全部 Agent 引擎。`,
          action: async () => {
            await openEngineModelDirectory(ctx, engine);
          },
          assert: async () => {
            await assertOpenAiAbsentFromPicker(ctx, engine.label);
          },
          screenshot: {
            name: `${engine.project}-hides-disconnected-openai`,
            requireText: ["切换模型"],
            rejectText: ["OpenAI"],
          },
        });
      },
    })),
  ],
};
