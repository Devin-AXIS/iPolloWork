import templateReferenceFlow from "./template-reference-wizard.flow.mjs";
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
    screenshot: {name:'project-location',requireText:['参考文件','手动填写'],rejectText:['创建位置']},
  });
  await ctx.eval(`window.__templateLocationFetch=window.fetch;window.__templateLocationRequests=[];window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(init?.method==='POST'&&url.endsWith('/sessions')){window.__templateLocationRequests.push(url);return new Response(JSON.stringify({error:'Location validation only'}),{status:409,headers:{'Content-Type':'application/json'}});}return window.__templateLocationFetch(input,init);};`);
  try {
    await click(ctx,'#template-description-tab');
    await ctx.fill('[data-testid=template-title]', '验证标题');
    await ctx.fill('[data-testid=template-audience]', '产品团队');


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
    screenshot:{name:'global-location',requireText:['创建位置','参考文件']},
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
    await ctx.fill('[data-testid=template-title]', '验证标题');
    await ctx.fill('[data-testid=template-audience]', '产品团队');


    await ctx.fill('[data-testid="template-description"]','Create a six-slide brand presentation.');
    await click(ctx,submit);
    await ctx.waitFor('window.__templateDeferredWrites.length===1');
    ctx.assert(await ctx.eval(`window.__templateDeferredWrites[0]==='/workspace/${projectId}/sessions'`),'Clicking Generate initiates creation in the originating project; request blocked before creating test data');
    await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
    ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]')"),'A failed submission does not open the workbench');


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
          await ctx.fill('[data-testid=template-title]', '验证标题');
          await ctx.fill('[data-testid=template-audience]', '产品团队');
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
      voiceover:referenceDelivery ? '上传参考文档后就能生成，无需选择是否发送原文件，也不用重复填写文档内容。' : '选择做 PPT 和模板后，描述演示需求，此时右侧预览保持关闭。',
      action:async()=>{
        await click(ctx,card);await ctx.waitFor("Boolean(document.querySelector('#template-description-tab'))");
        if(referenceDelivery){
          await ctx.eval(`(()=>{const input=document.querySelector('${dialog} input[type=file]');const transfer=new DataTransfer();transfer.items.add(new File(['# 预览时机验证\\n\\nThis presentation introduces the reference product to the product team. Include three user benefits, supporting evidence and a clear launch plan. The unique source fact is that the headphones offer 42 hours of listening.'], 'reference-proof.md',{type:'text/markdown'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          await ctx.waitFor(`!document.querySelector('${submit}').disabled`);
          await ctx.fill('[data-testid=template-file-instructions]','预览时机验证：面向产品团队。');
        }else{
          await ctx.trustedClick('#template-description-tab');
          await ctx.fill('[data-testid=template-title]', '验证标题');
          await ctx.fill('[data-testid=template-audience]', '产品团队');
          await ctx.fill('[data-testid=template-description]', '预览时机验证：为产品团队创建演示，说明产品优势和发布计划。');
        }
      },
      assert:async()=>ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel]') && !window.__previewProof.sid && !document.querySelector('[data-testid=template-apply-dialog]').innerText.includes('不发原文件')"),'No preview or new session before submitting and no original-file switch'),
      screenshot:{name:'result-brief',requireText:referenceDelivery ? ['reference-proof.md'] : ['手动填写'],rejectText:['entry.html','不发原文件']},
    });
    await ctx.trustedClick(submit);
    await ctx.waitFor('window.__previewProof.prompts.length===1 && Boolean(window.__previewProof.template)');
    await ctx.waitFor("!document.querySelector('[data-testid=template-apply-dialog]')");
    if(referenceDelivery) ctx.assert(await ctx.eval("(()=>{const p=window.__previewProof.prompts[0];const inputs=p.input??p.parts??[];const images=inputs.filter(x=>x.type==='image'||(x.type==='file'&&x.mime?.startsWith('image/')));return images.length===0 && JSON.stringify(p).includes('42 hours of listening');})()"),'The actual model request includes the extracted document fact; model execution is intercepted');
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
  title: "Template entry and project routing",
  kind: "user-facing",
  steps: [{name: "Template entry", async run(ctx) {
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_AFTER_RESULT_ONLY === '1' || ctx.env.IPOLLOWORK_EVAL_TEMPLATE_REFERENCE_DELIVERY_ONLY === '1') return provePreviewAfterResult(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_SESSION_CUSTOM_ONLY === '1') return proveSessionCustomEntry(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_DEFERRED_ONLY === '1') return proveDeferredTemplate(ctx);
    if(ctx.env.IPOLLOWORK_EVAL_TEMPLATE_LOCATION_ONLY === '1') return proveProjectLocation(ctx);
    return templateReferenceFlow.steps[0].run(ctx);
  }}],
};
