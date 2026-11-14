/** Shared IAM credentials retain separate hosts, speech usage and operator model choices. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createService } from "../src/app.js";
import { ExecutionService } from "../src/execution.js";
import { ledgerEntry, wallet } from "../src/domain.js";
import { reserveUsage, usageCost } from "../src/pricing.js";
import { parseArkModels } from "../src/ark-models.js";
import { testConfig } from "./database.js";

test("one IAM key serves native speech, audio and embedding without moving provider hosts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ipw-volc-services-"));
  const app = await createService(await testConfig({ DATA_DIR: dir }));
  try {
    const { user } = await app.auth.api.signUpEmail({ body: { email: "volc@example.test", name: "Volc", password: "Volc-fixture-password" } });
    const actor = { ...user, role: "admin" };
    let polls=0;
    const executor = new ExecutionService(app.store, app.settings, async (url,init) => {
      const headers=new Headers(init?.headers),path=new URL(String(url)).pathname;
      if(path.endsWith("/models"))return Response.json({object:"list",data:[{id:"future-voice",name:"Future voice",domain:"Audio"},{id:"future-language",domain:"LLM",token_limits:{context_window:32768,max_output_token_length:4096}}]});
      const body=JSON.parse(String(init?.body));
      if(path.includes("/embeddings")) {
        assert.equal(headers.get("Authorization"),"Bearer shared-fixture-key");
        return Response.json({data:{embedding:[0,1]},usage:{prompt_tokens:30,prompt_tokens_details:{image_tokens:20},total_tokens:30}});
      }
      assert.equal(new URL(String(url)).origin,"https://openspeech.bytedance.com");
      assert.equal(headers.get("X-Api-Key"),"shared-fixture-key");
      assert.equal(headers.has("Authorization"),false);
      if(path.endsWith("/tts/create")) {
        assert.equal(body.model,"seed-audio-1.0");
        return Response.json({original_duration:82.8,duration:41.4,audio:"AA=="});
      }
      assert.equal(body.model,undefined);
      if(path.endsWith("/sse")) {
        assert.equal(headers.get("X-Api-Resource-Id"),"seed-tts-2.0");
        assert.equal(headers.get("X-Control-Require-Usage-Tokens-Return"),"text_words");
        return new Response('data: {"code":0,"data":"AA=="}\n\ndata: {"code":20000000,"usage":{"text_words":3}}\n\n',{headers:{"Content-Type":"text/event-stream"}});
      }
      assert.equal(headers.get("X-Api-Sequence"),"-1");
      if(path.endsWith("/submit"))return Response.json({task_id:"asr-task"},{headers:{"X-Api-Status-Code":"20000000"}});
      if(path.endsWith("/query")) {
        assert.equal(headers.get("X-Api-Request-Id"),"asr-task");
        assert.equal(headers.get("X-Api-Resource-Id"),"volc.seedasr.auc");
        assert.equal(body.task_id,undefined);
        if(polls++===0)return Response.json({}, {headers:{"X-Api-Status-Code":"20000001"}});
      }
      return Response.json({audio_info:{duration:6312},result:{text:"hello"}},{headers:{"X-Api-Status-Code":"20000000"}});
    });
    await executor.connection(actor,"volcengine-video",{key:"shared-fixture-key",enabled:true});
    await assert.rejects(executor.connection(actor,"volcengine-video",{origin:"https://proxy.example.test"}),{code:"INVALID_INPUT"});
    const stored = await app.store.one("SELECT plan_ids FROM execution_services WHERE id=?", "official-volcengine-image");
    const legacy = JSON.parse(String(stored!.plan_ids));
    for (const rate of legacy.billing.rates) { if (!rate.freeInputUnits) delete rate.freeInputUnits; delete rate.audioInputPerMillion; }
    await app.store.run("UPDATE execution_services SET plan_ids=? WHERE id=?", JSON.stringify(legacy), "official-volcengine-image");
    const catalog=await executor.admin(actor);
    assert.equal(catalog.items.find(s=>s.id==="official-volcengine-image")!.billing!.rates[0].freeInputUnits,0);
    assert(catalog.items.some(s=>s.id==="official-volcengine-chat" && s.enabled));
    assert.equal(catalog.items.find(s=>s.id==="official-volcengine-tool")?.enabled,false);
    assert.equal(catalog.items.filter(s=>s.provider==="volcengine-video").every(s=>s.configured),true);
    await app.store.transaction(()=>ledgerEntry(app.store,user.id,100000,"grant","Fixture"));
    const call=async(id:string,path:string,body:unknown)=>{ const response=await executor.invoke(actor,id,{requestId:randomUUID(),method:"POST",path,contentType:"application/json",body:Buffer.from(JSON.stringify(body)).toString("base64")});return response.text(); };
    await call("official-volcengine-speech","/api/v3/tts/unidirectional/sse",{model:"seed-tts-2.0",req_params:{text:"你好。",speaker:"zh_female_vv_uranus_bigtts"}});
    await call("official-volcengine-transcription","/api/v3/auc/bigmodel/recognize/flash",{model:"volc.bigasr.auc_turbo",audio:{url:"https://example.test/audio.wav"},request:{model_name:"bigmodel"}});
    await call("official-volcengine-transcription-file","/api/v3/auc/bigmodel/submit",{model:"volc.seedasr.auc",audio:{url:"https://example.test/audio.wav"}});
    await call("official-volcengine-transcription-file","/api/v3/auc/bigmodel/query",{task_id:"asr-task"});
    await call("official-volcengine-transcription-file","/api/v3/auc/bigmodel/query",{task_id:"asr-task"});
    await call("official-volcengine-audio","/api/v3/tts/create",{model:"seed-audio-1.0",text_prompt:"Ocean"});
    await call("official-volcengine-embedding","/embeddings/multimodal",{model:"doubao-embedding-vision-251215",input:[{type:"text",text:"hello"}]});
    assert.equal((await wallet(app.store,user.id)).balance,98614);
    const chat=catalog.items.find(s=>s.id==="official-volcengine-chat")!;
    const embeddings=catalog.items.find(s=>s.id==="official-volcengine-embedding")!;
    const videoEmbedding=reserveUsage(embeddings.billing!,{model:"doubao-embedding-vision-251215",input:[{type:"video_url",video_url:{url:"https://example.test/input.mp4"}}]});
    assert.equal(videoEmbedding.micros,235930);
    const image=catalog.items.find(s=>s.id==="official-volcengine-image")!;
    const layers=reserveUsage(image.billing!,{model:"doubao-seedream-5-0-pro-260628",image:["one","two"],size:"1K",layer_decomposition:true});
    assert.equal(usageCost(layers,{data:[{size:"1024x1024"}],usage:{generated_images:1,input_images:2}}),170000);
    const audio=reserveUsage(chat.billing!,{model:"doubao-seed-2-1-lite-260915",messages:[{role:"user",content:[{type:"input_audio",input_audio:{url:"https://example.test/audio.wav"}}]}],max_tokens:10});
    assert.equal(usageCost(audio,{usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{audio_tokens:80,cached_tokens:40,audio_cached_tokens:30}}}),709);
    const before=chat.models[0];
    const {configured:_configured,...draft}=chat;
    await executor.save(actor,{...draft,models:chat.models.map(m=>m.id===before.id?{...m,name:"Operator choice"}:m)});
    const sync=await executor.syncModels(actor,"official-volcengine-speech");
    assert.equal(sync.total,2);assert.equal(sync.unpriced,2);
    const after=await executor.admin(actor);
    assert.equal(after.items.find(s=>s.id===chat.id)?.models[0].name,"Operator choice");
    assert.equal(after.items.find(s=>s.id===chat.id)?.models.find(m=>m.id==="future-language")?.enabled,false);
  } finally { await app.close(); await rm(dir,{recursive:true,force:true}); }
});

test("Ark discovery rejects duplicate IDs and never invents a protocol for new domains",()=>{
  assert.throws(()=>parseArkModels({object:"list",data:[{id:"same",domain:"LLM"},{id:"same",domain:"Audio"}]}),{code:"SERVICE_DISCOVERY_INCOMPLETE"});
  assert.equal(parseArkModels({object:"list",data:[{id:"new-3d",domain:"3DGeneration"}]}).items[0].operation,"tool");
});
