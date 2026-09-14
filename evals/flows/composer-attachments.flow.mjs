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

export default {
  id: 'composer-attachments',
  title: 'Chat attachments and capability chips preserve the input and footer',
  kind: 'user-facing',
  steps: [{
    name: 'Empty, attached, tagged and long drafts at responsive widths',
    run: async ctx => {
      await ctx.waitFor(`Boolean(document.querySelector('${editor}'))`);
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
