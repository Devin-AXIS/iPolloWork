export const inject = ['webServer', 'workspaceRegistry', 'tools', 'agents', 'sessionController'];
export async function apply(ctx) {
  let linked = false;
  const calls = [];
  ctx.provide('ipolloStage', {
    request: async action => {
      calls.push(action);
      if (action === 'status') return { configured: true, connected: linked, connectionId: linked ? 'qa:stage' : null, stageName: linked ? 'Existing QA account' : null };
      if (action === 'connect') return { url: 'https://stage.example.test/approve' };
      if (action === 'launch') return { url: 'https://stage.example.test/one-use' };
      if (action === 'disconnect') { linked = false; return { connected: false }; }
      return { taskId: 'qa-task' };
    },
    download: async () => new Response('fixture', { headers: { 'Content-Type': 'video/mp4' } }),
  });
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/stage-fixture', handler: async (req, res) => {
    if(req.method==='POST'&&req.url?.endsWith('/run')){
      const workspace=ctx.workspaceRegistry.list()[0];
      const created=await ctx.sessionController.create({workspaceId:workspace.id,agentPreset:'standard'});
      const agent=ctx.agents.get(created.sessionId);
      const result=await ctx.tools.execute({agent,signal:new AbortController().signal,calls:[{type:'tool-call',id:'qa-stage-call',name:'ipollo_stage',arguments:JSON.stringify({action:'catalog',input:{}})}]});
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
    }
    if (req.method === 'POST') linked = true;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ calls, linked }));
  } }));
  await ctx.workspaceRegistry.create(process.cwd(), 'Stage QA workspace');
}
