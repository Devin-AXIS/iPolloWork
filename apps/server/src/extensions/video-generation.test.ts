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
function workflowFixture() {
  return { code: 0, data: { prompt: JSON.stringify({
    "17": { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "public template example", clip: ["3",0], length: 360 } },
    "3": { class_type: "CLIPLoader", inputs: { type: "minimax" } },
    "7": { class_type: "SaveVideo", inputs: { format: "auto", codec: "auto", video: ["12",0] } },
    "12": { class_type: "CreateVideo", inputs: { images: ["11",0] } },
    "11": { class_type: "SamplerCustomAdvanced", inputs: { latent_image: ["17",1], guider: ["10",0], noise: ["16",0], sigmas: ["9",0] } },
    "10": { class_type: "BasicGuider", inputs: { conditioning: ["17",0] } },
    "9": { class_type: "BasicScheduler", inputs: { steps: 25 } },
    "16": { class_type: "RandomNoise", inputs: { noise_seed: 42 } },
  }) } };
}
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

test("maps Seedance first/last images and edit, and H3 first/last images into the real workflow graph",async()=>{
  const {config}=await setup();
  const request=async(patch:Record<string,string>)=>videoRequest(config.workspaces[0],validateVideoSubmission(submission(patch)),"key",config,auth);
  const edit=await request({operation:"edit",duration:"-1",ratio:"adaptive",videoRefs:"https://example.com/original.mp4"});
  expect(edit.body).toMatchObject({model:"doubao-seedance-2-5-260628",duration:-1,ratio:"adaptive",omni_reference_task_type:"edit",generate_audio:true,content:expect.arrayContaining([{type:"video_url",video_url:{url:"https://example.com/original.mp4"},role:"reference_video"}])});
  expect(edit.body).not.toHaveProperty("seed");
  const input={operation:"first-last",ratio:"adaptive",firstFrame:"https://example.com/first.png",lastFrame:"https://example.com/last.png"};
  const arkFrames=await request(input);
  expect(arkFrames.body).toMatchObject({content:expect.arrayContaining([
    {type:"image_url",image_url:{url:input.firstFrame},role:"first_frame"},
    {type:"image_url",image_url:{url:input.lastFrame},role:"last_frame"},
  ])});
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async()=>Response.json(workflowFixture()));
  const frames=await request({...input,model:"minimax-h3",resolution:"0.5MP"});
  expect(frames.url).toEndWith("/task/openapi/create");
  expect(frames.body).toMatchObject({apiKey:"key",workflowId:"2097511747551842305",instanceType:"plus"});
  if(!("workflow" in frames.body))throw new Error("Missing workflow graph");
  const graph=JSON.parse(frames.body.workflow);
  expect(graph["24"]).toMatchObject({class_type:"LoadImageFromUrl",inputs:{image:input.firstFrame}});
  expect(graph["25"].inputs.image).toBe(input.lastFrame);
  expect(graph["17"].inputs).toMatchObject({first_frame:["300",0],last_frame:["25",0],width:["301",0],height:["301",1]});
  expect(graph["300"].inputs).toMatchObject({megapixels:0.5,resolution_steps:32});
  expect(graph["17"].inputs.prompt).toBe(submission().prompt);
  expect(frames.body).toMatchObject({nodeInfoList:[{nodeId:"17",fieldName:"prompt",fieldValue:submission().prompt}]});
  expect(graph["17"].inputs.length).toBe(124);
  expect(graph["7"].inputs).toMatchObject({format:"mp4",codec:"h264"});
  const text=await request({model:"minimax-h3",resolution:"1MP"});
  if(!("workflow" in text.body))throw new Error("Missing workflow graph");
  const textGraph=JSON.parse(text.body.workflow);
  expect(textGraph["17"].inputs).toMatchObject({width:1344,height:736});
  expect(textGraph["17"].inputs).not.toHaveProperty("first_frame");
  expect(textGraph["17"].inputs).not.toHaveProperty("last_frame");
  expect(textGraph).not.toHaveProperty("24");
  expect(textGraph).not.toHaveProperty("25");
  expect(JSON.stringify(textGraph)).not.toContain("public template example");
  expect(JSON.stringify(textGraph)).not.toContain("template-first.png");
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
  const args = submission({ model: "minimax-h3", resolution: "0.5MP" });
  expect(validateVideoSubmission(args).ratio).toBe("16:9");
  for (const operation of ["text"]) {
    expect(() => validateVideoSubmission({ ...args, operation, ratio: "adaptive" })).toThrow("画幅");
  }
  expect(validateVideoSubmission({ ...args, operation: "first", firstFrame: "source.png", ratio: "adaptive" }).ratio).toBe("adaptive");
});

test("H3 workflow rejections are definite, redacted and never prompt for a standard-model key", async () => {
  const { config, call } = await setup();
  let creates=0;
  Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async (url:string) => {
    if(url.endsWith("getJsonApiFormat"))return Response.json(workflowFixture());
    creates++;return Response.json({code:421,msg:"WORKFLOW_NOT_FOUND test-rh-secret https://private.example/trace"});
  });
  const args = submission({ model: "minimax-h3", resolution: "0.5MP" });
  await call("submit", args);
  await call("submit", args);
  const job = await getVideoJob(config, args.requestId, "workspace", context.sessionId);
  expect(job.status).toBe("failed");
  expect(job.message).toContain("421");
  expect(job.message).not.toContain("Enterprise-Shared");
  expect(job.message).not.toContain("test-rh-secret");
  expect(creates).toBe(1);
});

test("H3 refuses a changed public graph before billing and never resubmits an uncertain workflow", async () => {
  for(const changed of [true,false]) {
    const {config,call}=await setup();let creates=0;
    Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string)=>{
      if(url.endsWith("getJsonApiFormat")){
        const fixture=workflowFixture();
        if(changed)fixture.data.prompt=fixture.data.prompt.replace('"CLIPLoader"','"RenamedPrompt"');
        return Response.json(fixture);
      }
      creates++;throw new Error("lost create response test-rh-secret");
    });
    const args=submission({model:"minimax-h3",resolution:"0.5MP"});
    await call("submit",args);await call("submit",args);await pollVideoJobs(config,auth);
    const job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);
    expect(job.status).toBe(changed?"failed":"uncertain");
    expect(creates).toBe(changed?0:1);
    expect(job.message).not.toContain("test-rh-secret");
    expect(job.workflowId).toBe("2097511747551842305");
  }
});

test("existing H3 standard-model jobs keep their original query endpoint",async()=>{
  const {config,call}=await setup();
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async()=>Response.json({id:"existing-h3-task"}));
  const args=submission();await call("submit",args);
  const job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);
  await updateVideoJob(config,job,{model:"minimax-h3"});
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string|URL)=>{
    if(String(url).endsWith("/openapi/v2/query"))return Response.json({status:"SUCCESS",results:[{url:"https://rh-images.xiaoyaoyou.com/existing.mp4"}]});
    expect(String(url)).toBe("https://rh-images.xiaoyaoyou.com/existing.mp4");return new Response(mp4);
  });
  await pollVideoJobs(config,auth);
  expect((await getVideoJob(config,job.id,"workspace",context.sessionId)).status).toBe("succeeded");
});

test.each([
  ["2084935567606894593", "92"],
  ["2084511826766811137", "7"],
  ["2097511747551842305", "7"],
])("H3 workflow %s keeps its saved output node %s",async(workflowId, nodeId)=>{
  const {config,call}=await setup();
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string)=>url.endsWith("getJsonApiFormat")?Response.json(workflowFixture()):Response.json({code:0,data:{taskId:"old-h3-task",taskStatus:"QUEUED"}}));
  const args=submission({model:"minimax-h3",resolution:"0.5MP"});
  await call("submit",args);
  const job=await getVideoJob(config,args.requestId,"workspace",context.sessionId);
  await updateVideoJob(config,job,{workflowId});
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string|URL)=>{
    if(String(url).endsWith("/status"))return Response.json({code:0,data:"SUCCESS"});
    if(String(url).endsWith("/outputs"))return Response.json({code:0,data:[{fileUrl:"https://rh-images.xiaoyaoyou.com/old.mp4",fileType:"mp4",nodeId}]});
    expect(String(url)).toBe("https://rh-images.xiaoyaoyou.com/old.mp4");return new Response(mp4);
  });
  await pollVideoJobs(config,auth);
  expect((await getVideoJob(config,job.id,"workspace",context.sessionId)).status).toBe("succeeded");
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
    if(String(url).endsWith("getJsonApiFormat"))return Response.json(workflowFixture());
    if(String(url).endsWith("/create"))return Response.json({code:0,data:{taskId:randomUUID(),taskStatus:"QUEUED"}});
    if(String(url).endsWith("/status"))return Response.json({code:0,data:phase});
    if(String(url).endsWith("/outputs"))return Response.json(phase==="FAILED"?{code:805,msg:"生成失败"}:{code:0,data:[{fileUrl:"https://rh-images.xiaoyaoyou.com/result.mp4",fileType:"mp4",nodeId:"7"}]});
    return new Response(mp4);
  });
  for(const status of ["succeeded","failed"]){const args=submission({model:"minimax-h3",resolution:"0.5MP"});await call("submit",args);await pollVideoJobs(config,auth);expect(String((await getVideoJob(config,args.requestId,"workspace",context.sessionId)).status)).toBe(status);phase="FAILED";}
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
  runInNewContext(`${definitions}\n${functions}\nglobalThis.state=state;state.mode='generate';state.models=provider.models;state.ratios=provider.ratios;state.host={sessionId:'session'};normalized();publish();`,sandbox);
  const result=runInNewContext(`({inspector:published.structuredContent[INSPECTOR],model:state.model})`,sandbox);
  expect(result.model).toBe("seedance-2.5");
  expect(parsePluginUiInspectorContext(result.inspector)?.fields.some(field=>field.id==="generateAudio"&&field.advanced)).toBe(true);
  const switched=runInNewContext(`state.model='minimax-h3';state.mode='generate';state.operation='edit';state.duration='30';state.resolution='1080p';const changed=normalized();publish();({changed,operation:state.operation,duration:state.duration,inspector:published.structuredContent[INSPECTOR]})`,sandbox);
  expect(switched.operation).toBe("text");expect(switched.duration).toBe("5");
  const ratioField = parsePluginUiInspectorContext(switched.inspector)?.fields.find(field=>field.id==="ratio");
  expect(ratioField?.value).toBe("16:9");
  expect(ratioField?.options?.some(option=>option.value==="adaptive")).toBe(false);
  expect(parsePluginUiInspectorContext(switched.inspector)?.fields.some(field=>field.id==="generateAudio")).toBe(false);
  expect(parsePluginUiInspectorContext(switched.inspector)?.fields.some(field=>field.id==="watermark")).toBe(false);
  const frames = runInNewContext(`state.operation='first-last';normalized();publish();published.structuredContent[INSPECTOR]`, sandbox);
  expect(parsePluginUiInspectorContext(frames)?.fields.filter(field => field.control === "image").map(field => field.id)).toEqual(["firstFrame", "lastFrame"]);
  expect(html).not.toContain('id="importTarget"');
  expect(html).not.toContain('id="openPath"');
  expect(html).not.toContain('素材与原视频');
  expect(html).not.toContain('id="trimStart"');
  expect(html).not.toContain('id="trimEnd"');
  expect(html).not.toContain('本会话任务');
  const local = runInNewContext(`state.mode='edit';state.ai=false;normalized();publish();({mode:state.mode,context:published.structuredContent})`,sandbox);
  expect(local.mode).toBe('edit');expect(local.context).toEqual({});
  expect(runInNewContext(`state.models=[];normalized();state.model`,sandbox)).toBe("");
  runInNewContext(`publish()`,sandbox);
  expect(runInNewContext(`published.structuredContent`,sandbox)).toEqual({});
  expect(html).toContain('const HOST = "ai.ipollo/workspace"');
  expect(html).toContain('"ui/message"');
  expect(html).not.toContain('call("prepare-prompt"');
});

test("one click expands with the current session AI and automatically submits exactly once", async () => {
  const html = await Bun.file(new URL("../../../../examples/plugin-packages/video-console/ui/video-console.html", import.meta.url)).text();
  const signature = html.slice(html.indexOf("function promptSignature()"), html.indexOf("\n", html.indexOf("function promptSignature()")));
  const runner = signature + "\n" + html.slice(html.indexOf("async function run()"), html.indexOf("async function importMedia("));
  const calls: string[] = [], messages: unknown[] = [], timers: Array<() => void> = [];
  const definitions = html.slice(html.indexOf("const state ="), html.indexOf("function post("));
  const sandbox: Record<string,unknown> = { crypto: { randomUUID }, setTimeout(callback: () => void) { timers.push(callback); }, render() {}, publish() {}, tell() {}, refresh: async () => {},
    request: async (method: string, args: unknown) => { calls.push(method); messages.push(args); return {}; },
    call: async (action: string) => {
      calls.push(action);
      return { job: { id: "job", status: "running", message: "submitted" } };
    },
  };
  runInNewContext(definitions+"\n"+runner+"\nglobalThis.state=state;state.model='minimax-h3';state.prompt='夸父追日';state.style='史诗电影';state.host={sessionId:'session'};", sandbox);
  await runInNewContext("run()", sandbox);
  expect(calls).toEqual(["ui/message"]);
  expect(JSON.stringify(messages)).toContain("史诗电影");
  expect(JSON.stringify(messages)).toContain("夸父追日");
  expect(runInNewContext("state.busy",sandbox)).toBe(false);
  await expect(runInNewContext("run()",sandbox)).rejects.toThrow("正在扩写");
  await expect(runInNewContext("acceptExpandedPrompt({requestId:'wrong',prompt:'ignore'})",sandbox)).rejects.toThrow("过期");
  const reply = "acceptExpandedPrompt({requestId:state.expansion.id,prompt:'integrated_multimodal_description: [Shot 1] Kuafu runs. overall_soundscape: wind. non_diegetic_music: drums.'})";
  runInNewContext("globalThis.previousId=state.expansion.id",sandbox);
  await runInNewContext(reply,sandbox);
  expect(calls).toEqual(["ui/message", "submit"]);
  await expect(runInNewContext("acceptExpandedPrompt({requestId:previousId,prompt:'duplicate'})",sandbox)).rejects.toThrow("过期");
  runInNewContext("state.firstFrame='new.png'",sandbox);
  await runInNewContext("run()",sandbox);
  runInNewContext("state.camera='特写'",sandbox);
  await expect(runInNewContext("acceptExpandedPrompt({requestId:state.expansion.id,prompt:'stale'})",sandbox)).rejects.toThrow("过期");
  expect(calls).toEqual(["ui/message", "submit", "ui/message"]);
  runInNewContext("state.expansion=null",sandbox);
  sandbox.request=async()=>({isError:true});
  await expect(runInNewContext("run()",sandbox)).rejects.toThrow("未接收");
  expect(runInNewContext("state.expansion",sandbox)).toBeNull();
  expect(runInNewContext("state.busy",sandbox)).toBe(false);
  expect(calls.filter(action=>action==="submit")).toHaveLength(1);
  sandbox.request=async()=>({});
  await runInNewContext("run()",sandbox);
  runInNewContext("state.host.sessionId='another-session'",sandbox);
  await expect(runInNewContext(reply,sandbox)).rejects.toThrow("过期");
  timers.at(-1)?.();
  expect(runInNewContext("state.expansion",sandbox)).toBeNull();
  expect(runInNewContext("state.busy",sandbox)).toBe(false);
  expect(calls.filter(action=>action==="submit")).toHaveLength(1);
  expect(html).toContain('"生成视频"');
  expect(html).not.toContain("确认描述并生成");
});

test("inspector uploads bind exact frame fields, preserve inputs on failure and reset hidden frames", async () => {
  const { call, root } = await setup();
  const provider = (await call("status")).result;
  const html = await Bun.file(new URL("../../../../examples/plugin-packages/video-console/ui/video-console.html", import.meta.url)).text();
  const definitions = html.slice(html.indexOf("const state ="), html.indexOf("function post("));
  const functions = html.slice(html.indexOf("function model()"), html.indexOf("async function refresh("));
  const importer = html.slice(html.indexOf("async function importMedia("), html.indexOf("function openSettings("));
  const dataUrl = "data:image/png;base64,aW1hZ2U=";
  const sandbox: Record<string, unknown> = {
    provider, dataUrl, Uint8Array, atob, INSPECTOR: "ai.ipollo/inspector", disposed: false,
    $: () => ({ setAttribute() {} }), renderEditor() {}, tell() {}, request: async () => ({}),
    call: async (action: string, args: Record<string, unknown>) => {
      expect(action).toBe("import");
      if (args.filename === "fail.png") throw new Error("导入失败");
      return (await call(action, args)).result;
    },
  };
  runInNewContext(`${definitions}\n${functions}\n${importer}\nglobalThis.state=state;state.models=provider.models;state.ratios=provider.ratios;state.host={sessionId:'session'};`, sandbox);
  for (const model of ["seedance-2.5", "minimax-h3"]) {
    runInNewContext(`state.model=${JSON.stringify(model)};state.operation='first-last';state.prompt='keep my draft';normalized();`, sandbox);
    await runInNewContext(`importMedia({fieldId:'firstFrame',filename:'first.png',dataUrl})`, sandbox);
    await runInNewContext(`importMedia({fieldId:'lastFrame',filename:'last.png',dataUrl})`, sandbox);
    const before = runInNewContext(`({first:state.firstFrame,last:state.lastFrame,prompt:state.prompt,busy:state.busy})`, sandbox);
    expect(before.first).not.toBe(before.last);
    expect(await readFile(join(root, before.first))).toEqual(Buffer.from("image"));
    expect(before).toMatchObject({ prompt: "keep my draft", busy: false });
    await expect(runInNewContext(`importMedia({fieldId:'firstFrame',filename:'fail.png',dataUrl})`, sandbox)).rejects.toThrow("导入失败");
    expect(runInNewContext(`state.firstFrame`, sandbox)).toBe(before.first);
    expect(runInNewContext(`state.busy`, sandbox)).toBe(false);
    await runInNewContext(`importMedia({fieldId:'firstFrame',filename:'replacement.png',dataUrl})`, sandbox);
    expect(runInNewContext(`state.firstFrame`, sandbox)).not.toBe(before.first);
    expect(runInNewContext(`state.lastFrame`, sandbox)).toBe(before.last);
    runInNewContext(`state.operation='first';normalized();`, sandbox);
    expect(runInNewContext(`state.lastFrame`, sandbox)).toBe("");
    await expect(runInNewContext(`importMedia({fieldId:'lastFrame',filename:'last.png',dataUrl})`, sandbox)).rejects.toThrow("当前模式");
    await expect(runInNewContext(`importMedia({fieldId:'firstFrame',filename:'bad.mp4',dataUrl:'data:video/mp4;base64,eA=='})`, sandbox)).rejects.toThrow("文件类型");
    runInNewContext(`state.operation='text';normalized();`, sandbox);
    expect(runInNewContext(`state.firstFrame`, sandbox)).toBe("");
  }
});

test("Ark local reference video requires storage; H3 uploads through documented multipart API",async()=>{
  const {config,root}=await setup();await writeFile(join(root,"clip.mp4"),mp4);
  const ark=validateVideoSubmission(submission({operation:"edit",ratio:"adaptive",duration:"-1",videoRefs:"clip.mp4"}));
  await expect(videoRequest(config.workspaces[0],ark,"key",config,auth)).rejects.toThrow("OSS/Wasabi");
  Reflect.set(globalThis,PROVIDER_FETCH_SYMBOL,async(url:string,init:RequestInit)=>{
    if(url.endsWith("getJsonApiFormat"))return Response.json(workflowFixture());
    expect(url).toEndWith("/task/openapi/upload");expect(init.body instanceof FormData).toBe(true);
    if(init.body instanceof FormData){expect(init.body.get("apiKey")).toBe("key");expect(init.body.get("fileType")).toBe("input");}
    return Response.json({code:0,data:{fileName:"api/uploaded.png"}});
  });
  await writeFile(join(root,"first.png"),Buffer.from("test-image-bytes"));
  const h3=validateVideoSubmission(submission({model:"minimax-h3",resolution:"0.5MP",operation:"first",ratio:"adaptive",firstFrame:"first.png"}));
  const request=await videoRequest(config.workspaces[0],h3,"key",config,auth);
  if(!("workflow" in request.body))throw new Error("Missing workflow graph");
  expect(JSON.parse(request.body.workflow)["24"]).toMatchObject({class_type:"LoadImage",inputs:{image:"api/uploaded.png"}});
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
