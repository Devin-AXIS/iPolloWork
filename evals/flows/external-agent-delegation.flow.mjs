import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("external-agent-delegation");

async function markButton(ctx, attribute, predicate) {
  const marked = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find(${predicate});
    if (!button || button.disabled) return false;
    button.setAttribute(${JSON.stringify(attribute)}, "true");
    return true;
  })()`);
  ctx.assert(marked, `Could not find button for ${attribute}.`);
}

export default {
  id: "external-agent-delegation",
  title: "Execute and Plan are modes; installed external agents delegate from the plus menu",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
      timeoutMs: 30_000,
      label: "control API",
    });
    await ctx.waitFor(
      `Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`,
      { timeoutMs: 30_000, label: "composer" },
    );
    const busy = await ctx.eval(`[...document.querySelectorAll("button")].some((button) => button.title === "停止" || button.title === "Stop")`);
    return busy ? "The active session is currently running; delegation proof needs an idle composer." : null;
  },
  steps: [
    {
      name: "Work modes sit beside the model",
      run: async (ctx) => {
        await ctx.prove("Execute and Plan are presented as work modes beside the model", {
          voiceover: vo[0],
          action: async () => {
            await ctx.control("composer.set_text", { text: "" });
            await ctx.waitFor(
              `document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')?.innerText.trim() === ""`,
              { label: "empty composer" },
            );
            await markButton(
              ctx,
              "data-eval-work-mode-trigger",
              `(button) => /Work mode|工作模式/.test(button.getAttribute("aria-label") ?? "")`,
            );
            await ctx.trustedClick('button[data-eval-work-mode-trigger="true"]');
            await ctx.trustedClick('button[data-work-mode-option="plan"]');
            await ctx.waitFor(
              `/Plan|计划/.test(document.querySelector('button[data-eval-work-mode-trigger="true"]')?.getAttribute("aria-label") ?? "")`,
              { label: "Plan mode selected" },
            );
            await ctx.trustedClick('button[data-eval-work-mode-trigger="true"]');
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const buttons = document.querySelectorAll('button[data-work-mode-option]');
              return {
                labels: [...buttons].map((button) => button.textContent?.trim()),
                planPressed: document.querySelector('button[data-work-mode-option="plan"]')?.getAttribute("aria-pressed"),
              };
            })()`);
            ctx.assert(state.labels.length === 2, "Expected exactly two work modes.");
            ctx.assert(state.planPressed === "true", "Plan mode did not become active.");
          },
          screenshot: {
            name: "work-modes",
            requireText: ["执行", "计划"],
          },
        });
      },
    },
    {
      name: "Plus menu discovers installed external agents",
      run: async (ctx) => {
        await ctx.prove("The plus menu exposes installed external agents through delegation", {
          voiceover: vo[1],
          action: async () => {
            await markButton(
              ctx,
              "data-eval-plus",
              `(button) => /Add to this task|添加到任务/.test(button.title)`,
            );
            await ctx.trustedClick('button[data-eval-plus="true"]');
            await markButton(
              ctx,
              "data-eval-delegation",
              `(button) => /Delegate external agent|委派外部智能体/.test(button.textContent?.trim() ?? "")`,
            );
            await ctx.trustedClick('button[data-eval-delegation="true"]');
            await ctx.waitForText("DeepSeek Harness", { timeoutMs: 15_000 });
          },
          assert: async () => {
            await ctx.expectText("DeepSeek Harness");
            const visible = await ctx.eval(`document.body.innerText.includes("DeepSeek Harness")`);
            ctx.assert(visible, "DeepSeek Harness was not listed for delegation.");
          },
          screenshot: {
            name: "external-agent-menu",
            requireText: ["DeepSeek Harness"],
          },
        });
      },
    },
    {
      name: "Choosing DSH prepares the delegation draft",
      run: async (ctx) => {
        await ctx.prove("Selecting DeepSeek Harness prepares a delegation prompt and returns to Execute", {
          voiceover: vo[2],
          action: async () => {
            await markButton(
              ctx,
              "data-eval-dsh",
              `(button) => button.textContent?.includes("DeepSeek Harness") === true`,
            );
            await ctx.trustedClick('button[data-eval-dsh="true"]');
            await ctx.waitFor(
              `document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')?.innerText.includes("DeepSeek Harness") === true`,
              { label: "DSH delegation prompt" },
            );
            await markButton(
              ctx,
              "data-eval-work-mode-trigger",
              `(button) => /Work mode|工作模式/.test(button.getAttribute("aria-label") ?? "")`,
            );
            await ctx.trustedClick('button[data-eval-work-mode-trigger="true"]');
            await ctx.trustedClick('button[data-work-mode-option="execute"]');
            await ctx.waitFor(
              `!document.querySelector('button[data-work-mode-option]')`,
              { label: "work mode menu closed" },
            );
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              draft: document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')?.innerText ?? "",
              workModeLabel: document.querySelector('button[data-eval-work-mode-trigger="true"]')?.getAttribute("aria-label") ?? "",
              delegationMenuOpen: Boolean(document.querySelector('button[data-eval-dsh="true"]')),
              workModeMenuOpen: Boolean(document.querySelector('button[data-work-mode-option]')),
            }))()`);
            ctx.assert(state.draft.includes("DeepSeek Harness"), "Delegation prompt was not inserted.");
            ctx.assert(/Execute|执行/.test(state.workModeLabel), "Execute mode was not restored.");
            ctx.assert(!state.delegationMenuOpen, "Delegation menu remained open after selection.");
            ctx.assert(!state.workModeMenuOpen, "Work mode menu remained open after selection.");
          },
          screenshot: {
            name: "delegation-draft",
            requireText: ["DeepSeek Harness", "执行"],
          },
        });
      },
    },
  ],
};
