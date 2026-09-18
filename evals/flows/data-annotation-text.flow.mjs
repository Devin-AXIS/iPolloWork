import { connect, debuggerUrlFor, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
const hostFrame = 'iframe[title="数据标注"]';
export default {
  id: 'data-annotation-text', title: 'Text labels, home-only role switching and host MCP actions',
  kind: 'user-facing', preserveTheme: true, requiredEnv: ['IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE'],
  steps: [{ name: 'Text labels, persistence and review', async run(ctx) {
    const workspaceId = ctx.env.IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE;
    await ctx.client.send('Page.bringToFront');
    await ctx.navigateHash(`/workspace/${workspaceId}/session`);
    await ctx.waitFor('Boolean(window.__ipolloworkControl)');
    const workspaceRoot = await ctx.eval(`(async () => {
      const { ipolloworkServerInfo } = await import('/src/app/lib/desktop.ts');
      const { createiPolloWorkServerClient } = await import('/src/app/lib/ipollowork-server.ts');
      const info = await ipolloworkServerInfo();
      const client = createiPolloWorkServerClient({baseUrl:info.baseUrl, token:info.ownerToken || info.clientToken, hostToken:info.hostToken});
      const result = await client.listWorkspaces();
      const workspace = (result.workspaces ?? result.items).find(item => item.id === ${JSON.stringify(workspaceId)});
      if (!workspace || !(workspace.name ?? '').startsWith('标注升级验收')) throw new Error('Use a dedicated annotation review test workspace');
      return workspace.path;
    })()`, { awaitPromise: true });
    if (await ctx.eval('Boolean(document.querySelector(\'button[aria-label="Close tab: 数据标注"]\'))')) {
      await ctx.trustedClick('button[aria-label="Close tab: 数据标注"]');
    }
    await ctx.trustedClick('[data-testid="sidebar-data-annotation"]');
    await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(hostFrame)})?.contentDocument?.querySelector('#workbench')?.getAttribute('src'))`, { timeoutMs: 60000 });
    const frameUrl = await ctx.eval(`document.querySelector(${JSON.stringify(hostFrame)}).contentDocument.querySelector('#workbench').src`);
    let target;
    for (let attempt = 0; attempt < 40 && !target; attempt++) {
      target = (await listTargets(ctx.cdpBaseUrl)).find(item => item.type === 'iframe' && item.url === frameUrl);
      if (!target) await new Promise(done => setTimeout(done, 250));
    }
    ctx.assert(Boolean(target), 'Annotation loads as an embedded frame in the main app');
    const client = await connect(debuggerUrlFor(ctx.cdpBaseUrl, target));
    const child = new EvalContext({ client, outDir: ctx.outDir, flowId: ctx.flowId });


    const get = path => child.eval('fetch('+JSON.stringify(path)+' + (('+JSON.stringify(path)+').includes("?")?"&":"?") + location.search.slice(1), {cache:"no-store"}).then(r=>r.json())',{awaitPromise:true});
    const role = async value => {
      const title = await child.eval('document.querySelector(".project-title strong")?.textContent');
      if (title) {
        await child.trustedClick('.app-header > .header-button');
        await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
      }
      await child.eval('(()=>{const s=document.querySelector(".role-control select");s.value='+JSON.stringify(value)+';s.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await child.waitFor('document.querySelector(".role-control select")?.value === '+JSON.stringify(value)+' && !document.querySelector(".role-control select").disabled');
      if (title) {
        await child.clickText(title, {selector: '.project-row'});
        await child.waitFor('Boolean(document.querySelector(".editor-shell"))');
        ctx.assert(!await child.eval('Boolean(document.querySelector(".editor-shell .role-control"))'), 'Role switching is absent from annotation detail');
      }
    };

    const hostCall = (action,args={}) => ctx.eval('(async()=>{const {ipolloworkServerInfo}=await import("/src/app/lib/desktop.ts");const {createiPolloWorkServerClient}=await import("/src/app/lib/ipollowork-server.ts");const info=await ipolloworkServerInfo();const client=createiPolloWorkServerClient({baseUrl:info.baseUrl,token:info.ownerToken||info.clientToken,hostToken:info.hostToken});const reply=await client.callExtensionAction('+JSON.stringify({extensionId:'labelu-data-annotation',action,args,context:{directory:workspaceRoot,workspaceId}})+');if(!reply.ok)throw Error(reply.message);return reply.result;})()',{awaitPromise:true});
    let projectId;
    try {
      await child.waitFor('Boolean(document.querySelector("#training-tab"))');
      await child.trustedClick('#training-tab');
      await child.clickText('通知要素标注',{selector:'.template-card'});
      await child.waitFor('Boolean(document.querySelector(".text-inspector #marks-tab"))');
      await ctx.prove('Text annotation replaces document classification with right-side mark and label tabs',{
        voiceover:'文字标注右侧现在是标记和标签集。选择正文添加标记后，直接切换标签集，未保存的标注会先保存。',
        action:async()=>{
          ctx.assert(!await child.eval('Boolean(document.querySelector(".classification-field"))'),'Document classification input removed');
          await child.eval('(()=>{const a=document.querySelector(".text-source textarea");const i=a.value.indexOf("2026年10月12日");if(i<0)throw Error("Missing teaching text");a.focus();a.setSelectionRange(i,i+11);})()');
          await child.trustedClick('.text-actions button');
          await child.waitFor('document.querySelectorAll(".span-item").length === 1');
          await child.trustedClick('#labels-tab');
          await child.waitFor('Boolean(document.querySelector(".annotation-labels-panel"))');
        },
        assert:async()=>{
          const p=(await get('/api/projects')).projects.find(p=>p.title==='通知要素标注');projectId=p.id;
          const saved=(await get('/api/project?projectId='+projectId)).project;
          ctx.assert(saved.annotations.spans.length===1 && saved.annotations.spans[0].text==='2026年10月12日','Switching to labels saves the span');
          ctx.assert(!('classification' in saved.annotations),'New text record has no document classification field');
          ctx.assert(await child.eval('document.querySelector(".text-inspector .label-editor") !== null'),'Label editor lives in text sidebar');
        },
        screenshot:{name:'text-labels-sidebar',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
      await ctx.prove('Renaming a text label updates its span and persists after reopening',{
        voiceover:'在右侧修改标签名称并应用，已有文字标记也同步更新。项目面板不再重复显示标签集，重新打开后修改仍然保留。',
        action:async()=>{
          await child.fill('.annotation-labels-panel input[aria-label="第 1 个标签名称"]','日期时间');
          await child.clickText('应用标签',{selector:'.annotation-labels-panel button',exact:true});
          await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
          await child.trustedClick('#marks-tab');
          await child.waitFor('document.querySelector(".span-label")?.textContent === "日期时间"');
          await child.clickText('项目',{selector:'.header-actions button',exact:true});
          ctx.assert(await child.eval('Boolean(document.querySelector(".project-inspector")) && !document.querySelector(".project-inspector .label-editor")'),'Project panel has no duplicate label editor');
          await child.clickText('收起',{selector:'.project-inspector button',exact:true});
          await child.trustedClick('.app-header > .header-button');
          await child.waitFor('Boolean(document.querySelector(".project-row"))');
          await child.clickText('通知要素标注',{selector:'.project-row'});
          await child.waitFor('document.querySelector(".span-label")?.textContent === "日期时间"');
        },
        assert:async()=>{
          const saved=(await get('/api/project?projectId='+projectId)).project;
          ctx.assert(saved.labels[0]==='日期时间' && saved.annotations.spans[0].label==='日期时间','Label name and span are stored consistently');
          ctx.assert(await child.eval('document.querySelector(".text-actions select").value === "日期时间"'),'Text annotation picker uses updated labels');
        },
        screenshot:{name:'text-marks-reopened',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
      await ctx.prove('Reviewers can inspect both tabs but cannot edit labels, and approved text exports retain spans',{
        voiceover:'审核员可以查看标记和标签集，不能修改内容。审核通过后，两种角色都可以导出包含文字区间和标签的 JSON。',
        action:async()=>{
          await role('reviewer');
          await child.trustedClick('#labels-tab');
          ctx.assert(await child.eval('document.querySelector(".label-editor").disabled && document.querySelector(".text-source textarea").readOnly'),'Reviewer label set and text are read-only');
          await child.trustedClick('#marks-tab');
          await child.fill('input[aria-label="审核意见"]','区间与日期标签已核对。');
          await child.clickText('审核通过',{selector:'.review-form button',exact:true});
          await child.waitFor('document.querySelector(".review-badge")?.textContent === "已通过"');
          const reviewer=await get('/api/project-export?projectId='+projectId);
          ctx.assert(reviewer.project?.annotations.spans[0].label==='日期时间','Reviewer exports approved text label');
          await role('annotator');
        },
        assert:async()=>{
          const exported=await get('/api/project-export?projectId='+projectId);
          ctx.assert(exported.project?.review.status==='approved' && exported.project.annotations.spans[0].text==='2026年10月12日','Annotator exports approved text span');
          ctx.assert(await child.eval('[...document.querySelectorAll(".header-actions button")].find(b=>b.textContent==="导出 JSON").disabled === false'),'Export button enabled');
        },
        screenshot:{name:'text-reviewed-export',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });

      await ctx.prove('Host extension actions create, annotate, label, review and export the same records displayed in the workbench',{
        voiceover:'主软件可以通过扩展接口创建和保存标注、调整标签、审核并导出。回到首页刷新，能看到同一条记录；角色切换只在首页显示。',
        action:async()=>{
          await child.trustedClick('.app-header > .header-button');
          await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
          const templates=await hostCall('list-training-templates');
          ctx.assert(templates.length===12,'Host discovers training templates through extension dispatcher');
          let p=await hostCall('create-text-project',{title:'MCP 接口联调 '+Date.now(),textContent:'李明来到上海。'});
          p=await hostCall('update-project',{projectId:p.id,expectedRevision:p.revision,annotations:{spans:[{id:'person',start:0,end:2,text:'李明',label:'实体'}]}});
          p=await hostCall('update-project-labels',{projectId:p.id,expectedRevision:p.revision,labels:[{name:'人物',color:'#2563eb'}],replacements:{实体:'人物'}});
          p=await hostCall('review-project',{projectId:p.id,expectedRevision:p.revision,status:'approved',comment:'MCP 联调记录，核对通过。'});
          const exported=await hostCall('export-project',{projectId:p.id});
          ctx.assert(exported.project.annotations.spans[0].label==='人物' && exported.project.updateSource==='ai','Host export contains saved renamed span and AI source');
          await child.trustedClick('.refresh-records');
          await child.waitFor('Array.from(document.querySelectorAll(".project-row strong")).some(e=>e.textContent==='+JSON.stringify(p.title)+')');
          ctx.assert(await child.eval('document.querySelector(".role-control select").value === "annotator"'),'MCP review leaves workbench role unchanged');
          await child.clickText(p.title,{selector:'.project-row'});
          await child.waitFor('document.querySelector(".span-label")?.textContent === "人物"');
          ctx.assert(await child.eval('document.querySelector(".review-badge").textContent === "已通过" && !document.querySelector(".role-control")'),'UI displays host-approved record without a role selector');
        },
        assert:async()=>{
          const p=(await hostCall('list-projects',{limit:1}))[0];
          const detail=await hostCall('get-project',{projectId:p.id});
          ctx.assert(detail.review.status==='approved' && detail.annotations.spans[0].text==='李明','Host reads the same approved record');
        },
        screenshot:{name:'host-mcp-shared-record',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });

      await ctx.prove('Media details inherit the home role and returning home keeps the role selector usable',{
        voiceover:'音视频详情沿用首页角色。返回首页切换审核员，再打开记录即可审核，详情页不再显示角色下拉框。',
        action:async()=>{
          await child.trustedClick('.app-header > .header-button');
          await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
          const projects=await hostCall('list-projects',{limit:100});
          for(const modality of ['video','audio']) {
            const p=projects.find(p=>p.modality===modality);
            ctx.assert(Boolean(p),'Dedicated test workspace has '+modality+' record');
            await child.clickText(p.title,{selector:'.project-row'});
            await child.waitFor('Boolean(document.querySelector("#marks-tab"))');
            ctx.assert(!await child.eval('Boolean(document.querySelector(".editor-shell .role-control"))'),'Media detail hides role switching');
            await role('reviewer');
            await child.waitFor('Boolean(document.querySelector(".review-form"))');
            await child.trustedClick('.app-header > .header-button');
            await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
            await role('annotator');
          }
        },
        assert:async()=>{
          ctx.assert(await child.eval('document.querySelector(".home-shell .role-control select")?.value === "annotator" && !document.querySelector(".role-control select").disabled'),'Home role control remains usable after both media details');
        },
        screenshot:{name:'home-only-role-switch',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
    } finally {client.close();}
  }}]
};
