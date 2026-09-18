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

async function proveExtensionsMenu(ctx) {
  const plus = '.composer-card button[title="添加到任务"], .composer-card button[title="Add to this task"]';
  const menu = '[data-testid="composer-plus-menu"]';
  const extensions = '[data-testid="composer-extensions-menu"]';
  const originalHash = await ctx.eval('location.hash');
  const originalDraft = await ctx.eval(`document.querySelector('${editor}').textContent`);
  const originalWidth = await ctx.eval(`document.querySelector('${card}').style.width`);
  const open = async () => {
    await ctx.waitFor(`Boolean(document.querySelector('${plus}'))`);
    if (!await ctx.eval(`Boolean(document.querySelector('${menu}'))`)) await ctx.trustedClick(plus);
    await ctx.waitFor(`Boolean(document.querySelector('${menu}'))`);
  };
  if (await ctx.eval(`Boolean(document.querySelector('${menu}'))`)) await ctx.trustedClick(plus);
  try {
    await ctx.prove('The compact add menu offers Extensions alongside files, templates and delegation', {
      voiceover: '打开加号菜单，扩展使用与左侧栏一致的图标，四个入口的按钮也更紧凑。',
      action: open,
      assert: async () => {
        const state = await ctx.eval(`(() => { const m=document.querySelector('${menu}'); return {width:m.getBoundingClientRect().width, items:[...m.querySelectorAll('button')].map(b=>({text:b.textContent.trim(), height:b.getBoundingClientRect().height}))}; })()`);
        ctx.assert(await ctx.eval(`(() => { const icon=document.querySelector('${menu} .lucide-toy-brick'), sidebar=document.querySelector('[data-sidebar-primary-icon] .lucide-toy-brick'); return Boolean(icon && sidebar && icon.innerHTML===sidebar.innerHTML && icon.getAttribute('stroke-width')===sidebar.getAttribute('stroke-width')); })()`), 'Extensions uses the same icon and stroke as the sidebar');
        ctx.assert(state.width <= 176 && state.items.length === 4 && state.items.every(b=>b.height <= 32), JSON.stringify(state));
        ctx.assert(state.items.some(b=>/^(扩展|Extensions)$/.test(b.text)) && !state.items.some(b=>/^(工具|Tools)$/.test(b.text)), 'Extensions replaces Tools');
      },
      screenshot: {name:'compact-plus-menu', requireText:['扩展','使用模板']},
    });
    for (const [index, name, route] of [[0,'插件','plugins'],[1,'MCP','mcp']]) {
      await open();
      await ctx.eval(`[...document.querySelectorAll('${menu} button')].find(b=>/^(扩展|Extensions)$/.test(b.textContent.trim())).click()`);
      await ctx.waitFor(`Boolean(document.querySelector('${extensions}'))`);
      await ctx.eval(`document.querySelector('${extensions}').firstElementChild.firstElementChild.querySelectorAll('button')[${index}].click()`);
      await ctx.waitFor(`!document.querySelector('${extensions}').textContent.includes('加载') && !document.querySelector('${extensions}').textContent.includes('Loading')`);
      await ctx.prove(`${name} is available in a compact two-section extensions menu`, {
        voiceover: `扩展里只保留插件和 MCP。现在查看${name}，可以从右上角进入对应配置。`,
        action: async () => {},
        assert: async () => {
          const state = await ctx.eval(`(() => {const m=document.querySelector('${extensions}'); const nav=[...m.firstElementChild.firstElementChild.querySelectorAll('button')];return {width:m.getBoundingClientRect().width, contained:m.getBoundingClientRect().right <= document.querySelector('.composer-card').getBoundingClientRect().right, noHorizontalScroll:[...m.querySelectorAll('div')].every(e=>e.scrollWidth <= e.clientWidth || getComputedStyle(e).textOverflow==='ellipsis' || e.classList.contains('truncate')), items:nav.map(b=>({text:b.textContent.trim(),height:b.getBoundingClientRect().height})), text:m.textContent};})()`);
          ctx.assert(state.contained && state.noHorizontalScroll, `Menu fits the conversation pane without horizontal scrolling: ${JSON.stringify(state)}`);
          ctx.assert(state.width <= 448 && state.items.length === 2 && state.items.every(b=>b.height <= 32), JSON.stringify(state));
          ctx.assert(/^(插件|Plugins)$/.test(state.items[0].text) && state.items[1].text==='MCP', 'Only Plugins and MCP navigation remains');
          ctx.assert(!/正在加载命令|Loading commands/.test(state.text), 'No command loading state in extensions');
        },
        screenshot: {name:`compact-${route}`, requireText:['插件','MCP','配置']},
      });
      await ctx.eval(`[...document.querySelectorAll('${extensions} button')].find(b=>/^(配置|Configure)$/.test(b.textContent.trim())).click()`);
      await ctx.waitFor(`location.hash.includes('/settings/extensions/${route}')`);
      ctx.assert(await ctx.eval(`location.hash.includes('/settings/extensions/${route}')`), `${name} configuration opens its own settings page`);
      await ctx.navigateHash(originalHash);
      await ctx.waitFor(`Boolean(document.querySelector('${editor}'))`);
    }
    await ctx.prove('Extensions stay visible above the add menu in a narrow conversation', {
      voiceover: '对话栏变窄时，扩展面板显示在上方，配置按钮和列表仍然完整可见。',
      action: async () => {
        await ctx.eval(`document.querySelector('${card}').style.width='360px'`);
        await open();
        await ctx.eval(`[...document.querySelectorAll('${menu} button')].find(b=>/^(扩展|Extensions)$/.test(b.textContent.trim())).click()`);
        await ctx.waitFor(`Boolean(document.querySelector('${extensions}'))`);
      },
      assert: async () => {
        await ctx.waitFor(`document.querySelector('${extensions}').getBoundingClientRect().bottom <= document.querySelector('${menu}').getBoundingClientRect().top`);
        ctx.assert(await ctx.eval(`(() => {const r=document.querySelector('${extensions}').getBoundingClientRect(),c=document.querySelector('${card}').getBoundingClientRect();return r.left >= c.left && r.right <= c.right && r.top >=0;})()`), 'Narrow submenu remains within the composer width and above the main menu');
      },
      screenshot: {name:'compact-extensions-narrow', requireText:['插件','MCP','配置']},
    });
    ctx.assert(await ctx.eval(`document.querySelector('${editor}').textContent === ${JSON.stringify(originalDraft)}`), 'Existing draft is preserved; no message sent');
  } finally {
    if (await ctx.eval('location.hash') !== originalHash) await ctx.navigateHash(originalHash);
    await ctx.waitFor(`Boolean(document.querySelector('${editor}'))`);
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
      if (process.env.IPOLLOWORK_EVAL_COMPOSER_MENU_ONLY === '1') return proveExtensionsMenu(ctx);
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
