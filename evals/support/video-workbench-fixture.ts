// Isolated production plugin + real server/FFmpeg. The host bridge is a fixture;
// no accounts, user workspace, or billable generation endpoints are used.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { callVideoGenerationAction } from "../../apps/server/src/extensions/video-generation";
import { listSessionArtifacts } from "../../apps/server/src/session-artifacts";
import { inspectLocalVideo } from "../../apps/server/src/extensions/video-local-edit";
import type { ServerConfig } from "../../apps/server/src/types";
let root=await mkdtemp(join(tmpdir(),"ipollowork-video-workbench-proof-"));
const seed=()=>execFileSync(process.env.HYPERFRAMES_FFMPEG_PATH||"ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=s=640x360:r=24:d=6","-f","lavfi","-i","sine=frequency=440:duration=6","-c:v","libx264","-threads","1","-c:a","aac","-shortest",join(root,"source.mp4")],{windowsHide:true});
seed();
const workspace={id:"proof",name:"Proof",path:root,preset:"starter",workspaceType:"local"} satisfies ServerConfig["workspaces"][number];
const config:ServerConfig={host:"127.0.0.1",port:5278,token:"fixture",hostToken:"fixture",configPath:join(root,"server.json"),approval:{mode:"auto",timeoutMs:0},corsOrigins:[],workspaces:[workspace],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:"generated",hostTokenSource:"generated",logFormat:"pretty",logRequests:false};
const context={workspaceId:workspace.id,sessionId:"proof"};
let calls:string[]=[];
const launch={intent:"edit-video",requestId:crypto.randomUUID(),source:{path:"source.mp4",name:"source.mp4",kind:"workspace-file",preview:"video"}};
const hostHtml=`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>视频工作台本地剪辑验证</title><style>body{margin:0;font:13px Arial;background:#fff}header{padding:9px 16px;border-bottom:1px solid #eee}iframe{width:100%;height:calc(100vh - 36px);border:0}</style></head><body><header>视频工作台验证 · 真实剪辑和保存 · 未绑定 AI 模型</header><iframe id="studio" title="视频工作台" src="/studio"></iframe><script>
window.proofSaved=[];window.proofInspector=null;window.__ipolloworkControl={fixture:true};
const launch=${JSON.stringify(launch)};
addEventListener('message',async event=>{if(event.source!==document.querySelector('iframe').contentWindow||event.data?.jsonrpc!=='2.0')return;const m=event.data;if(m.id===undefined||!m.method)return;const reply=result=>event.source.postMessage({jsonrpc:'2.0',id:m.id,result},location.origin);try{
if(m.method==='ui/initialize')return reply({hostContext:{theme:'light','ai.ipollo/workspace':{workspaceId:'proof',sessionId:'proof',launch}}});
if(m.method==='ui/update-model-context'){const s=m.params?.structuredContent;if(s?.videoEditResult)proofSaved.push(s.videoEditResult);proofInspector=s?.['ai.ipollo/inspector']||null;return reply({});}
if(m.method==='tools/call'){const response=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.params)});return reply(await response.json());}reply({});
}catch(e){reply({isError:true,content:[{type:'text',text:e.message}]});}});
</script></body></html>`;
const server=Bun.serve({hostname:"127.0.0.1",port:5278,async fetch(request){const url=new URL(request.url);try{
  if(url.pathname==="/reset"&&request.method==="POST"){root=await mkdtemp(join(tmpdir(),"ipollowork-video-workbench-proof-"));workspace.path=root;config.configPath=join(root,"server.json");config.authorizedRoots=[root];calls=[];seed();return Response.json({ok:true});}
  if(url.pathname==="/studio")return new Response(await readFile(new URL("../../examples/plugin-packages/video-console/ui/video-console.html",import.meta.url)),{headers:{"content-type":"text/html;charset=utf-8"}});
  if(url.pathname==="/setup")return Response.json({root,launch});
  if(url.pathname==="/witness"){const artifacts=await listSessionArtifacts(config,workspace.id,"proof");return Response.json({calls,artifacts,source:await inspectLocalVideo(workspace,"source.mp4")});}
  if(url.pathname==="/action"){const {name,arguments:args}=await request.json();if(!["status","jobs","read","inspect","local-edit","import"].includes(name))throw new Error("Billable actions are disabled in this proof");calls.push(name);const result=await callVideoGenerationAction(config,{read:async()=>({})},name,args,context);return Response.json({content:[],structuredContent:result.result});}
  return new Response(hostHtml,{headers:{"content-type":"text/html;charset=utf-8"}});
}catch(error){return Response.json({isError:true,content:[{type:"text",text:error instanceof Error?error.message:String(error)}]});}}});
console.log(`Video workbench proof http://127.0.0.1:${server.port}; fixture ${root}`);
