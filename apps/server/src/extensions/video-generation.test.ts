import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { parsePluginUiInspectorContext } from "@ipollowork/types/plugins";
import type { ServerConfig } from "../types.js";
import type { AuthorizationAccess } from "../authorization-center.js";
import { saveAuthorizationService, testAuthorizationService } from "../authorization-center.js";
import { PROVIDER_FETCH_SYMBOL } from "../provider-fetch.js";
import { listSessionArtifacts } from "../session-artifacts.js";
import { validatePluginPackageManifest } from "../plugin-package-manifest.js";
import { callVideoGenerationAction, pollVideoJobs, validateVideoSubmission, videoRequest } from "./video-generation.js";
import { claimVideoJobs, getVideoJob, updateVideoJob } from "./video-jobs.js";

const roots: string[] = [];
const oldFetch: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
const auth: AuthorizationAccess = { read: async (id): Promise<Readonly<Record<string,string>>> => id === "volcengine-video" ? { ARK_API_KEY: "test-ark-secret" } : id === "runninghub-video" ? { RUNNINGHUB_API_KEY: "test-rh-secret" } : {} };
const context = { workspaceId: "workspace", sessionId: "session-one" };
// Minimal ftyp fixture; provider transport is mocked, not a claim of real generated video.
const mp4 = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-test-")); roots.push(root);
  const config: ServerConfig = { host:"127.0.0.1",port:0,token:"token",hostToken:"host",configPath:join(root,"server.json"),approval:{mode:"auto",timeoutMs:0},corsOrigins:[],workspaces:[{id:"workspace",name:"Workspace",path:root,preset:"starter",workspaceType:"local"}],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:"generated",hostTokenSource:"generated",logFormat:"pretty",logRequests:false };
  return { root, config, call: (action: string, input: unknown = {}, owner = context) => callVideoGenerationAction(config,auth,action,input,owner) };
}
function submission(patch = {}) { return { requestId:randomUUID(),model:"seedance-2.5",operation:"text",prompt:"镜头缓慢推近海边的灯塔",resolution:"720p",duration:"5",ratio:"16:9", ...patch }; }
afterEach(async () => {
  if (oldFetch === undefined) Reflect.deleteProperty(globalThis,PROVIDER_FETCH_SYMBOL); else Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,oldFetch);
  for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true});
});

test("only bound video models appear, without credentials or unsupported knobs",async()=>{
  const {config}=await setup();
  const result=await callVideoGenerationAction(config,{read:async (id): Promise<Readonly<Record<string,string>>> =>id==="volcengine-video"?{ARK_API_KEY:"private-key"}:{}},"status",{},context);
  expect(result.result).toMatchObject({models:[{id:"seedance-2.5",resolutions:["480p","720p","1080p"]}]});
  expect(JSON.stringify(result)).not.toContain("private-key");
  const empty=await callVideoGenerationAction(config,{read:async()=>({})},"status",{},context);
  expect(empty.result).toMatchObject({models:[]});
});

test("rejects unsupported mode combinations before any network call",()=>{
  for(const patch of [
    {model:"minimax-h3",operation:"edit",resolution:"2K"},
    {operation:"edit",videoRefs:"https://example.com/input.mp4"},
    {operation:"first",firstFrame:"https://example.com/a.png"},
    {model:"minimax-h3",resolution:"2K",duration:"30"},
    {model:"minimax-h3",resolution:"2K",generateAudio:"true"},
    {model:"minimax-h3",operation:"reference",resolution:"2K",audioRefs:"https://example.com/a.wav"},
    {operation:"text",videoRefs:"https://example.com/a.mp4"},
    {seed:"42"},
  ])expect(()=>validateVideoSubmission(submission(patch))).toThrow();
  expect(validateVideoSubmission(submission({operation:"edit",duration:"-1",ratio:"adaptive",videoRefs:"https://example.com/input.mp4"})).operation).toBe("edit");
});

test("maps Seedance edit and H3 first/last and reference payloads to documented native fields",async()=>{
  const {config}=await setup();
  const request=async(patch:Record<string,string>)=>videoRequest(config.workspaces[0],validateVideoSubmission(submission(patch)),"key",config,auth);
  const edit=await request({operation:"edit",duration:"-1",ratio:"adaptive",videoRefs:"https://example.com/original.mp4"});
  expect(edit.body).toMatchObject({model:"doubao-seedance-2-5-260628",duration:-1,ratio:"adaptive",omni_reference_task_type:"edit",generate_audio:true,content:expect.arrayContaining([{type:"video_url",video_url:{url:"https://example.com/original.mp4"},role:"reference_video"}])});
  expect(edit.body).not.toHaveProperty("seed");
  const frames=await request({model:"minimax-h3",resolution:"768P",operation:"first-last",ratio:"adaptive",firstFrame:"https://example.com/first.png",lastFrame:"https://example.com/last.png"});
  expect(frames.url).toEndWith("/minimax/hailuo-h3/image-to-video");
  expect(frames.body).toMatchObject({duration:"5",resolution:"768P",firstFrameUrl:"https://example.com/first.png",lastFrameUrl:"https://example.com/last.png"});
  expect(frames.body).not.toHaveProperty("ratio");
  const reference=await request({model:"minimax-h3",resolution:"2K",operation:"regenerate",videoRefs:"https://example.com/source.mp4"});
  expect(reference.url).toEndWith("/minimax/hailuo-h3/multimodal-to-video");
  expect(reference.body).toMatchObject({videoUrls:["https://example.com/source.mp4"],resolution:"2K",ratio:"16:9"});
});

test("duplicate submissions are idempotent; restart saves only into initiating session",async()=>{
  const {config,root,call}=await setup();let creates=0;
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async (url: string | URL,init?:RequestInit)=>{
    if(init?.method==="POST"){creates++;return Response.json({id:"ark-task-1"});}
    if(String(url).includes("/contents/generations/tasks/"))return Response.json({status:"succeeded",content:{video_url:"https://output.tos-cn-beijing.volces.com/test.mp4"}});
    return new Response(mp4);
  });
  const args=submission();await Promise.all([call("submit",args),call("submit",args)]);expect(creates).toBe(1);
  const reloaded={...config};await pollVideoJobs(reloaded,auth);
  const job=await getVideoJob(reloaded,args.requestId,"workspace",context.sessionId);
  expect(job.status).toBe("succeeded");expect(job.path).toBe(`video/${context.sessionId}/renders/${args.requestId}.mp4`);
  expect(await readFile(join(root,job.path))).toEqual(mp4);
  expect((await listSessionArtifacts(config,"workspace",context.sessionId)).items).toHaveLength(1);
  expect((await listSessionArtifacts(config,"workspace","session-two")).items).toHaveLength(0);
  await pollVideoJobs(reloaded,auth);expect(creates).toBe(1);
  await expect(call("recover",{id:job.id},{...context,sessionId:"session-two"})).rejects.toThrow("当前会话");
});

test("lost submit response stays uncertain, redacts keys, and never re-POSTs on polling or retry",async()=>{
  const {config,call}=await setup();let calls=0;
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async()=>{calls++;throw new Error("network test-ark-secret https://service.test/token?secret=hidden");});
  const args=submission();await call("submit",args);await call("submit",args);await pollVideoJobs(config,auth);
  const job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);
  expect(job.status).toBe("uncertain");expect(calls).toBe(1);expect(job.message).not.toContain("test-ark-secret");expect(job.message).not.toContain("secret=hidden");
  await call("recover",{id:job.id,upstreamId:"existing-provider-task"});
  expect((await getVideoJob(config,job.id,"workspace",context.sessionId)).upstreamId).toBe("existing-provider-task");expect(calls).toBe(1);
});

test("stale submitting task is marked uncertain without automatic resubmission",async()=>{
  const {config,call}=await setup();Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async()=>Response.json({id:"task"}));
  const args=submission();await call("submit",args);const job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);
  await updateVideoJob(config,job,{status:"submitting",upstreamId:"",nextPoll:0});await claimVideoJobs(config);
  expect((await getVideoJob(config,job.id,"workspace",context.sessionId)).status).toBe("uncertain");
});

test("503 and malformed responses show friendly text and never duplicate a billable submission", async () => {
  for (const status of [200, 503]) {
    for (const body of ["<html>Service Unavailable</html>", ""]) {
      const { config, call } = await setup();
      let calls = 0;
      Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => { calls++; return new Response(body, { status }); });
      const args = submission();
      await call("submit", args);
      await call("submit", args);
      await pollVideoJobs(config, auth);
      const job = await getVideoJob(config, args.requestId, "workspace", context.sessionId);
      expect(job.status).toBe("uncertain");
      expect(job.message).toContain("第三方服务暂时不可用，请稍后重试。");
      expect(job.message).toContain("勿重复提交");
      expect(job.message).not.toContain("JSON");
      expect(calls).toBe(1);
    }
  }
});

test("video rejections retain provider codes and do not expose raw account diagnostics", async () => {
  for (const [status, code, message, expected] of [
    [400, "ModelNotOpen", "Your account 123 has not activated the model example. Request id: private-trace", "当前账号无权使用该第三方服务或模型"],
    [400, "InvalidParameter", "Private upstream validation diagnostics", "第三方请求未完成，请检查参数后重试"],
    [503, "UpstreamFault", "Private gateway diagnostics", "第三方服务暂时不可用"],
  ] as const) {
    const { config, call } = await setup();
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => Response.json({ error: { code, message } }, { status }));
    const args = submission();
    await call("submit", args);
    const job = await getVideoJob(config, args.requestId, "workspace", context.sessionId);
    expect(job.message).toContain(expected);
    expect(job.message).not.toContain(message);
    expect(job.status).toBe(status < 500 ? "failed" : "uncertain");
  }
});

test("H3 uses explicit ratios except for first-frame inputs, before contacting the provider", () => {
  const args = submission({ model: "minimax-h3", resolution: "768P" });
  expect(validateVideoSubmission(args).ratio).toBe("16:9");
  for (const operation of ["text", "reference", "regenerate"]) {
    expect(() => validateVideoSubmission({ ...args, operation, ratio: "adaptive" })).toThrow("画幅");
  }
  expect(validateVideoSubmission({ ...args, operation: "first", firstFrame: "source.png", ratio: "adaptive" }).ratio).toBe("adaptive");
});

test("authorization tests distinguish provider outages from invalid keys", async () => {
  const { config } = await setup();
  await saveAuthorizationService(config, "runninghub-video", { RUNNINGHUB_API_KEY: "test-rh-key" });
  await saveAuthorizationService(config, "openai-images", { OPENAI_API_KEY: "test-openai-key" });
  for (const service of ["runninghub-video", "openai-images"] as const) {
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => new Response("<html>down</html>", { status: 503 }));
    expect(await testAuthorizationService(config, service)).toMatchObject({ ok: false, detail: "第三方服务暂时不可用，请稍后重试。" });
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => new Response("", { status: 401 }));
    expect(await testAuthorizationService(config, service)).toMatchObject({ ok: false, detail: "第三方服务授权已失效，请检查 API Key 或重新登录授权。" });
  }
});

test("download failure preserves upstream id, cleans partial output and retry saves without generating",async()=>{
  const {config,root,call}=await setup();let creates=0,valid=false;
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string|URL,init?:RequestInit)=>{
    if(init?.method==="POST"){creates++;return Response.json({id:"task"});}
    if(String(url).includes("/tasks/"))return Response.json({status:"succeeded",content:{video_url:"https://output.volces.com/result.mp4"}});
    return new Response(valid?mp4:"<html>not a video</html>");
  });
  const args=submission();await call("submit",args);await pollVideoJobs(config,auth);
  let job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);expect(job.status).toBe("save_failed");
  expect(await readdir(join(root,"video",context.sessionId,"renders"))).toEqual([]);
  valid=true;await call("recover",{id:job.id});await pollVideoJobs(config,auth);job=await getVideoJob(config,job.id,"workspace",context.sessionId);
  expect(job.status).toBe("succeeded");expect(creates).toBe(1);
});

test("H3 query recognizes SUCCESS and FAILED application statuses",async()=>{
  const {config,call}=await setup();let phase="SUCCESS";
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string|URL)=>{
    if(String(url).endsWith("text-to-video"))return Response.json({taskId:randomUUID(),status:"RUNNING",errorCode:"",errorMessage:""});
    if(String(url).endsWith("/query"))return Response.json({status:phase,errorCode:phase==="FAILED"?"INSUFFICIENT_BALANCE":"",errorMessage:phase==="FAILED"?"余额不足":"",results:[{url:"https://rh-images-125.cos.ap-beijing.myqcloud.com/result.mp4",outputType:"mp4"}]});
    return new Response(mp4);
  });
  for(const status of ["succeeded","failed"]){const args=submission({model:"minimax-h3",resolution:"2K"});await call("submit",args);await pollVideoJobs(config,auth);expect(String((await getVideoJob(config,args.requestId,"workspace",context.sessionId)).status)).toBe(status);phase="FAILED";}
});

test("read-only and path escapes are rejected; preview is chunked",async()=>{
  const {config,root,call}=await setup();config.readOnly=true;
  await expect(call("submit",submission())).rejects.toThrow("只读");config.readOnly=false;
  await writeFile(join(root,"clip.mp4"),Buffer.alloc(2*1024*1024));
  expect((await call("read",{path:"clip.mp4"})).result).toMatchObject({size:2*1024*1024,nextOffset:1024*1024});
  await expect(call("read",{path:"../clip.mp4"})).rejects.toThrow("相对路径");
  const outside=await mkdtemp(join(tmpdir(),"ipollowork-video-outside-"));roots.push(outside);await writeFile(join(outside,"clip.mp4"),mp4);
  await symlink(outside,join(root,"outside"),process.platform==="win32"?"junction":"dir");
  await expect(call("read",{path:"outside/clip.mp4"})).rejects.toThrow("escapes");
  await symlink(outside,join(root,"video"),process.platform==="win32"?"junction":"dir");
  await expect(call("import",{filename:"clip.mp4",dataUrl:`data:video/mp4;base64,${mp4.toString("base64")}`})).rejects.toThrow("escapes");
  await rmdir(join(root,"outside"));await rmdir(join(root,"video"));
});

test("plugin manifest is valid and advertises only host-backed actions",async()=>{
  const manifest=await Bun.file(new URL("../../../../examples/plugin-packages/video-console/ipollowork.plugin.json",import.meta.url)).json();
  const result=validatePluginPackageManifest(manifest);expect(result.success).toBe(true);
  if(!result.success)throw new Error(JSON.stringify(result.issues));
  expect(result.manifest.contributions).toContainEqual(expect.objectContaining({type:"workspace-app",ref:"console"}));
});

test("video inspector resets incompatible fields and publishes the real host contract",async()=>{
  const {call}=await setup();
  const provider=(await call("status")).result;
  const html=await Bun.file(new URL("../../../../examples/plugin-packages/video-console/ui/video-console.html",import.meta.url)).text();
  const definitions=html.slice(html.indexOf("const state ="),html.indexOf("function post("));
  const functions=html.slice(html.indexOf("function model()"),html.indexOf("async function refresh("));
  const sandbox: Record<string,unknown>={
    provider, INSPECTOR:"ai.ipollo/inspector",disposed:false,
    request:async (_method:string,context:unknown)=>{sandbox.published=context;},
  };
  runInNewContext(`${definitions}\n${functions}\nglobalThis.state=state;state.models=provider.models;state.ratios=provider.ratios;state.host={sessionId:'session'};normalized();publish();`,sandbox);
  const result=runInNewContext(`({inspector:published.structuredContent[INSPECTOR],model:state.model})`,sandbox);
  expect(result.model).toBe("seedance-2.5");
  expect(parsePluginUiInspectorContext(result.inspector)?.fields.some(field=>field.id==="generateAudio"&&field.advanced)).toBe(true);
  const switched=runInNewContext(`state.model='minimax-h3';state.mode='edit';state.operation='edit';state.duration='30';state.resolution='1080p';const changed=normalized();publish();({changed,operation:state.operation,duration:state.duration,inspector:published.structuredContent[INSPECTOR]})`,sandbox);
  expect(switched.operation).toBe("regenerate");expect(switched.duration).toBe("5");
  const ratioField = parsePluginUiInspectorContext(switched.inspector)?.fields.find(field=>field.id==="ratio");
  expect(ratioField?.value).toBe("16:9");
  expect(ratioField?.options?.some(option=>option.value==="adaptive")).toBe(false);
  expect(parsePluginUiInspectorContext(switched.inspector)?.fields.some(field=>field.id==="generateAudio")).toBe(false);
  expect(runInNewContext(`state.models=[];normalized();state.model`,sandbox)).toBe("");
  expect(html).toContain('const HOST = "ai.ipollo/workspace"');
  expect(html).not.toContain('"ui/message"');
});

test("Ark local reference video requires storage; H3 uploads through documented multipart API",async()=>{
  const {config,root}=await setup();await writeFile(join(root,"clip.mp4"),mp4);
  const ark=validateVideoSubmission(submission({operation:"edit",ratio:"adaptive",duration:"-1",videoRefs:"clip.mp4"}));
  await expect(videoRequest(config.workspaces[0],ark,"key",config,auth)).rejects.toThrow("OSS/Wasabi");
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string,init:RequestInit)=>{
    expect(url).toEndWith("/openapi/v2/media/upload/binary");expect(init.body instanceof FormData).toBe(true);
    return Response.json({code:200,data:{download_url:"https://rh-images-125.cos.ap-beijing.myqcloud.com/clip.mp4"}});
  });
  const h3=validateVideoSubmission(submission({model:"minimax-h3",resolution:"2K",operation:"regenerate",videoRefs:"clip.mp4"}));
  const request=await videoRequest(config.workspaces[0],h3,"key",config,auth);
  expect(request.body).toMatchObject({videoUrls:["https://rh-images-125.cos.ap-beijing.myqcloud.com/clip.mp4"]});
});

test("RunningHub authorization uses a non-billable account test and checks application-level errors",async()=>{
  const {config}=await setup();
  await saveAuthorizationService(config,"runninghub-video",{RUNNINGHUB_API_KEY:"test-account-key"});
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string,init:RequestInit)=>{
    expect(url).toBe("https://www.runninghub.ai/uc/openapi/accountStatus");
    expect(JSON.parse(String(init.body))).toEqual({apikey:"test-account-key"});
    return Response.json({code:0,data:{remainMoney:"10"}});
  });
  expect((await testAuthorizationService(config,"runninghub-video")).ok).toBe(true);
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async()=>Response.json({code:401,msg:"invalid"}));
  expect((await testAuthorizationService(config,"runninghub-video")).ok).toBe(false);
});

test("Ark local video reuses default storage with a 24-hour signed read URL",async()=>{
  const {config,root}=await setup();await writeFile(join(root,"clip.mp4"),mp4);
  const storageAuth: AuthorizationAccess={read:async(id):Promise<Readonly<Record<string,string>>>=>(id==="aliyun-oss"?{ALIYUN_OSS_ACCESS_KEY_ID:"test-id",ALIYUN_OSS_ACCESS_KEY_SECRET:"test-secret",ALIYUN_OSS_BUCKET:"video-test",ALIYUN_OSS_REGION:"cn-beijing"}:{})};
  let uploads=0;
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(_url:string,init:RequestInit)=>{expect(init.method).toBe("PUT");uploads++;return new Response("",{status:200});});
  const args=validateVideoSubmission(submission({operation:"edit",ratio:"adaptive",duration:"-1",videoRefs:"clip.mp4"}));
  const result=await videoRequest(config.workspaces[0],args,"ark-key",config,storageAuth);
  expect(uploads).toBe(1);expect(JSON.stringify(result.body)).toContain("x-oss-expires=86400");
  expect(JSON.stringify(result.body)).not.toContain("test-secret");expect(await readFile(join(root,"clip.mp4"))).toEqual(mp4);
});
