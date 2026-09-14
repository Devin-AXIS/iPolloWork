// Open any template brief in the development client before running.
// Mock task creation, capture the brief and reject materialization locally; no generation is dispatched.
const dialog = '[data-testid="template-apply-dialog"]';
const submit = `${dialog} [data-slot="dialog-footer"] button:last-child`;
const click = (ctx, selector) => ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function proveProjectLocation(ctx) {
  ctx.assert(!await ctx.eval('Boolean(document.querySelector("[role=dialog]"))'), 'Begin with dialogs closed');
  await ctx.eval("document.querySelectorAll('[data-sonner-toast] button[aria-label=\"Close notification\"]').forEach(b=>b.click())");
  await ctx.waitFor("!document.querySelector('[data-sonner-toast]')");
  const originalHash = await ctx.eval('location.hash');
  const projectId = await ctx.eval("document.querySelector('[data-testid=project-new-conversation-button]').dataset.projectId");
  await ctx.prove('Project new task opens without a location selector', {
    voiceover: '从项目旁的新建入口打开自定义模板，直接沿用当前项目，无需再次选择创建位置。',
    action: async () => {
      await ctx.trustedClick(`[data-testid="project-new-conversation-button"][data-project-id="${projectId}"]`);
      await ctx.waitFor('Boolean(document.querySelector("[data-testid=initial-project-task-starter]"))');
      await ctx.eval("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='创作').click()");
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-quick-actions]'))");
      await ctx.eval("document.querySelector('[data-testid=new-conversation-quick-actions] button').click()");
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=new-conversation-template-strip] button[aria-label*=自定义模板]'))");
      await ctx.trustedClick('[data-testid="new-conversation-template-strip"] button[aria-label*="自定义模板"]');
      await ctx.waitFor("Boolean(document.querySelector('#template-file-tab'))");
    },
    assert: async () => ctx.assert(await ctx.eval(`location.hash.includes(${JSON.stringify(projectId)}) && !document.querySelector('#template-destination') && Boolean(document.querySelector('#template-file-tab'))`), 'The project route is retained and the location field is absent'),
    screenshot: {name:'project-location',requireText:['上传文件','手动填写'],rejectText:['创建位置']},
  });
  await ctx.eval(`window.__templateLocationFetch=window.fetch;window.__templateLocationRequests=[];window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(init?.method==='POST'&&url.endsWith('/sessions')){window.__templateLocationRequests.push(url);return new Response(JSON.stringify({error:'Location validation only'}),{status:409,headers:{'Content-Type':'application/json'}});}return window.__templateLocationFetch(input,init);};`);
  try {
    await click(ctx,'#template-description-tab');
    await ctx.fill('[data-testid="template-title"]','Project website');
    await ctx.fill('[data-testid="template-audience"]','Customers');
    await ctx.fill('[data-testid="template-description"]','Create a minimal project website.');
    await click(ctx,submit);
    await ctx.waitFor('window.__templateLocationRequests.length===1');
    const url=await ctx.eval('window.__templateLocationRequests[0]');
    ctx.assert(new URL(url).pathname.endsWith('/workspace/'+projectId+'/sessions'),'Session creation targets the originating project; intercepted before creating a session');
    await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
  } finally {
    await ctx.eval('window.fetch=window.__templateLocationFetch;delete window.__templateLocationFetch;delete window.__templateLocationRequests;');
    await ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()");
  }
  await ctx.prove('Global template entry still offers project selection', {
    voiceover:'从侧栏的全局模板入口创建时，仍然可以选择项目作为创建位置。',
    action:async()=>{
      await ctx.eval("document.querySelectorAll('[data-sonner-toast] button[aria-label=\"Close notification\"]').forEach(b=>b.click())");
      await ctx.waitFor("!document.querySelector('[data-sonner-toast]')");
      await ctx.eval("[...document.querySelectorAll('button')].find(b=>b.textContent==='模板').click()");
      await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='自定义模板')");
      await ctx.eval("[...document.querySelectorAll('button')].find(b=>b.textContent==='自定义模板').click()");
      await ctx.waitFor("Boolean(document.querySelector('#template-destination'))");
    },
    assert:async()=>ctx.assert(await ctx.eval("Boolean(document.querySelector('#template-destination')) && Boolean(document.querySelector('#template-file-tab'))"),'Global template creation retains the location selector'),
    screenshot:{name:'global-location',requireText:['创建位置','上传文件']},
  });
  await ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()");
  await ctx.navigateHash(originalHash);
}
async function proveDeferredTemplate(ctx) {
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=project-new-conversation-button]'))");
  const projectId = await ctx.eval("document.querySelector('[data-testid=project-new-conversation-button]').dataset.projectId");
  // Leave the previous empty template session intact while checking a fresh project entry.
  ctx.assert(await ctx.eval("[...document.querySelectorAll('[role=dialog] textarea')].every(e=>!e.value) && [...document.querySelectorAll('[role=dialog] input[type=file]')].every(e=>!e.files.length)"), 'No user input is displaced');
  if(await ctx.eval("location.hash.endsWith('/session') && Boolean(document.querySelector('[data-testid=template-apply-dialog]'))")) {
    await ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()");
  }
  await ctx.navigateHash(`/workspace/${projectId}/session`);
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]')) && !document.querySelector('[role=dialog]')");
  await ctx.trustedClick(`[data-testid="project-new-conversation-button"][data-project-id="${projectId}"]`);
  await ctx.eval("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='创作').click()");
  await ctx.waitFor("[...document.querySelectorAll('[data-testid=new-conversation-quick-actions] button')].some(b=>b.textContent.includes('PPT'))");
  await ctx.eval("[...document.querySelectorAll('[data-testid=new-conversation-quick-actions] button')].find(b=>b.textContent.includes('PPT')).click()");
  const card='[data-testid="new-conversation-template-strip"] button[aria-label="使用模板: Morrow Brand Narrative"]';
  await ctx.waitFor(`Boolean(document.querySelector('${card}'))`);
  await ctx.eval(`window.__templateDeferredFetch=window.fetch;window.__templateDeferredWrites=[];window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(init?.method==='POST' && (url.endsWith('/sessions') || url.endsWith('/materialize'))){window.__templateDeferredWrites.push(new URL(url).pathname);return new Response(JSON.stringify({error:'Submission boundary validation only'}),{status:409,headers:{'Content-Type':'application/json'}});}return window.__templateDeferredFetch(input,init);};`);
  try {
    await ctx.prove('Choosing a named template opens only the brief', {
      voiceover:'选择演示模板后，只打开需求弹窗，右侧工作台保持关闭，也不会提前创建任务。',
      action:async()=>{
        await ctx.trustedClick(card);
        await ctx.waitFor("Boolean(document.querySelector('#template-file-tab'))");
        await ctx.waitFor("document.querySelector('[data-testid=template-apply-dialog]').getAnimations().every(a=>a.playState==='finished')");
      },
      assert:async()=>ctx.assert(await ctx.eval(`window.__templateDeferredWrites.length===0 && location.hash.endsWith('/session') && !document.querySelector('[data-testid=design-panel]') && !document.querySelector('[data-testid=video-panel]') && !document.querySelector('#template-destination')`),'No session or materialization request occurs before submitting; no workbench is visible'),
      screenshot:{name:'deferred-template',requireText:['Morrow Brand Narrative','上传参考文件'],rejectText:['entry.html','创建位置']},
    });
    await ctx.prove('Cancel returns to template selection without creating a task', {
      voiceover:'取消填写后回到模板选择，页面保持原样，不留下新建任务。',
      action:async()=>ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()"),
      assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[role=dialog]') && Boolean(document.querySelector('[data-testid=initial-project-task-starter]')) && window.__templateDeferredWrites.length===0"),'Cancel makes no creation request and retains the starter'),
      screenshot:{name:'deferred-cancel',requireText:['做 PPT'],rejectText:['entry.html']},
    });
    await ctx.trustedClick(card);
    await ctx.waitFor("Boolean(document.querySelector('#template-description-tab'))");
    await click(ctx,'#template-description-tab');
    await ctx.fill('[data-testid="template-title"]','Brand story');
    await ctx.fill('[data-testid="template-audience"]','Customers');
    await ctx.fill('[data-testid="template-description"]','Create a six-slide brand presentation.');
    await click(ctx,submit);
    await ctx.waitFor('window.__templateDeferredWrites.length===1');
    ctx.assert(await ctx.eval(`window.__templateDeferredWrites[0]==='/workspace/${projectId}/sessions'`),'Clicking Generate initiates creation in the originating project; request blocked before creating test data');
    await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
    ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]')"),'A failed submission does not open the workbench');
    await ctx.fill('[data-testid="template-title"]','');
      await ctx.fill('[data-testid="template-audience"]','');
      await ctx.fill('[data-testid="template-description"]','');
    await click(ctx,'#template-file-tab');
  } finally {
    await ctx.eval('window.fetch=window.__templateDeferredFetch;delete window.__templateDeferredFetch;delete window.__templateDeferredWrites;');
    await ctx.eval("document.querySelectorAll('[data-sonner-toast] button[aria-label=\"Close notification\"]').forEach(b=>b.click())");
  }
}
async function proveSessionCustomEntry(ctx) {
  const card = '[data-testid="new-conversation-template-strip"] button[aria-label*="自定义模板"]';
  ctx.assert(await ctx.eval("!document.querySelector('[role=dialog]') && !document.querySelector('[data-testid=initial-project-task-starter]') && Boolean(document.querySelector('[data-testid=new-conversation-starter-slot]'))"), 'Begin in the ordinary empty-session starter');
  const originalHash = await ctx.eval('location.hash');
  await ctx.eval(`window.__customEntryFetch=window.fetch;window.__customEntryWrites=[];window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(init?.method==='POST' && ['/sessions','/materialize','/authoring-sessions'].some(path=>new URL(url,location.href).pathname.endsWith(path))){window.__customEntryWrites.push(url);return new Response('{}',{status:409});}return window.__customEntryFetch(input,init);};`);
  try {
    for (const [category, label, title] of [['slides','做 PPT','演示标题'],['website','做网站','网站名称'],['video','视频','视频主题']]) {
      await ctx.prove(`${category}: ordinary session offers custom templates`, {
        voiceover: `在新任务里选择${label}，模板列表保留自定义模板入口。点击即可填写内容，沿用当前任务，不再选择创建位置。`,
        action: async () => {
          await ctx.eval(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent===${JSON.stringify(category === 'video' ? '视频' : '创作')}).click()`);
          if (category !== 'video') await ctx.eval(`[...document.querySelectorAll('[data-testid=new-conversation-quick-actions] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
          await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);
          await ctx.trustedClick(card);
          await ctx.waitFor("Boolean(document.querySelector('#template-description-tab'))");
          await ctx.trustedClick('#template-description-tab');
          await ctx.waitFor(`document.querySelector(${JSON.stringify(dialog)}).innerText.includes(${JSON.stringify(title)})`);
        },
        assert: async () => ctx.assert(await ctx.eval(`location.hash===${JSON.stringify(originalHash)} && !document.querySelector('#template-destination') && document.querySelectorAll('${dialog} input[required]').length===2 && document.querySelector('${submit}').disabled && window.__customEntryWrites.length===0`), 'Custom entry opens correct required fields in the current session without creating resources'),
        screenshot: {name:`session-custom-${category}`,requireText:['自定义模板',title,'手动填写'],rejectText:['创建位置']},
      });
      await ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()");
      await ctx.waitFor("!document.querySelector('[data-testid=template-apply-dialog]')");
      ctx.assert(await ctx.eval(`Boolean(document.querySelector(${JSON.stringify(card)})) && window.__customEntryWrites.length===0`), 'Cancel preserves custom entry and creates no resources');
    }
    await ctx.prove('Cancel returns to the custom template card', {
      voiceover: '取消填写后，自定义模板仍保留在列表第一项，没有创建任务或启动生成。',
      action:async()=>{await ctx.eval("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='创作').click()");await ctx.eval("[...document.querySelectorAll('[data-testid=new-conversation-quick-actions] button')].find(b=>b.textContent.trim()==='做 PPT').click()");await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);},
      assert:async()=>ctx.assert(await ctx.eval(`!document.querySelector('[role=dialog]') && window.__customEntryWrites.length===0 && location.hash===${JSON.stringify(originalHash)}`),'Cancel leaves the original session intact'),
      screenshot:{name:'session-custom-card',requireText:['自定义模板','做 PPT']},
    });
  } finally {
    await ctx.eval('window.fetch=window.__customEntryFetch;delete window.__customEntryFetch;delete window.__customEntryWrites;');
  }
}

// Uses a real local template/task and file writes; only the model response is simulated.
async function provePreviewAfterResult(ctx) {
  const referenceDelivery = ctx.env.IPOLLOWORK_EVAL_TEMPLATE_REFERENCE_DELIVERY_ONLY === '1';
  const originalHash = await ctx.eval('location.hash');
  ctx.assert(await ctx.eval("![...document.querySelectorAll('[role=dialog] input,[role=dialog] textarea')].some(e=>e.value || e.files?.length) && !document.querySelector('[contenteditable=true]')?.textContent.trim()"), 'No user draft is displaced');
  if(await ctx.eval("Boolean(document.querySelector('[data-testid=template-apply-dialog]'))")) await ctx.eval("[...document.querySelectorAll('[data-testid=template-apply-dialog] button')].find(b=>b.textContent==='取消').click()");
  await ctx.waitFor("!document.querySelector('[role=dialog]')");
  await ctx.eval(`window.__previewProof={fetch:window.fetch,prompts:[],writes:[]};window.fetch=async(input,init)=>{const p=window.__previewProof;const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;const path=new URL(url,location.href).pathname;if(init?.method==='POST' && (path.endsWith('/prompt') || path.endsWith('/prompt_async'))){const body=JSON.parse(init.body);p.prompts.push(body);p.started=true;return new Response(JSON.stringify({sessionId:p.sid,turnId:'preview-proof-turn'}),{status:200,headers:{'Content-Type':'application/json'}});}const response=await p.fetch(input,init);if(init?.method==='POST'&&path.endsWith('/sessions')&&response.ok){const data=await response.clone().json();p.sid=data.item.id;p.sessionUrl=url+'/'+p.sid;p.headers=init.headers;}if(path.endsWith('/materialize')&&response.ok){p.template=await response.clone().json();p.base=new URL(url).origin;}return response;};`);
  try {
    const projectId = await ctx.eval("document.querySelector('[data-testid=project-new-conversation-button]').dataset.projectId");
    await ctx.trustedClick(`[data-testid="project-new-conversation-button"][data-project-id="${projectId}"]`);
    await ctx.waitFor("Boolean(document.querySelector('[data-testid=initial-project-task-starter]'))");
    await ctx.eval("[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='创作').click()");
    await ctx.eval("[...document.querySelectorAll('[data-testid=new-conversation-quick-actions] button')].find(b=>b.textContent.includes('PPT')).click()");
    const card='[data-testid="new-conversation-template-strip"] button[aria-label="使用模板: Morrow Brand Narrative"]';
    await ctx.waitFor(`Boolean(document.querySelector('${card}'))`);
    await ctx.prove('Choose a template and provide its content before previewing', {
      voiceover:referenceDelivery ? '上传参考文档和图片后就能生成，无需选择是否发送原文件，也不用重复填写文档内容。' : '选择做 PPT 和模板后，填写演示主题与受众，此时右侧预览保持关闭。',
      action:async()=>{
        await click(ctx,card);await ctx.waitFor("Boolean(document.querySelector('#template-description-tab'))");
        if(referenceDelivery){
          await ctx.eval(`(()=>{const input=document.querySelector('${dialog} input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['# 预览时机验证\\n\\nThis presentation introduces the reference product to the product team. Include three user benefits, supporting evidence and a clear launch plan. The unique source fact is that the headphones offer 42 hours of listening.'], 'reference-proof.md',{type:'text/markdown'}));const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],'reference-proof.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
          await ctx.fill('[data-testid=template-file-instructions]','预览时机验证：面向产品团队。');
        }else{
          await ctx.trustedClick('#template-description-tab');await ctx.fill('[data-testid=template-title]','预览时机验证');await ctx.fill('[data-testid=template-audience]','产品团队');
        }
      },
      assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]') && !window.__previewProof.sid && !document.querySelector('[data-testid=template-apply-dialog]').innerText.includes('不发原文件')"),'No preview or new session before submitting and no original-file switch'),
      screenshot:{name:'result-brief',requireText:referenceDelivery ? ['reference-proof.md','reference-proof.png'] : ['演示标题','手动填写'],rejectText:['entry.html','不发原文件']},
    });
    await ctx.trustedClick(submit);
    await ctx.waitFor('window.__previewProof.prompts.length===1 && Boolean(window.__previewProof.template)');
    await ctx.waitFor("!document.querySelector('[data-testid=template-apply-dialog]')");
    if(referenceDelivery) ctx.assert(await ctx.eval("(()=>{const p=window.__previewProof.prompts[0];const inputs=p.input??p.parts??[];const images=inputs.filter(x=>x.type==='image'||(x.type==='file'&&x.mime?.startsWith('image/')));return images.length===1 && images[0].url.startsWith('data:image/png;base64,') && JSON.stringify(p).includes('42 hours of listening');})()"),'The actual model request includes one image and the extracted document fact; model execution is intercepted');
    await ctx.eval(`(async()=>{const p=window.__previewProof;p.workspace=${JSON.stringify(projectId)};p.cache=(await import('/src/react-app/infra/query-client.ts')).getReactQueryClient();const surfaceSource=await(await fetch('/src/react-app/domains/session/surface/session-surface.tsx')).text();const activityUrl=surfaceSource.split(String.fromCharCode(10)).find(line=>line.includes('from "') && line.includes('session-activity-store.ts')).split('from "')[1].split('"')[0];p.activityImport=import(activityUrl);p.activity=(await p.activityImport).useSessionActivityStore;const k=['react-session-transcript',p.workspace,p.sid];p.user=p.cache.getQueryData(k)?.findLast(m=>m.role==='user');if(!p.user)throw Error('Submitted brief did not reach the conversation');p.user={...p.user,metadata:{ipollowork:{created:Date.now(),optimistic:false}}};p.seed=(phase)=>{const busy=phase!=='complete';const status={type:busy?'busy':'idle'};const reasoning={type:'reasoning',text:'先规划演示结构，再根据需求生成内容。',state:busy?'streaming':'done'};const text=phase==='complete'?{type:'text',text:'演示已完成：[预览时机验证]('+p.template.state.entry+')',state:'done'}:null;const assistant={id:'preview-proof-answer',role:'assistant',metadata:{ipollowork:{created:Date.now(),...(busy?{}:{completed:Date.now()})}},parts:[reasoning,...(text?[text]:[])]};const messages=[p.user,assistant];p.cache.setQueryData(k,messages);const snapshotKey=['react-session-snapshot',p.workspace,p.sid];const snap=p.cache.getQueryData(snapshotKey);if(snap)p.cache.setQueryData(snapshotKey,{...snap,messages,status});p.cache.setQueryData(['react-session-status',p.workspace,p.sid],status);p.activity.getState().seedSessionRun(p.workspace,p.sid,status,true);};p.seed('thinking');})()`,{awaitPromise:true});
    await ctx.prove('Submitted brief stays in the conversation while thinking',{
      voiceover:'提交表单后，对话中显示需求和思考进度，已复制的模板原稿不会自动打开。',
      action:async()=>{},
      assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]') && document.body.innerText.includes('预览时机验证') && window.__previewProof.prompts.length===1"),'The submitted conversation remains visible without opening the scaffold'),
      screenshot:{name:'result-thinking',requireText:['预览时机验证'],rejectText:['entry.html']},
    });
    await ctx.eval(`(async()=>{const p=window.__previewProof;const result=await p.fetch(p.base+'/workspace/'+p.workspace+'/files/content',{method:'POST',headers:p.headers,body:JSON.stringify({path:p.template.state.entry,content:'<!doctype html><html><head><meta charset="UTF-8"><title>预览时机验证</title></head><body style="margin:0;background:#171421;color:#fff;font-family:sans-serif"><main class="slide" data-ipw-slide style="width:1280px;height:720px;padding:80px;box-sizing:border-box"><p>产品团队 · 演示</p><h1 style="font-size:64px">结果生成之后，再打开预览</h1><p>需求 → 思考与规划 → 文件卡片 → 预览</p></main></body></html>'})});if(!result.ok)throw Error('Could not write the test output');p.seed('thinking');})()`,{awaitPromise:true});
    await ctx.prove('Writing a file during generation does not open the preview',{
      voiceover:'生成过程中即使文件已经写入，也继续留在对话页，等待本轮完成。',
      action:async()=>{},
      assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]')"),'The existing output file does not bypass the running state'),
      screenshot:{name:'result-generating',requireText:['预览时机验证'],rejectText:['entry.html']},
    });
    await ctx.prove('Completion shows one result card without opening the preview',{
      voiceover:'生成完成后，对话保留说明和一张结果卡片，右侧不会自动展开。',
      action:async()=>{await ctx.eval("window.__previewProof.seed('complete')");await ctx.waitFor("document.querySelectorAll('[data-testid=artifact-file-card]').length===1",{timeoutMs:20000});},
      assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=artifact-file-card]').length===1 && !document.querySelector('[data-testid=design-panel]') && document.body.innerText.includes('演示已完成') && window.__previewProof.prompts.length===1"),'The same file appears once and no preview opens automatically'),
      screenshot:{name:'result-complete',requireText:['预览时机验证','演示已完成']},
    });
    await ctx.prove('Clicking the result card opens the generated preview',{
      voiceover:'点击结果卡片，右侧才展示生成的演示文件。',
      action:async()=>{await ctx.trustedClick('[data-testid=artifact-file-card]');await ctx.waitFor("[...document.querySelectorAll('[data-testid=design-panel] iframe')].some(f=>f.contentDocument?.body?.innerText.includes('结果生成之后'))",{timeoutMs:20000});},
      assert:async()=>ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=artifact-file-card]').length===1 && Boolean(document.querySelector('[data-testid=design-panel]')) && window.__previewProof.prompts.length===1"),'Clicking opens the existing result without generating again'),
      screenshot:{name:'result-click-preview',requireText:['预览时机验证','演示已完成']},
    });
  } catch (error) {
    ctx.output('preview-state', JSON.stringify(await ctx.eval("(()=>{const p=window.__previewProof;return {hash:location.hash,status:p.cache?.getQueryData(['react-session-status',p.workspace,p.sid]),activity:p.activity?.getState().getStatus(p.workspace,p.sid),prompts:p.prompts.length,text:document.body.innerText.slice(-1800)}})()")));
    throw error;
  } finally {
    await ctx.navigateHash(originalHash);
    await ctx.eval(`(async()=>{const p=window.__previewProof;try{if(p.template){const created=await p.fetch(p.base+'/workspace/'+p.workspace+'/files/sessions',{method:'POST',headers:p.headers,body:JSON.stringify({write:true})});if(!created.ok)throw Error('Could not begin proof cleanup');const fileSession=await created.json();try{const removed=await p.fetch(p.base+'/files/sessions/'+fileSession.session.id+'/ops',{method:'POST',headers:p.headers,body:JSON.stringify({operations:[{type:'delete',path:p.template.state.entry.split('/').slice(0,-1).join('/'),recursive:true}]})});const result=await removed.json();if(!removed.ok || !result.items.every(item=>item.ok))throw Error('Could not clean isolated proof output');}finally{await p.fetch(p.base+'/files/sessions/'+fileSession.session.id,{method:'DELETE',headers:p.headers});}}if(p.sid){const response=await p.fetch(p.sessionUrl,{method:'DELETE',headers:p.headers});if(!response.ok)throw Error('Could not delete the isolated proof session');}}finally{window.fetch=p.fetch;}delete window.__previewProof;})()`,{awaitPromise:true});
  }
}

export default {
  id: "template-entry",
  title: "Template file and description entry interactions",
  kind: "user-facing",
  preserveTheme: true,
  steps: [{ name: "Use existing template UI and reference ingestion", async run(ctx) {
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_AFTER_RESULT_ONLY === '1' || ctx.env.IPOLLOWORK_EVAL_TEMPLATE_REFERENCE_DELIVERY_ONLY === '1') return provePreviewAfterResult(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_SESSION_CUSTOM_ONLY === '1') return proveSessionCustomEntry(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_DEFERRED_ONLY === '1') return proveDeferredTemplate(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_LOCATION_ONLY === '1') return proveProjectLocation(ctx);
    if(!await ctx.eval("Boolean(document.querySelector('#template-file-tab'))")){
      await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='模板')");
      await ctx.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='模板').click()`);
      await ctx.waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent==='自定义模板')`);
      await ctx.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='自定义模板').click()`);
    }
    await ctx.waitFor(`Boolean(document.querySelector('#template-file-tab'))`);
    await click(ctx, '#template-file-tab');
    await ctx.eval("document.querySelectorAll('[data-sonner-toast] button[aria-label=\"Close notification\"]').forEach(b=>b.click())");
    await ctx.waitFor("!document.querySelector('[data-sonner-toast]')");
    await ctx.eval(`window.__templateEntryFetch=window.fetch; window.__templateEntryWrites=[];
      window.fetch=async function(input,init){
        const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
        if(init?.method==='POST' && url.endsWith('/sessions'))return new Response(JSON.stringify({item:{id:'ses_template_entry_proof'}}),{status:200,headers:{'Content-Type':'application/json'}});
        if(init?.method==='DELETE' && url.endsWith('/sessions/ses_template_entry_proof'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
        if(init?.method==='POST' && ['/files/content','/templates/authoring-sessions','/materialize'].some(suffix=>url.endsWith(suffix))){
          const body=JSON.parse(init.body); window.__templateEntryWrites.push(body.brief ?? JSON.parse(body.content));
          return new Response(JSON.stringify({error:'Preview only: generation was not submitted'}),{status:409,headers:{'Content-Type':'application/json'}});
        }
        return window.__templateEntryFetch(input,init);
      }; window.__templateEntryTheme=document.documentElement.getAttribute('data-theme'); window.__templateEntryColorScheme=document.documentElement.style.colorScheme;`);
    try {
      if(await ctx.eval("Boolean(document.querySelector('#custom-template-category'))")){
        await click(ctx,'#custom-template-category');
        await ctx.waitFor("[...document.querySelectorAll('[role=option]')].filter(e=>e.checkVisibility()).length===9");
        const categories=await ctx.eval("[...document.querySelectorAll('[role=option]')].filter(e=>e.checkVisibility()).map(e=>e.textContent)");
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        for(const category of categories){
          await click(ctx,'#custom-template-category');
          await ctx.waitFor("[...document.querySelectorAll('[role=option]')].filter(e=>e.checkVisibility()).length===9");
          await ctx.eval(`document.querySelectorAll('[data-template-proof-choice]').forEach(e=>e.removeAttribute('data-template-proof-choice'));[...document.querySelectorAll('[role=option]')].filter(e=>e.checkVisibility()).find(e=>e.textContent===${JSON.stringify(category)}).setAttribute('data-template-proof-choice','true')`);
          await ctx.trustedClick('[data-template-proof-choice=true]');
          await ctx.waitFor(`document.querySelector('#custom-template-category').textContent.includes(${JSON.stringify(category)})`);
          await ctx.assert(await ctx.eval(`Boolean(document.querySelector('#template-file-tab')) && Boolean(document.querySelector('#template-description-tab')) && !document.querySelector('${dialog} input[required]')`),`${category}: file mode uses the shared two-mode entry`);
          await click(ctx,'#template-description-tab');
          await ctx.assert(await ctx.eval(`document.querySelectorAll('${dialog} input[required]').length===2 && !document.querySelector('${dialog} textarea[required]') && !document.querySelector('${dialog} input[type=file]') && document.querySelector('${submit}').disabled`),`${category}: custom content has required title and audience with optional details`);
          await click(ctx,'#template-file-tab');
        }
        await ctx.prove('All nine template categories use the same entry',{
        voiceover: "切换不同类型的模板，创建入口仍然保留参考文件和手动填写两种方式。",
          assert:async()=>ctx.assert(categories.length===9,'Site, video, slides, app, poster, cards, report, article and other were checked through the category selector'),
          screenshot:{name:'all-categories',requireText:['上传文件','手动填写']},
        });
      }
      await ctx.prove("File entry has no repeated required fields", {
        voiceover: "打开文件方式，上传入口和可选补充要求清晰分组，无需重复填写主题和受众。",
        action: async () => {
          // Exercise the real upload handler, suppressing only the native picker in this UI check.
          await ctx.eval(`window.__templateUploadClicks=0;document.querySelector('${dialog} input[type=file]').addEventListener('click',event=>{event.preventDefault();window.__templateUploadClicks++;},{once:true});`);
          await ctx.trustedClick(`${dialog} button[aria-label="上传参考文件"]`);
          ctx.assert(await ctx.eval('window.__templateUploadClicks===1'), 'The upload tile invokes the existing file picker exactly once');
          await ctx.eval('delete window.__templateUploadClicks');
          await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10});
          await ctx.eval("document.querySelector('[data-testid=template-file-instructions]').focus()");
          await ctx.waitFor("!document.querySelector('[data-slot=tooltip-content]')");
        },
        assert: async () => {
          ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled && !document.querySelector('${dialog} input[required]') && document.querySelector('#template-file-tab').getAttribute('aria-selected')==='true'`), "An empty file entry cannot submit and requests no title or audience");
          ctx.assert(await ctx.eval(`(()=>{const e=document.querySelector('[data-testid=template-file-instructions]');return e.rows===3 && e.getBoundingClientRect().height<=100;})()`), 'The optional instructions start at three compact lines');
          ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('[data-testid=template-file-instructions]')).resize==='none' && getComputedStyle(document.querySelector('${dialog} [data-slot=dialog-footer]')).borderTopWidth==='0px'`), 'File mode has no resize handle or footer divider');
          ctx.assert(await ctx.eval(`(()=>{const e=document.querySelector('[data-testid=template-reference-formats-trigger]'),r=e.getBoundingClientRect(),icon=e.querySelector('svg').getBoundingClientRect(),s=getComputedStyle(e);return Math.abs(icon.left+icon.width/2-r.left-r.width/2)<2 && s.flexDirection==='column' && s.textAlign==='center' && s.borderTopWidth==='0px';})()`), 'Upload content is centered on a borderless tile');
          ctx.assert(await ctx.eval(`(()=>{const e=document.querySelector('[data-testid=template-file-instructions]'),d=document.querySelector('${dialog}');return getComputedStyle(e).borderTopWidth==='0px' && getComputedStyle(e).backgroundColor!==getComputedStyle(d).backgroundColor;})()`),'File instructions use a gray background without borders');
        },
        screenshot: {name:"file-entry", requireText:["上传参考文件","PDF","25"], rejectText:["Something went wrong"]},
      });
      await ctx.prove('Centered upload shows formats and size with keyboard access', {
        voiceover:'上传入口居中展示，支持的文件类型和单个文件大小直接显示在下方，键盘也能聚焦上传。',
        action:async()=>{
          await ctx.client.send('Page.bringToFront');
          await ctx.eval("document.querySelector('[data-testid=template-file-instructions]').focus()");
          await ctx.client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
          await ctx.client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
          await ctx.waitFor("document.activeElement.matches('[data-testid=template-reference-formats-trigger]')");
        },
        assert:async()=>ctx.assert(await ctx.eval("document.activeElement.matches('[data-testid=template-reference-formats-trigger]') && document.activeElement.matches(':focus-visible') && document.activeElement.textContent.includes('25')"),'Upload supports visible keyboard focus and displays the actual size limit'),
        screenshot:{name:'supported-formats',requireText:['PDF','DOCX','PPTX','JSON','25']},
      });
      await ctx.eval("document.querySelector('[data-testid=template-file-instructions]').focus()");
      await ctx.waitFor("!document.querySelector('[data-slot=tooltip-content]')");
      await ctx.eval(`(()=>{const input=document.querySelector('${dialog} input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['# Source document\\n\\nAudience: Customers\\n\\nThis presentation explains our product launch, its three customer benefits and the rollout plan. Focus on the new collaboration tools, faster workflows and a clear next step for the audience. Include a launch overview, product highlights, supporting evidence and a final call to action.'], 'launch-brief.md',{type:'text/markdown'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await ctx.waitFor(`document.querySelector('${submit}').disabled===false`, {timeoutMs:60000});
      await ctx.fill('[data-testid="template-file-instructions"]', 'Emphasize customer benefits');
      await ctx.prove("A file is sufficient; extra instructions are optional", {
        voiceover: "上传后，附件只显示文件名、大小和删除按钮，补充要求仍然可选。",
        assert: async () => ctx.assert(await ctx.eval(`document.querySelector('${dialog}').innerText.includes('launch-brief.md') && !document.querySelector('[data-testid="template-file-instructions"]').required && !document.querySelector('${submit}').disabled`), "The existing file card reports readiness without additional required fields"),
        screenshot: {name:"file-ready", requireText:["launch-brief.md"], rejectText:["Something went wrong"]},
      });
      ctx.assert(await ctx.eval("(()=>{const card=document.querySelector('[data-testid=template-reference-card]');return card.getBoundingClientRect().height<=64 && card.getBoundingClientRect().width<=240 && getComputedStyle(card).borderTopWidth==='0px' && !card.innerText.includes('质量') && card.querySelectorAll('button').length===1 && !card.querySelector('button[aria-pressed]');})()"),'Attachment card is compact and borderless without an original-file switch');
      await ctx.prove('Images display thumbnails beside compact document cards', {
        voiceover:'图片以缩略图并排展示，文档使用短卡片，文件名过长会截断，删除按钮始终可见。',
        action:async()=>{
          await ctx.eval(`(()=>{const input=document.querySelector('${dialog} input[type=file]');const transfer=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII='),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],'reference-proof.png',{type:'image/png'}));transfer.items.add(new File([bytes],'second-reference-proof.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
          await ctx.waitFor("document.querySelectorAll('[data-testid=template-reference-card] img').length===2 && [...document.querySelectorAll('[data-testid=template-reference-card] img')].every(img=>img.complete&&img.naturalWidth>0)");
        },
        assert:async()=>ctx.assert(await ctx.eval("(()=>{const c=[...document.querySelectorAll('[data-testid=template-reference-card]')].find(c=>c.innerText.includes('reference-proof.png'));return c.getBoundingClientRect().width<=240 && c.getBoundingClientRect().height===48 && [...document.querySelectorAll('[data-testid=template-reference-card]')].every(e=>e.getBoundingClientRect().height===48) && c.querySelector('img').getBoundingClientRect().height<=32 && c.querySelectorAll('button').length===1 && getComputedStyle(c.querySelector('img')).objectFit==='contain' && getComputedStyle(c.parentElement).flexWrap==='wrap' && !c.querySelector('button[aria-pressed]');})()"),'Two decoded image previews and a compact document card share a wrapping attachment area'),
        screenshot:{name:'image-reference',requireText:['reference-proof.png'],rejectText:['不发原文件','发送原文件','解析失败','OCR']},
      });
      await click(ctx, '#template-description-tab');
      await ctx.waitFor("Boolean(document.querySelector('[data-testid=template-title]'))");
      await ctx.prove('Required fields are marked and reject blank input', {
        voiceover:'标题和面向谁标有红色星号，任一项为空或只有空格时，都不能生成。补充信息无需填写。',
        action:async()=>{
          ctx.assert(await ctx.eval("['template-title','template-audience'].every(id=>{const e=document.querySelector('[data-testid='+id+']');return e.required&&e.validity.valueMissing&&e.closest('label').querySelector('.text-destructive')?.textContent==='*';}) && !document.querySelector('[data-testid=template-description]').required"),'Both title and audience are actual required controls with red markers');
          await click(ctx,submit);
          ctx.assert(await ctx.eval('window.__templateEntryWrites.length===0'),'An empty form sends no request');
          for(const values of [['   ','Customers'],['Launch story','   '],['','Customers'],['Launch story','']]) {
            await ctx.fill('[data-testid="template-title"]',values[0]);
            await ctx.fill('[data-testid="template-audience"]',values[1]);
            ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`),'An empty or whitespace-only required field disables generation');
            await click(ctx,submit);
            ctx.assert(await ctx.eval('window.__templateEntryWrites.length===0'),'Invalid fields cannot submit');
          }
          await ctx.fill('[data-testid="template-title"]','');
        },
        assert:async()=>ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled && !document.querySelector('[data-testid=template-description]').closest('label').textContent.includes('可选') && !document.querySelector('[data-testid=template-description]').closest('label').textContent.includes('*')`),'Only required fields have markers; optional details have no suffix'),
        screenshot:{name:'required-fields',requireText:['手动填写','*'],rejectText:['（可选）']},
      });
      await ctx.fill('[data-testid="template-title"]', 'Launch story');
      ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`), 'An audience is required with the title');
      await ctx.fill('[data-testid="template-audience"]', 'Customers');
      ctx.assert(await ctx.eval(`!document.querySelector('${submit}').disabled`), 'Details are optional after filling title and audience');
      await ctx.fill('[data-testid="template-description"]', 'Create a customer product launch with three benefits.');
      await click(ctx, '#template-file-tab');
      await ctx.assert(await ctx.eval(`document.querySelector('[data-testid="template-file-instructions"]').value==='Emphasize customer benefits'`), "File instructions survive mode switching");
      if (ctx.env.IPOLLOWORK_EVAL_TEMPLATE_UI_ONLY !== '1') {
      await ctx.eval("for(const name of ['reference-proof.png','second-reference-proof.png'])document.querySelector('button[aria-label*=\"'+name+'\"]')?.click()");
      await click(ctx, submit);
      await ctx.waitFor('window.__templateEntryWrites.length===1');
      await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
      await ctx.assert(await ctx.eval(`window.__templateEntryWrites[0].referenceFiles[0].name==='launch-brief.md' && window.__templateEntryWrites[0].details==='Emphasize customer benefits'`), "File submission includes only the file and its instructions");
      }
      await click(ctx, '#template-description-tab');
      await ctx.prove("Description mode retains its own draft and hides the file", {
        voiceover: "手动填写恢复标题、受众和补充内容，往返切换仍保留各自草稿。",
        assert: async () => ctx.assert(await ctx.eval(`document.querySelector('[data-testid="template-title"]').value==='Launch story' && document.querySelector('[data-testid="template-audience"]').value==='Customers' && document.querySelector('[data-testid="template-description"]').value==='Create a customer product launch with three benefits.' && !document.querySelector('${dialog} input[type=file]')`), "Switching preserves the description without including hidden references"),
        screenshot: {name:"description-entry", requireText:["手动填写"], rejectText:["Something went wrong"]},
      });
      ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}');return [...d.querySelectorAll('input[data-testid],textarea[data-testid]')].every(e=>getComputedStyle(e).borderTopWidth==='0px'&&getComputedStyle(e).backgroundColor!==getComputedStyle(d).backgroundColor);})()`), 'Custom inputs share the borderless gray treatment');
      ctx.assert(await ctx.eval(`getComputedStyle(document.querySelector('[data-testid=template-description]')).resize==='none' && getComputedStyle(document.querySelector('${dialog} [data-slot=dialog-footer]')).borderTopWidth==='0px'`), 'Custom mode has no resize handle or footer divider');
      await ctx.eval(`(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
        const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
        const luminance=rgb=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
        const bg=rgba(getComputedStyle(document.querySelector('${dialog}')).backgroundColor);
        window.__templateContrast=[['[data-slot=dialog-description]',null],['[data-testid=template-title]','::placeholder'],['[data-testid=template-description]','::placeholder']].map(([selector,pseudo])=>{const e=document.querySelector('${dialog} '+selector),fg=rgba(getComputedStyle(e,pseudo).color),rgb=fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255)),a=luminance(rgb),b=luminance(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);});
      })()`);
      ctx.assert(await ctx.eval('window.__templateContrast.every(ratio=>ratio>=4.5)'), 'Description and placeholders have at least 4.5:1 contrast');
      await ctx.eval('delete window.__templateContrast');
      if (ctx.env.IPOLLOWORK_EVAL_TEMPLATE_UI_ONLY !== '1') {
      await ctx.eval("for(const name of ['reference-proof.png','second-reference-proof.png'])document.querySelector('button[aria-label*=\"'+name+'\"]')?.click()");
      await click(ctx, submit);
      await ctx.waitFor('window.__templateEntryWrites.length===2');
      await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
      await ctx.assert(await ctx.eval(`window.__templateEntryWrites[1].referenceFiles.length===0 && window.__templateEntryWrites[1].title==='Launch story' && window.__templateEntryWrites[1].audience==='Customers' && window.__templateEntryWrites[1].details==='Create a customer product launch with three benefits.'`), "Custom submission preserves its three fields and excludes uploaded references");
      }
      await ctx.prove("Narrow dark layouts keep controls within the dialog", {
        voiceover: "缩小窗口并切换深色外观，输入框、附件操作和底部按钮依然完整可见。",
        action: async () => {
          await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:420,height:820,deviceScaleFactor:1,mobile:false});
          await ctx.eval("document.documentElement.setAttribute('data-theme','dark'); document.documentElement.style.colorScheme='dark'");
          await click(ctx, '#template-file-tab');
        },
        assert: async () => ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}'),r=d.getBoundingClientRect();return getComputedStyle(d).colorScheme==='dark' && r.left>=0 && r.right<=innerWidth && d.scrollWidth<=d.clientWidth+1 && [...d.querySelectorAll('button,textarea')].every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left && b.right<=r.right+1;});})()`), "Upload, file actions and submit controls fit at 420px in dark mode"),
        screenshot: {name:"narrow-dark", requireText:["launch-brief.md"], rejectText:["Something went wrong"]},
      });
      if (ctx.env.IPOLLOWORK_EVAL_TEMPLATE_UI_ONLY === '1') ctx.assert(await ctx.eval("(()=>{const cards=[...document.querySelectorAll('[data-testid=template-reference-card]')];const parent=cards[0].parentElement.getBoundingClientRect();return cards.length===3 && new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top))).size>1 && cards.every(c=>{const r=c.getBoundingClientRect();return r.left>=parent.left&&r.right<=parent.right+1;});})()"),'Mixed attachments wrap within the narrow modal without horizontal overflow');
      await ctx.prove('Custom fields fit a narrow dark window', {
        voiceover:'窄窗口下，标题、受众和补充内容纵向排列，输入和生成按钮保持可用。',
        action:async()=>{await click(ctx,'#template-description-tab');await ctx.waitFor("Boolean(document.querySelector('[data-testid=template-title]'))");},
        assert:async()=>ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}'),r=d.getBoundingClientRect();return document.querySelectorAll('${dialog} input[required]').length===2 && d.scrollWidth<=d.clientWidth+1 && [...d.querySelectorAll('input[data-testid],textarea[data-testid]')].every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1;});})()`),'All three custom inputs fit at 420px'),
        screenshot:{name:'custom-narrow-dark',requireText:['手动填写']},
      });
      await click(ctx, '#template-description-tab');
      await ctx.fill('[data-testid="template-title"]','');
      await ctx.fill('[data-testid="template-audience"]','');
      await ctx.fill('[data-testid="template-description"]','');
      await click(ctx, '#template-file-tab');
      await ctx.fill('[data-testid="template-file-instructions"]','');
      await ctx.eval(`for(const name of ["launch-brief.md","reference-proof.png","second-reference-proof.png"])document.querySelector('${dialog} button[aria-label*="'+name+'"]')?.click()`);
      await ctx.assert(await ctx.eval(`document.querySelector('${submit}').disabled`), "Removing the last reference disables file generation");
      await ctx.prove("English labels fit the same narrow layout", {
        voiceover: "切换英文后，较长的标签也能正常换行，弹窗没有横向溢出。",
        action: async () => {
          await ctx.eval(`window.__templateEntryLocaleSetup=(async()=>{const source=await (await fetch('/src/react-app/domains/session/chat/session-page.tsx')).text();const url=source.split('"').find(value=>value.startsWith('/src/i18n/index.ts'));const locale=await import(url);window.__templateEntryI18n=locale;window.__templateEntryLocale=locale.currentLocale();locale.setLocale('en');})()`, {awaitPromise:true});
          await click(ctx, '#template-description-tab');
          await click(ctx, '#template-file-tab');
          await ctx.waitFor("document.querySelector('#template-description-tab')?.innerText.includes('Fill in manually')");
        },
        assert: async () => ctx.assert(await ctx.eval(`(()=>{const d=document.querySelector('${dialog}');return d.innerText.includes('Additional instructions') && d.scrollWidth<=d.clientWidth+1;})()`), "English controls and instructions remain readable without horizontal overflow"),
        screenshot: {name:"english-narrow", requireText:["Additional instructions"], rejectText:["Something went wrong"]},
      });
    } finally {
      await ctx.eval("if(window.__templateEntryLocale){window.__templateEntryI18n.setLocale(window.__templateEntryLocale);delete window.__templateEntryLocale;delete window.__templateEntryI18n;}");
      await click(ctx, '#template-description-tab');
      await ctx.fill('[data-testid="template-title"]','');
      await ctx.fill('[data-testid="template-audience"]','');
      await ctx.fill('[data-testid="template-description"]','');
      await click(ctx, '#template-file-tab');
      await ctx.fill('[data-testid="template-file-instructions"]','');
      await ctx.eval(`for(const name of ["launch-brief.md","reference-proof.png","second-reference-proof.png"]) document.querySelector('${dialog} button[aria-label*="'+name+'"]')?.click()`);
      await ctx.eval("window.fetch=window.__templateEntryFetch; if(window.__templateEntryTheme===null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',window.__templateEntryTheme); document.documentElement.style.colorScheme=window.__templateEntryColorScheme; delete window.__templateEntryFetch; delete window.__templateEntryWrites; delete window.__templateEntryTheme; delete window.__templateEntryColorScheme;");
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
    }
  }}],
};
