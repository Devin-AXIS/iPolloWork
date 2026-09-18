import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connect, debuggerUrlFor, listTargets } from '../runner/cdp.mjs';
import { EvalContext } from '../runner/context.mjs';
import { loadVoiceoverParagraphs } from '../runner/voiceover.mjs';

const vo = await loadVoiceoverParagraphs('data-annotation-review');
const hostFrame = 'iframe[title="数据标注"]';
const sourceArea = 'textarea[aria-label="待标注正文"]';

export default {
  id: 'data-annotation-review',
  title: 'Local annotator/reviewer workflow, real media, and approved JSON downloads',
  kind: 'user-facing',
  preserveTheme: true,
  requiredEnv: ['IPOLLOWORK_ANNOTATION_REVIEW_WORKSPACE'],
  steps: [{ name: 'Annotate, review, export, revise, and inspect real media', async run(ctx) {
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
    const downloads = resolve(ctx.outDir, 'annotation-downloads');
    await mkdir(downloads, { recursive: true });
    const get = (path) => child.eval(`fetch(${JSON.stringify(path)} + ((${JSON.stringify(path)}).includes('?') ? '&' : '?') + location.search.slice(1), {cache:'no-store'}).then(async r=>({status:r.status,body:await r.json()}))`, { awaitPromise: true });
    const role = async value => {
      const title = await child.eval('document.querySelector(".project-title strong")?.textContent');
      if (title) {
        await child.trustedClick('.app-header > .header-button');
        await child.waitFor('Boolean(document.querySelector(".home-shell .role-control select"))');
      }
      await child.eval(`(() => {const select=document.querySelector('.role-control select');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await child.waitFor(`document.querySelector('.role-control select')?.value === ${JSON.stringify(value)} && !document.querySelector('.role-control select').disabled`);
      if (title) {
        await child.clickText(title, {selector: '.project-row'});
        await child.waitFor('Boolean(document.querySelector(".editor-shell"))');
        ctx.assert(!await child.eval('Boolean(document.querySelector(".editor-shell .role-control"))'), 'Role switching is absent from annotation detail');
      }
    };
    const home = async () => {
      if (await child.eval('Boolean(document.querySelector(".editor-shell"))')) {
        await child.trustedClick('.app-header > .header-button');
        await child.waitFor('Boolean(document.querySelector(".home-shell"))');
        const current = (await get('/api/projects')).body.projects;
        await child.waitFor(`document.querySelectorAll('.project-row').length === ${current.length} && document.querySelector('.project-row strong')?.textContent === ${JSON.stringify(current[0]?.title)}`);
      }
    };
    const openTemplate = async title => {
      await home();
      await role('annotator');
      await child.trustedClick('#training-tab');
      await child.waitFor('document.querySelectorAll(".template-card").length === 12');
      await child.clickText(title, { selector: '.template-card' });
      await child.waitFor('Boolean(document.querySelector(".editor-shell"))');
    };
    const editMedia = async (index=0) => {
      while(await child.eval('Boolean(document.querySelector(".rc-collapse-header[aria-expanded=false]"))')) await child.trustedClick('.rc-collapse-header[aria-expanded=false]');
      const r=await child.eval('[...document.querySelectorAll(\'path[d^="M9.73242 3.31152"]\')]['+index+'].closest("svg").getBoundingClientRect().toJSON()');
      await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+r.width/2,y:r.y+r.height/2});
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});
      await child.waitFor('Boolean(document.querySelector("textarea[aria-label=标注描述]"))');
    };
    const save = async () => {
      await child.clickText('保存', { selector: '.app-header button', exact: true });
      await child.waitFor('document.querySelector(".save-status")?.textContent === "已保存"');
    };
    const latest = async title => {
      const payload = await get('/api/projects');
      return payload.body.projects.find(project => project.title === title);
    };
    let downloadNumber = 0;
    const expectDownload = async (title, id, mode) => {
      // Chromium may overwrite the same suggested name. Each click needs its own file witness.
      const destination = join(downloads, `${++downloadNumber}-${mode.toLowerCase()}`);
      await mkdir(destination, { recursive: true });
      await ctx.client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: destination });
      await child.clickText('导出 JSON', { selector: '.header-actions button', exact: true });
      let name;
      for (let attempt = 0; attempt < 80 && !name; attempt++) {
        name = (await readdir(destination)).find(file => file.endsWith('.json'));
        if (!name) await new Promise(done => setTimeout(done, 150));
      }
      ctx.assert(Boolean(name), `${mode} downloads an actual JSON file: ${title}`);
      const exported = JSON.parse(await readFile(join(destination, name), 'utf8'));
      ctx.assert(exported.format === 'ipollowork.annotation' && exported.project.id === id, 'Downloaded JSON belongs to the displayed record');
      ctx.assert(exported.project.review.status === 'approved' && exported.project.review.revision === exported.project.revision, 'Download contains an approved version');
      ctx.assert(!('mediaUrl' in exported.project), 'Download excludes session-bearing media URLs');
      return exported;
    };
    let textId;
    try {
      await child.waitFor('Boolean(document.querySelector(".role-control select"))');
      await ctx.prove('Default annotator mode exposes twelve ready-to-use local exercises', {
        voiceover: vo[0],
        action: async () => { await child.trustedClick('#training-tab'); },
        assert: async () => {
          await child.waitFor('document.querySelectorAll(".template-card").length === 12');
          ctx.assert(await child.eval('document.querySelector(".role-control select").value === "annotator"'), 'New workbench defaults to annotator');
          const templates = await get('/api/training-templates');
          ctx.assert(templates.body.templates.filter(item => item.mediaSource).length === 9, 'Nine real media templates retain attribution');
          ctx.assert(await ctx.eval(`document.querySelector(${JSON.stringify(hostFrame)}).sandbox.contains('allow-downloads')`), 'Host iframe permits annotation downloads');
          await ctx.client.send('Page.bringToFront');
        },
        screenshot: { name: 'real-training-catalog', requireText: ['数据标注'], rejectText: ['操作未完成', '请求超时'] },
      });
      await ctx.prove('Text annotation persists on disk, resumes and starts pending review', {
        voiceover: vo[1],
        action: async () => {
          await openTemplate('新闻实体抽取');
          await child.waitFor(`Boolean(document.querySelector(${JSON.stringify(sourceArea)}))`);
          ctx.assert(await child.eval(`document.querySelector(${JSON.stringify(sourceArea)}).value.length > 650`), 'Training text has multiple substantial paragraphs');
          await child.eval(`(() => {const area=document.querySelector(${JSON.stringify(sourceArea)});const start=area.value.indexOf('李明');area.focus();area.setSelectionRange(start,start+2);})()`);
          await child.trustedClick('.text-actions button');
          await save();
          textId = (await latest('新闻实体抽取')).id;
          await home();
          await child.clickText('新闻实体抽取', { selector: '.project-row' });
        },
        assert: async () => {
          await child.waitForText('李明');
          ctx.assert(await child.eval('document.querySelectorAll(".span-item").length === 1'), 'Saved span resumes');
          const saved = JSON.parse(await readFile(join(workspaceRoot, '.ipollowork/plugins/labelu-data-annotation/projects', `${textId}.json`), 'utf8'));
          ctx.assert(saved.review.status === 'pending' && saved.annotations.spans[0].text === '李明', 'Disk record matches the selected text and review state');
          await ctx.client.send('Page.bringToFront');
        },
        screenshot: { name: 'saved-pending-text', requireText: ['数据标注'] },
      });
      await ctx.prove('Reviewer opens local details as read-only and rejects with an opinion', {
        voiceover: vo[2],
        action: async () => {
          await home(); await role('reviewer');
          await child.waitForText('审核记录');
          await child.clickText('新闻实体抽取', { selector: '.project-row' });
          await child.waitFor('Boolean(document.querySelector(".review-form"))');
          ctx.assert(await child.eval(`document.querySelector(${JSON.stringify(sourceArea)}).readOnly`), 'Reviewer cannot edit text');
          await child.fill('input[aria-label="审核意见"]', '请补充青禾社区的实体标注。');
          await child.clickText('退回修改', { selector: '.review-form button', exact: true });
        },
        assert: async () => {
          await child.waitFor('document.querySelector(".review-badge")?.textContent === "已退回"');
          const saved = (await get(`/api/project?projectId=${textId}`)).body.project;
          ctx.assert(saved.review.comment === '请补充青禾社区的实体标注。', 'Rejection opinion is stored');
          ctx.assert((await get(`/api/project-export?projectId=${textId}`)).status === 409, 'Rejected records cannot export');
          await ctx.client.send('Page.bringToFront');
        },
        screenshot: { name: 'reviewer-rejected-detail', requireText: ['数据标注'] },
      });
      await ctx.prove('Resubmitted annotations can pass review and the reviewer downloads their JSON', {
        voiceover: vo[3],
        action: async () => {
          await role('annotator');
          await child.eval(`(() => {const area=document.querySelector(${JSON.stringify(sourceArea)});const start=area.value.indexOf('青禾社区');area.focus();area.setSelectionRange(start,start+4);})()`);
          await child.trustedClick('.text-actions button'); await save();
          await child.waitFor('document.querySelector(".review-badge")?.textContent === "待审核"');
          await role('reviewer');
          await child.fill('input[aria-label="审核意见"]', '实体边界与标签已核对，通过。');
          await child.clickText('审核通过', { selector: '.review-form button', exact: true });
        },
        assert: async () => {
          await child.waitFor('document.querySelector(".review-badge")?.textContent === "已通过"');
          const file = await expectDownload('新闻实体抽取', textId, 'Reviewer');
          ctx.assert(file.project.annotations.spans.some(span => span.text === '青禾社区'), 'Export contains the reviewed changes');
          await ctx.client.send('Page.bringToFront');
        },
        screenshot: { name: 'approved-reviewer-json', requireText: ['数据标注'] },
      });
      await ctx.prove('Annotator can export approval, while later edits revoke export eligibility', {
        voiceover: vo[4],
        action: async () => {
          await role('annotator');
          await expectDownload('新闻实体抽取', textId, 'Annotator');
          await child.trustedClick('.span-item button'); await save();
        },
        assert: async () => {
          await child.waitFor('document.querySelector(".review-badge")?.textContent === "待审核"');
          ctx.assert(await child.eval('[...document.querySelectorAll(".header-actions button")].find(b=>b.textContent==="导出 JSON").disabled'), 'Export is disabled after edits');
          ctx.assert((await get(`/api/project-export?projectId=${textId}`)).status === 409, 'The service also denies export after edits');
          await ctx.client.send('Page.bringToFront');
        },
        screenshot: { name: 'edited-record-awaits-review', requireText: ['数据标注'] },
      });
      const clickPoint = async (x, y) => {
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      };
      const playMedia = async modality => {
        const selector = `.labelu-${modality}-wrapper svg.icon`;
        if (modality === 'video') await child.waitFor('document.querySelector("video")?.readyState >= 2');
        const control = await child.eval(`document.querySelector(${JSON.stringify(selector)}).parentElement.getBoundingClientRect().toJSON()`);
        await clickPoint(control.x + control.width / 2, control.y + control.height / 2);
        await child.waitFor(modality === 'video'
          ? 'document.querySelector("video").currentTime > 0.25 && !document.querySelector("video").error'
          : 'document.querySelector(".labelu-audio-wrapper").innerText.includes("00:00:01 / ")');
        await clickPoint(control.x + control.width / 2, control.y + control.height / 2);
      };
      for (const [modality, title] of [['image', '施工现场安全帽检测'], ['video', '交通事件切片'], ['audio', '普通话语音分段']]) {
        let mediaId;
        await ctx.prove(`Real ${modality} annotations persist, remain visible to reviewers and export after approval`, {
          voiceover: vo[5],
          action: async () => {
            await openTemplate(title);
            if (modality === 'image') {
              await child.waitFor('Boolean(document.querySelector(".labelu-image-annotator canvas"))');
              await child.trustedClick('.labelu-image-annotator > div:first-child [aria-describedby]:nth-child(3)');
              const rect = await child.eval('document.querySelector("canvas").getBoundingClientRect().toJSON()');
              // LabelU's rectangle tool uses two clicks to place opposing corners.
              await clickPoint(rect.x + rect.width * .58, rect.y + rect.height * .3);
              await clickPoint(rect.x + rect.width * .69, rect.y + rect.height * .62);
              await child.waitFor('document.querySelector("#marks-tab small")?.textContent === "1 条"');
              await save();
              const before = await latest(title);
              const savedBefore = (await get(`/api/project?projectId=${before.id}`)).body.project;
              await child.clickText('拖动画布', { selector: '.image-pan-controls button', exact: true });
              const canvasBefore = await child.eval('[...document.querySelectorAll(".labelu-image-annotator canvas")].map(c=>c.toDataURL())');
              const x = rect.x + rect.width * .5, y = rect.y + rect.height * .5;
              await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
              await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
              for (let index = 1; index <= 8; index++) await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + index * 9, y: y + index * 4, buttons: 1 });
              await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 72, y: y + 32, button: 'left', clickCount: 1 });
              await child.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', { awaitPromise: true });
              const canvasAfter = await child.eval('[...document.querySelectorAll(".labelu-image-annotator canvas")].map(c=>c.toDataURL())');
              ctx.assert(canvasAfter.some((value, index) => value !== canvasBefore[index]), 'Dragging changes the canvas view');
              const savedAfter = (await get(`/api/project?projectId=${before.id}`)).body.project;
              ctx.assert(savedAfter.revision === savedBefore.revision && JSON.stringify(savedAfter.annotations) === JSON.stringify(savedBefore.annotations), 'Canvas pan preserves saved coordinates and record version');
              ctx.assert(await child.eval('document.querySelector(".save-status").textContent.includes("已保存")'), 'Canvas pan creates no annotation edit');
              await child.clickText('拖动画布', { selector: '.image-pan-controls button', exact: true });
            } else {
              await child.waitFor('Boolean(document.querySelector("[editingtype=segment]"))');
              await playMedia(modality);
              const rect = await child.eval('document.querySelector("[editingtype=segment]").getBoundingClientRect().toJSON()');
              const start = rect.x + rect.width * .12, end = rect.x + rect.width * .45, y = rect.y + rect.height / 2;
              await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y });
              await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y, button: 'left', clickCount: 1 });
              for (let index = 1; index <= 8; index++) await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start + (end - start) * index / 8, y, buttons: 1 });
              await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', clickCount: 1 });
              await child.waitFor('document.querySelector("#marks-tab small")?.textContent === "1 条"');
              await editMedia();
              await child.fill('textarea[aria-label="标注描述"]', `${modality === 'video' ? '车辆经过路口' : '清晰的人声朗读'}，这一片段包含完整事件。`);
              ctx.assert(await child.eval(`document.querySelector('.labelu-${modality}-wrapper').innerText.includes('这一片段包含完整事件')`), 'Description is visible on the native segment');
              await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
              if (modality === 'video') {
                await child.clickText('标记当前关键帧', { selector: 'button', exact: true });
                await editMedia(1);
                await child.fill('textarea[aria-label="标注描述"]', '关键帧：车辆进入路口。');
                const time = await child.eval('document.querySelector("video").currentTime');
                await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
                await child.eval('document.querySelector("video").currentTime = 0');
                await editMedia(0); await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
                await editMedia(1);
                await child.waitFor(`Math.abs(document.querySelector('video').currentTime - ${time}) < 0.01`);
                await child.trustedClick('.labelu-draggable-modal .rc-dialog-close');
              }
            }
            await save();
            mediaId = (await latest(title)).id;
            await home(); await role('reviewer');
            await child.clickText(title, { selector: '.project-row' });
            await child.waitFor('Boolean(document.querySelector(".review-form"))');
            if (modality !== 'image') {
              await child.waitFor(`Boolean(document.querySelector('.labelu-${modality}-wrapper'))`);
              await playMedia(modality);
              ctx.assert(await child.eval('!document.querySelector(".media-drag-track")'), 'Reviewer has playback without annotation drag controls');
              await child.trustedClick("#labels-tab");
              ctx.assert(await child.eval('document.querySelector("fieldset.label-editor").disabled'), "Reviewer label editor remains read-only");
              await child.trustedClick("#marks-tab");
            }
            await child.fill('input[aria-label="审核意见"]', '已核对真实素材与保存的标注，通过。');
            await child.clickText('审核通过', { selector: '.review-form button', exact: true });
            await child.waitFor('document.querySelector(".review-badge")?.textContent === "已通过"');
          },
          assert: async () => {
            const file = await expectDownload(title, mediaId, 'Reviewer');
            const annotations = file.project.annotations[modality === 'image' ? 'rect' : 'segment'];
            ctx.assert(annotations?.length === 1, 'Export retains the saved target or time segment');
            if (modality !== 'image') {
              ctx.assert(annotations[0].end > annotations[0].start, 'Saved time segment has a positive duration');
              ctx.assert(annotations[0].attributes.描述.includes('这一片段包含完整事件'), 'Segment descriptions survive save, reopen, review and JSON download');
            }
            if (modality === 'video') ctx.assert(file.project.annotations.frame?.length === 1 && file.project.annotations.frame[0].attributes.描述 === '关键帧：车辆进入路口。', 'Keyframe timestamp and description survive export');
            ctx.assert(Boolean(file.project.mediaSource?.author && file.project.mediaSource?.license), 'Export retains the original media attribution');
            await role('annotator');
            await expectDownload(title, mediaId, 'Annotator');
            await role('reviewer');
            await child.clickText('项目', { selector: '.header-actions button', exact: true });
            await child.waitForText('素材来源');
            await child.trustedClick('#labels-tab');
            ctx.assert(await child.eval('document.querySelector("fieldset.label-editor").disabled'), 'Reviewer cannot change the label schema');
            ctx.assert(await child.eval('document.documentElement.scrollWidth <= innerWidth + 1'), 'Media review fits the main app panel');
            await ctx.client.send('Page.bringToFront');
          },
          screenshot: { name: `approved-real-${modality}`, requireText: ['数据标注'], rejectText: ['操作未完成', '请求超时'] },
        });
      }
      await home(); await role('annotator');
    } finally { client.close(); }
  } }],
};
