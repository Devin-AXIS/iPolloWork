import { connect, debuggerUrlFor, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
const hostFrame = 'iframe[title="数据标注"]';
export default {
  id: 'data-annotation-image', title: 'Close polygons and manage labels from annotation details',
  kind: 'user-facing', preserveTheme: true, requiredEnv: ['IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE'],
  steps: [{ name: 'Image closure and shared label management', async run(ctx) {
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
    let projectId, polygon, first;
    try {
      await child.waitFor('Boolean(document.querySelector("#training-tab"))');
      await child.trustedClick('#training-tab');
      await child.clickText('施工现场安全帽检测',{selector:'.template-card'});
      await child.waitFor('Boolean(document.querySelector(".labelu-image-annotator canvas"))');
      await child.trustedClick('.labelu-image-annotator > div:first-child [aria-describedby]:nth-child(4)');
      const rect=await child.eval('document.querySelector("canvas").getBoundingClientRect().toJSON()');
      first={x:rect.x+rect.width*.58,y:rect.y+rect.height*.32};
      await ctx.prove('Clicking the first vertex completes exactly one polygon without a separate finish action',{
        voiceover:'依次画出三个顶点，再点击起点，多边形就会闭合并自动完成一条标注。',
        action:async()=>{
          await click(first.x,first.y);
          await click(first.x+75,first.y+35);
          ctx.assert(!await child.eval('document.querySelector("#marks-tab small")?.textContent.trim() === "1 条"'),'Two vertices do not complete an annotation');
          await click(first.x+25,first.y+100);
          await click(first.x+2,first.y+2);
          await child.waitFor('document.querySelector("#marks-tab small")?.textContent.trim() === "1 条"');
          await save();
        },
        assert:async()=>{
          const projects=await get('/api/projects?');projectId=projects.projects.find(p=>p.title==='施工现场安全帽检测').id;
          const p=(await get('/api/project?projectId='+projectId)).project;polygon=p.annotations.polygon;
          ctx.assert(polygon.length===1 && polygon[0].points.length===3,'Saved polygon has three vertices, no duplicate starting vertex');
        },
        screenshot:{name:'polygon-click-to-close',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
      await ctx.prove('Right-side tabs manage labels and the detail bubble edits an individual mark name',{
        voiceover:'在编辑气泡里给单条标记命名，再切换右侧的标签集页签，新增标签并修改颜色。',
        action:async()=>{
          const edit=await child.eval('document.querySelector(\'path[d^="M9.73242 3.31152"]\').closest("svg").getBoundingClientRect().toJSON()');
          await click(edit.x+edit.width/2,edit.y+edit.height/2);
          await child.waitFor('Boolean(document.querySelector("input[aria-label=标记名称]"))');
          await child.fill('input[aria-label=标记名称]','施工人员 A');
          await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
          await child.waitFor('document.querySelector(".annotation-custom-name")?.textContent === "施工人员 A"');
          await child.trustedClick('#labels-tab');
          await child.waitFor('Boolean(document.querySelector(".annotation-labels-panel"))');
          await child.clickText('新增标签',{selector:'.annotation-labels-panel button',exact:true});
          const count=await child.eval('document.querySelectorAll(".annotation-labels-panel .label-row").length');
          await child.fill('.annotation-labels-panel input[aria-label="第 '+count+' 个标签名称"]','闭合目标');
          await child.eval('(()=>{const input=[...document.querySelectorAll(".annotation-labels-panel input[type=color]")].at(-1);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"#e11d48");input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));})()');
          await child.clickText('应用标签',{selector:'.annotation-labels-panel button',exact:true});
          await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
        },
        assert:async()=>{
          const p=(await get('/api/project?projectId='+projectId)).project;
          ctx.assert(p.labels.includes('闭合目标'),'New label saved');
          ctx.assert(p.labelColors['闭合目标']==='#e11d48','New color saved');
          ctx.assert(JSON.stringify(p.annotations.polygon[0].points)===JSON.stringify(polygon[0].points),'Adding labels preserves polygon geometry');
          ctx.assert(p.annotations.polygon[0].attributes.标记名称 === '施工人员 A','Mark name saved independently from label');
        },
        screenshot:{name:'manage-labels-from-details',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
      await ctx.prove('Deleting a used label requires replacement and reopening retains the polygon with its new label',{
        voiceover:'删除已使用的标签时选择替换标签，应用后重新打开，标注形状和新标签都会保留。',
        action:async()=>{
          const p=(await get('/api/project?projectId='+projectId)).project;
          const index=p.labels.indexOf(polygon[0].label);
          await child.trustedClick('.annotation-labels-panel .label-row:nth-child('+(index+1)+') .danger-text');
          await child.waitFor('Boolean(document.querySelector(".annotation-labels-panel .label-replacement"))');
          await child.eval('(()=>{const s=document.querySelector(".annotation-labels-panel .label-replacement select");s.value=[...s.options].find(o=>o.textContent==="闭合目标").value;s.dispatchEvent(new Event("change",{bubbles:true}));})()');
          await child.clickText('应用标签',{selector:'.annotation-labels-panel button',exact:true});
          await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
          await child.trustedClick('#marks-tab');
          await child.trustedClick('.app-header > .header-button');
          await child.waitFor('Boolean(document.querySelector(".project-row"))');
          await child.trustedClick('.project-row');
          await child.waitFor('Boolean(document.querySelector(".labelu-image-annotator canvas")) && document.querySelector("#marks-tab small")?.textContent.trim() === "1 条"');
        },
        assert:async()=>{
          const p=(await get('/api/project?projectId='+projectId)).project;
          ctx.assert(p.annotations.polygon.length===1 && p.annotations.polygon[0].label==='闭合目标','Saved annotation relabeled');
          ctx.assert(JSON.stringify(p.annotations.polygon[0].points)===JSON.stringify(polygon[0].points),'Saved geometry unchanged');
          ctx.assert(await child.eval('document.body.innerText.includes("闭合目标") && document.querySelector(".annotation-custom-name")?.textContent === "施工人员 A"'),'Reopened editor displays replacement label and individual name');
        },
        screenshot:{name:'reopen-relabeled-polygon',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });

      await ctx.prove('Zoomed and panned polygons close repeatedly, undo works, and opening labels saves completed annotations',{
        voiceover:'缩放和拖动画布后仍可连续闭合多边形，撤销也正常；打开标签集时会先保存已完成的标注。',
        action:async()=>{
          await child.trustedClick('.labelu-image-annotator > div:first-child [aria-describedby]:nth-child(4)');
          const r=await child.eval('document.querySelector("canvas").getBoundingClientRect().toJSON()');
          const x=r.x+r.width*.20,y=r.y+r.height*.55;
          await client.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:-140});
          await child.clickText('拖动画布',{selector:'.image-pan-controls button',exact:true});
          await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
          await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+30,y:y+20,buttons:1});
          await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+30,y:y+20,button:'left',clickCount:1});
          await child.clickText('拖动画布',{selector:'.image-pan-controls button',exact:true});
          await child.waitFor('document.querySelector(".save-status").textContent === "已保存"');
          for(const dx of [0,110]) {
            await click(x+dx,y);await click(x+dx+70,y+20);await click(x+dx+20,y+70);await click(x+dx,y);
          }
          await child.waitFor('document.querySelector("#marks-tab small")?.textContent.trim() === "3 条"');
          const undo=await child.eval('document.querySelector(\'path[d^="M7.97454 2.29297"]\').closest("svg").getBoundingClientRect().toJSON()');
          await click(undo.x+undo.width/2,undo.y+undo.height/2);
          await child.waitFor('document.querySelector("#marks-tab small")?.textContent.trim() === "2 条"');
          await child.trustedClick('#labels-tab');
          await child.waitFor('Boolean(document.querySelector(".annotation-labels-panel")) && document.querySelector(".save-status").textContent === "已保存"');
          const row=await child.eval('[...document.querySelectorAll(".annotation-labels-panel .label-name-field input")].findIndex(i=>i.value==="闭合目标")+1');
          await child.fill('.annotation-labels-panel input[aria-label="第 '+row+' 个标签名称"]','闭合目标（更新）');
          await child.clickText('上移',{selector:'.annotation-labels-panel .label-row:nth-child('+row+') button',exact:true});
          await child.clickText('应用标签',{selector:'.annotation-labels-panel button',exact:true});
          await child.waitFor('document.querySelector(".annotation-labels-panel").innerText.includes("标签已更新")');
          await child.trustedClick('#marks-tab');
        },
        assert:async()=>{
          const p=(await get('/api/project?projectId='+projectId)).project;
          ctx.assert(p.annotations.polygon.length===2 && p.annotations.polygon.every(a=>a.points.length===3),'Auto-save contains exactly two completed triangles after undo');
          ctx.assert(p.labels[0]==='闭合目标（更新）' && p.annotations.polygon[0].label==='闭合目标（更新）','Renaming and ordering update both labels and existing annotations');
        },
        screenshot:{name:'zoom-pan-undo-autosave',requireText:['数据标注'],rejectText:['操作未完成','请求超时']}
      });
    } finally {client.close();}
  }}]
};
