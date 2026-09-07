const IMAGE_STUDIO_TITLE = "图片工作台";
const PROMPT = "生成一张后裔射日的图片";
const VOICEOVER = "我在图片参数中输入生成指令并点击生成，现在会直接看到模型服务返回的可处理结果，不再是笼统的服务器错误。";

export default {
  id: "image-studio-provider-response",
  title: "Image Studio surfaces the real provider response",
  kind: "user-facing",
  steps: [
    {
      name: "Generate from Image Studio and surface the provider result",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__ipolloworkControl)", {
          timeoutMs: 30_000,
          label: "window.__ipolloworkControl",
        });

        const studioOpen = await ctx.eval(`Boolean(document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]'))`);
        if (!studioOpen) {
          await ctx.eval(`(() => {
            const addPanel = document.querySelector('button[aria-label="添加侧面板入口"]');
            addPanel?.click();
            return Boolean(addPanel);
          })()`);
          await ctx.waitFor(`Array.from(document.querySelectorAll('button,[role="menuitem"]'))
            .some((element) => element.textContent?.trim() === ${JSON.stringify(IMAGE_STUDIO_TITLE)})`, {
            label: "Image Studio panel menu item",
          });
          await ctx.eval(`(() => {
            const entry = Array.from(document.querySelectorAll('button,[role="menuitem"]'))
              .find((element) => element.textContent?.trim() === ${JSON.stringify(IMAGE_STUDIO_TITLE)});
            entry?.click();
            return Boolean(entry);
          })()`);
          await ctx.waitFor(`Boolean(document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument)`, {
            timeoutMs: 15_000,
            label: "loaded Image Studio panel",
          });
        }

        const inspectorOpen = await ctx.eval("Boolean(document.querySelector('textarea[name=\"prompt\"]'))");
        if (!inspectorOpen) {
          await ctx.eval(`(() => {
            const studio = document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument;
            const settings = Array.from(studio?.querySelectorAll('button') ?? [])
              .find((button) => button.textContent?.trim() === "参数");
            settings?.click();
            return Boolean(settings);
          })()`);
          await ctx.waitFor("Boolean(document.querySelector('textarea[name=\"prompt\"]'))", {
            label: "Image Studio inspector prompt",
          });
        }

        await ctx.eval(`(() => {
          const target = document.activeElement ?? document;
          target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          return true;
        })()`);
        await ctx.waitFor("!document.querySelector('[role=\"listbox\"]')", {
          label: "stale Image Studio popover to close",
        });

        await ctx.prove("Image Studio shows the real provider outcome instead of a generic server error", {
          voiceover: VOICEOVER,
          action: async () => {
            await ctx.fill('textarea[name="prompt"]', PROMPT);
            await ctx.eval(`(() => {
              const button = Array.from(document.querySelectorAll('button'))
                .find((element) => element.textContent?.trim() === "生成图片");
              button?.click();
              return Boolean(button);
            })()`);
            await ctx.waitFor(`document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')
              ?.contentDocument?.querySelector('#busyLayer')?.classList.contains('visible') === true`, {
              timeoutMs: 15_000,
              label: "Image Studio generation request to start",
            });
            await ctx.waitFor(`document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')
              ?.contentDocument?.querySelector('#busyLayer')?.classList.contains('visible') === false`, {
              timeoutMs: 150_000,
              label: "Image Studio provider request to finish",
            });
          },
          assert: async () => {
            const result = await ctx.eval(`(() => {
              const studio = document.querySelector('iframe[title=${JSON.stringify(IMAGE_STUDIO_TITLE)}]')?.contentDocument;
              const errorText = Array.from(document.querySelectorAll('[role="status"]'))
                .map((element) => element.textContent?.trim() ?? "")
                .find((text) => text.length > 0) ?? "";
              return {
                errorText,
                generatedImageVisible: Boolean(studio?.querySelector('#canvasWrap.visible')),
                unexpectedErrorVisible: document.body.innerText.includes("Unexpected server error"),
              };
            })()`);
            ctx.assert(!result.unexpectedErrorVisible, "The generic Unexpected server error is still visible.");
            ctx.assert(
              result.generatedImageVisible || Boolean(result.errorText),
              `Expected a generated image or an actionable provider error, got ${JSON.stringify(result)}.`,
            );
            ctx.log(`Image Studio outcome: ${JSON.stringify(result)}`);
          },
          screenshot: {
            name: "image-studio-provider-response",
            requireText: ["图片参数", "生成图片"],
            rejectText: ["Unexpected server error"],
          },
        });
      },
    },
  ],
};
