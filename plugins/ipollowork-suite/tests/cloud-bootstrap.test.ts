import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { Context } from '@deepseek-ai/cordis';
import * as bootstrap from '../src/host/cloud/bootstrap.ts';

test('cloud bootstrap closes retained sockets and drains authorization on unload',async()=>{
 const previous=process.env.IPOLLO_CLOUD_RUNTIME_TOKEN;
 process.env.IPOLLO_CLOUD_RUNTIME_TOKEN='fixture';
 const server=createServer((_req,res)=>res.end('{}'));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert(address&&typeof address!=='string');
 const ctx=new Context();
 const sockets:PassThrough[]=[];
 try{
  ctx.provide('webServer',{});
  ctx.provide('agents',{list:()=>[]});
  ctx.provide('sessionController',{});
  ctx.provide('workspaceRegistry',{create:async()=>({id:'workspace',sessionIds:['session']})});
  const fiber=ctx.plugin(bootstrap,{accountOrigin:`http://127.0.0.1:${address.port}`});
  await fiber;
  // The official transport supplies these values; the listener only uses the socket.
  const socket=new PassThrough();sockets.push(socket);
  await ctx.waterfall('webserver/upgrade',{} as never,socket,Buffer.alloc(0),undefined,async()=>{});
  assert.equal(socket.listenerCount('data'),1);
  await fiber.dispose();
  assert.equal(socket.destroyed,true);
  assert.equal(socket.listenerCount('data'),0);
 }finally{
  for(const socket of sockets)socket.destroy();
  await ctx.fiber.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  if(previous===undefined)delete process.env.IPOLLO_CLOUD_RUNTIME_TOKEN;else process.env.IPOLLO_CLOUD_RUNTIME_TOKEN=previous;
 }
});
