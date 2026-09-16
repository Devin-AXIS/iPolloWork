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
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function(message, ...options) {
          Worker.prototype.postMessage = post;
          window.__releaseReferenceRead = () => post.call(this, message, ...options);
        };
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
  title: "Template entry combines compact modes with local reference parsing",
  kind: "user-facing",
  steps: [{name: "Reference and custom modes preserve drafts and isolate submitted content", run: async ctx => {
    const previousUrl = await ctx.eval("location.href");
    const fixtureUrl = new URL("../support/template-reference-fixture.html", import.meta.url).pathname;
    try {
      await ctx.client.send("Page.navigate", {url: `http://localhost:5173/@fs${fixtureUrl}`});
      await ctx.waitForText("使用模板");
      const click = selector => ctx.trustedClick(selector);
      const submit = `${dialog} [data-slot=dialog-footer] button:last-child`;
      const start = async () => { await ctx.clickText("使用模板", {selector:"button"}); await ctx.waitFor(`Boolean(document.querySelector('#template-file-tab'))`); };
      await start();
      await ctx.prove("Reference mode is one upload card and optional requirements", {
        action: async () => {},
        assert: async () => {await assertFits(ctx);ctx.assert(await ctx.eval(`document.querySelectorAll('${dialog} textarea').length === 1 && !document.querySelector('${dialog} input:not([type=file])')`), "Only optional requirements are shown; no style field");},
        screenshot: {name:"reference-entry",requireText:["参考文件","手动填写","补充要求"]},
      });
      await ctx.fill('[data-testid=template-file-instructions]', 'FILE_ONLY 要求：重点突出协作');
      await click('#template-description-tab');
      ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`),'Empty custom content cannot submit');
      await ctx.fill('[data-testid=template-title]', 'CUSTOM_ONLY 标题');
      ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`), 'Audience is required');
      await ctx.fill('[data-testid=template-audience]', '设计团队');
      ctx.assert(await ctx.eval(`!document.querySelector('${submit}').disabled`), 'Additional details are optional');
      await ctx.fill('[data-testid=template-description]', 'CUSTOM_ONLY 为设计团队介绍新产品');
      await click('#template-file-tab');
      await ctx.prove("Parsing progress stays inside the file card and blocks file submission", {
        action: () => upload(ctx,[{name:"发布需求.md",type:"text/markdown",text:brief}],true),
        assert: async () => {await ctx.waitFor("typeof window.__releaseReferenceRead === 'function'");ctx.assert(await ctx.eval(`Boolean(document.querySelector('${dialog} [role=status]')) && document.querySelector('${submit}').disabled`),"Cannot submit files while parsing");},
        screenshot:{name:"reference-parsing"},
      });
      await ctx.eval("window.__releaseReferenceRead()",{awaitPromise:true});
      await ctx.waitFor(`!document.querySelector('${dialog} [role=status]')`);
      await click('#template-description-tab');
      ctx.assert(await ctx.eval("document.querySelector('[data-testid=template-description]').value.includes('CUSTOM_ONLY')"),"Custom draft survives switching");
      await click('#template-file-tab');
      ctx.assert(await ctx.eval("document.querySelector('[data-testid=template-file-instructions]').value.includes('FILE_ONLY')"),"File requirements survive switching");
      ctx.assert(await ctx.eval(`!document.querySelector('${dialog} pre') && document.querySelector('[data-testid=template-reference-card]').getBoundingClientRect().height===48`), "Compact card hides parsed content");
      await ctx.prove("File submission retains the new extraction context without the custom draft", {
        action: () => click(submit),
        assert: async () => {await ctx.waitFor("Boolean(window.__referenceReceipt)");const r=await ctx.eval('window.__referenceReceipt');ctx.assert(r.brief.title === '秋季产品发布' && r.brief.details.includes('FILE_ONLY') && !JSON.stringify(r).includes('CUSTOM_ONLY'),"File mode infers title and includes only its requirements");ctx.assert(r.context.files[0].source.name === '发布需求.md' && r.context.files[0].text.includes('团队协作'),"Full parsed evidence survives submission");},
        screenshot:{name:"reference-receipt"},
      });
      await start();
      await upload(ctx,[{name:"不得提交.md",type:"text/markdown",text:brief}]);
      await ctx.waitFor(`!document.querySelector('${dialog} [role=status]')`);
      await click('#template-description-tab');
      await ctx.fill('[data-testid=template-title]', 'CUSTOM_ONLY 标题');
      ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`), 'Audience is required');
      await ctx.fill('[data-testid=template-audience]', '设计团队');
      ctx.assert(await ctx.eval(`!document.querySelector('${submit}').disabled`), 'Additional details are optional');
      await ctx.fill('[data-testid=template-description]', 'CUSTOM_ONLY 创建一个简洁的网站');
      await ctx.prove("Custom submission excludes the other mode's reference files", {
        action: () => click(submit),
        assert: async () => {await ctx.waitFor(`!document.querySelector('${dialog}')`);const r=await ctx.eval('window.__referenceReceipt');ctx.assert(r.brief.details === 'CUSTOM_ONLY 创建一个简洁的网站' && r.attachmentNames.length === 0,"No reference attachments leak into custom mode");},
        screenshot:{name:"custom-receipt"},
      });
      await ctx.prove("All template categories require title and audience", {
        action: async () => {
          for(const category of ['slides','video','site','app','report','article','poster','cards','other']) {
            await ctx.eval(`(() => {const select=document.querySelector('select[aria-label="验收模板类型"]');select.value=${JSON.stringify(category)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
            await start(); await click('#template-description-tab');
            ctx.assert(await ctx.eval(`document.querySelectorAll('${dialog} [required]').length===2`),`${category} has two required fields`);
            await ctx.eval(`document.querySelector('${dialog} button[aria-label="关闭"]').click()`);
          }
          await start(); await click('#template-description-tab');
          await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:520,height:740,deviceScaleFactor:1,mobile:false});
          await ctx.eval("document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark'");
        },
        assert: () => assertFits(ctx),
        screenshot:{name:"compact-dark-entry"},
      });
      await click('#template-file-tab');
      await upload(ctx,[{name:"取消解析.md",type:"text/markdown",text:brief}],true);
      await ctx.waitFor(`Boolean(document.querySelector('${dialog} [role=status]'))`);
      await click(`${dialog} button[aria-label="移除 取消解析.md"]`);
      await ctx.eval("window.__releaseReferenceRead()",{awaitPromise:true});
      await ctx.waitFor(`!document.querySelector('${dialog} [role=status]')`);
      ctx.assert(await ctx.eval(`!document.querySelector('${dialog} li')`),"Removing a parsing file prevents late results from returning");
    } finally {
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.client.send('Page.navigate',{url:previousUrl});
    }
  }}],
};
