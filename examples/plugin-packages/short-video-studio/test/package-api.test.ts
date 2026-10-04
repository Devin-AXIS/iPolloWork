import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
const hostRoot=process.env.IPOLLOWORK_SOURCE_ROOT;
if(!hostRoot)throw new Error('IPOLLOWORK_SOURCE_ROOT required');
const load=(path:string)=>import(pathToFileURL(resolve(hostRoot,path)).href);
test('real HTTP import, UI, service and uninstall remove private data but retain authored files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'short-video-api-')),prior=process.env.IPOLLOWORK_RUNTIME_DB;
  process.env.IPOLLOWORK_RUNTIME_DB=join(root,'runtime.sqlite');
  const config={host:'127.0.0.1',port:0,token:'isolated-test-token',hostToken:'isolated-host-token',configPath:join(root,'server.json'),approval:{mode:'auto',timeoutMs:0},corsOrigins:[],workspaces:[{id:'verify',name:'Short video API test',path:root,preset:'starter',workspaceType:'local',engineId:'opencode'}],authorizedRoots:[root],readOnly:false,startedAt:Date.now(),tokenSource:'generated',hostTokenSource:'generated',logFormat:'pretty',logRequests:false};
  let server;
  try{
    const {startServer}=await load('apps/server/src/server.ts');
    const {pluginServiceDataDirectory}=await load('apps/server/src/plugin-service-runtime.ts');
    server=await startServer(config);
    const request=async(path:string,method='GET',body?:unknown)=>{
      const res=await fetch(`http://127.0.0.1:${server.port}${path}`,{method,headers:{authorization:'Bearer isolated-test-token','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const text=await res.text();expect(res.status,text).toBe(200);return JSON.parse(text);
    };
    const zip=await JSZip.loadAsync(await readFile(new URL('../dist/short-video-studio-0.1.0.ipollowork-plugin',import.meta.url)));
    const files=[];for(const [path,entry]of Object.entries(zip.files))if(!entry.dir)files.push({path,contentBase64:await entry.async('base64')});
    const upload={archiveName:'short-video-studio-0.1.0.ipollowork-plugin',files};
    await request('/workspace/verify/plugin-packages/import/validate','POST',upload);
    const installed=await request('/workspace/verify/plugin-packages/import','POST',upload);expect(installed.result.status).toBe('installed');
    const ui=await request('/workspace/verify/plugin-packages/short-video-studio/ui/studio');expect(ui.html).toContain('短片创作工作台');
    const call=(action:string,args:unknown)=>request('/experimental/extensions/call','POST',{extensionId:'short-video-studio',action,args,context:{directory:root,workspaceId:'verify',sessionId:'ses_verify'}});
    const created=await call('project-create',{title:'保留的创作工程'}), project=created.result.project;
    await call('asset-upload',{projectId:project.id,uploadId:'upload_verify',filename:'test.png',total:6,offset:0,data:Buffer.from('abc').toString('base64')});
    const privateDir=pluginServiceDataDirectory(config,'verify','short-video-studio');expect((await stat(privateDir)).isDirectory()).toBe(true);
    await request('/workspace/verify/plugin-packages/short-video-studio','DELETE');
    await expect(stat(privateDir)).rejects.toMatchObject({code:'ENOENT'});
    expect((await stat(join(root,'short-video',project.id,'project.json'))).isFile()).toBe(true);
  }finally{if(server)await server.stop();if(prior===undefined)delete process.env.IPOLLOWORK_RUNTIME_DB;else process.env.IPOLLOWORK_RUNTIME_DB=prior;await rm(root,{recursive:true,force:true});}
},60000);
