import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export default {
  id: "avatar-smart-cutout", title: "数字人智能抠图：进度、主体保护和持久化", kind: "user-facing", preserveTheme: true,
  requiredEnv: ["IPOLLOWORK_AVATAR_PROOF_DIR"],
  steps: [{ name: "Cut out a real avatar through its context menu", run: async ctx => {
    const url = process.env.IPOLLOWORK_AVATAR_PROOF_URL || "http://localhost:3566/?locale=zh#project/avatar-smart-cutout-project";
    const originalUrl = await ctx.eval("location.href");
    const file = resolve(process.env.IPOLLOWORK_AVATAR_PROOF_DIR, "index.html");
    const frame = `document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe')`;
    const source = `(${frame})?.contentDocument?.querySelector('video[data-avatar-cutout], video:not([data-avatar-source])')`;
    const avatarSelected = `(() => { const a=${source}; return new URLSearchParams(location.hash.split('?')[1]||'').get('selHfId')===a?.getAttribute('data-hf-id'); })()`;
    const ready = () => ctx.waitFor(`Boolean((${source})?.readyState >= 2)`, { timeoutMs: 30000 });
    const reload = async () => {
      const origin = await ctx.eval("performance.timeOrigin");
      await ctx.client.send("Page.reload", { ignoreCache: true });
      await ctx.waitFor(`performance.timeOrigin !== ${origin}`);
      await ready();
    };
    const mouse = async (point, button = "left") => {
      await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await ctx.client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, clickCount: 1 });
      await ctx.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, clickCount: 1 });
    };
    const menu = async text => {
      const point = await ctx.waitFor(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point);
    };
    const avatarPoint = async () => {
      await ctx.waitFor(`Boolean(document.querySelector('[aria-label="Composition canvas"]'))`);
      await ctx.waitFor(`(() => { const r=document.querySelector('[data-testid="preview-zoom-stage"]')?.getBoundingClientRect(); return r?.width>0 && r.height>0 && r.height<innerHeight; })()`);
      return ctx.waitFor(`(() => { const f=${frame}, a=${source}, w=f?.contentWindow; if(!f||!a||!w||w.getComputedStyle(a).visibility==='hidden') return null; const fr=f.getBoundingClientRect(), ar=a.getBoundingClientRect(); return ar.width>0&&ar.height>0 ? {x:fr.left+(ar.left+ar.width/2)*fr.width/w.innerWidth,y:fr.top+(ar.top+ar.height*.15)*fr.height/w.innerHeight}:null; })()`);
    };
    const openMenu = async () => {
      await mouse(await avatarPoint(), "right");
    };
    try {
      await ctx.client.send("Page.navigate", { url });
      await reload();
      const existing = await ctx.eval(`Boolean((${frame})?.contentDocument?.querySelector('video[data-avatar-source]'))`);
      if (existing) {
        await openMenu();
        await menu("取消智能抠图");
        await ctx.waitFor(`Boolean(${source}) && !(${frame}).contentDocument.querySelector('[data-avatar-source]')`);
      }
      await ctx.prove("Smart cutout reuses the preview AI editing status", {
        voiceover: "启动智能抠图后，播放区统一显示 AI 正在修改的状态，不再出现底部重复提示。",
        action: async () => { await openMenu(); await menu("智能抠图"); },
        assert: async () => {
          await ctx.waitFor(`Boolean(document.querySelector('[data-testid="studio-ai-editing-status"]'))`);
          ctx.assert(!(await ctx.eval(`document.body.innerText.includes('AI 抠图中')`)), "Legacy bottom cutout notice is absent");
        },
        screenshot: {
          name: "cutout-preview-ai-status",
          requireText: ["AI 修改视频中，建议不要手动修改"],
          rejectText: ["AI 抠图中"],
        },
      });
      await ctx.prove("The cutout remains one editable video while protecting the person", {
        voiceover: "抠图完成后，片段区和画布仍只显示一个可编辑人物，背景、文字和人物保持正确层级。",
        action: async () => {
          await ctx.waitFor(`Boolean((${frame})?.contentDocument?.querySelector('video[data-avatar-source]')?.readyState >= 2)`, { timeoutMs: 240000 });
          await ctx.waitFor(`(() => { const f=${frame}, d=f?.contentDocument, w=f?.contentWindow; return Boolean(d && [...d.querySelectorAll('[data-avatar-background-proxy],[data-layer-role="background"],.scene-fill,.background,.backdrop,.bg')].some(e => w.getComputedStyle(e).visibility !== 'hidden' && w.getComputedStyle(e).maskImage !== 'none')); })()`, { timeoutMs: 30000 });
          const point = await avatarPoint();
          for (let attempt = 0; attempt < 6 && !(await ctx.eval(avatarSelected)); attempt += 1) {
            await mouse(point);
            await new Promise(resolve => setTimeout(resolve, 700));
          }
          await ctx.waitFor(avatarSelected);
          await ctx.waitFor(`Boolean(document.querySelector('[data-dom-edit-selection-box="true"]')?.getBoundingClientRect().width > 0)`);
        },
        assert: async () => {
          const result = await ctx.eval(`(() => { const f=${frame}, d=f.contentDocument, w=f.contentWindow, a=d.querySelector('video[data-avatar-cutout]'), p=d.querySelector('video[data-avatar-source]'), overlay=d.querySelector('.process-card')||d.getElementById('title')||d.querySelector('h1,h2'); let contentBranch=overlay; while(contentBranch?.parentElement!==a.parentElement) contentBranch=contentBranch?.parentElement; const backgroundMask=[...d.querySelectorAll('[data-avatar-background-proxy],[data-layer-role="background"],.scene-fill,.background,.backdrop,.bg')].some(e => w.getComputedStyle(e).visibility!=='hidden' && w.getComputedStyle(e).maskImage!=='none'); const c=d.createElement('canvas'); c.width=p.videoWidth;c.height=p.videoHeight;const x=c.getContext('2d');x.drawImage(p,0,0);const pixels=x.getImageData(0,0,c.width,c.height).data;let clear=0,solid=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]<10)clear++;if(pixels[i]>245)solid++;}const ar=a.getBoundingClientRect(),pr=p.getBoundingClientRect(),ids=new Set([a.id,p.id,a.getAttribute('data-hf-id'),p.getAttribute('data-hf-id')].filter(Boolean)),state=window.__playerStore?.getState(),elements=state?.elements||[],timelineAvatars=elements.filter(e=>[e.id,e.domId,e.hfId].some(id=>ids.has(id))),timelineVideos=elements.filter(e=>e.tag==='video'),manifestAvatars=(state?.clipManifest||[]).filter(e=>ids.has(e.id)),childAvatars=(state?.domClipChildren||[]).filter(e=>[e.id,e.domId,e.hfId].some(id=>ids.has(id))),timelineClips=[...document.querySelectorAll('.timeline-clip')].map(e=>({text:e.textContent.trim(),title:e.getAttribute('title'),kind:e.getAttribute('data-timeline-kind'),selected:e.classList.contains('is-selected')}));return {clear,solid,sourceId:a.id,foregroundId:p.id,source:a.getAttribute('src'),foreground:p.getAttribute('src'),ready:p.readyState,error:p.error?.message||null,muted:p.muted,backgroundMask,z:[a,contentBranch,p].map(e=>Number(w.getComputedStyle(e).zIndex)||0),times:[a.currentTime,p.currentTime],aligned:[ar.left-pr.left,ar.top-pr.top,ar.width-pr.width,ar.height-pr.height],timelineAvatars:timelineAvatars.map(e=>({id:e.id,domId:e.domId,hfId:e.hfId})),timelineVideos:timelineVideos.map(e=>({id:e.id,domId:e.domId,hfId:e.hfId,src:e.src})),manifestAvatars:manifestAvatars.map(e=>({id:e.id,tagName:e.tagName})),childAvatars:childAvatars.map(e=>({id:e.id,domId:e.domId,hfId:e.hfId,tag:e.tag})),timelineClips,selectionBoxes:document.querySelectorAll('[data-dom-edit-selection-box="true"]').length}; })()`);
          ctx.output("cutout assertions",JSON.stringify(result,null,2));
          ctx.assert(result.clear > 1000 && result.solid > 1000, "Actual decoded foreground has transparent background and opaque person");
          ctx.assert(result.ready >= 2 && result.error === null, "Foreground media is loaded instead of a cached incomplete file");
          ctx.assert(result.backgroundMask, "Scene background opens only the source-video window");
          ctx.assert(result.z[0] < result.z[1] && result.z[1] < result.z[2], "Graphics are between original video and foreground");
          ctx.assert(result.source && result.foreground && result.source !== result.foreground && result.muted, "Original audio source is retained and the foreground is silent");
          ctx.assert(await ctx.eval(`(${frame}).contentWindow.getComputedStyle(${source}).visibility === 'visible'`), "Original background remains visible in preview");
          ctx.assert(Math.abs(result.times[0]-result.times[1]) < .06, "Both videos share the same frame time");
          ctx.assert(result.aligned.every(delta => Math.abs(delta) < 1), "Foreground follows the source geometry as one visual element");
          const videoClips = result.timelineClips.filter(clip => clip.kind === "video");
          ctx.assert(videoClips.length === 1 && videoClips[0].selected && !videoClips[0].text.includes("人物前景"), "Only the authored avatar is exposed in the timeline");
          ctx.assert(result.selectionBoxes === 1, "Canvas exposes one selection box for the cutout avatar");
          ctx.assert((await ctx.eval(avatarSelected)) && await ctx.eval(`document.querySelector('[data-dom-edit-selection-box="true"]')?.getBoundingClientRect().height>0`), "Selection is rebound to the refreshed avatar element");
          ctx.assert((await readFile(file,"utf8")).includes("data-avatar-cutout="), "The effect is persisted in the composition");
        },
        screenshot: { name: "cutout-single-editable-avatar", rejectText: ["智能抠图失败", "无法保存"] },
      });
      if (!existing) {
        await ctx.prove("The cutout survives reopening and can be removed from the same menu", {
          voiceover: "重新打开视频，主体保护仍然保留，也可以通过原菜单取消智能抠图。",
          action: async () => { await reload(); await openMenu(); },
          assert: async () => { await ctx.waitForText("取消智能抠图"); ctx.assert((await readFile(file,"utf8")).includes("data-avatar-source="), "Foreground relationship survives reopening"); },
          screenshot: { name: "cutout-reopened", requireText: ["取消智能抠图"] },
        });
        await menu("取消智能抠图");
        await ctx.waitFor(`Boolean(${source}) && !(${frame}).contentDocument.querySelector('[data-avatar-source]')`);
        ctx.assert(!(await readFile(file,"utf8")).includes("data-avatar-cutout="), "Cancelling the effect removes the saved foreground relationship");
      }
    } finally {
      if (originalUrl !== url) await ctx.client.send("Page.navigate", { url: originalUrl });
    }
  } }],
};
