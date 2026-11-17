/** Thin native adapter. Stage keeps its own server, renderer, projects and generation loop. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-workspace';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { sourceFile, saveMovie } from './files.ts';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StageBridge } from '@ipollo/dsh-suite/stage';

declare module '@deepseek-ai/cordis' { interface Context { ipolloStage: StageBridge } }
export const name = 'ipollo-stage';
export const inject = ['webServer', 'connection', 'connection.authentication', 'workspaceRegistry', 'tools', 'sandboxPolicy', 'ipolloStage'];
const root = '/ipollo-stage';
const manual = new Set(['status', 'connect', 'disconnect', 'launch']);
const actions = new Set(['catalog', 'document', 'generate', 'export', 'task', 'source', 'download']);
type Host = Context & { connection: { admit(req: IncomingMessage): { rejection: number } | { peer: { principal: { kind: string } } } } };
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 8 * 1024 * 1024) throw new Error('Request is too large'); chunks.push(buffer); }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid input');
  return result as Record<string, unknown>;
}
export function stageRequestId(session: string, call: string): string {
  const hex = createHash('sha256').update(session).update('\0').update(call).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function apply(ctx: Host): void {
  const enabled = new Map<string, string>();
  const lifetime = new AbortController();
  const connection = async () => {
    const status = await ctx.ipolloStage.request('status', undefined, lifetime.signal) as { connected?: boolean; connectionId?: string };
    if (!status.connected || !status.connectionId) throw new Error('请先在 Stage 插件中关联账号 / Link Stage in the plugin first');
    return status.connectionId;
  };
  ctx.effect(() => () => { lifetime.abort(); enabled.clear(); });
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: root, handler: async (req, res) => {
    try {
    const admission = ctx.connection.admit(req);
    if ('rejection' in admission) return json(res, admission.rejection, { error: 'unauthorized' });
    if (admission.peer.principal.kind !== 'owner') return json(res, 403, { error: 'forbidden' });
      const action = new URL(req.url ?? '/', 'http://localhost').pathname.slice(root.length + 1);
      if(action.startsWith('download/')&&req.method==='GET'){
        const response=await ctx.ipolloStage.download(action.slice(9),lifetime.signal);
        res.writeHead(200,{'Content-Type':'video/mp4','Content-Disposition':response.headers.get('Content-Disposition')||'attachment; filename="Stage.mp4"','Cache-Control':'private,no-store'});
        if(response.body)await pipeline(Readable.fromWeb(response.body as never),res);
        else res.end();return;
      }
      if (action === 'workspaces' && req.method === 'GET') return json(res, 200, { workspaces: ctx.workspaceRegistry.list().map(({id,title}) => ({id,title,enabled:enabled.has(id)})) });
      if (action === 'enable' && req.method === 'POST') {
        const input = await body(req), id = String(input.workspaceId ?? '');
        if (!ctx.workspaceRegistry.list().some(item => item.id === id)) return json(res,404,{error:'workspace_not_found'});
        if (input.enabled === false) enabled.delete(id); else enabled.set(id, await connection());
        return json(res,200,{enabled:enabled.has(id)});
      }
      if (!manual.has(action) || req.method !== (action === 'status' ? 'GET' : 'POST')) return json(res,404,{error:'not_found'});
      if (action === 'disconnect'||action==='connect') enabled.clear();
      const result = await ctx.ipolloStage.request(action as 'status', action === 'status' ? undefined : await body(req), lifetime.signal);
      if(action==='status'){const status=result as {connectionId?:string};for(const [id,identity] of enabled)if(identity!==status.connectionId)enabled.delete(id);}
      json(res,200,result);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'IPW_STAGE_UNAVAILABLE';
      if(res.headersSent){res.destroy();return;}
      const reason=error&&typeof error==='object'&&'reason'in error?String(error.reason).slice(0,500):undefined;
      json(res,502,{error:code,...(reason?{message:reason}:{})});
    }
  } }));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'ipollo_stage',
    description: 'Use the connected Stage service to inspect scene schemas, generate or edit SceneDocs, poll generation/export tasks and export films. The user must enable Stage for this workspace in the plugin first. Generation uses official models and actual token billing. catalog reads contracts; document reads/writes SceneDoc (expectedRevision required for updates); generate accepts message/projectId/tier/options for live scenes; confirm deep film plans in the Stage editor. task polls taskId/kind; source uploads a workspace path (max 5 MB); download saves a completed export taskId to stage-exports without replacing existing files. Query accepted tasks after uncertain requests.',
    parameters: { action: { type:'string', enum:['catalog','document','generate','export','task','source','download'], required:true }, input: { type:'object', additionalProperties:true } },
    output: { schema:{type:'json'}, render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}] },
    async execute(args, exec) {
      if (!actions.has(args.action)) throw new Error('Invalid Stage action');
      const session = exec.agent?.session;
      const workspace = session && ctx.workspaceRegistry.list().find(item => item.path === session.header.cwd && item.sessionIds.includes(session.id));
      if (!workspace || !enabled.has(workspace.id)) throw new Error('请在 Stage 插件中启用当前工作区 / Enable this workspace in Stage first');
      const current = await connection();
      if (enabled.get(workspace.id) !== current) { enabled.delete(workspace.id); throw new Error('Stage account changed; enable this workspace again'); }
      if (['generate','export','source','download'].includes(args.action) || args.action === 'document' && args.input?.doc !== undefined) {
        if (ctx.sandboxPolicy.resolve({session}).mode === 'read-only') throw new Error('Read-only session');
      }
      let input=args.input;
      if(args.action==='source'){
        if(typeof input?.path!=='string')throw new Error('Provide a workspace file path');
        input=await sourceFile(workspace.path,input.path);
      }
      if(args.action==='download'){
        const id=String(args.input?.taskId??'');if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Provide the completed export taskId');
        const response=await ctx.ipolloStage.download(id,exec.signal);
        return {path:await saveMovie(workspace.path,id,response,exec.signal),mimeType:'video/mp4'};
      }
      const requestId=typeof args.input?.requestId==='string'?args.input.requestId:stageRequestId(session.id,exec.callId);
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))throw new Error('Provide a UUID requestId for retries');
      let result:unknown;
      try{result=await ctx.ipolloStage.request(args.action as 'catalog', { ...input, requestId }, exec.signal);}
      catch(error){if(['generate','export'].includes(args.action))throw new Error((error instanceof Error?error.message:'Stage request failed')+'\nStage requestId: '+requestId+'. For generation, poll this taskId first. For export, retry the identical request with this requestId.',{cause:error});throw error;}
      if(args.action==='task'&&args.input?.kind==='export'){const row=result as {task?:{id?:string;status?:string}};if(row.task?.status==='complete'&&row.task.id)return JSON.parse(JSON.stringify({...row,download:root+'/download/'+row.task.id}));}
      return JSON.parse(JSON.stringify(result));
    },
    presentCall: args => ({card:'generic',title:'Stage · '+args.action,kind:['catalog','task'].includes(args.action)?'read':'execute'}),
  })));
}
