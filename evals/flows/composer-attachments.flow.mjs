// Start on an empty new-task composer. Files stay in the draft; nothing is submitted.
const card = '.composer-card';
const editor = `${card} [data-lexical-editor]`;
const fixtureName = 'composer-layout-reference-';

async function attach(ctx, count) {
  await ctx.eval(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 60;
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#268b9b'; paint.fillRect(0, 0, 80, 60);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const transfer = new DataTransfer();
    for (let index = 0; index < ${count}; index++) {
      transfer.items.add(new File([blob], ${JSON.stringify(fixtureName)} + index + '.png', {type: 'image/png'}));
    }
    const input = document.querySelector('${card} input[type=file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  })()`);
  await ctx.waitFor(`document.querySelector('${card}').querySelectorAll('img[decoding=async]').length >= ${count}`);
}

async function clearFixtures(ctx) {
  const selector = `[data-testid=composer-image-attachment]:has(img[alt^="${fixtureName}"])`;
  while (await ctx.eval(`Boolean(document.querySelector('${selector}'))`)) {
    const count = await ctx.eval(`document.querySelectorAll('${selector}').length`);
    await ctx.eval(`document.querySelector('${selector} button').click()`);
    await ctx.waitFor(`document.querySelectorAll('${selector}').length < ${count}`);
  }
}

async function assertLayout(ctx, {empty = false, scrolling = false} = {}) {
  const state = await ctx.eval(`(() => {
    const card = document.querySelector('${card}');
    const editor = card.querySelector('[data-lexical-editor]');
    const footer = editor.parentElement.parentElement.lastElementChild;
    const rect = card.getBoundingClientRect(), field = editor.getBoundingClientRect(), actions = footer.getBoundingClientRect();
    const placeholder = card.querySelector('[data-testid=composer-placeholder]')?.getBoundingClientRect();
    const rail = card.querySelector('[data-testid=composer-image-attachment]')?.parentElement;
    return {
      height: rect.height, editorHeight: field.height,
      thumbnails: [...card.querySelectorAll('[data-testid=composer-image-attachment]')].map(e => ({width:e.getBoundingClientRect().width, height:e.getBoundingClientRect().height})),
      aligned: !rail || rail.getBoundingClientRect().left === field.left,
      chipAligned: !card.querySelector('.new-conversation-capability-chip') || card.querySelector('.new-conversation-capability-chip').getBoundingClientRect().left === field.left,
      contained: actions.bottom <= rect.bottom - 7 && actions.left >= rect.left && actions.right <= rect.right,
      separated: field.bottom + 7 <= actions.top && (!placeholder || placeholder.bottom <= actions.top),
      buttonsContained: [...footer.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width).every(b => {
        const r = b.getBoundingClientRect(); return r.left >= rect.left && r.right <= rect.right && r.bottom <= rect.bottom;
      }),
      railScrollable: rail && rail.scrollHeight > rail.clientHeight && getComputedStyle(rail).overflowY === 'auto',
      editorScrollable: editor.scrollHeight > editor.clientHeight && getComputedStyle(editor).overflowY === 'auto'
    };
  })()`);
  ctx.assert(state.aligned && state.chipAligned && state.thumbnails.every(r => r.width === 48 && r.height === 48), `48px thumbnails align with tag and input: ${JSON.stringify(state)}`);
  ctx.assert(state.editorHeight === 60, `Editor keeps 60px: ${JSON.stringify(state)}`);
  ctx.assert(state.contained && state.separated && state.buttonsContained, `Input and actions must not overlap or overflow: ${JSON.stringify(state)}`);
  if (empty) ctx.assert(state.height === 122, `Empty card keeps its 122px height: ${state.height}`);
  if (scrolling) ctx.assert(state.railScrollable && state.editorScrollable, `Attachments and long draft scroll independently: ${JSON.stringify(state)}`);
}

async function proveFlatPlusMenu(ctx) {
  const plus = '.composer-card button[title="添加到任务"], .composer-card button[title="Add to this task"]';
  const menu = '[data-testid="composer-plus-menu"]';
  const originalDraft = await ctx.eval(`document.querySelector('${editor}').textContent`);
  const originalWidth = await ctx.eval(`document.querySelector('${card}').style.width`);
  try {
    await ctx.prove('Add, plugins, MCPs, and external agents share one list', {
      voiceover: '加号菜单里的文件、模板、插件、MCP 和外部智能体处于同一个列表，按标题分组。',
      action: async () => {
        await ctx.trustedClick(plus);
        await ctx.waitFor(`Boolean(document.querySelector('${menu}'))`);
        await ctx.waitFor(`!document.querySelector('${menu} [role=status]')`);
      },
      assert: async () => {
        const state = await ctx.eval(`(() => {const m=document.querySelector('${menu}'),s=getComputedStyle(m),buttons=[...m.querySelectorAll('button')],icon=name=>buttons.find(b=>b.innerText.includes(name))?.querySelector('img')?.getAttribute('src'),add=buttons.find(b=>b.innerText.includes('附加文件')),template=buttons.find(b=>b.innerText.includes('使用模板'));return {headings:m.innerText,width:m.getBoundingClientRect().width,height:m.getBoundingClientRect().height,viewportHeight:window.innerHeight,buttons:buttons.length,weight:getComputedStyle(buttons[0]).fontWeight,shadow:s.boxShadow,border:s.borderStyle,submenus:document.querySelectorAll('[data-testid="composer-extensions-menu"]').length,overflow:s.overflowY,icons:{design:icon('iPollo Design'),video:icon('iPollo Video'),media:icon('素材工作台')},paperclipSize:add?.querySelector('svg')?.getBoundingClientRect().width,templateSize:template?.querySelector('img')?.getBoundingClientRect().width};})()`);
        ctx.assert(/添加|Add/.test(state.headings) && /插件|Plugins/.test(state.headings) && /MCP/.test(state.headings) && /外部智能体|External agents/.test(state.headings), `All groups appear in one list: ${JSON.stringify(state)}`);
        const plugins = state.headings.indexOf(state.headings.includes('插件') ? '插件' : 'Plugins');
        const agents = state.headings.indexOf(state.headings.includes('外部智能体') ? '外部智能体' : 'External agents');
        ctx.assert(plugins >= 0 && plugins < agents && agents < state.headings.indexOf('MCP'), `Agent section follows plugins and precedes MCP: ${JSON.stringify(state)}`);
        ctx.assert(state.width <= 384 && state.height <= Math.min(state.viewportHeight * 0.56,416) + 1 && state.buttons >= 2 && state.submenus === 0 && state.overflow === 'auto' && state.shadow === 'none' && state.border === 'solid' && Number(state.weight) >= 500, `The outlined menu stays compact and readable: ${JSON.stringify(state)}`);
        ctx.assert(state.icons.design?.includes('ext-design.png') && state.icons.video?.includes('ext-video.png') && state.icons.media?.includes('ext-image-studio.png'), `Menu icons follow their plugin identities: ${JSON.stringify(state.icons)}`);
        const iconStyle = await ctx.eval(`(() => {const button=[...document.querySelectorAll('${menu} button')].find(b=>b.innerText.includes('iPollo Design')),image=button?.querySelector('img');return {size:image?.getAttribute('width'),filter:image&&getComputedStyle(image).filter,opacity:button&&getComputedStyle(button).opacity};})()`);
        ctx.assert(iconStyle.size === '16' && iconStyle.filter === 'none' && iconStyle.opacity === '1', `Plugin icon keeps its original color at the installed-list size: ${JSON.stringify(iconStyle)}`);
        ctx.assert(state.templateSize < state.paperclipSize, `The visually fuller template glyph uses a smaller box than the attachment icon: ${JSON.stringify(state)}`);
        const editorType = await ctx.eval(`(() => {const input=document.querySelector('${editor}'),placeholder=document.querySelector('${card} [data-testid=composer-placeholder]');return {inputSize:getComputedStyle(input).fontSize,inputLineHeight:getComputedStyle(input).lineHeight,placeholderSize:getComputedStyle(placeholder).fontSize};})()`);
        ctx.assert(editorType.inputSize === '14px' && editorType.placeholderSize === '14px' && editorType.inputLineHeight === '21px', `Composer input and placeholder share 14px text with 1.5 line height: ${JSON.stringify(editorType)}`);
        ctx.assert(!/正在更新列表|Refreshing list|列表更新失败|Could not refresh list/.test(state.headings), 'The refreshed list has settled without an error');
      },
      screenshot: {name:'flat-plus-menu', requireText:['插件']},
    });
    await ctx.prove('The same list fits a narrow composer', {
      voiceover: '对话栏变窄时，菜单仍然是一个可滚动列表，不会溢出或弹出第二层。',
      action: async () => {
        await ctx.eval(`document.querySelector('${card}').style.width='360px'`);
      },
      assert: async () => {
        const state = await ctx.eval(`(() => {const m=document.querySelector('${menu}'),c=document.querySelector('${card}'),r=m.getBoundingClientRect(),p=c.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,width:r.width,composerLeft:p.left,composerRight:p.right,scrollable:getComputedStyle(m).overflowY==='auto'};})()`);
        ctx.assert(state.left >= state.composerLeft && state.right <= state.composerRight && state.top >= 0 && state.scrollable, `Narrow menu stays inside the composer: ${JSON.stringify(state)}`);
      },
      screenshot: {name:'flat-plus-menu-narrow', requireText:['插件']},
    });
    await ctx.prove('The list remains contained at 280px', {
      voiceover: '更窄的对话栏里，菜单随容器缩小，名称与说明会截断，不出现横向滚动。',
      action: async () => {
        await ctx.eval(`document.querySelector('${card}').style.width='280px'`);
      },
      assert: async () => {
        const state = await ctx.eval(`(() => {const m=document.querySelector('${menu}'),c=document.querySelector('${card}'),r=m.getBoundingClientRect(),p=c.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,composerLeft:p.left,composerRight:p.right,scrollWidth:m.scrollWidth,clientWidth:m.clientWidth};})()`);
        ctx.assert(state.left >= state.composerLeft && state.right <= state.composerRight && state.scrollWidth <= state.clientWidth + 1, `Compact menu fits 280px without horizontal scrolling: ${JSON.stringify(state)}`);
      },
      screenshot: {name:'flat-plus-menu-small', requireText:['插件']},
    });
    if (await ctx.eval(`document.querySelector('${menu}').scrollHeight > document.querySelector('${menu}').clientHeight + 1`)) {
      await ctx.prove('Lower sections remain reachable by scrolling the same popup', {
        voiceover: '继续向下滚动同一个菜单，就能看到外部智能体和 MCP，无需进入子菜单。',
        action: async () => {
          await ctx.eval(`document.querySelector('${menu}').scrollTop = document.querySelector('${menu}').scrollHeight`);
        },
        assert: async () => {
          const state = await ctx.eval(`(() => {const m=document.querySelector('${menu}');return {text:m.innerText,atBottom:m.scrollTop+m.clientHeight>=m.scrollHeight-1,submenus:document.querySelectorAll('[data-testid="composer-extensions-menu"]').length};})()`);
          ctx.assert(state.atBottom && state.submenus === 0 && /外部智能体|External agents/.test(state.text) && /MCP/.test(state.text), `External agents and MCP stay in the same list: ${JSON.stringify(state)}`);
        },
        screenshot: {name:'flat-plus-menu-bottom', requireText:['MCP']},
      });
    }
    ctx.assert(await ctx.eval(`document.querySelector('${editor}').textContent === ${JSON.stringify(originalDraft)}`), 'Opening the list does not change the draft');
  } finally {
    if (await ctx.eval(`Boolean(document.querySelector('${menu}'))`)) await ctx.trustedClick(plus);
    await ctx.eval(`document.querySelector('${card}').style.width=${JSON.stringify(originalWidth)}`);
  }
}

export default {
  id: 'composer-attachments',
  title: 'Chat attachments and capability chips preserve the input and footer',
  kind: 'user-facing',
  steps: [{
    name: 'Empty, attached, tagged and long drafts at responsive widths',
    run: async ctx => {
      await ctx.waitFor(`Boolean(document.querySelector('${editor}'))`);
      if (process.env.IPOLLOWORK_EVAL_COMPOSER_MENU_ONLY === '1') return proveFlatPlusMenu(ctx);
      ctx.assert(await ctx.eval(`document.querySelector('${editor}').textContent.trim() === '' && !document.querySelector('${card} img[decoding=async]') && !document.querySelector('.new-conversation-capability-chip')`), 'Start with an empty draft and no capability chip');
      const theme = await ctx.eval("({value: document.documentElement.getAttribute('data-theme'), scheme: document.documentElement.style.colorScheme})");
      try {
        await ctx.prove('Empty composer retains its original compact height', {
          action: async () => {}, assert: () => assertLayout(ctx, {empty:true}),
          screenshot: {name: 'composer-empty', fromSurface:true},
        });
        await attach(ctx, 1);
        await ctx.prove('An attachment alone leaves room for text and controls', {
          action: async () => {}, assert: () => assertLayout(ctx),
          screenshot: {name:'composer-attachment-only', fromSurface:true},
        });
        await ctx.prove('Hover reveals filename, dimensions and size while the thumbnail stays compact', {
          action: async () => {
            const point = await ctx.eval(`(() => {const r=document.querySelector('[data-testid=composer-image-attachment]').getBoundingClientRect();return {x:r.x+20,y:r.y+25};})()`);
            await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...point});
            await ctx.waitFor(`Boolean([...document.querySelectorAll('[data-slot=tooltip-content]')].find(e=>e.textContent.includes('80 × 60')))`);
          },
          assert: async () => {
            const info = await ctx.eval(`document.querySelector('[data-slot=tooltip-content]').textContent`);
            ctx.assert(info.includes(fixtureName) && info.includes('80 × 60') && /B/.test(info), 'Tooltip includes filename, image dimensions and file size');
            await assertLayout(ctx);
          },
          screenshot: {name:'composer-thumbnail-tooltip', fromSurface:true},
        });
        await ctx.client.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:5,y:5});
        for (const width of [1440, 1024, 640, 480]) {
          await ctx.prove(`Attachment and capability chip fit at ${width}px`, {
            action: async () => {
              if (width === 1440) {
                await ctx.eval(`[...document.querySelectorAll('button')].find(b=>/^(工作|Work)$/.test(b.textContent.trim()))?.click()`);
                await ctx.waitFor(`[...document.querySelectorAll('button')].some(b=>/^(文档处理|Documents)$/.test(b.textContent.trim()))`);
                await ctx.eval(`[...document.querySelectorAll('button')].find(b=>/^(文档处理|Documents)$/.test(b.textContent.trim()))?.click()`);
                await ctx.waitFor("Boolean(document.querySelector('.new-conversation-capability-chip'))");
              }
              await ctx.client.send('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:false});
            },
            assert: async () => {
              ctx.assert(await ctx.eval("Boolean(document.querySelector('.new-conversation-capability-chip'))"), 'Capability chip is present');
              await assertLayout(ctx);
            },
            screenshot: {name:`composer-attachment-${width}`, fromSurface:true},
          });
        }
        await ctx.prove('Multiple attachments and long text scroll without covering the footer in dark mode', {
          action: async () => {
            await clearFixtures(ctx);
            await attach(ctx, 12);
            await ctx.eval("document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'");
            await ctx.trustedClick(editor);
            await ctx.client.send('Input.insertText', {text: '检查附件后整理内容，并保留素材信息。\n'.repeat(16)});
          },
          assert: () => assertLayout(ctx, {scrolling:true}),
          screenshot: {name:'composer-attachments-scroll-dark', fromSurface:true},
        });
      } finally {
        await ctx.trustedClick(editor);
        await ctx.client.send('Input.dispatchKeyEvent', {type:'keyDown', key:'a', code:'KeyA', modifiers:4, commands:['selectAll']});
        await ctx.client.send('Input.dispatchKeyEvent', {type:'keyUp', key:'a', code:'KeyA', modifiers:4});
        await ctx.client.send('Input.dispatchKeyEvent', {type:'keyDown', key:'Backspace', code:'Backspace'});
        await ctx.client.send('Input.dispatchKeyEvent', {type:'keyUp', key:'Backspace', code:'Backspace'});
        await clearFixtures(ctx);
        await ctx.eval("document.querySelector('.new-conversation-capability-chip button')?.click()");
        await ctx.eval(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme.value)}); document.documentElement.style.colorScheme = ${JSON.stringify(theme.scheme)}`);
        await ctx.client.send('Emulation.clearDeviceMetricsOverride');
      }
      await ctx.prove('Removing attachments and the chip restores the compact composer', {
        action: async () => {}, assert: () => assertLayout(ctx, {empty:true}),
        screenshot: {name:'composer-restored', fromSurface:true},
      });
    },
  }],
};
