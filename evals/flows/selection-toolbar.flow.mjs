import { connect, pickAppTarget, evaluate } from "../runner/cdp.mjs";
const design = 'document.querySelector(\'iframe[title^="Design preview:"]\')?.contentDocument';
export default {
  id: "selection-toolbar",
  title: "Shared project selection toolbars: grouped studio entry and responsive hover hints",
  kind: "user-facing",
  preserveTheme: true,
  cdpTarget: {urlIncludes:"127.0.0.1:5274"},
  steps:[{
    name:"Design toolbar labels, spacing, and compact tooltips",
    async run(ctx){
      await ctx.client.send("Page.reload");
      await ctx.waitFor(`${design}?.getElementById('hero')?.complete`,{timeoutMs:60000});
      await ctx.clickText("编辑",{selector:"button"});
      await ctx.waitFor(`${design}?.documentElement.getAttribute('data-ipollowork-design-mode')==='editing'`);
        await ctx.prove("Project media has a separate labeled studio action at regular width", {
          action: async () => { await ctx.eval(`${design}.getElementById('hero').click()`); },
          assert: async () => {
            await ctx.waitFor("document.querySelector('[aria-label=在图片工作台编辑]')?.textContent==='图片编辑'");
            ctx.assert(await ctx.eval("document.querySelectorAll('[data-testid=design-floating-toolbar] [aria-hidden=true].bg-border').length===2"), "Quick edits, studio entry and delete are separated");
            ctx.assert(await ctx.eval("(()=>{const entry=document.querySelector('[aria-label=在图片工作台编辑]'),settings=document.querySelector('[aria-label=调整属性]');return entry.querySelectorAll('svg').length===1&&getComputedStyle(entry.querySelector('svg')).color===getComputedStyle(settings.querySelector('svg')).color})()"), "Entry uses one icon and the same neutral color as adjacent tools");
          },
          screenshot: {name:"project-toolbar-labeled"},
        });
        await ctx.prove("Every compact project toolbar action has a localized hover hint", {
          action: async () => {
            await ctx.client.send("Emulation.setDeviceMetricsOverride", {width:360,height:850,deviceScaleFactor:1,mobile:false});
            await ctx.waitFor("document.querySelector('[aria-label=在图片工作台编辑]')?.textContent===''");
          },
          assert: async () => {
            const buttons=await ctx.eval("[...document.querySelectorAll('[data-testid=design-floating-toolbar] button')].map(b=>b.getAttribute('aria-label'))");
            ctx.assert(buttons.length===5 && buttons.every(Boolean), "All compact buttons have accessible names");
            for(const label of buttons){
              const point=await ctx.eval(`(()=>{const r=document.querySelector('[data-testid=design-floating-toolbar] [aria-label="${label}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
              await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
              await ctx.waitFor(`document.querySelector('[data-slot=tooltip-content][data-open]')?.textContent===${JSON.stringify(label)}`);
            }
            ctx.assert(await ctx.eval("(()=>{const r=document.querySelector('[data-testid=design-floating-toolbar]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"), "The compact toolbar fits within the canvas");
          },
          screenshot:{name:"project-toolbar-compact-hints"},
        });
        await ctx.prove("English studio labels and hints work at medium width", {
          action: async () => {
            await ctx.eval("window.__proofSetLocale('en')");
            await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:700,height:850,deviceScaleFactor:1,mobile:false});
          },
          assert: async () => {
            await ctx.waitFor("document.querySelector('[aria-label=\"Edit in Image Studio\"]')?.textContent==='Edit image'");
            const point=await ctx.eval("(()=>{const r=document.querySelector('[aria-label=\"Edit in Image Studio\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
            await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
            await ctx.waitFor("document.querySelector('[data-slot=tooltip-content][data-open]')?.textContent==='Edit in Image Studio'");
          },
          screenshot:{name:"project-toolbar-english"},
        });
        await ctx.eval("window.__proofSetLocale('zh')");
        await ctx.client.send("Emulation.clearDeviceMetricsOverride");
      await ctx.prove("The labeled entry still opens the selected image in an independent studio",{
        action:async()=>{
          await ctx.trustedClick('[aria-label=在图片工作台编辑]');
          await ctx.waitFor("document.querySelector('iframe[title=\"图片工作台\"]')?.contentDocument?.querySelector('#imageCanvas')?.width===800",{timeoutMs:60000});
        },
        assert:async()=>{ctx.assert(await ctx.eval("!document.querySelector('[data-testid=design-panel] [data-testid=media-workbench]') && document.querySelector('[data-testid=media-workbench]')?.getBoundingClientRect().width>0"),"Independent studio retains selected source");},
        screenshot:{name:"toolbar-open-independent-studio"},
      });
    }
  },
    {
      name: "Video project uses the same grouped entry and compact hover hints",
      async run(ctx) {
        await ctx.clickText("Video Studio 验证",{selector:"button"});
        await ctx.waitFor("Boolean(document.querySelector('iframe[title=\"Video Studio\"]'))");
        let target;
        for(let attempt=0;attempt<40;attempt++) {
          try {target=await pickAppTarget(ctx.cdpBaseUrl,{urlIncludes:"localhost:5192"});break;} catch {await new Promise(r=>setTimeout(r,250));}
        }
        ctx.assert(target,"Video project target mounted");
        const connection=await connect(target.webSocketDebuggerUrl);
        const video=expression=>evaluate(connection,expression,{awaitPromise:true});
        const waitVideo=async expression=>{
          for(let attempt=0;attempt<120;attempt++) {if(await video(expression))return;await new Promise(r=>setTimeout(r,250));}
          throw new Error(`Video assertion timed out: ${expression}`);
        };
        try {
          await waitVideo("Boolean(document.querySelector('[aria-label=\"选择 Hero Image\"]')) && document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe')?.contentDocument?.getElementById('hero-image')?.complete");
          await video("document.querySelector('[aria-label=\"选择 Hero Image\"]').click()");
          const point=await video("(()=>{const f=document.querySelector('hyperframes-player').shadowRoot.querySelector('iframe'),e=f.contentDocument.getElementById('hero-image'),r=f.getBoundingClientRect(),b=e.getBoundingClientRect();return{x:r.x+(b.x+b.width/2)*r.width/f.contentWindow.innerWidth,y:r.y+(b.y+b.height/2)*r.height/f.contentWindow.innerHeight}})()");
          point.y+=await ctx.eval("document.querySelector('iframe[title=\"Video Studio\"]').getBoundingClientRect().y");
          for(const type of ['mouseMoved','mousePressed','mouseReleased'])await ctx.client.send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
          await ctx.prove("Video media entry is labeled and separated from quick edits and delete",{
            action:async()=>{await waitVideo("document.querySelector('[aria-label=在图片工作台编辑]')?.textContent==='图片编辑'");},
            assert:async()=>{ctx.assert(await video("document.querySelectorAll('.hf-preview-text-toolbar__divider').length===2"),"Video entry has its own group");},
            screenshot:{name:"video-project-toolbar-labeled"},
          });
          await ctx.prove("Every compact video toolbar action has a hover hint",{
            action:async()=>{
              await ctx.client.send("Emulation.setDeviceMetricsOverride",{width:420,height:850,deviceScaleFactor:1,mobile:false});
              await waitVideo("document.querySelector('[aria-label=在图片工作台编辑]')?.textContent===''");
            },
            assert:async()=>{
              const labels=await video("[...document.querySelectorAll('.hf-preview-text-toolbar button')].map(b=>b.getAttribute('aria-label'))");
              ctx.assert(labels.length===4&&labels.every(Boolean),"Every video button has an accessible name");
              for(const label of labels){
                const point=await video(`(()=>{const r=document.querySelector('.hf-preview-text-toolbar [aria-label="${label}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
                point.y+=await ctx.eval("document.querySelector('iframe[title=\"Video Studio\"]').getBoundingClientRect().y");
                await ctx.client.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
                await waitVideo(`document.querySelector('[role=tooltip]')?.textContent===${JSON.stringify(label)}`);
              }
              ctx.assert(await video("(()=>{const r=document.querySelector('.hf-preview-text-toolbar').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()"),"Video toolbar stays inside narrow canvas");
            },
            screenshot:{name:"video-project-toolbar-compact-hints"},
          });
        } finally {connection.close();await ctx.client.send("Emulation.clearDeviceMetricsOverride");}
      },
    },
  ],
};
