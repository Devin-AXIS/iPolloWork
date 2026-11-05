const FIRST_REQUEST = "请制作一个极简网页，标题必须包含 QUEUE-FIRST-ARTIFACT。必须真实修改准备好的 HTML，并在最终回复中给出文件路径。";
const SECOND_REQUEST = "再制作一个独立网页，标题必须包含 QUEUE-SECOND-ARTIFACT。";
const VOICEOVER = "第一个网页尚未通过产物验收时，第二个需求保持排队；第一张成果卡片出现后，第二个需求才开始，并最终形成自己的成果卡片。";

async function ensureProject(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
    timeoutMs: 60_000,
    label: "iPolloWork control API",
  });
  await ctx.waitFor("!document.querySelector('[data-testid=startup-logo-animation]')", {
    timeoutMs: 120_000,
    label: "application startup",
  });
  await ctx.waitFor(`!/(正在安装相关资源|Installing related resources)/i.test(document.body.innerText)`, {
    timeoutMs: 300_000,
    label: "isolated runtime installation",
  });

  const projectCount = await ctx.eval("document.querySelectorAll('[data-testid=project-row]').length");
  if (projectCount > 0) {
    await ctx.eval("document.querySelector('[data-testid=project-row]')?.click()");
    return;
  }

  await ctx.eval("document.querySelector('[data-testid=new-project-button]')?.click()");
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=create-project-dialog]'))", {
    timeoutMs: 20_000,
    label: "create project dialog",
  });
  await ctx.fill("#create-project-name", "Fraimz queued artifact delivery");
  const created = await ctx.eval(`(() => {
    const dialog = document.querySelector('[data-testid=create-project-dialog]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((entry) => ['创建', 'Create'].includes(entry.textContent?.trim() ?? ''));
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(created, "Could not submit the create-project dialog.");
  await ctx.waitFor("!document.querySelector('[data-testid=create-project-dialog]') && location.hash.includes('/workspace/')", {
    timeoutMs: 120_000,
    label: "created OpenCode project",
  });
}

async function sendFirstRequest(ctx) {
  await ctx.waitFor("Boolean(document.querySelector('[contenteditable=\"true\"][data-lexical-editor=\"true\"]'))", {
    timeoutMs: 120_000,
    label: "first task composer",
  });
  const hasSessionComposer = await ctx.eval(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === 'composer.set_text' && !action.disabled)`);
  if (hasSessionComposer) {
    await ctx.control("composer.set_text", { text: FIRST_REQUEST });
    await ctx.control("composer.send");
  } else {
    await ctx.eval(`(() => {
      const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
      editor?.focus();
      return Boolean(editor);
    })()`);
    await ctx.client.send("Input.insertText", { text: FIRST_REQUEST });
    const submitted = await ctx.eval(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => /运行任务|Run task/i.test(entry.getAttribute('title') ?? '') && !entry.disabled);
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(submitted, "Could not submit the first task from the project starter.");
  }
  await ctx.waitFor("location.hash.includes('/session/')", {
    timeoutMs: 90_000,
    label: "active artifact session",
  });
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === 'composer.stop' && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "first artifact run active",
  });
}

async function queueSecondRequest(ctx) {
  await ctx.waitFor(`window.__ipolloworkControl.listActions()
    .some((action) => action.id === 'composer.set_text' && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "busy composer accepts a follow-up",
  });
  await ctx.control("composer.set_text", { text: SECOND_REQUEST });
  await ctx.eval(`(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return Boolean(editor);
  })()`);
  await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(SECOND_REQUEST)})`, {
    timeoutMs: 15_000,
    label: "second request visible in queue",
  });
}

export default {
  id: "queued-artifact-delivery",
  title: "Queued follow-ups wait for artifact delivery",
  kind: "user-facing",
  steps: [
    {
      name: "Queue a second artifact request behind the first",
      run: async (ctx) => {
        await ensureProject(ctx);
        await ctx.prove("A queued follow-up cannot overtake the active turn's artifact gate", {
          voiceover: VOICEOVER,
          action: async () => {
            await sendFirstRequest(ctx);
            await queueSecondRequest(ctx);
          },
          assert: async () => {
            await ctx.waitFor(`document.querySelectorAll('[data-message-role="assistant"] button[title="在 Design 中打开"], [data-message-role="assistant"] button[title="Open in Design"]').length >= 2`, {
              timeoutMs: 360_000,
              label: "two independent website result cards",
            });
            const transcript = await ctx.control("session.read_transcript", { count: 30 });
            const messages = transcript?.messages ?? [];
            const firstUser = messages.findIndex((message) => message.role === "user" && message.text.includes("QUEUE-FIRST-ARTIFACT"));
            const secondUser = messages.findIndex((message) => message.role === "user" && message.text.includes("QUEUE-SECOND-ARTIFACT"));
            const firstResult = messages.findIndex((message, index) => (
              index > firstUser
              && message.role === "assistant"
              && /design\/.+\/(?:entry|index)\.html/i.test(message.text)
            ));
            ctx.assert(firstUser >= 0, `First request is missing: ${JSON.stringify(messages)}`);
            ctx.assert(firstResult > firstUser, `First result is missing: ${JSON.stringify(messages)}`);
            ctx.assert(secondUser > firstResult, `Queued request overtook the first artifact result: ${JSON.stringify(messages)}`);
            const cardOwnership = await ctx.eval(`(() => {
              const users = [...document.querySelectorAll('[data-message-role="user"]')];
              const first = users.find((element) => element.textContent?.includes('QUEUE-FIRST-ARTIFACT'));
              const second = users.find((element) => element.textContent?.includes('QUEUE-SECOND-ARTIFACT'));
              const cards = [...document.querySelectorAll('[data-message-role="assistant"] button[title="在 Design 中打开"], [data-message-role="assistant"] button[title="Open in Design"]')];
              if (!first || !second) return { firstOwned: false, secondOwned: false, cardCount: cards.length };
              const follows = (left, right) => Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
              return {
                firstOwned: cards.some((card) => follows(first, card) && follows(card, second)),
                secondOwned: cards.some((card) => follows(second, card)),
                cardCount: cards.length,
              };
            })()`);
            ctx.assert(cardOwnership.firstOwned, `The first result card was not rendered inside the first request boundary: ${JSON.stringify(cardOwnership)}`);
            ctx.assert(cardOwnership.secondOwned, `The second result card was not rendered after the second request: ${JSON.stringify(cardOwnership)}`);
          },
          screenshot: {
            name: "queued-artifacts-complete-in-order",
            requireText: ["QUEUE-FIRST-ARTIFACT", "QUEUE-SECOND-ARTIFACT"],
            rejectText: ["Some requested outputs are still missing", "部分请求的输出仍然缺失"],
            hashIncludes: "/session/",
          },
        });
      },
    },
  ],
};
