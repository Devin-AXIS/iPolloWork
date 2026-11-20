import test from "node:test";
import assert from "node:assert/strict";
import { fetchChatWithRateLimitRecovery } from "../src/chat-rate-limit.js";

test("explicit chat rate limits recover with the same payload and release rejected bodies", async () => {
  let calls = 0, cancelled = 0;
  const init = {method:"POST",body:'{"model":"fixture"}',signal:new AbortController().signal};
  const response = await fetchChatWithRateLimitRecovery(async (_url, options) => {
    assert.equal(options, init);
    calls++;
    return calls < 3 ? new Response(new ReadableStream({cancel(){cancelled++;}}),{status:429,headers:{"retry-after":"0"}}) : new Response("OK");
  }, "https://provider.test/chat/completions", init, true);
  assert.equal(await response.text(),"OK");
  assert.equal(calls,3);
  assert.equal(cancelled,2);
});

test("rate limits remain bounded, respect long cooldowns and do not replay other operations", async () => {
  for (const [status,retry,header,expected] of [[429,true,"0",3],[429,true,"60",1],[429,false,"0",1],[400,true,"0",1],[503,true,"0",1]] as const) {
    let calls=0;
    const response=await fetchChatWithRateLimitRecovery(async()=>{calls++;return new Response("rejected",{status,headers:{"retry-after":header}});},"https://provider.test",{},retry);
    assert.equal(response.status,status);
    assert.equal(calls,expected);
    await response.body?.cancel();
  }
});

test("cancellation and uncertain transport outcomes never cause another upstream call",async()=>{
  const controller=new AbortController();
  let calls=0;
  await assert.rejects(fetchChatWithRateLimitRecovery(async()=>{calls++;controller.abort();return new Response("busy",{status:429});},"https://provider.test",{signal:controller.signal},true),{code:"SERVICE_RATE_LIMITED"});
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(fetchChatWithRateLimitRecovery(async()=>{calls++;throw new TypeError("fetch failed");},"https://provider.test",{},true));
  assert.equal(calls,1);
});
