/** One native Cordis plugin owns the suite's HTTP routes and domain services. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { ZodError } from 'zod'
import packageInfo from '../../package.json' with { type: 'json' }
import type { CredentialStore } from '../shared/types.ts'
import { mountServiceModels } from './service-models.ts'
import type {Context} from '@deepseek-ai/cordis'
import { Services } from './services.ts'
import type { ServiceCenter,ServiceChoice } from '../shared/services.ts'
import { AccountService } from './account.ts'
import { sharingStatus, nativeShareAudience, prepareNativeShare, createNativeShare, authorizeNativeShare, stopNativeShare, type NativeSharing } from './native-sharing.ts'
import { mountProjectContext, type MemoryContext } from './project-context.ts'
import { EnterpriseService, type EnterpriseNative } from './enterprise.ts'
import { mountEnterpriseSkills, type EnterpriseSkillScope } from './enterprise-skills.ts'
import { Config, resolveConfig, type Config as ConfigInput } from './config.ts'
import { readMarket, type NativePluginManager } from './market.ts'
import { SuiteError } from './errors.ts'
import { blocksSuiteManagement, MANAGEMENT_DENIAL, type ToolCall, type Decision } from './management.ts'
export { Config }
export const name = 'ipollowork-suite'
export const inject = ['webServer', 'connection', 'credentials', 'pluginManager', 'profileContext', 'workspaceRegistry', 'sessionQuery', 'systemPrompt', 'tools']
const API = '/ipollowork-suite'
export interface HostContext extends EnterpriseNative, MemoryContext {
  inject?(names:['skills'],callback:(scope:EnterpriseSkillScope)=>void):unknown;
  inject?(names:string[],callback:(scope:Context)=>void):unknown;
  provide?(name: 'ipolloServices',value:ServiceCenter):void;
  get?(name: 'liveshareShares'):NativeSharing|undefined;
  on(event: 'agent/pre-step', listener: (event: {agent: object & {session:{header:{cwd?:string}}}}, next:()=>Promise<unknown>)=>Promise<unknown>):unknown;
  effect(effect: () => void | (() => void), label?: string): unknown;
  on(event: 'tools/pre-execute', listener: (call: ToolCall, next: () => Promise<Decision>) => Promise<Decision>): () => void;
  fiber: { entry?: { id: string } };
  webServer: { getOrigin?():string; register(route: { kind: 'prefix'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void };
  connection: { requestRejection(request: { headers: IncomingMessage['headers'] }): number | undefined };
  credentials: CredentialStore;
  pluginManager: NativePluginManager;
  profileContext: { installAnchor: string; home: string };
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage, limit=16384): Promise<unknown> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > limit) throw new SuiteError('IPW_REQUEST_TOO_LARGE', 413)
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (cause) { throw new SuiteError('IPW_INVALID_INPUT', 400, { cause }) }
}
/** Read a multipart upload of at most 25 MiB, the account service's file limit plus form overhead. */
async function readForm(request: IncomingMessage): Promise<FormData> {
  const chunks: Buffer[]=[];let size=0
  for await (const chunk of request) { const value=Buffer.from(chunk);size+=value.length;if(size>25*1024*1024)throw new SuiteError('IPW_FILE_TOO_LARGE',413);chunks.push(value) }
  return new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers['content-type']??''}}).formData()
}
/** Relay a private file: a signed HTTPS URL becomes a redirect, and a body of at most 24 MiB is streamed through with its file name. */
async function relayDownload(result: Response, response: ServerResponse): Promise<void> {
  if(result.headers.get('content-type')?.includes('application/json')){
    const value=await result.json() as {url?:string}
    if(!value.url||new URL(value.url).protocol!=='https:')throw new SuiteError('IPW_INVALID_RESPONSE',502)
    response.writeHead(303,{Location:value.url});response.end();return
  }
  const chunks:Uint8Array[]=[];let size=0;const reader=result.body?.getReader()
  if(!reader)throw new SuiteError('IPW_FILE_TRANSFER_FAILED',502)
  try { while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>24*1024*1024){await reader.cancel();throw new SuiteError('IPW_FILE_TOO_LARGE',413)}chunks.push(value.value)} }finally{reader.releaseLock()}
  const disposition=result.headers.get('content-disposition')
  response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':disposition?.startsWith('attachment')?disposition:'attachment','Cache-Control':'private, no-store'});response.end(Buffer.concat(chunks))
}
/** Mount the suite without changing DSH's model, session, or plugin-management implementation. */
export function apply(ctx: HostContext, input: ConfigInput): void {
  const config = resolveConfig(input)
  ctx.on('tools/pre-execute', async (call, next) => blocksSuiteManagement(call, ctx.fiber.entry?.id) ? MANAGEMENT_DENIAL : next())
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'ipollowork-suite: requests')
  const account = new AccountService(ctx.credentials, config, lifetime.signal)
  let refreshModels=async()=>{}
  let refreshSkills=async()=>{}
  // Account changes and enterprise grant edits change both the official model list and the granted enterprise skills.
  const refreshAccount=async()=>{await Promise.all([refreshModels(),refreshSkills()])}
  const services = new Services(account,ctx.credentials,lifetime.signal,config.account)
  ctx.provide?.('ipolloServices',services)
  ctx.inject?.(['llm'],scope=>{if(!ctx.webServer.getOrigin){services.modelStatus='unsupported';return}refreshModels=mountServiceModels(scope,{register:route=>ctx.webServer.register(route),getOrigin:()=>ctx.webServer.getOrigin!()},services,account);void refreshModels().catch(error=>{services.modelStatus='error';services.modelError=error instanceof Error?error.message:'Model registration failed'});scope.effect(()=>()=>{refreshModels=async()=>{}})})
  ctx.inject?.(['skills'],scope=>{refreshSkills=mountEnterpriseSkills(scope,account);void refreshSkills().catch(()=>{})})
  const enterprise = new EnterpriseService(account, ctx, config.accountOrigin)
  mountProjectContext(ctx, account, config.accountOrigin)
  const runtime = JSON.parse(readFileSync(ctx.profileContext.installAnchor, 'utf8')) as { version?: unknown }
  if (typeof runtime.version !== 'string' || !semver.valid(runtime.version)) throw new SuiteError('IPW_INVALID_RUNTIME_VERSION', 500)
  const runtimeVersion = runtime.version
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API, handler: async (request, response) => {
    try {
      const rejection = ctx.connection.requestRejection({ headers: request.headers })
      if (rejection !== undefined) { json(response, rejection, { error: 'IPW_UNAUTHORIZED' }); return }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const path = url.pathname.slice(API.length)
      if (request.method === 'GET' && path === '/assets/client.css') {
        const css = await readFile(new URL('../client.css', import.meta.url))
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); response.end(css); return
      }
      if (request.method === 'GET' && path === '/assets/mark.svg') {
        const mark = await readFile(new URL('../../assets/mark.svg', import.meta.url))
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); response.end(mark); return
      }
      if (request.method === 'GET' && path === '/info') { json(response, 200, { name: 'iPolloWork', version: packageInfo.version, accountOrigin: config.accountOrigin, theme: config.theme, market: config.market, account: config.account }); return }
      if (request.method === 'GET' && path === '/catalog' && config.market) { json(response, 200, await readMarket(config.catalogPath, ctx.pluginManager, runtimeVersion, url.searchParams.get('language') === 'zh' ? 'zh' : 'en', config.maxResponseBytes, join(ctx.profileContext.home, 'cache', 'ipollowork-market'))); return }
      if(request.method==='GET'&&path==='/services'){await refreshModels().catch(error=>{services.modelStatus='error';services.modelError=error instanceof Error?error.message:'Model registration failed'});json(response,200,await services.state());return}
      if(request.method==='POST'&&path==='/services/choice'){const value=await body(request) as {provider:string;choice:ServiceChoice};await services.choose(value.provider,value.choice);await refreshModels();json(response,200,{ok:true});return}
      if (request.method === 'GET' && path === '/account' && config.account) { const state=await account.state();await refreshAccount().catch(()=>{});json(response, 200, state); return }
      if (request.method === 'POST' && path === '/account/sign-in' && config.account) { const state=await account.signIn(await body(request));await refreshAccount().catch(()=>{});json(response, 200, state); return }
      if (request.method === 'POST' && path === '/account/sign-up' && config.account) { const state=await account.signUp(await body(request));await refreshAccount().catch(()=>{});json(response, 200, state); return }
      if (request.method === 'POST' && path === '/account/sign-out' && config.account) { const state=await account.signOut();await refreshAccount().catch(()=>{});json(response, 200, state); return }
      if (path === '/enterprise/native-sharing') {
        if (request.method === 'GET') { json(response, 200, await sharingStatus(ctx.get?.('liveshareShares'),account)); return }
        if (request.method === 'POST') { json(response, 200, await createNativeShare(ctx.get?.('liveshareShares'), await body(request),account)); return }
      }
      if(path==='/enterprise/native-sharing/configure'&&request.method==='POST') {
        const sharing=ctx.get?.('liveshareShares');if(!sharing)throw new SuiteError('NATIVE_SHARING_DISABLED',409)
        if((await account.state()).status!=='signed-in')throw new SuiteError('IPW_SIGN_IN_REQUIRED',401)
        await sharing.setRelay({relayUrl:config.accountOrigin});json(response,200,{ok:true});return
      }
      if(path.startsWith('/enterprise/native-sharing/audience/')&&(request.method==='GET'||request.method==='PUT')){json(response,200,await nativeShareAudience(ctx.get?.('liveshareShares'),account,path.slice('/enterprise/native-sharing/audience/'.length),request.method==='PUT'?await body(request):undefined));return}
      if(path==='/enterprise/native-sharing/prepare'&&request.method==='POST'){json(response,200,await prepareNativeShare(ctx.get?.('liveshareShares'),await body(request),account));return}
      if(path==='/enterprise/native-sharing/authorize'&&request.method==='POST'){json(response,200,await authorizeNativeShare(account,await body(request)));return}
      if(path.startsWith('/enterprise/native-sharing/')&&request.method==='DELETE'){json(response,200,await stopNativeShare(ctx.get?.('liveshareShares'),account,path.slice('/enterprise/native-sharing/'.length)));return}
      if (path === '/enterprise/upload' && request.method === 'POST') {
        const form=await readForm(request)
        const result=await account.transfer('/api/v1/resources',form)
        json(response,200,await result.json());return
      }
      if (path.startsWith('/enterprise/download/') && request.method === 'GET') {
        const resourceId=path.slice('/enterprise/download/'.length)
        if(!/^[A-Za-z0-9_-]{1,200}$/.test(resourceId))throw new SuiteError('IPW_INVALID_INPUT',400)
        await relayDownload(await account.transfer('/api/v1/resources/'+resourceId+'/download'),response);return
      }
      const packageFile=/^\/enterprise\/organizations\/([A-Za-z0-9_-]{1,100})\/packages\/([A-Za-z0-9_-]{1,100})\/(upload|files\/([A-Za-z0-9_-]{1,100})\/download)$/.exec(path)
      if (packageFile && packageFile[3] === 'upload' && request.method === 'POST') {
        const form=await readForm(request)
        const result=await account.transfer(`/api/v1/enterprises/${packageFile[1]}/packages/${packageFile[2]}/files`,form)
        json(response,200,await result.json());return
      }
      if (packageFile && packageFile[4] && request.method === 'GET') {
        await relayDownload(await account.transfer(`/api/v1/enterprises/${packageFile[1]}/packages/${packageFile[2]}/files/${packageFile[4]}/download`),response);return
      }
      if (path === '/enterprise' || path.startsWith('/enterprise/')) {
        if (!config.account) throw new SuiteError('IPW_NOT_FOUND', 404)
        const value = await enterprise.request(request.method ?? 'GET', path.slice('/enterprise'.length), ['POST','PATCH','PUT'].includes(request.method ?? '') ? await body(request,config.maxRequestBytes) : undefined)
        if (request.method !== 'GET' && /^\/enterprise\/organizations\/[^/]+\/(skills|grants|services|members|departments)/.test(path)) await refreshAccount().catch(() => {})
        json(response, 200, value); return
      }
      json(response, 404, { error: 'IPW_NOT_FOUND' })
    } catch (error) { json(response, error instanceof SuiteError ? error.status : error instanceof ZodError ? 400 : 500, { error: error instanceof SuiteError ? error.code : error instanceof ZodError ? 'IPW_INVALID_INPUT' : 'IPW_SERVICE_UNAVAILABLE' }) }
  } }), 'ipollowork-suite: HTTP route')
}
