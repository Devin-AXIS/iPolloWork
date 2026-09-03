const EXPECTED_MODELS = [
  "Big Pickle",
  "Hy3 Free",
  "MiMo-V2.5 Free",
  "Nemotron 3 Ultra Free",
  "Nemotron 3.5 Lightning Free",
  "Ox Alpha Free",
];

const REMOVED_MODELS = [
  "DeepSeek V4 Flash Free",
  "Laguna S 2.1 Free",
  "Ling-3.0-flash Free",
  "Muse Spark 1.2 Contributor Free",
  "North Mini Code Free",
  "GPT-4 Turbo",
  "GPT-4.1",
  "GPT-4.1 mini",
  "GPT-4.1 nano",
];

async function openCompactModelDirectory(ctx) {
  await ctx.eval(`(() => {
    const style = document.getElementById("fraimz-disable-motion") ?? document.createElement("style");
    style.id = "fraimz-disable-motion";
    style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
    if (!style.isConnected) document.head.append(style);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return true;
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll("button"))
    .some((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""))`, {
    timeoutMs: 30_000,
    label: "compact Composer model trigger",
  });
  await ctx.eval(`(() => {
    const trigger = Array.from(document.querySelectorAll("button"))
      .find((button) => /切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
  await ctx.eval(`(() => {
    const rows = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("切换模型")
        && !/切换模型|Change model/.test(button.getAttribute("aria-label") ?? ""));
    rows.at(-1)?.click();
    return rows.length > 0;
  })()`);
  await ctx.waitFor(`Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
    .some((element) => element.innerText.includes("切换模型")
      && element.innerText.includes("Ox Alpha Free"))`, {
    timeoutMs: 30_000,
    label: "compact OpenCode Zen model directory",
  });
}

export default {
  id: "opencode-zen-compact-picker",
  title: "Compact Composer picker shows the complete OpenCode Zen free roster",
  kind: "user-facing",
  steps: [
    {
      name: "The compact model directory includes the working Ox model",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("The compact model directory shows all six supported OpenCode Zen models", {
          voiceover: "切换模型列表现在包含 Ox Alpha Free，并与其他引擎使用同一份六模型名录。",
          action: async () => {
            await openCompactModelDirectory(ctx);
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const dialogs = Array.from(document.querySelectorAll('[role="dialog"][data-slot="popover-content"]'))
                .filter((element) => element.innerText.includes("切换模型"));
              const dialog = dialogs.at(-1);
              const text = dialog?.innerText ?? "";
              const groups = dialog
                ? Array.from(dialog.querySelectorAll('[data-slot="command-group"]'))
                : [];
              const openCodeGroup = groups.find((group) =>
                group.querySelector('[data-slot="command-group-label"]')?.textContent?.trim() === "OpenCode Zen");
              const items = openCodeGroup
                ? Array.from(openCodeGroup.querySelectorAll('[data-slot="command-item"]'))
                    .map((item) => item.textContent?.trim() ?? "")
                : [];
              const lastExpectedModel = openCodeGroup
                ? Array.from(openCodeGroup.querySelectorAll('[data-slot="command-item"]'))
                    .find((item) => item.textContent?.includes("Ox Alpha Free"))
                : undefined;
              lastExpectedModel?.scrollIntoView({ block: "center" });
              const footerVisible = dialog
                ? Array.from(dialog.querySelectorAll("button"))
                    .some((button) => button.textContent?.includes("配置模型"))
                : false;
              return { text, items, footerVisible };
            })()`);
            ctx.assert(state.items.length === EXPECTED_MODELS.length,
              `Expected ${EXPECTED_MODELS.length} OpenCode Zen rows, found ${state.items.length}.`);
            for (const model of EXPECTED_MODELS) {
              ctx.assert(state.items.some((item) => item.includes(model)), `Missing ${model}.`);
            }
            for (const model of REMOVED_MODELS) {
              ctx.assert(!state.items.some((item) => item.includes(model)),
                `Removed model is still visible in OpenCode Zen: ${model}.`);
            }
            ctx.assert(state.footerVisible, "The configure-model footer is still clipped.");
            await ctx.waitFor(`(() => {
              const model = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .find((item) => item.textContent?.includes("Ox Alpha Free"));
              if (!model) return false;
              const rect = model.getBoundingClientRect();
              return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
            })()`, { timeoutMs: 10_000, label: "visible final OpenCode Zen row" });
          },
          screenshot: {
            name: "compact-opencode-zen-six-supported-models",
            fromSurface: true,
            requireText: ["切换模型", "OpenCode Zen", "Ox Alpha Free", "配置模型"],
            rejectText: REMOVED_MODELS,
          },
        });
      },
    },
  ],
};
