// Open /@fs/<checkout>/evals/support/template-reference-fixture.html in the checkout's Vite server.
// The fixture runs the production dialog/parser; only the final paid model request is replaced.
const dialog = '[data-testid="template-apply-dialog"]';
const brief = "# 秋季产品发布\n\n目标用户：设计团队\n\n需求：介绍自动排版、团队协作与视频导出。";

async function upload(ctx, files, holdRead = false) {
  await ctx.eval(`(() => {
    const transfer = new DataTransfer();
    for (const item of ${JSON.stringify(files)}) {
      const file = new File([item.text], item.name, { type: item.type });
      if (${holdRead}) {
        const read = file.text.bind(file);
        file.text = () => new Promise((resolve) => { window.__releaseReferenceRead = async () => resolve(await read()); });
      }
      transfer.items.add(file);
    }
    const input = document.querySelector('${dialog} input[type="file"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function assertFits(ctx) {
  const fits = await ctx.eval(`(() => {
    const box = document.querySelector('${dialog}').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  })()`);
  ctx.assert(fits, "Dialog must remain within the viewport.");
}

export default {
  id: "template-reference-wizard",
  title: "Template references: skip, parse, replace files, edit and submit",
  kind: "user-facing",
  cdpTarget: { urlIncludes: "template-reference-fixture.html" },
  steps: [{ name: "Two-step reference workflow", run: async (ctx) => {
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await ctx.client.send("Page.reload", {});
    await ctx.waitForText("使用模板");
    await ctx.prove("Reference upload is optional and comes before the brief", {
      voiceover: "点击使用模板后，先选择是否上传参考文件；没有文件也能直接填写需求。",
      action: () => ctx.clickText("使用模板"),
      assert: async () => { await ctx.waitForText("是否上传参考文件？"); ctx.assert(await ctx.eval(`!document.querySelector('${dialog} textarea')`), "Brief is not shown in step one."); await assertFits(ctx); },
      screenshot: { name: "reference-choice", requireText: ["是否上传参考文件？", "不上传，直接填写"] },
    });
    await ctx.prove("Skipping opens an editable empty brief", {
      voiceover: "不上传文件时，第二步显示空白的信息表单，可以自行输入。",
      action: () => ctx.clickText("不上传，直接填写"),
      assert: async () => { await ctx.waitFor(`Boolean(document.querySelector('${dialog} textarea'))`); ctx.assert(await ctx.eval(`[...document.querySelectorAll('${dialog} input, ${dialog} textarea')].every(el => !el.value)`), "Skipped brief stays empty."); },
      screenshot: { name: "manual-brief", requireText: ["填写信息"] },
    });
    await ctx.clickText("返回修改文件", { selector: `${dialog} button` });
    await ctx.prove("Parsing shows progress and blocks the next step", {
      voiceover: "上传后显示解析进度，解析期间不能进入下一步。",
      action: () => upload(ctx, [{ name: "发布需求.md", type: "text/markdown", text: brief }], true),
      assert: async () => {
        await ctx.waitFor("typeof window.__releaseReferenceRead === 'function'");
        ctx.assert(await ctx.eval(`Boolean(document.querySelector('${dialog} [role="progressbar"]')) && [...document.querySelectorAll('${dialog} button')].some(el => el.textContent.trim() === '下一步' && el.disabled)`), "Parser owns progress and next is disabled.");
      },
      screenshot: { name: "parsing", requireText: ["下一步", "发布需求.md"] },
    });
    await ctx.eval("window.__releaseReferenceRead()", { awaitPromise: true });
    await ctx.prove("Finished parsing leaves only a compact filename list", {
      voiceover: "解析完成后收起进度条，仅保留文件名和删除操作。",
      action: () => ctx.waitFor(`!document.querySelector('${dialog} [role="progressbar"]')`),
      assert: async () => {
        await ctx.expectText("发布需求.md");
        ctx.assert(await ctx.eval(`!document.querySelector('${dialog} details')`), "Extraction details are hidden.");
        await ctx.expectNoText("下载解析结果（JSON）");
        await ctx.expectNoText("不发原文件");
      },
      screenshot: { name: "parsed-reference", requireText: ["发布需求.md", "下一步"], rejectText: ["查看解析内容", "下载解析结果（JSON）", "不发原文件"] },
    });
    await ctx.prove("Prefilled fields stay editable and survive going back", {
      voiceover: "第二步已填入文档中的标题、受众和需求，手动修改后返回上一步也会保留。",
      action: async () => {
        await ctx.clickText("下一步", { selector: `${dialog} button` });
        await ctx.waitFor(`document.querySelector('${dialog} input')?.value === '秋季产品发布'`);
        ctx.assert(await ctx.eval(`document.querySelector('${dialog} textarea').value.includes('团队协作')`), "Reference requirements prefilled.");
        await ctx.fill(`${dialog} input`, "秋季发布 · 最终版");
        await ctx.clickText("返回修改文件", { selector: `${dialog} button` });
        await ctx.clickText("下一步", { selector: `${dialog} button` });
      },
      assert: async () => { ctx.assert(await ctx.eval(`document.querySelector('${dialog} input').value === '秋季发布 · 最终版'`), "User edits survive navigation."); await assertFits(ctx); },
      screenshot: { name: "prefilled-brief", requireText: ["填写信息", "已根据参考文档"] },
    });
    await ctx.prove("Files can be replaced from the brief without losing manual edits", {
      voiceover: "填写信息页显示当前文件，点击修改文件可返回删除并重新上传，手动编辑仍然保留。",
      action: async () => {
        await ctx.expectText("发布需求.md");
        await ctx.clickText("修改文件", { selector: `${dialog} button` });
        await ctx.eval(`document.querySelector('${dialog} button[aria-label="移除 发布需求.md"]').click()`);
        await ctx.expectNoText("发布需求.md");
        await upload(ctx, [{ name: "更新需求.md", type: "text/markdown", text: brief }]);
        await ctx.waitFor(`!document.querySelector('${dialog} [role="progressbar"]')`);
        await ctx.clickText("下一步", { selector: `${dialog} button` });
      },
      assert: async () => {
        await ctx.expectText("更新需求.md");
        await ctx.expectNoText("发布需求.md");
        ctx.assert(await ctx.eval(`document.querySelector('${dialog} input').value === '秋季发布 · 最终版'`), "Replacing files preserves manually edited fields.");
      },
      screenshot: { name: "replaced-reference", requireText: ["更新需求.md", "修改文件", "返回修改文件"], rejectText: ["发布需求.md"] },
    });
    const submitted = await ctx.eval(`(() => { const button = [...document.querySelectorAll('${dialog} button')].at(-1); if (!button || button.disabled) return false; button.click(); return true; })()`);
    ctx.assert(submitted, "Final submit is enabled.");
    await ctx.waitFor("Boolean(window.__referenceReceipt)");
    const receipt = await ctx.eval("window.__referenceReceipt");
    ctx.assert(receipt.brief.title === "秋季发布 · 最终版" && receipt.context.files[0].text.includes("团队协作") && receipt.attachmentNames.includes("reference-context.json"), "Submission carries edited brief and actual parsed JSON.");
    await ctx.output("submitted-reference-payload", JSON.stringify(receipt, null, 2));
    await ctx.clickText("使用模板");
    await ctx.client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await upload(ctx, [{ name: "无法解析.json", type: "application/json", text: "{" }]);
    await ctx.prove("Failed parsing remains actionable on a narrow screen", {
      voiceover: "解析失败会明确提示，可以更换文件或手动填写；窄屏下仍能操作。",
      action: () => ctx.waitForText("未提取到可靠正文"),
      assert: async () => { await assertFits(ctx); ctx.assert(await ctx.eval(`[...document.querySelectorAll('${dialog} button')].some(el => el.textContent.trim() === '下一步' && !el.disabled)`), "Failed references do not trap users."); },
      screenshot: { name: "failed-mobile", requireText: ["未提取到可靠正文", "下一步"] },
    });
    await ctx.clickText("下一步", { selector: `${dialog} button` });
    ctx.assert(await ctx.eval(`[...document.querySelectorAll('${dialog} input, ${dialog} textarea')].every(el => !el.value)`), "Failed extraction invents no brief.");
    await assertFits(ctx);
  }}],
};
