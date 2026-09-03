const RESPONSE_TOKEN = "DSH_GPT_OK_825";
const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"]';

export default {
  id: "deepseek-harness-openai-response",
  title: "DeepSeek Harness sends a real GPT request with the shared OpenAI credential",
  kind: "user-facing",
  steps: [
    {
      name: "Send a GPT-5.5 message through DeepSeek Harness",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("The first DeepSeek Harness reply is retained in task history", {
          voiceover: "首次在 DeepSeek Harness 项目中发送消息后，回复正常显示，而且同一任务会立即保留在左侧历史中。",
          action: async () => {
            const workspaceId = await ctx.eval(`(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              const project = Array.from(document.querySelectorAll('[data-testid="project-row"][data-project-id]'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'dsh');
              project?.click();
              return project?.getAttribute('data-project-id') ?? null;
            })()`, { awaitPromise: true });
            ctx.assert(Boolean(workspaceId), "Could not find the DeepSeek Harness project.");
            await ctx.waitFor(`Boolean(document.querySelector(
              ${JSON.stringify(`[data-testid="project-new-conversation-button"][data-project-id="${workspaceId}"]`)},
            ))`, {
              timeoutMs: 10_000,
              label: "DeepSeek Harness new task button",
            });
            const openedDeepSeekTask = await ctx.eval(`(() => {
              const button = document.querySelector(
                '[data-testid="project-new-conversation-button"][data-project-id="${workspaceId}"]',
              );
              button?.click();
              return Boolean(button);
            })()`);
            ctx.assert(openedDeepSeekTask, "Could not open a DeepSeek Harness task.");
            await ctx.waitFor(`location.hash.includes(${JSON.stringify(`/workspace/${workspaceId}/session`)})`, {
              timeoutMs: 45_000,
              label: "DeepSeek Harness workspace route",
            });
            await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`, {
              timeoutMs: 45_000,
              label: "ready DeepSeek Harness composer",
            });
            await ctx.waitFor(`Array.from(document.querySelectorAll('button'))
              .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''))`, {
              timeoutMs: 30_000,
              label: "DeepSeek Harness model trigger",
            });
            await ctx.eval(`(() => {
              const trigger = Array.from(document.querySelectorAll('button'))
                .find((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              trigger?.click();
              return Boolean(trigger);
            })()`);
            await ctx.waitForText("切换模型", { timeoutMs: 10_000 });
            await ctx.eval(`(() => {
              const candidates = Array.from(document.querySelectorAll('button'))
                .filter((button) => button.textContent?.includes('切换模型')
                  && !/切换模型|Change model/.test(button.getAttribute('aria-label') ?? ''));
              candidates.at(-1)?.click();
              return candidates.length > 0;
            })()`);
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-slot="command-item"]'))
              .some((item) => item.textContent?.includes('GPT-5.5')
                && !item.textContent?.includes('Fast')
                && !item.hasAttribute('data-disabled'))`, {
              timeoutMs: 30_000,
              label: "enabled GPT-5.5 model",
            });
            await ctx.eval(`(() => {
              sessionStorage.setItem('fraimz-dsh-model-selected-at', String(Date.now()));
              const model = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .find((item) => item.textContent?.includes('GPT-5.5')
                  && !item.textContent?.includes('Fast')
                  && !item.hasAttribute('data-disabled'));
              model?.click();
              return Boolean(model);
            })()`);
            await ctx.waitFor(`Date.now() - Number(sessionStorage.getItem('fraimz-dsh-model-selected-at')) > 1500
              && Boolean(window.__ipolloworkControl)
              && !document.body.innerText.includes('Loading...')
              && Boolean(document.querySelector('[contenteditable="true"]'))
              && Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
                  && button.textContent?.includes('GPT-5.5'))`, {
              timeoutMs: 30_000,
              label: "stable GPT-5.5 composer",
            });
            const prompt = `只回复 ${RESPONSE_TOKEN}，不要添加其他内容。`;
            await ctx.eval(`(() => {
              const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
              editor?.focus();
              return document.activeElement === editor;
            })()`);
            await ctx.client.send("Input.insertText", { text: prompt });
            await ctx.waitFor(`document.querySelector(${JSON.stringify(EDITOR_SELECTOR)})
              ?.innerText.includes(${JSON.stringify(RESPONSE_TOKEN)})`, {
              timeoutMs: 10_000,
              label: "DeepSeek Harness initial prompt",
            });
            const submitted = await ctx.eval(`(() => {
              const submit = Array.from(document.querySelectorAll('button'))
                .find((button) => /运行任务|Run task/i.test(button.getAttribute('title') ?? '')
                  && !button.disabled)
                || Array.from(document.querySelectorAll('button'))
                  .find((button) => button.querySelector('svg[class*="arrow-up"]')
                    && !button.disabled);
              submit?.click();
              return Boolean(submit);
            })()`);
            ctx.assert(submitted, "Could not submit the DeepSeek Harness message.");
          },
          assert: async () => {
            await ctx.waitFor(`Array.from(document.querySelectorAll('[data-message-role="assistant"]'))
              .some((message) => message.innerText.includes(${JSON.stringify(RESPONSE_TOKEN)}))`, {
              timeoutMs: 120_000,
              label: "assistant GPT response token",
            });
            const transcript = await ctx.control("session.read_transcript", { count: 20 });
            const assistantReply = (transcript?.messages ?? []).findLast((message) => (
              message.role === "assistant" && message.text.includes(RESPONSE_TOKEN)
            ));
            ctx.assert(Boolean(assistantReply), `GPT response is missing from the transcript: ${JSON.stringify(transcript)}`);
            await ctx.waitFor(`(() => {
              const actions = window.__ipolloworkControl.listActions();
              return actions.some((action) => action.id === 'composer.stop' && action.disabled);
            })()`, {
              timeoutMs: 30_000,
              label: "completed DeepSeek Harness turn",
            });
            const sessions = await ctx.control("session.list_sessions");
            const historyItem = sessions.find((session) => (
              session.sessionId === transcript.sessionId
              && session.workspace.toLowerCase() === "dsh"
            ));
            ctx.assert(Boolean(historyItem), `The completed DSH task is missing from sidebar history: ${JSON.stringify(sessions)}`);
            await ctx.eval(`(() => {
              const project = Array.from(document.querySelectorAll('[data-testid="project-row"][data-project-id]'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'dsh');
              if (project?.getAttribute('aria-expanded') !== 'true') project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`(() => {
              const project = Array.from(document.querySelectorAll('[data-testid="project-row"][data-project-id]'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'dsh');
              const group = project?.closest('[data-slot="sidebar-group"]');
              return project?.getAttribute('aria-expanded') === 'true'
                && Array.from(group?.querySelectorAll('span[title]') ?? [])
                  .some((item) => item.getAttribute('title')?.includes(${JSON.stringify(RESPONSE_TOKEN)}));
            })()`, {
              timeoutMs: 10_000,
              label: "completed DSH task in expanded sidebar history",
            });
            await ctx.expectNoText("Provider is not configured");
          },
          screenshot: {
            name: "deepseek-harness-gpt-response",
            requireText: [RESPONSE_TOKEN, "GPT-5.5"],
            rejectText: ["Provider is not configured"],
          },
        });
      },
    },
  ],
};
