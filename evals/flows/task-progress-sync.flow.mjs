const flow = {
  id: 'task-progress-sync',
  title: 'Real engine task progress matches the active client session',
  kind: 'user-facing',
  steps: [{ name: 'Inspect native task progress', run: async ctx => {
    await ctx.prove('The real task progress count matches the current session todo cache', {
      voiceover: 'The task reports its plan through the engine. The client shows the same completed steps and total above the composer.',
      action: async () => { await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))",{timeoutMs:60000,label:'native task plan'}); },
      assert: async () => {
        const state=await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1],q=getReactQueryClient().getQueryCache().getAll().find(q=>q.queryKey[0]==='react-session-todos'&&q.queryKey.includes(id)),todos=q?.state.data??[],button=[...document.querySelectorAll('button')].find(b=>/^(Progress|进度) ·/.test(b.innerText));return {session:id,completed:todos.filter(t=>t.status==='completed').length,total:todos.length,label:button?.innerText,height:button?.getBoundingClientRect().height}})()`,{awaitPromise:true});
        ctx.assert(state.total>0&&state.label.endsWith(`${state.completed}/${state.total}`)&&state.height===40,JSON.stringify(state));
        await ctx.output('Native task state',JSON.stringify(state));
      },
      screenshot: {name:'native-progress',requireText:['Progress ·'],rejectText:['Something went wrong']},
    });
  }}, ...(process.env.IPOLLOWORK_PROGRESS_STABILITY === '1' ? [{
    name:'Native progress remains visible beyond the cache collection interval',
    run:ctx=>ctx.prove('The active plan stays visible for 17 seconds and follows native updates without disappearing',{
      voiceover:'While the task runs, the progress remains in place even when the model does not update its plan for more than fifteen seconds.',
      action:async()=>{
        const result=await ctx.eval(`(async()=>{let samples=[];for(let i=0;i<35;i++){const b=[...document.querySelectorAll('button')].find(b=>/^(Progress|进度) ·/.test(b.innerText));samples.push({label:b?.innerText,top:b?.getBoundingClientRect().top,height:b?.getBoundingClientRect().height});if(i<34)await new Promise(r=>setTimeout(r,500));}window.__progressStability=samples;return samples})()`,{awaitPromise:true});
        await ctx.output('Observed samples',JSON.stringify(result));
      },
      assert:async()=>{const samples=await ctx.eval('window.__progressStability');ctx.assert(samples.length===35&&samples.every(s=>s.label&&s.height===40),'An active progress entry disappeared during the observation');ctx.assert(Math.max(...samples.map(s=>s.top))-Math.min(...samples.map(s=>s.top))<1,'The composer progress shifted during steady execution');},
      screenshot:{name:'native-progress-stable',requireText:['Progress ·'],rejectText:['Something went wrong']},
    }),
  },{
    name:'Completion hides progress and the next request does not inherit it',
    run:ctx=>ctx.prove('After the native task completes, a follow-up without a plan starts with an empty todo list',{
      voiceover:'The completed task releases its active progress entry. A new request does not inherit the previous plan.',
      action:async()=>{
        await ctx.waitFor("!document.querySelector('button[aria-label=\"Stop\"]') && ![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))",{timeoutMs:180000,label:'native task completion'});
        await ctx.control('composer.set_text',{text:'不要调用任何工具或待办，只回复 progress-followup-ok。'});
        await ctx.control('composer.send');
      },
      assert:async()=>{
        await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(e=>e.innerText.includes('progress-followup-ok'))",{timeoutMs:90000,label:'follow-up reply'});
        const todos=await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1];return getReactQueryClient().getQueryCache().getAll().find(q=>q.queryKey[0]==='react-session-todos'&&q.queryKey.includes(id))?.state.data})()`,{awaitPromise:true});
        ctx.assert(Array.isArray(todos)&&todos.length===0,'The follow-up inherited a previous plan');
      },
      screenshot:{name:'native-follow-up-empty-plan',requireText:['progress-followup-ok'],rejectText:['Progress · 2/2']},
    }),
  }] : [])],};


if (process.env.IPOLLOWORK_PROGRESS_FOLLOWUP === "1") {
  flow.steps = [{ name: "DeepSeek new-turn snapshot has no previous plan", run: ctx => ctx.prove(
    "The real DeepSeek follow-up completes without inheriting the previous three-step plan", {
      voiceover: "A new request without a plan keeps the old completed tasks out of the active progress area.",
      action: async () => { await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(e=>e.innerText.includes('dsh-followup-ok'))", {timeoutMs:90000,label:'DeepSeek native follow-up'}); },
      assert: async () => {
        const state=await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1],q=getReactQueryClient();const todos=q.getQueryCache().getAll().find(x=>x.queryKey[0]==='react-session-todos'&&x.queryKey.includes(id))?.state.data;return {todos,visible:[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))}})()`,{awaitPromise:true});
        ctx.assert(Array.isArray(state.todos)&&state.todos.length===0&&!state.visible,JSON.stringify(state));
      },
      screenshot:{name:'deepseek-follow-up-without-old-plan',requireText:['dsh-followup-ok'],rejectText:['Progress · 3/3']},
    }) }];
}
if (process.env.IPOLLOWORK_PROGRESS_RECOVERY === "1") {
  const otherRoute = process.env.IPOLLOWORK_PROGRESS_OTHER_ROUTE;
  if (!otherRoute) throw new Error("Set IPOLLOWORK_PROGRESS_OTHER_ROUTE to another isolated test session");
  flow.steps.splice(1, 0, { name: "Switching sessions and refreshing restores the native active plan", run: ctx => ctx.prove(
    "Switching away and back, then refreshing, restores this session's native plan without borrowing another session's progress", {
      voiceover: "I switch to another conversation and return. After refreshing, the current task restores its own plan and progress.",
      action: async () => {
        const route = await ctx.eval('location.hash.slice(1)');
        await ctx.navigateHash(otherRoute);
        await ctx.waitFor(`!location.hash.includes(${JSON.stringify(route.split('/session/')[1])})`);
        await ctx.navigateHash(route);
        await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))");
        await ctx.client.send('Page.reload',{});
        await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))",{timeoutMs:60000,label:'restored native plan'});
      },
      assert: async () => {
        const state=await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1],todos=getReactQueryClient().getQueryCache().getAll().find(q=>q.queryKey[0]==='react-session-todos'&&q.queryKey.includes(id))?.state.data??[],b=[...document.querySelectorAll('button')].find(b=>/^(Progress|进度) ·/.test(b.innerText));return {id,total:todos.length,completed:todos.filter(t=>t.status==='completed').length,label:b?.innerText}})()`,{awaitPromise:true});
        ctx.assert(state.total>0&&state.label.endsWith(`${state.completed}/${state.total}`),JSON.stringify(state));
      },
      screenshot:{name:'native-session-recovery',requireText:['Progress ·'],rejectText:['Something went wrong']},
    }) });
}
if (process.env.IPOLLOWORK_PROGRESS_BLOCKED === "1") {
  const route = process.env.IPOLLOWORK_PROGRESS_BLOCKED_ROUTE;
  if (!route) throw new Error("Set IPOLLOWORK_PROGRESS_BLOCKED_ROUTE to the isolated Codex session");
  flow.steps = [{ name: "Codex native-plan verification is blocked", run: ctx => ctx.prove(
    "The real Codex session reports a missing native plan tool; the client does not fabricate todo progress", {
      voiceover: "This Codex task ran file operations, but reported that its native plan tool was unavailable. Its todo lifecycle is not accepted as verified.",
      action: async () => { await ctx.navigateHash(route); await ctx.waitFor("document.body.innerText.includes('当前工具列表未提供原生计划工具')",{timeoutMs:60000,label:'native Codex limitation'}); },
      assert: async () => {ctx.assert(await ctx.eval("![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'The client must not invent a plan for this task');},
      screenshot:{name:'codex-native-plan-blocked',requireText:['当前工具列表未提供原生计划工具']},
    }) }];
}
if (process.env.IPOLLOWORK_PROGRESS_CODEX_ISOLATION) {
  const ready = process.env.IPOLLOWORK_PROGRESS_CODEX_ISOLATION === 'ready';
  flow.steps = [{ name: 'Codex client runtime isolation', run: ctx => ctx.prove(
    ready ? 'The settings page and launch selection use the client-managed Codex 0.149.0' : 'Missing client Codex is reported clearly without using the installed personal desktop CLI', {
      voiceover: ready ? 'Codex is managed by iPolloWork at version 0.149.0. Personal desktop updates no longer change this runtime.' : 'The personal Codex desktop is installed, but the client asks to install its own pinned runtime instead of borrowing it.',
      action: async () => { await ctx.navigateHash('/settings/engines'); await ctx.waitFor("document.querySelector('[data-engine-id=\"codex-harness\"]')?.innerText.includes('Codex Harness')"); },
      assert: async () => {
        const state = await ctx.eval(`(async()=>{const e=(await window.__IPOLLOWORK_ELECTRON__.invokeDesktop('enginePackagesList')).find(e=>e.id==='codex-harness');return {engine:e,text:document.querySelector('[data-engine-id="codex-harness"]').innerText}})()`, {awaitPromise:true});
        ctx.assert(state.engine.version === '0.149.0' && state.engine.installed === ready, JSON.stringify(state));
        ctx.assert(state.engine.source === (ready ? 'downloaded' : 'none'), 'Unexpected runtime source');
        ctx.assert(ready ? state.text.includes('0.149.0') : state.text.includes('不会使用本机个人 Codex'), 'Missing visible version or recovery explanation');
        await ctx.output('Observed runtime selection', JSON.stringify(state));
      },
      screenshot: {name: ready ? 'codex-managed-runtime' : 'codex-missing-runtime',requireText:['Codex Harness','0.149.0']},
    }) }];
}
if (process.env.IPOLLOWORK_PROGRESS_CODEX_FINISHED === '1') {
  flow.steps = [{name:'Completed native Codex plan',run:ctx=>ctx.prove('The real three-stage Codex task completes and releases its active progress entry',{
    voiceover:'The native plan reached three completed steps. The final reply and generated files remain visible, and active progress is hidden.',
    action:async()=>{await ctx.waitFor("document.body.innerText.includes('验收完成') && !document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:60000});},
    assert:async()=>{ctx.assert(await ctx.eval("![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'Completed progress must be hidden');},
    screenshot:{name:'codex-three-stage-completed',requireText:['isolation-summary.md','验收完成']},
  })}];
}
if (process.env.IPOLLOWORK_PROGRESS_CODEX_STOP === '1') {
  const recovery = flow.steps.find(s=>s.name === 'Switching sessions and refreshing restores the native active plan');
  flow.steps = [{name:'Codex plan before Stop',run:ctx=>ctx.prove('A new Codex task creates its own native plan before cancellation',{
    voiceover:'I start a separate task with a native plan. The progress belongs to this new turn.',
    action:async()=>{await ctx.control('composer.set_text',{text:'这是 Stop 验收。先用 update_plan 建立恰好2步：等待、汇总。将等待设为进行中，然后执行 python3 -c "import time; time.sleep(90)"。不要写文件，不创建子代理，不联网，等待结束后再完成计划。'});await ctx.control('composer.send');await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>b.innerText==='Progress · 0/2'||b.innerText==='进度 · 0/2')",{timeoutMs:90000,label:'new native two-step plan'});},
    assert:async()=>{ctx.assert(await ctx.eval("Boolean(document.querySelector('button[aria-label=\"Stop\"]'))"),'Task must still be active');},
    screenshot:{name:'codex-before-stop',requireText:['Progress · 0/2']},
  })},{name:'Stop releases active progress',run:ctx=>ctx.prove('Stopping the real Codex task hides the active entry and keeps the interruption visible',{
    voiceover:'I press Stop. The task stops, its active progress is released, and the conversation keeps its interruption outcome.',
    action:async()=>{await ctx.eval("document.querySelector('button[aria-label=\"Stop\"]').click()");await ctx.waitFor("!document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:30000});},
    assert:async()=>{ctx.assert(await ctx.eval("![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'Stopped progress must be hidden');},
    screenshot:{name:'codex-stopped',rejectText:['Progress · 0/2']},
  })}];
  if (recovery) flow.steps.splice(1,0,recovery);
}
if (process.env.IPOLLOWORK_PROGRESS_CODEX_RESEND === '1') {
  flow.steps=[{name:'Failed native turn',run:ctx=>ctx.prove('A real unsupported-model failure leaves no active task progress',{
    voiceover:'The service rejected the test model. The task ends with an error, and there is no stale active plan.',
    action:async()=>{await ctx.waitFor("document.body.innerText.includes('This model is unavailable')",{timeoutMs:60000});},
    assert:async()=>{ctx.assert(await ctx.eval("!document.querySelector('button[aria-label=\"Stop\"]') && ![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'Failed turn must release progress');},
    screenshot:{name:'codex-real-model-failure',requireText:['This model is unavailable','Choose another model and try again.']},
  })},{name:'Resend after failure',run:ctx=>ctx.prove('Resending with the configured model succeeds without inheriting a previous plan',{
    voiceover:'I send a new request using the configured model. It replies successfully, with an empty plan for this turn.',
    action:async()=>{await ctx.control('composer.set_text',{text:'不要调用工具或待办，只回复 resend-isolation-ok。'});await ctx.control('composer.send');await ctx.waitFor("document.body.innerText.includes('resend-isolation-ok') && !document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:90000});},
    assert:async()=>{const state=await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1];return getReactQueryClient().getQueryCache().getAll().find(q=>q.queryKey[0]==='react-session-todos'&&q.queryKey.includes(id))?.state.data})()`,{awaitPromise:true});ctx.assert(Array.isArray(state)&&state.length===0,'Retry must not retain the previous plan');},
    screenshot:{name:'codex-resend-succeeded',requireText:['resend-isolation-ok']},
  })}];
}
if (process.env.IPOLLOWORK_PROGRESS_CODEX_APPROVAL === '1') {
  flow.steps=[{name:'Native permission request',run:ctx=>ctx.prove('Codex presents the pending shell approval through one active status entry',{
    voiceover:'The read-only task requests approval before writing the isolated test file. The conversation shows one waiting status and the Allow once action.',
    action:async()=>{await ctx.waitFor("document.body.innerText.includes('Approve shell?')",{timeoutMs:30000});},
    assert:async()=>{ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].filter(b=>b.innerText.startsWith('Waiting for your approval')).length===1"),'Expected one pending approval entry');},
    screenshot:{name:'codex-native-approval',requireText:['Approve shell?','Allow once']},
  })},{name:'Allow once completes native task',run:ctx=>ctx.prove('Allow once executes only the requested test write and the task completes',{
    voiceover:'I allow the reviewed write once. Codex writes the test marker and finishes the task.',
    action:async()=>{await ctx.eval("[...document.querySelectorAll('button')].find(b=>b.innerText==='Allow once').click()");await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(e=>e.innerText.includes('permission-isolation-ok')) && !document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:60000});},
    assert:async()=>{const {readFile}=await import('node:fs/promises');ctx.assert(await readFile('/tmp/ipollowork-codex-isolation-permission.txt','utf8')==='permission-ok','The approved command must write the exact test marker');},
    screenshot:{name:'codex-native-approved',requireText:['permission-isolation-ok']},
  })}];
}
if (process.env.IPOLLOWORK_RUNTIME_OWNERSHIP === "1") {
  flow.steps.splice(1, 0, { name: "Concurrent desktop requests reuse the active service", run: ctx => ctx.prove(
    "Boot/start/activation requests share one healthy server without interrupting the real Codex task", {
      voiceover: "While the task runs, I request the desktop runtime through multiple entry points. They reuse the same service and the plan stays visible.",
      action: async () => {
        const state = await ctx.eval(`(async()=>{const invoke=window.__IPOLLOWORK_ELECTRON__.invokeDesktop;const before=await invoke('runtimeStatus');const root=before.engine.projectDir;await Promise.all([invoke('engineStart',root),invoke('orchestratorWorkspaceActivate',{workspacePath:root}),invoke('engineStart',root),invoke('orchestratorWorkspaceActivate',{workspacePath:root})]);const after=await invoke('runtimeStatus');return {before:before.ipolloworkServer.baseUrl,after:after.ipolloworkServer.baseUrl,lifecycle:after.lifecycleState}})()`, { awaitPromise: true });
        await ctx.output("Runtime ownership", JSON.stringify(state));
        ctx.assert(state.before===state.after&&state.lifecycle==='healthy',JSON.stringify(state));
      },
      assert: async () => { ctx.assert(await ctx.eval("Boolean(document.querySelector('button[aria-label=\"Stop\"]'))"), "The native task remains active"); },
      screenshot: {name:'runtime-reused-during-task',requireText:['Progress ·']},
    }) });
}
if (process.env.IPOLLOWORK_RUNTIME_DISCONNECT === "1") {
  flow.steps.push({ name: "Renderer disconnect and reconnect", run: ctx => ctx.prove(
    "A temporary renderer disconnection retains the current plan and reconnects to the same running service", {
      voiceover: "I disconnect only the renderer network, then reconnect. The backend continues the task and the progress returns without restarting the service.",
      action: async () => {
        await ctx.client.send('Network.enable');
        try {
          await ctx.client.send('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
          await new Promise(resolve => setTimeout(resolve, 8_000));
          ctx.assert(await ctx.eval("[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"), "The current plan remains during disconnection");
        } finally {
          await ctx.client.send('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
        }
        await ctx.waitFor("[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))");
      },
      assert: async () => { ctx.assert(await ctx.eval("Boolean(document.querySelector('button[aria-label=\"Stop\"]'))"), "The same task remains active after reconnect"); },
      screenshot: {name:'runtime-disconnect-recovered',requireText:['Progress ·']},
    }) });
}
if (process.env.IPOLLOWORK_RUNTIME_CRASH_FILE) {
  const { readFile } = await import('node:fs/promises');
  const proof = JSON.parse(await readFile(process.env.IPOLLOWORK_RUNTIME_CRASH_FILE, 'utf8'));
  flow.steps = [{ name: "Recover after forced desktop exit", run: ctx => ctx.prove(
    "After a forced desktop exit, history and its current plan remain available without an endless active entry", {
      voiceover: "I reopen the isolated client after a forced exit. The interrupted task and plan are preserved, and it does not keep spinning.",
      action: async () => {
        await ctx.navigateHash('/workspace/'+proof.workspace+'/session/'+proof.session);
        await ctx.waitFor("document.body.innerText.includes('sleep 45') && !document.querySelector('button[aria-label=\"Stop\"]')", {timeoutMs:60000});
        await ctx.waitFor("globalThis.__owReactQueryClient?.getQueryData(['react-session-todos',"+JSON.stringify(proof.workspace)+","+JSON.stringify(proof.session)+"])?.length === "+proof.before.todos.length, {timeoutMs:60000,label:'cold snapshot plan restoration'});
      },
      assert: async () => {
        const state = await ctx.eval(`(async()=>{const {getReactQueryClient}=await import('/src/react-app/infra/query-client.ts');const id=location.hash.split('/session/')[1];const todos=getReactQueryClient().getQueryData(['react-session-todos',${JSON.stringify(proof.workspace)},id]);return {todos,active:[...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))}})()`,{awaitPromise:true});
        ctx.assert(Array.isArray(state.todos)&&state.todos.length===proof.before.todos.length&&!state.active,JSON.stringify(state));
        ctx.assert(state.todos.every(t=>t.id.startsWith(proof.session+':')), 'Restored todos belong to this native session');
        await ctx.output('Recovered plan',JSON.stringify(state));
      },
      screenshot: {name:'runtime-crash-history-recovered',requireText:['sleep 45']},
    }) }, { name: "Resend after recovered desktop", run: ctx => ctx.prove(
    "The recovered native session accepts a new request with no active-writer conflict or inherited plan", {
      voiceover: "I send another request in the recovered session. It completes normally and starts without an inherited plan.",
      action: async () => {
        await ctx.control('composer.set_text',{text:'不要调用任何工具或待办，只回复 runtime-restart-ok。'});
        await ctx.control('composer.send');
        await ctx.waitFor("[...document.querySelectorAll('[data-message-role=assistant]')].some(e=>e.innerText.includes('runtime-restart-ok')) && !document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:90000});
      },
      assert: async () => {ctx.assert(await ctx.eval("!document.body.innerText.includes('already has an active writer') && ![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'The task completes without a writer conflict');},
      screenshot: {name:'runtime-crash-resend-completed',requireText:['runtime-restart-ok']},
    }) }];
}
if (process.env.IPOLLOWORK_RUNTIME_PARALLEL_FILE) {
  const { readFile } = await import('node:fs/promises');
  const proof = JSON.parse(await readFile(process.env.IPOLLOWORK_RUNTIME_PARALLEL_FILE,'utf8'));
  if (!proof.simultaneousBusy || !proof.final?.every(row=>row.final&&row.status.type==='idle')) throw new Error('Native concurrency verification did not complete');
  flow.steps = proof.jobs.map(job=>({name:'Concurrent native session '+job.index,run:ctx=>ctx.prove(
    'Concurrent task '+job.index+' retains its own result and releases active progress',{
      voiceover:'I inspect this completed concurrent task. Its result and plan belong to its own session and workspace.',
      action:async()=>{await ctx.navigateHash('/workspace/'+job.workspace+'/session/'+job.session);await ctx.waitFor("document.body.innerText.includes("+JSON.stringify('parallel-'+job.index+'-ok')+") && !document.querySelector('button[aria-label=\"Stop\"]')",{timeoutMs:60000});},
      assert:async()=>{ctx.assert(await ctx.eval("![...document.querySelectorAll('button')].some(b=>/^(Progress|进度) ·/.test(b.innerText))"),'Completed concurrent task releases progress');await ctx.output('Native overlap evidence',JSON.stringify({session:job.session,workspace:job.workspace,simultaneousBusy:proof.simultaneousBusy}));},
      screenshot:{name:'runtime-parallel-'+job.index,requireText:['parallel-'+job.index+'-ok']},
    })}));
}
export default flow;
