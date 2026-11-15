import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Sandbox } from 'e2b';
import { createBackend } from '../src/host/sandbox/aliyun/backend.ts';
import { settingsSchema } from '../src/host/sandbox/aliyun/config.ts';

test('real E2B SDK exchanges authenticated creation, streamed files and deletion with a local HTTP fixture',async()=>{
 const requests:string[]=[];let created=false,written=false;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://localhost');requests.push(req.method+' '+url.pathname);
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'&&url.pathname==='/sandboxes'){
   assert.equal(req.headers['x-api-key'],'e2b_0000000000000000000000000000000000000000');
   const body=JSON.parse(Buffer.concat(chunks).toString());
   assert.equal(body.templateID,'code-interpreter-v1');assert.equal(body.secure,true);created=true;
   res.end(JSON.stringify({sandboxID:'fixture',envdVersion:'0.6.2',envdAccessToken:'envd-fixture',domain:'local.test'}));
  }else if(req.method==='POST'&&url.pathname==='/files'){
   assert.equal(req.headers['x-access-token'],'envd-fixture');
   assert(Buffer.concat(chunks).toString().includes('hello-sdk'));written=true;
   res.end(JSON.stringify([{name:'file.txt',path:'/tmp/file.txt',type:'file'}]));
  }else if(req.method==='GET'&&url.pathname==='/files'){
   assert.equal(req.headers['x-access-token'],'envd-fixture');
   res.setHeader('Content-Type','application/octet-stream');res.end('hello-sdk');
  }else if(req.method==='DELETE'&&url.pathname==='/sandboxes/fixture'){
   assert.equal(req.headers['x-api-key'],'e2b_0000000000000000000000000000000000000000');res.statusCode=204;res.end();
  }else {res.statusCode=404;res.end('{}')}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const addr=server.address();assert(addr&&typeof addr!=='string');const origin=`http://127.0.0.1:${addr.port}`;
 try{
  const backend=createBackend(settingsSchema.parse({apiUrl:'https://api.cn-hangzhou.sandbox.aliyuncs.com',domain:'cn-hangzhou.sandbox.aliyuncs.com',template:'code-interpreter-v1'}),(template,options)=>Sandbox.create(template,{...options,apiUrl:origin,sandboxUrl:origin}));
  const remote=await backend({image:'unused',connectionConfig:{apiKey:'e2b_0000000000000000000000000000000000000000'}});
  await remote.files.writeFiles([{path:'/tmp/file.txt',data:'hello-sdk'}]);
  assert.equal(Buffer.from(await remote.files.readBytes('/tmp/file.txt',{offset:6,limit:3})).toString(),'sdk');
  await remote.kill();await remote.close();
  assert(created&&written);assert(requests.includes('DELETE /sandboxes/fixture'));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
