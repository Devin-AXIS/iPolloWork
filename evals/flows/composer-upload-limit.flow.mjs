const card = ".composer-card";
const maxBytes = 100 * 1024 * 1024;
const acceptedName = "chat-boundary-100MB.txt";
const rejectedName = "chat-oversized-100MB.txt";

async function clearFixture(ctx) {
  await ctx.eval(`(() => {
    const label = [...document.querySelectorAll('${card} .truncate')]
      .find(element => element.textContent === ${JSON.stringify(acceptedName)});
    label?.parentElement.parentElement.querySelector('button')?.click();
  })()`);
}

export default {
  id: "composer-upload-limit",
  title: "Chat attachments accept 100 MB and reject larger files",
  kind: "user-facing",
  steps: [{ name: "Chat attachment boundary", run: async ctx => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)");
    await ctx.waitFor(`Boolean(document.querySelector('${card} input[type=file]'))`);
    await clearFixture(ctx);
    try {
      await ctx.prove("File selection and drag-and-drop accept 100 MB and reject one byte more", {
        voiceover: "对话框支持上传 100 MB 的文件，超过上限时会明确提示。",
        action: async () => {
          await ctx.eval(`(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(${maxBytes})], ${JSON.stringify(acceptedName)}, {type:'text/plain'}));
            transfer.items.add(new File([new Uint8Array(${maxBytes + 1})], ${JSON.stringify(rejectedName)}, {type:'text/plain'}));
            const input = document.querySelector('${card} input[type=file]');
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', {bubbles:true}));
          })()`);
          await ctx.waitFor(`document.querySelector('${card}').innerText.includes(${JSON.stringify(acceptedName)})`);
          ctx.assert(await ctx.eval(`!document.querySelector('${card}').innerText.includes(${JSON.stringify(rejectedName)})`), "File picker excludes oversized files");
          await clearFixture(ctx);
          await ctx.waitFor(`!document.querySelector('${card}').innerText.includes(${JSON.stringify(acceptedName)})`);
          await ctx.eval(`(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(${maxBytes})], ${JSON.stringify(acceptedName)}, {type:'text/plain'}));
            transfer.items.add(new File([new Uint8Array(${maxBytes + 1})], ${JSON.stringify(rejectedName)}, {type:'text/plain'}));
            document.querySelector('${card} [data-lexical-editor]').dispatchEvent(new DragEvent('drop', {bubbles:true,cancelable:true,dataTransfer:transfer}));
          })()`);
        },
        assert: async () => {
          await ctx.waitFor(`document.querySelector('${card}').innerText.includes(${JSON.stringify(acceptedName)})`);
          ctx.assert(await ctx.eval(`document.querySelector('${card}').innerText.includes('100 MB') && !document.querySelector('${card}').innerText.includes(${JSON.stringify(rejectedName)})`), "Drop accepts the real 100 MB file and excludes one byte more");
          await ctx.waitFor(`Boolean([...document.querySelectorAll('[data-sonner-toast]')].find(element => element.textContent.includes(${JSON.stringify(rejectedName)}) && element.textContent.includes('100')))`);
        },
        screenshot: { name: "chat-upload-100mb", requireText: [acceptedName, "100 MB"], rejectText: ["8MB", "25 MB"] },
      });
    } finally {
      await clearFixture(ctx);
    }
  } }],
};
