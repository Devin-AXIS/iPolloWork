import { connect, debuggerUrlFor, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
const hostFrame = 'iframe[title="数据标注"]';
export default {
  id: 'data-annotation-media', title: 'Native lower timeline and unified media marking sidebar',
  kind: 'user-facing', preserveTheme: true, requiredEnv: ['IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE'],
  steps: [{ name: 'Refresh, drag media, edit and reopen', async run(ctx) {
    const workspaceId = ctx.env.IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE;
    await ctx.client.send('Page.bringToFront');
    await ctx.navigateHash(`/workspace/${workspaceId}/session`);
    await ctx.waitFor('Boolean(window.__ipolloworkControl)');
    await ctx.eval(`(async () => {
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

    const get = path => child.eval('fetch(' + JSON.stringify(path) + ' + "&" + location.search.slice(1), {cache:"no-store"}).then(r=>r.json())', {awaitPromise:true});
    const click = async (x,y,button='left',modifiers=0) => {
      await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      await new Promise(resolve=>setTimeout(resolve,60));
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,modifiers,clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,modifiers,clickCount:1});
      await new Promise(resolve=>setTimeout(resolve,60));
    };
    const save = async () => {await child.clickText('保存',{selector:'.app-header button',exact:true});await child.waitFor('document.querySelector(".save-status")?.textContent === "已保存"');};

    const edit = async (index=0) => {
      for(let i=0;i<10 && await child.eval('Boolean(document.querySelector(".rc-collapse-header[aria-expanded=false]"))');i++) await child.trustedClick(".rc-collapse-header[aria-expanded=false]");
      const r=await child.eval('[...document.querySelectorAll(\'path[d^="M9.73242 3.31152"]\')]['+index+'].closest("svg").getBoundingClientRect().toJSON()');
      await click(r.x+r.width/2,r.y+r.height/2);
      await child.waitFor('Boolean(document.querySelector("textarea[aria-label=标注描述]"))');
    };
    try {
      await child.waitFor('Boolean(document.querySelector("#training-tab"))');
      await ctx.prove('Refresh records is an accessible icon at the far right of the filter row',{
        voiceover:'刷新记录已放在筛选行最右侧，点击刷新图标即可更新列表。',
        action:async()=>{await child.trustedClick('[aria-label=刷新记录]');},
        assert:async()=>{
          ctx.assert(await child.eval('(()=>{const b=document.querySelector(".refresh-records"),r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();return Boolean(b.querySelector("svg")) && !b.textContent.trim() && Math.abs(r.right-p.right)<3;})()'),'Refresh is icon-only and right aligned');
          const count=(await get('/api/projects?')).projects.length;
          await child.waitFor('document.querySelectorAll(".project-row").length === '+count);
        },screenshot:{name:'refresh-records-icon',requireText:['数据标注'],rejectText:['请求超时','操作未完成']}
      });
      const media = [['video','交通事件切片'],['audio','普通话语音分段']];
      for(const [modality,title] of media.filter(([kind]) => !ctx.env.IPOLLOWORK_ANNOTATION_MEDIA || kind === ctx.env.IPOLLOWORK_ANNOTATION_MEDIA)) {
        let id, saved;
        await ctx.prove(modality+' uses only the lower timeline, with names and descriptions edited from the right sidebar',{
          voiceover:(modality==='video'?'视频':'音频')+'在下方时间轴拖拽创建片段，从右侧编辑标记名称和描述，标签集也在同一侧栏。',
          action:async()=>{
            await child.trustedClick('#training-tab');await child.clickText(title,{selector:'.template-card'});
            await child.waitFor('Boolean(document.querySelector("[editingtype=segment]"))');
            if(modality==='video')await child.waitFor('document.querySelector("video")?.readyState >= 2');
            else await child.waitFor('document.querySelector(".labelu-audio-wrapper")?.innerText.includes("00:00:45")');
            const r=await child.eval('document.querySelector("[editingtype=segment]").getBoundingClientRect().toJSON()');
            const x=r.x+r.width*.15,y=r.y+r.height*.5,end=r.x+r.width*.48;
            await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
            await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
            for(let i=1;i<=10;i++){await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+(end-x)*i/10,y,buttons:1});await new Promise(r=>setTimeout(r,40));}
            await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:end,y,button:'left',clickCount:1});
            await child.waitFor('document.querySelector("#marks-tab small")?.textContent === "1 条"');
            await edit();await child.fill('input[aria-label=标记名称]',modality+'片段名称');await child.fill('textarea[aria-label=标注描述]',modality+'片段描述：完整事件。');
            await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
            await child.trustedClick('#labels-tab');
            await child.waitFor('Boolean(document.querySelector(".annotation-labels-panel .label-editor"))');
            await child.clickText('新增标签',{selector:'.annotation-labels-panel button',exact:true});
            const count=await child.eval('document.querySelectorAll(".annotation-labels-panel .label-row").length');
            await child.trustedClick('.annotation-labels-panel input[aria-label="第 '+count+' 个标签名称"]');
            await child.fill('.annotation-labels-panel input[aria-label="第 '+count+' 个标签名称"]','侧栏标签');
            ctx.assert(await child.eval('document.querySelector(".save-status")?.textContent === "已保存"'),'Clicking and editing label drafts does not dirty media annotations');
            await child.trustedClick('.annotation-labels-panel .label-editor-actions .primary-button');
            await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
            await child.trustedClick('#marks-tab');
            if(modality==='video'){
              await child.clickText('标记当前关键帧',{selector:'button',exact:true});
              await child.waitFor('document.querySelector("#marks-tab small")?.textContent === "2 条"');
              await edit(1);await child.fill('input[aria-label=标记名称]','关键帧名称');await child.fill('textarea[aria-label=标注描述]','关键画面描述');
              await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
              await save();
            }
          },
          assert:async()=>{
            const p=(await get('/api/projects?')).projects.find(p=>p.title===title);id=p.id;saved=(await get('/api/project?projectId='+id)).project;
            ctx.assert(!await child.eval('Boolean(document.querySelector(".media-drag-panel,.media-annotation-details"))'),'No redundant upper timeline or description panel');
            const segment=saved.annotations.segment[0];
            ctx.assert(segment.end>segment.start && saved.annotations.segment.length===1,'Native lower timeline saves exactly one positive-duration segment');
            ctx.assert(segment.attributes.标记名称===modality+'片段名称' && segment.attributes.描述===modality+'片段描述：完整事件。','Name and description persist without replacing label');
            ctx.assert(saved.labels.includes('侧栏标签'),'Sidebar label set changes persist');
            if(modality==='video')ctx.assert(saved.annotations.frame[0].attributes.描述==='关键画面描述','Video keyframe description persists');
          },screenshot:{name:modality+'-sidebar-edit',requireText:['数据标注'],rejectText:['请求超时','操作未完成']}
        });
        await ctx.prove(modality+' saved marks reopen with their descriptions and can still be reviewed and exported',{
          voiceover:'重新打开记录，名称和描述仍然保留；审核通过后，JSON 也包含这些标注内容。',
          action:async()=>{
            await child.trustedClick('.app-header > .header-button');await child.waitFor('Boolean(document.querySelector(".project-row"))');await child.trustedClick('.project-row');
            await child.waitFor('Boolean(document.querySelector(".annotation-custom-name"))');await edit();
          },
          assert:async()=>{
            ctx.assert(await child.eval('document.querySelector("input[aria-label=标记名称]").value === '+JSON.stringify(modality+'片段名称')),'Reopened name matches');
            ctx.assert(await child.eval('document.querySelector("textarea[aria-label=标注描述]").value === '+JSON.stringify(modality+'片段描述：完整事件。')),'Reopened description matches');
            await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
            const title=await child.eval('document.querySelector(".project-title strong").textContent');
            await child.trustedClick('.app-header > .header-button');
            await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
            await child.eval('(()=>{const s=document.querySelector(".role-control select");s.value="reviewer";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
            await child.waitFor('document.querySelector(".role-control select")?.value === "reviewer" && !document.querySelector(".role-control select").disabled');
            await child.clickText(title,{selector:'.project-row'});
            await child.waitFor('Boolean(document.querySelector(".review-form"))');
            await child.clickText('审核通过',{selector:'.review-form button',exact:true});await child.waitFor('document.querySelector(".review-badge")?.textContent === "已通过"');
            const exported=await get('/api/project-export?projectId='+id);
            ctx.assert(exported.project.annotations.segment[0].attributes.标记名称===modality+'片段名称','Approved JSON contains mark name');
            ctx.assert(exported.project.annotations.segment[0].attributes.描述===modality+'片段描述：完整事件。','Approved JSON contains description');
          },screenshot:{name:modality+'-reopen-and-review',requireText:['数据标注'],rejectText:['请求超时','操作未完成']}
        });
        await child.trustedClick('.app-header > .header-button');await child.waitFor('Boolean(document.querySelector(".role-control select"))');
        await child.eval('(()=>{const s=document.querySelector(".role-control select");s.value="annotator";s.dispatchEvent(new Event("change",{bubbles:true}));})()');await child.waitFor('Boolean(document.querySelector("#training-tab"))');
      }
    } finally {client.close();}
  }}]
};
