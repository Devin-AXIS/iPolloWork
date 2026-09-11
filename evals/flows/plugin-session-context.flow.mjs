export default {
  id: 'plugin-session-context', title: '普通对话传递小红书发布上下文', kind: 'user-facing', preserveTheme: true,
  requiredEnv: ['XHS_EVAL_SESSION_HASH'],
  steps: [{ name: '当前对话能直接进入插件发布准备', async run(ctx) {
    await ctx.client.send('Page.bringToFront');
    await ctx.navigateHash(process.env.XHS_EVAL_SESSION_HASH);
    await ctx.waitFor('Boolean(window.__ipolloworkControl)');
    await ctx.waitFor(`Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`);
    const sessionId = await ctx.eval("location.hash.split('/session/')[1]");
    const resumeMarker = process.env.XHS_EVAL_DIAGNOSTIC_MARKER;
    const marker = resumeMarker || '发布链路诊断-' + Date.now();
    const prompt = `${marker}：这是修复后的诊断，不要发布或改动任何现有草稿。请依次调用原生 ipollowork_extension_call：第一步 extensionId=storage，action=status，args={}，查看返回的 context.sessionId；第二步 extensionId=xiaohongshu-ops，action=prepare-draft-publish，args={"accountId":1,"draftId":"00000000-0000-4000-8000-000000000000"}。第二步使用不存在的测试草稿，预期返回“找不到当前账号的草稿”。不要创建草稿、领取任务、打开浏览器、发布或评论。最后报告真实会话 ID 和第二步原始错误；只有会话 ID 存在且第二步为上述草稿校验错误，才说明当前对话已接通发布准备，无需创建日程。`;
    let evidence;
    await ctx.prove('普通对话携带自己的会话 ID，发布准备进入草稿校验', {
      voiceover: '在当前对话验证发布链路，插件能识别本次会话并进入草稿校验，无需创建日程。这里使用不存在的测试草稿，不会实际发布。',
      action: async () => {
        // Reopen saved results after a capture failure without paying for another AI turn.
        if (!resumeMarker) {
          await ctx.waitFor(`Boolean(document.querySelector('button[title="运行任务"]'))`);
          await ctx.eval(`(() => {
            const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            if (!editor || editor.innerText.trim()) throw new Error('Composer is unavailable or contains an unsent message');
            editor.focus();
            const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(prompt)});
            editor.dispatchEvent(new ClipboardEvent('paste', {bubbles:true,cancelable:true,clipboardData:data}));
          })()`);
          await ctx.waitFor(`Boolean(document.querySelector('button[title="运行任务"]:not(:disabled)'))`);
          await ctx.eval(`document.querySelector('button[title="运行任务"]').click()`);
        }
        const readEvidence = `(async () => {
          const info = await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('ipolloworkServerInfo');
          const workspaceId = location.hash.split('/')[2];
          const response = await fetch(info.baseUrl+'/workspace/'+workspaceId+'/sessions/'+${JSON.stringify(sessionId)}+'/messages?limit=40', {headers:{Authorization:'Bearer '+info.clientToken}});
          if (!response.ok) throw new Error('Could not read the saved diagnostic turn');
          const {items} = await response.json();
          const start = items.findIndex(item=>item.parts.some(part=>part.type==='text' && part.text.includes(${JSON.stringify(marker)})));
          if (start<0) return null;
          const parts=items.slice(start+1).flatMap(item=>item.parts);
          const calls=parts.filter(part=>part.type==='tool' && part.tool.includes('extension_call'));
          const context=calls.find(call=>call.state.input?.extensionId==='storage' && call.state.input?.action==='status');
          const preparation=calls.find(call=>call.state.input?.action==='prepare-draft-publish');
          if (!context?.state.output || !preparation || !['completed','error'].includes(preparation.state.status)) return null;
          return {context:context.state.output,preparation:preparation.state.error??preparation.state.output,calls:calls.map(call=>call.state.input)};
        })()`;
        for (let attempt=0;attempt<60;attempt++) {
          evidence = await ctx.eval(readEvidence,{awaitPromise:true});
          if (evidence) break;
          await new Promise(resolve=>setTimeout(resolve,3000));
        }
        ctx.assert(evidence, 'Native MCP results were not saved within three minutes');
        await ctx.waitFor(`Boolean(document.querySelector('button[title="运行任务"]'))`, {timeoutMs:60000});
      },
      assert: async () => {
        const output = typeof evidence.context === 'string' ? JSON.parse(evidence.context) : evidence.context;
        const result = output.structuredContent ?? output.structured_content ?? JSON.parse(output.content.find(item=>item.type==='text').text);
        ctx.assert(result.context.sessionId === sessionId, 'The MCP call did not carry its own current session');
        const error = JSON.stringify(evidence.preparation);
        ctx.assert(error.includes('找不到当前账号的草稿'), 'Preparation did not reach draft validation: '+error);
        ctx.assert(!error.includes('请从项目会话或日程'), 'The old context guard still rejects this conversation');
        ctx.assert(evidence.calls.every(call=>['status','prepare-draft-publish'].includes(call.action)), 'Unexpected action during diagnosis');
        await ctx.output('native-session-result', JSON.stringify({sessionId:result.context.sessionId,preparationError:evidence.preparation},null,2));
        await ctx.eval(`(() => { const pane=document.querySelector('[data-testid="session-message-scroll"]'); if(pane) pane.scrollTop=pane.scrollHeight; })()`);
      },
      screenshot: {name:'manual-session-connected',fromSurface:false,requireText:['找不到当前账号的草稿','无需创建日程']},
    });
  }}],
};
