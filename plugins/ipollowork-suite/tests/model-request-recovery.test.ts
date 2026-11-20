import test from "node:test";
import assert from "node:assert/strict";
import { recoverModelRequest } from "../src/host/model-request-recovery.ts";
import { SuiteError } from "../src/host/errors.ts";

test("a lost gateway connection replays the same invocation until its saved response is ready", async () => {
  const requestId = "fixed-invocation";
  const ids: string[] = [];
  const response = await recoverModelRequest(async () => {
    ids.push(requestId);
    if (ids.length === 1) throw new TypeError("fetch failed");
    if (ids.length === 2) throw new SuiteError("SERVICE_CALL_RUNNING", 409);
    return new Response("saved response");
  }, new AbortController().signal);
  assert.equal(await response.text(), "saved response");
  assert.deepEqual(ids, [requestId, requestId, requestId]);
});

test("gateway recovery is bounded and stops on cancellation", async () => {
  let calls = 0;
  await assert.rejects(recoverModelRequest(async () => {
    calls++;
    throw new TypeError("fetch failed");
  }, AbortSignal.timeout(20)), { name: "AbortError" });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(recoverModelRequest(async () => {
    calls++;
    throw new SuiteError("SERVICE_CALL_RUNNING", 409);
  }, new AbortController().signal), { code: "SERVICE_CALL_RUNNING" });
  assert.equal(calls, 4);
});

test("rejections, unknown outcomes and programming errors never start another request", async () => {
  for (const error of [new SuiteError("SERVICE_UPSTREAM_REJECTED", 503), new SuiteError("SERVICE_OUTCOME_UNKNOWN", 503), new SuiteError("INSUFFICIENT_POINTS", 409), new SuiteError("IPW_ACCOUNT_CHANGED", 409), new TypeError("Invalid model configuration")]) {
    let calls = 0;
    await assert.rejects(recoverModelRequest(async () => { calls++; throw error; }, new AbortController().signal), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test("an interrupted response stream is not replayed after output has begun", async () => {
  let calls=0, reads=0;
  const response=await recoverModelRequest(async()=>{
    calls++;
    return new Response(new ReadableStream({pull(controller){
      if(reads++===0) controller.enqueue(new TextEncoder().encode("partial output"));
      else controller.error(new TypeError("fetch failed"));
    }}));
  },new AbortController().signal);
  await assert.rejects(response.text(),/fetch failed/);
  assert.equal(calls,1);
});
