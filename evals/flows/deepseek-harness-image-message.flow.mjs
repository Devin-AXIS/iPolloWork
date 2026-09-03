import { fileURLToPath } from "node:url";

const IMAGE_FIXTURE = fileURLToPath(
  new URL("../../packages/docs/images/ipollowork-providers.png", import.meta.url),
);
const PROMPT = "DSH_IMAGE_MESSAGE_825：请描述这张图片。";
const VOICEOVER = "我只发送一次带图消息，页面立即显示唯一的一条消息和完整图片预览。";

async function chooseComposerImage(ctx) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"][multiple]',
  });
  ctx.assert(Boolean(nodeId), "The conversation attachment input was not found.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [IMAGE_FIXTURE] });
}

export default {
  id: "deepseek-harness-image-message",
  title: "DeepSeek Harness shows one user message with its uploaded image",
  kind: "user-facing",
  steps: [
    {
      name: "Send one image message through DeepSeek Harness",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 60_000,
          label: "window.__ipolloworkControl",
        });
        await ctx.prove("One DSH image send produces one visible user message with the image", {
          voiceover: VOICEOVER,
          action: async () => {
            await ctx.eval(`(async () => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              const project = Array.from(document.querySelectorAll('button, a'))
                .find((element) => element.textContent?.trim().toLowerCase() === 'dsh');
              project?.click();
              return Boolean(project);
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('[aria-label^="DeepSeek Harness"]'))
              && window.__ipolloworkControl.listActions()
                .some((action) => action.id === 'session.create_task' && !action.disabled)`, {
              timeoutMs: 45_000,
              label: "ready DeepSeek Harness project",
            });
            await ctx.control("session.create_task");
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
              label: "image-capable GPT-5.5 model",
            });
            await ctx.eval(`(() => {
              const model = Array.from(document.querySelectorAll('[data-slot="command-item"]'))
                .find((item) => item.textContent?.includes('GPT-5.5')
                  && !item.textContent?.includes('Fast')
                  && !item.hasAttribute('data-disabled'));
              model?.click();
              return Boolean(model);
            })()`);
            await ctx.waitFor(`Boolean(document.querySelector('input[type="file"][multiple]'))
              && Array.from(document.querySelectorAll('button'))
                .some((button) => /切换模型|Change model/.test(button.getAttribute('aria-label') ?? '')
                  && button.textContent?.includes('GPT-5.5'))`, {
              timeoutMs: 30_000,
              label: "stable image-capable composer",
            });

            await chooseComposerImage(ctx);
            await ctx.waitFor(`Array.from(document.querySelectorAll('img'))
              .some((image) => image.getAttribute('alt') === 'ipollowork-providers.png'
                && image.complete && image.naturalWidth > 0)`, {
              timeoutMs: 15_000,
              label: "composer image preview",
            });
            await ctx.control("composer.set_text", { text: PROMPT });
            await ctx.waitFor(`window.__ipolloworkControl.listActions()
              .some((action) => action.id === 'composer.send' && !action.disabled)`, {
              timeoutMs: 15_000,
              label: "enabled DSH send action",
            });
            await ctx.control("composer.send");
          },
          assert: async () => {
            await ctx.waitFor(`(() => {
              const messages = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.includes(${JSON.stringify(PROMPT)}));
              if (messages.length !== 1) return false;
              const image = messages[0].querySelector('img');
              return Boolean(image?.complete && image.naturalWidth > 0
                && image.getAttribute('src')?.startsWith('data:image/'));
            })()`, {
              timeoutMs: 60_000,
              label: "single rendered DSH image message",
            });
            const state = await ctx.eval(`(() => {
              const messages = Array.from(document.querySelectorAll('[data-message-role="user"]'))
                .filter((message) => message.textContent?.includes(${JSON.stringify(PROMPT)}));
              const image = messages[0]?.querySelector('img');
              return {
                count: messages.length,
                imageLoaded: Boolean(image?.complete && image.naturalWidth > 0),
                imageSource: image?.getAttribute('src')?.slice(0, 30) ?? null,
                hasAttachmentPlaceholder: messages.some((message) => /\[attachment\]|\[Image attachment\]/i.test(message.textContent ?? '')),
              };
            })()`);
            ctx.assert(state.count === 1, `Expected one user message, got ${JSON.stringify(state)}.`);
            ctx.assert(state.imageLoaded, `Expected a loaded message image, got ${JSON.stringify(state)}.`);
            ctx.assert(!state.hasAttachmentPlaceholder, `Attachment placeholder leaked into the message: ${JSON.stringify(state)}.`);
          },
          screenshot: {
            name: "deepseek-harness-single-image-message",
            requireText: [PROMPT],
            rejectText: ["[attachment]", "[Image attachment]"],
          },
        });
      },
    },
  ],
};
