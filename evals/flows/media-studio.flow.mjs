const engine = id => `document.querySelector('[data-media-engine="${id}"]')`;
const image = `${engine('image-studio')}?.querySelector('iframe')?.contentDocument`;
const video = `${engine('video-console')}?.querySelector('iframe')?.contentDocument`;
const click = (ctx, selector) => ctx.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
const switchType = async (ctx, kind) => {
  await ctx.eval(`document.querySelector('[data-media-engine]:not([aria-hidden="true"]) [data-media-type]').click()`);
  await ctx.waitFor(`Boolean(document.querySelector('[role="option"]'))`);
  await ctx.eval(`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent===${JSON.stringify(kind==='image'?'图片':'视频')}).setAttribute('data-proof-media-choice','true')`);
  await ctx.trustedClick('[data-proof-media-choice=true]');
  await ctx.waitFor(`${engine(kind==='image'?'image-studio':'video-console')}?.getAttribute('aria-hidden')==='false'`);
};

export default {
  id:'media-studio', title:'Unified media entry, retained drafts, and project replacement', kind:'user-facing', preserveTheme:true,
  steps:[{name:'Actual desktop UI and workspace files; prepared result instead of paid generation',async run(ctx){
    await ctx.waitFor('Boolean(window.__IPOLLOWORK_ELECTRON__)');
    await ctx.eval(`window.__mediaProofSetup=(async()=>{
      const source=await(await fetch('/src/react-app/domains/session/chat/session-page.tsx')).text();
      const storeUrl=source.split('"').find(value=>value.includes('/panel/panel-tab-store.ts'));
      window.__mediaProofStore=(await import(storeUrl)).usePanelTabStore;
      const info=await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
      const {createiPolloWorkServerClient}=await import('/src/app/lib/ipollowork-server.ts');
      window.__mediaProofClient=createiPolloWorkServerClient({baseUrl:info.baseUrl,token:info.ownerToken||info.clientToken,hostToken:info.hostToken});
      window.__mediaProofWorkspace=location.hash.split('/')[2];window.__mediaProofSession=location.hash.split('/session/')[1];
      window.__mediaProofOriginal=window.__mediaProofStore.getState().sessions[window.__mediaProofSession];
      window.__mediaProofEdits=window.__mediaProofStore.getState().mediaEdits;
      window.__mediaProofPackages=(await window.__mediaProofClient.listPluginPackages(window.__mediaProofWorkspace)).items;
      const current=window.__mediaProofStore.getState();for(const tab of current.sessions[window.__mediaProofSession]?.tabs||[])if(tab.type==='workspace-app'&&['media-studio','image-studio','video-console'].includes(tab.surface.pluginId))current.closeTab(window.__mediaProofSession,tab.id);
    })()`,{awaitPromise:true});
    try {
      await ctx.waitFor(`!document.querySelector('[aria-label="Select tab: 素材工作台"]')`);
      await ctx.eval(`if(!document.querySelector('[data-testid="side-panel-launcher-workspace-app:media-studio"]'))document.querySelector('button[aria-label="添加侧面板入口"]').click()`);
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="side-panel-launcher-workspace-app:media-studio"]'))`);
      await ctx.prove('There is one Media Studio launcher',{
        assert:async()=>ctx.assert(await ctx.eval(`window.__mediaProofPackages.filter(item=>['media-studio','image-studio','video-console'].includes(item.pluginId)).length===1 && window.__mediaProofPackages.some(item=>item.pluginId==='media-studio' && item.enabled && item.manifest.resources.filter(r=>r.type==='local-service').length===1 && item.manifest.resources.filter(r=>r.type==='ui').length===2) && document.querySelectorAll('[data-testid="side-panel-launcher-workspace-app:media-studio"]').length===1 && ![...document.querySelectorAll('[role="menuitem"]')].some(e=>['图片工作台','视频工作台'].includes(e.textContent))`),'The menu has one media entry and no duplicate image/video launchers'),
        screenshot:{name:'unified-entry'},
      });
      await click(ctx,'[data-testid="side-panel-launcher-workspace-app:media-studio"]');
      await ctx.waitFor(`Boolean(${image}?.querySelector('#generateMode'))`,{timeoutMs:60000});
      await ctx.eval(`${image}.querySelector('#generateMode').click()`);
      await ctx.waitFor(`Boolean(${engine('image-studio')}?.querySelector('textarea[name="prompt"]'))`);
      await ctx.fill('[data-media-engine="image-studio"] textarea[name="prompt"]','Image draft retained');
      await switchType(ctx,'video');
      await ctx.waitFor(`Boolean(${engine('video-console')}?.querySelector('textarea[name="prompt"]'))`,{timeoutMs:60000});
      await ctx.waitFor(`${video}?.querySelector('#empty')?.hidden===true && ${video}?.querySelector('nav')?.hidden===false`,{timeoutMs:60000});
      await ctx.eval(`${video}.querySelector('#modelMenu').click()`);
      await ctx.waitFor('document.querySelectorAll("[role=menuitemradio]").length>0');
      await ctx.trustedClick('[role=menuitemradio]');
      await ctx.waitFor(`Boolean(${engine('video-console')}?.querySelector('[data-inspector-field="operation"]'))`);
      await ctx.eval(`window.__mediaProofVideoDocument=${video};window.__mediaProofImageDocument=${image};`);
      await ctx.fill('[data-media-engine="video-console"] textarea[name="prompt"]','Video draft retained');
      await switchType(ctx,'image');
      await ctx.prove('Media types share one tab and retain independent drafts',{
        assert:async()=>ctx.assert(await ctx.eval(`document.querySelectorAll('[aria-label="Select tab: 素材工作台"]').length===1 && ${engine('image-studio')}.querySelector('textarea[name="prompt"]').value==='Image draft retained' && ${engine('video-console')}.querySelector('textarea[name="prompt"]').value==='Video draft retained' && ${image}===window.__mediaProofImageDocument && ${video}===window.__mediaProofVideoDocument && ${video}.querySelector('#modelMenu').title.includes('Seedance')`),'Both composers retain their text, model selection and iframe documents after switching'),
        screenshot:{name:'retained-image-draft'},
      });
      const resize = async x => {
        const point=await ctx.eval(`(()=>{const r=document.querySelector('[aria-label="Resize right panel"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:point.y,buttons:1});
        await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:point.y,button:'left',clickCount:1});
      };
      const panelX=await ctx.eval(`document.querySelector('[aria-label="Resize right panel"]').getBoundingClientRect().x+4`);
      await ctx.eval(`window.__mediaProofTheme=document.documentElement.getAttribute('data-theme');window.__mediaProofScheme=document.documentElement.style.colorScheme;document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';`);
      try {
        await resize(await ctx.eval('innerWidth-400'));
        await switchType(ctx,'video');
        await ctx.waitFor(`[...${video}.querySelectorAll('#mediaCards img')].length>0 && [...${video}.querySelectorAll('#mediaCards img')].every(img=>img.naturalWidth>0)`,{timeoutMs:60000});
        await ctx.prove('Compact dark controls remain readable in a narrow panel',{
          assert:async()=>ctx.assert(await ctx.eval(`(()=>{const e=${engine('video-console')},control=e.querySelector('[data-media-type]'),card=e.querySelector('[data-testid="workspace-app-inspector"]'),button=card.querySelector('button[type="submit"]'),r=card.getBoundingClientRect(),b=button.getBoundingClientRect();return Math.round(control.getBoundingClientRect().height)===28 && b.right<=r.right && b.top>=r.top && b.bottom<=r.bottom && getComputedStyle(card).colorScheme==='dark' && getComputedStyle(button).color!==getComputedStyle(button).backgroundColor;})()`),'Type selector is 28px; the CTA fits the card and has contrasting text in dark mode'),
          screenshot:{name:'narrow-dark-video'},
        });
      } finally {
        await resize(panelX);
        await ctx.eval(`document.documentElement.setAttribute('data-theme',window.__mediaProofTheme);document.documentElement.style.colorScheme=window.__mediaProofScheme;`);
      }
      await ctx.eval(`window.__mediaProofFixture=(async()=>{
        const c=window.__mediaProofClient,w=window.__mediaProofWorkspace,s=window.__mediaProofSession;
        const folder='artifacts/media-studio/proof-'+Date.now();window.__mediaProofFolder=folder;
        for(const [name,color]of [['source.png','#a8b4a0'],['edited.png','#477b99']]){
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const g=canvas.getContext('2d');g.fillStyle=color;g.fillRect(0,0,640,360);g.fillStyle='#fff';g.font='32px sans-serif';g.fillText(name==='source.png'?'Original media':'Prepared edit result',36,190);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await c.uploadWorkspaceMedia(w,folder+'/'+name,new File([blob],name,{type:'image/png'}));
        }
        const html='<html><body style="margin:24px;font-family:sans-serif"><h1>Media Studio return check</h1><img id="hero" src="source.png" style="width:60%;display:block"><img id="other" src="source.png" style="width:20%;margin-top:20px"></body></html>';
        await c.writeWorkspaceFile(w,{path:folder+'/index.html',content:html});
        window.__mediaProofStore.getState().openTab(s,{id:'design:'+s+':'+encodeURIComponent(folder+'/index.html'),type:'design',label:'Media return check',sessionId:s,path:folder+'/index.html'});
      })()`,{awaitPromise:true});
      const design=`[...document.querySelectorAll('iframe[title^="Design preview:"]')].find(f=>f.getBoundingClientRect().width>0)?.contentDocument`;
      await ctx.waitFor(`${design}?.querySelector('#hero')?.naturalWidth===640`,{timeoutMs:60000});
      await ctx.eval(`[...document.querySelectorAll('[data-testid="design-panel"] button')].find(e=>e.getBoundingClientRect().width>0&&e.textContent==='编辑').click()`);
      await ctx.waitFor(`${design}?.documentElement.getAttribute('data-ipollowork-design-mode')==='editing'`);
      await ctx.eval(`${design}.querySelector('#hero').click()`);
      await ctx.waitFor(`Boolean(document.querySelector('[aria-label="在素材工作台编辑"]'))`);
      await click(ctx,'[aria-label="在素材工作台编辑"]');
      await ctx.waitFor(`${image}?.querySelector('#imageCanvas')?.width===640`,{timeoutMs:60000});
      await ctx.prove('Project selection opens the independent Media Studio with a return path',{
        assert:async()=>ctx.assert(await ctx.eval(`!document.querySelector('[data-testid="design-panel"] [data-testid="media-workbench"]') && ${image}.querySelector('#workbenchBack').hidden===false && document.querySelectorAll('[aria-label="Select tab: 素材工作台"]').length===1`),'The project remains separate while the editor retains its origin'),
        screenshot:{name:'project-source'},
      });
      await ctx.eval(`(()=>{const requestId=document.querySelector('[data-testid="media-workbench"]').dataset.requestId;window.__mediaProofRequest=requestId;window.dispatchEvent(new CustomEvent('ipollowork:image-studio:edit-result',{cancelable:true,detail:{workspaceId:window.__mediaProofWorkspace,sessionId:window.__mediaProofSession,requestId,path:window.__mediaProofFolder+'/edited.png'}}));})()`);
      await ctx.waitFor(`${image}?.querySelector('#documentTitle')?.textContent.includes('edited.png')`,{timeoutMs:60000});
      await ctx.waitFor(`${image}?.querySelector('#imageToVideo')?.hidden===false && !${image}?.querySelector('#imageToVideo')?.disabled && ${image}?.querySelector('#documentTitle')?.textContent.includes('edited.png')`);
      await ctx.eval(`${image}.querySelector('#imageToVideo').click()`);
      await ctx.waitFor(`${engine('video-console')}?.getAttribute('aria-hidden')==='false' && ${video}?.querySelector('#workbenchBack')?.hidden===false`,{timeoutMs:60000});
      await ctx.prove('Continuing from an image into video retains the project return path',{
        action:async()=>{await ctx.waitFor(`${video}?.querySelector('#modelMenu')?.title.includes('Seedance') && [...${video}.querySelectorAll('#mediaCards img')].some(img=>img.naturalWidth>0)`,{timeoutMs:60000});},
        assert:async()=>ctx.assert(await ctx.eval(`${image}.querySelector('#documentTitle').textContent.includes('edited.png') && ${video}.querySelector('#workbenchHint').textContent.includes('继续制作') && !document.querySelector('[data-testid="media-replace-return"]')`),'The original image edit remains mounted and cross-type work retains a return path without an incompatible replacement action'),
        screenshot:{name:'continue-making-video'},
      });
      await switchType(ctx,'image');
      await ctx.waitFor(`${engine('image-studio')}?.getAttribute('aria-hidden')==='false' && ${image}?.querySelector('#documentTitle')?.textContent.includes('edited.png')`);
      await ctx.eval(`${image}.querySelector('#downloadImage').click()`);
      await ctx.waitFor(`document.querySelector('[data-testid="media-replace-return"]')?.getAttribute('aria-disabled')!=='true' && Boolean(document.querySelector('[data-testid="media-replace-return"]'))`);
      await ctx.prove('A completed result keeps save and replace actions in the same studio',{
        assert:async()=>ctx.assert(await ctx.eval(`${image}.querySelector('#workbenchBack').hidden===false && document.querySelectorAll('[aria-label="Select tab: 素材工作台"]').length===1`),'Prepared result delivery does not open a second studio or lose source context'),
        screenshot:{name:'result-save-menu'},
      });
      await ctx.trustedClick('[data-testid="media-save-copy"]');
      await ctx.waitFor(`${image}?.querySelector('#workbenchHint')?.textContent.includes('已保存新素材')`);
      await ctx.assert(await ctx.eval(`(async()=>{const f=await window.__mediaProofClient.readWorkspaceFile(window.__mediaProofWorkspace,window.__mediaProofFolder+'/index.html');return (f.content.match(/src="source.png"/g)||[]).length===2;})()`,{awaitPromise:true}),'Saving a new asset leaves both project references unchanged');
      await ctx.eval(`${image}.querySelector('#downloadImage').click()`);
      await ctx.waitFor('Boolean(document.querySelector("[data-testid=media-replace-return]"))');
      await ctx.trustedClick('[data-testid="media-replace-return"]');
      await ctx.waitFor(`${engine('image-studio')}?.getAttribute('aria-hidden')==='true'`);
      await ctx.prove('Replace and return updates only the selected project position',{
        assert:async()=>ctx.assert(await ctx.eval(`(async()=>{const f=await window.__mediaProofClient.readWorkspaceFile(window.__mediaProofWorkspace,window.__mediaProofFolder+'/index.html');const d=new DOMParser().parseFromString(f.content,'text/html');return d.querySelector('#hero').getAttribute('src').endsWith('edited.png')&&d.querySelector('#other').getAttribute('src')==='source.png';})()`,{awaitPromise:true}),'Only the selected element uses the new file; the original file and other reference remain'),
        screenshot:{name:'replaced-return'},
      });
    } finally {
      await ctx.eval(`(()=>{const store=window.__mediaProofStore,s=window.__mediaProofSession;store.setState(state=>({sessions:{...state.sessions,[s]:window.__mediaProofOriginal},mediaEdits:window.__mediaProofEdits}));})()`);
      await ctx.eval(`(async()=>{const folder=window.__mediaProofFolder;if(!folder?.startsWith('artifacts/media-studio/proof-'))return;await window.__mediaProofClient.deleteWorkspaceFiles(window.__mediaProofWorkspace,[{path:folder,recursive:true}]);const key='image-studio-gallery:'+window.__mediaProofWorkspace+':'+window.__mediaProofSession;const saved=localStorage.getItem(key);if(saved)localStorage.setItem(key,JSON.stringify(JSON.parse(saved).filter(item=>!item.path.startsWith(folder+'/'))));})()`,{awaitPromise:true});
    }
  }},{name:'Centered empty output states with fixture artifact responses',async run(ctx){
    await ctx.eval(`window.__mediaEmptySetup=(async()=>{
      const store=window.__mediaProofStore,s=window.__mediaProofSession,w=window.__mediaProofWorkspace;
      window.__mediaEmptyOriginal=store.getState().sessions[s];
      window.__mediaEmptyGalleryKey='image-studio-gallery:'+w+':'+s;
      window.__mediaEmptyGallery=localStorage.getItem(window.__mediaEmptyGalleryKey);
      window.__mediaEmptyPaths=(await window.__mediaProofClient.listSessionArtifacts(w,s)).items.filter(item=>/\\.(png|jpe?g|webp)$/.test(item.path)).slice(0,1).map(item=>item.path);
      localStorage.removeItem(window.__mediaEmptyGalleryKey);
      window.__mediaEmptyFetch=window.fetch;
      window.fetch=function(input,init){const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.pathname.endsWith('/workspace/'+w+'/artifacts')&&url.searchParams.get('sessionId')===s)return Promise.resolve(new Response(JSON.stringify({items:[],nextCursor:null}),{headers:{'Content-Type':'application/json'}}));return window.__mediaEmptyFetch(input,init);};
      for(const tab of store.getState().sessions[s].tabs)if(tab.type==='workspace-app'&&['media-studio','image-studio','video-console'].includes(tab.surface.pluginId))store.getState().closeTab(s,tab.id);
      window.__mediaEmptyTheme=document.documentElement.getAttribute('data-theme');window.__mediaEmptyScheme=document.documentElement.style.colorScheme;
    })()`,{awaitPromise:true});
    try{
      await ctx.waitFor(`!document.querySelector('[aria-label="Select tab: 素材工作台"]')`);
      await click(ctx,'button[aria-label="添加侧面板入口"]');
      await ctx.waitFor(`Boolean(document.querySelector('[data-testid="side-panel-launcher-workspace-app:media-studio"]'))`);
      await click(ctx,'[data-testid="side-panel-launcher-workspace-app:media-studio"]');
      await ctx.waitFor(`Boolean(${image}?.querySelector('#outputsEmpty'))`,{timeoutMs:60000});
      await ctx.eval(`${image}.querySelector('#generateMode').click()`);
      await ctx.waitFor(`${image}?.querySelector('#outputsEmpty')?.hidden===false && Boolean(${engine('image-studio')}?.querySelector('textarea[name=prompt]'))`);
      await ctx.prove('Empty image outputs invite the first creation in the center',{
        assert:async()=>ctx.assert(await ctx.eval(`(()=>{const d=${image},r=d.querySelector('#outputsEmpty').getBoundingClientRect(),a=d.querySelector('.outputs-empty-art').getBoundingClientRect(),stage=d.querySelector('#stage').getBoundingClientRect();return d.querySelector('[data-output-empty-title]').textContent==='给灵感一个开始' && Math.abs(a.x+a.width/2-stage.width/2)<2 && r.height>220 && d.querySelector('#galleryGrid').children.length===0;})()`),'The illustration and invitation are centered in the available gallery, above the composer'),
        screenshot:{name:'empty-image-light'},
      });
      await ctx.eval(`${engine('image-studio')}.querySelector('iframe').contentWindow.postMessage({type:'ipollowork:image-studio:image-list',error:'Fixture: could not load outputs'},'*')`);
      await ctx.waitFor(`${image}?.querySelector('#outputsEmpty')?.hidden===true && ${image}?.querySelector('#galleryStatus')?.textContent.includes('could not load')`);
      await ctx.eval(`${engine('image-studio')}.querySelector('iframe').contentWindow.postMessage({type:'ipollowork:image-studio:image-list',paths:[]},'*')`);
      await ctx.waitFor(`${image}?.querySelector('#outputsEmpty')?.hidden===false`);
      await switchType(ctx,'video');
      await ctx.waitFor(`${video}?.querySelector('#outputsEmpty')?.hidden===false`,{timeoutMs:60000});
      await ctx.prove('Video uses the same empty state',{
        assert:async()=>ctx.assert(await ctx.eval(`(()=>{const d=${video},r=d.querySelector('#outputsEmpty').getBoundingClientRect(),a=d.querySelector('.outputs-empty-art').getBoundingClientRect();return d.querySelector('[data-output-empty-title]').textContent==='给灵感一个开始' && Math.abs(a.x+a.width/2-d.documentElement.clientWidth/2)<2 && r.height>220;})()`),'The video empty state shares the image layout and copy'),
        screenshot:{name:'empty-video-light'},
      });
      await ctx.client.send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false});
      await ctx.eval(`document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';`);
      await ctx.prove('The empty state fits a narrow dark canvas',{
        assert:async()=>ctx.assert(await ctx.eval(`(()=>{const d=${video},e=d.querySelector('#outputsEmpty'),r=e.getBoundingClientRect(),a=d.querySelector('.outputs-empty-art').getBoundingClientRect();return r.left>=0&&r.right<=d.documentElement.clientWidth&&a.bottom<d.documentElement.clientHeight&&getComputedStyle(d.documentElement).colorScheme==='dark';})()`),'Semantic colors adapt to dark mode without horizontal overflow'),
        screenshot:{name:'empty-video-dark'},
      });
      await ctx.eval(`window.__mediaEmptyLocaleSetup=(async()=>{const src=await(await fetch('/src/react-app/domains/session/chat/session-page.tsx')).text();const url=src.split('"').find(v=>v.startsWith('/src/i18n/index.ts'));window.__mediaEmptyI18n=await import(url);window.__mediaEmptyLocale=window.__mediaEmptyI18n.currentLocale();window.__mediaEmptyI18n.setLocale('en');})()`,{awaitPromise:true});
      await ctx.waitFor(`${video}?.querySelector('[data-output-empty-title]')?.textContent==='Make room for your next idea'`);
      await ctx.prove('The English invitation stays readable at narrow width',{
        assert:async()=>ctx.assert(await ctx.eval(`${video}.querySelector('[data-output-empty-description]').textContent.includes('Your first creation') && ${video}.querySelector('#outputsEmpty').scrollWidth<=${video}.documentElement.clientWidth`),'Both translated lines fit the same empty state'),
        screenshot:{name:'empty-video-english'},
      });
      await ctx.eval('window.__mediaEmptyI18n.setLocale(window.__mediaEmptyLocale)');
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.eval(`document.documentElement.setAttribute('data-theme',window.__mediaEmptyTheme);document.documentElement.style.colorScheme=window.__mediaEmptyScheme;`);
      await ctx.assert(await ctx.eval('window.__mediaEmptyPaths.length>0'),'A real existing image is available for the populated transition');
      await ctx.eval(`${engine('video-console')}.querySelector('iframe').contentWindow.postMessage({type:'ipollowork:video-console:media-list',paths:window.__mediaEmptyPaths},'*')`);
      await ctx.waitFor(`${video}?.querySelector('#outputsEmpty')?.hidden===true && ${video}?.querySelector('#mediaCards img')?.naturalWidth>0`,{timeoutMs:60000});
      await ctx.prove('Existing outputs replace the empty state',{
        assert:async()=>ctx.assert(await ctx.eval(`${video}.querySelector('#mediaCards').children.length===1 && ${video}.querySelector('#outputsEmpty').hidden`),'The normal preview card returns as soon as an output is available'),
        screenshot:{name:'empty-to-populated'},
      });
    }finally{
      await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      await ctx.eval(`if(window.__mediaEmptyLocale)window.__mediaEmptyI18n.setLocale(window.__mediaEmptyLocale);window.fetch=window.__mediaEmptyFetch;if(window.__mediaEmptyGallery===null)localStorage.removeItem(window.__mediaEmptyGalleryKey);else localStorage.setItem(window.__mediaEmptyGalleryKey,window.__mediaEmptyGallery);document.documentElement.setAttribute('data-theme',window.__mediaEmptyTheme);document.documentElement.style.colorScheme=window.__mediaEmptyScheme;window.__mediaProofStore.setState(state=>({sessions:{...state.sessions,[window.__mediaProofSession]:window.__mediaEmptyOriginal}}));delete window.__mediaEmptyFetch;`);
    }
  }}],
};
