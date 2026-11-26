import test from "node:test";
import assert from "node:assert/strict";
import { readModelResponse, recoverModelRequest } from "../src/host/model-request-recovery.ts";
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
  }, new AbortController().signal, async()=>{}), { code: "SERVICE_CALL_RUNNING" });
  assert.equal(calls, 6);
});

test('malformed gateway responses and restart admission recover using the same invocation without starting a new model request',async()=>{
  const ids:string[]=[],waits:number[]=[];
  const failures=['IPW_INVALID_RESPONSE','SERVICE_DRAINING','SERVICE_BUSY','SERVICE_QUEUE_TIMEOUT'];
  const response=await recoverModelRequest(async()=>{
    ids.push('original-request');
    const failure=failures.shift();
    if(failure)throw new SuiteError(failure,503);
    return new Response('persisted completion');
  },new AbortController().signal,async milliseconds=>{waits.push(milliseconds);});
  assert.equal(await response.text(),'persisted completion');
  assert.deepEqual(ids,Array(5).fill('original-request'));
  assert.deepEqual(waits,[500,1000,2000,4000]);
});

test("rejections, unknown outcomes and programming errors never start another request", async () => {
  for (const error of [new SuiteError("SERVICE_UPSTREAM_REJECTED", 503), new SuiteError("SERVICE_OUTCOME_UNKNOWN", 503), new SuiteError("INSUFFICIENT_POINTS", 409), new SuiteError("IPW_ACCOUNT_CHANGED", 409), new TypeError("Invalid model configuration")]) {
    let calls = 0;
    await assert.rejects(recoverModelRequest(async () => { calls++; throw error; }, new AbortController().signal), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test("interrupted streams stop on unknown results, mismatched output or user cancellation", async () => {
  const headers = { "content-type": "text/event-stream", "x-ipollo-call-id": "invocation" };
  for (const scenario of ["unknown", "mismatch", "cancel", "unidentified"] as const) {
    let calls = 0;
    let reads = 0;
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ pull(stream) {
      if (reads++ === 0) stream.enqueue(new TextEncoder().encode("partial output"));
      else stream.error(new TypeError("terminated"));
    } }), { headers: scenario === "unidentified" ? { "content-type": "text/event-stream" } : headers });
    const stream = readModelResponse(response, "invocation", async () => {
      calls++;
      if (scenario === "unknown") throw new SuiteError("SERVICE_CALL_UNKNOWN", 409);
      return new Response("different output", { headers });
    }, controller.signal);
    assert.equal(new TextDecoder().decode((await stream.next()).value), "partial output");
    if (scenario === "cancel") controller.abort();
    const expected = {
      unknown: { code: "SERVICE_CALL_UNKNOWN" }, mismatch: { code: "IPW_MODEL_REPLAY_MISMATCH" },
      cancel: { name: "AbortError" }, unidentified: /terminated/,
    };
    await assert.rejects(stream.next(), expected[scenario]);
    assert.equal(calls, scenario === "cancel" || scenario === "unidentified" ? 0 : 1);
  }
});
