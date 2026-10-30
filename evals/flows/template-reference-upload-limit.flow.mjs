import { fileURLToPath } from "node:url";

const dialog = '[data-testid="template-apply-dialog"]';
const maxBytes = 200 * 1024 * 1024;

export default {
  id: "template-reference-upload-limit",
  title: "Reference documents accept 200 MB and reject larger files",
  kind: "user-facing",
  steps: [{ name: "Reference file size boundary", run: async ctx => {
    const previousUrl = await ctx.eval("location.href");
    const origin = ctx.env.IPOLLOWORK_EVAL_UI_URL ?? "http://localhost:5173";
    const fixture = fileURLToPath(new URL("../support/template-reference-fixture.html", import.meta.url)).replaceAll("\\", "/");
    try {
      await ctx.client.send("Page.navigate", { url: `${origin}/@fs/${fixture}` });
      await ctx.waitForText("使用模板");
      await ctx.clickText("使用模板", { selector: "button" });
      await ctx.waitFor(`document.querySelector('#template-reference-max-size')?.textContent.includes('200 MB')`);
      await ctx.prove("The dialog accepts a real 200 MB reference and rejects one byte more", {
        voiceover: "参考文档现在最大支持 200 MB，超过这个大小的文件会被拒绝。",
        action: async () => {
          await ctx.eval(`(() => {
            const input = document.querySelector('${dialog} input[type=file]');
            const select = file => {
              const transfer = new DataTransfer(); transfer.items.add(file);
              input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
            };
            select(new File([new Uint8Array(${maxBytes + 1})], 'oversized.txt', { type: 'text/plain' }));
          })()`);
          ctx.assert(await ctx.eval(`!document.querySelector('[data-testid=template-reference-card]')`), "An oversized file never starts parsing");
          await ctx.eval(`(() => {
            const post = Worker.prototype.postMessage;
            Worker.prototype.postMessage = function () { Worker.prototype.postMessage = post; };
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(${maxBytes})], 'boundary-200MB.txt', { type: 'text/plain' }));
            const input = document.querySelector('${dialog} input[type=file]');
            input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
        },
        assert: async () => {
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid=template-reference-card] [role=status]'))`);
          ctx.assert(await ctx.eval(`document.querySelector('[data-testid=template-reference-card]').textContent.includes('200 MB') && !document.querySelector('${dialog}').textContent.includes('oversized.txt')`), "A real boundary file reaches parsing; the oversized file stays excluded");
        },
        screenshot: { name: "reference-200mb", requireText: ["boundary-200MB.txt", "200 MB"], rejectText: ["47.7 MB", "oversized.txt"] },
      });
      await ctx.trustedClick(`${dialog} button[aria-label="移除 boundary-200MB.txt"]`);
    } finally {
      await ctx.client.send("Page.navigate", { url: previousUrl });
    }
  } }],
};
