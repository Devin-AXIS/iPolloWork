import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexHistoryReader, projectCodexHistory } from "./codex-harness-history.js";
const roots: string[] = [];
afterEach(async()=>{for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true});});
const row=(type:string,payload:unknown)=>JSON.stringify({type,payload});
const turn=(id:string)=>row("event_msg",{type:"task_started",turn_id:id});
const call=(id:string,name:string,args:unknown)=>row("response_item",{type:"function_call",call_id:id,name,arguments:JSON.stringify(args)});
const output=(id:string,value:unknown)=>row("response_item",{type:"function_call_output",call_id:id,output:typeof value==='string'?value:JSON.stringify(value)});

test("native plans require a successful output in the same turn, including legitimate clearing",()=>{
 const history=[turn("one"),call("a","update_plan",{plan:[{step:"A",status:"completed"}]}),output("a","Plan updated"),
 call("b","update_plan",{plan:[]}),output("b","Plan updated"),turn("two")];
 expect(projectCodexHistory(history,"thread").map(t=>({id:t.id,plan:t.plan}))).toEqual([{id:"one",plan:[]},{id:"two",plan:undefined}]);
 expect(projectCodexHistory([...history,call("c","update_plan",{plan:[{step:"B",status:"pending"}]}),output("c","Plan updated")],"thread")[1]?.plan).toEqual([{step:"B",status:"pending"}]);
});

test("failed, pending, malformed, foreign-turn and duplicate outputs cannot overwrite valid progress",()=>{
 const history=[turn("one"),call("a","update_plan",{plan:[{step:"A",status:"in_progress"}]}),output("a","Plan updated"),
 call("b","update_plan",{plan:[]}),output("b",{error:"rejected"}),output("a","Plan updated"),
 call("c","update_plan",{plan:[{step:"Bad",status:"invalid"}]}),output("c","Plan updated"),'{broken',
 call("late","update_plan",{plan:[]}),turn("two"),output("late","Plan updated")];
 const data=projectCodexHistory(history,"thread");
 expect(data[0]?.plan).toEqual([{step:"A",status:"inProgress"}]);expect(data[1]?.plan).toBeUndefined();
});

test("native plan replacements may add, delete, reorder and reduce completed counts",()=>{
 const plans=[[{step:"A",status:"completed"}],[{step:"B",status:"pending"},{step:"A",status:"in_progress"}],[{step:"B",status:"completed"}]];
 const history=[turn("one")];for(const [index,plan] of plans.entries())history.push(call(String(index),"update_plan",{plan}),output(String(index),"Plan updated"));
 expect(projectCodexHistory(history,"thread")[0]?.plan).toEqual(plans.at(-1));
});

test("same text messages retain distinct native identities and ordering",()=>{
 const data=projectCodexHistory([turn("one"),row("response_item",{type:"message",role:"assistant",id:"a",content:[{text:"same"}]}),row("response_item",{type:"message",role:"assistant",id:"b",content:[{text:"same"}]})],"thread");
 expect(data[0]?.agentMessageIds).toEqual(["a","b"]);expect(data[0]?.order).toEqual(["a","b"]);
});

test("collaboration preserves native call/child ownership and completed or failed child state",()=>{
 const data=projectCodexHistory([turn("one"),call("spawn","spawn_agent",{message:"work"}),output("spawn",{agent_id:"child"}),
 call("send","send_input",{id:"child",message:"continue"}),output("send",{submission_id:"s"}),
 call("wait","wait_agent",{ids:["child","other"]}),output("wait",{status:{child:{completed:"ok"},other:{errored:"failed"}},timed_out:false})],"parent")[0];
 expect(data?.calls.map(c=>({id:c.id,tool:c.tool,parent:c.senderThreadId}))).toEqual([{id:"spawn",tool:"spawnAgent",parent:"parent"},{id:"send",tool:"sendInput",parent:"parent"},{id:"wait",tool:"wait",parent:"parent"}]);
 expect(data?.calls[0]?.agentsStates?.child).toEqual({status:"completed",message:"ok"});expect(data?.calls[2]?.agentsStates?.other).toEqual({status:"errored",message:"failed"});
});

test("failed creation and native shutdown are not fabricated as completed child execution",()=>{
 const data=projectCodexHistory([turn("one"),call("spawn","spawn_agent",{}),output("spawn",{error:"rejected"}),call("close","close_agent",{id:"child"}),output("close",{status:{shutdown:"stopped"}})],"parent")[0];
 expect(data?.calls[0]).toMatchObject({status:"failed",receiverThreadIds:[]});expect(data?.calls[1]?.agentsStates?.child).toEqual({status:"interrupted",message:"stopped"});
});

test("reader is confined to the independent home, checks session ownership and invalidates appended records",async()=>{
 const root=await mkdtemp(join(tmpdir(),"ipollowork-codex-history-"));roots.push(root);const home=join(root,"home");await mkdir(home);const path=join(home,"rollout.jsonl");
 const lines=[row("session_meta",{id:"thread"}),turn("one"),call("a","update_plan",{plan:[{step:"A",status:"pending"}]}),output("a","Plan updated")];
 await writeFile(path,lines.join('\n')+'\n');const reader=new CodexHistoryReader();expect((await reader.read(home,path,"thread"))[0]?.plan).toHaveLength(1);expect(await reader.read(home,path,"other")).toEqual([]);
 await writeFile(path,[...lines,call("b","update_plan",{plan:[]}),output("b","Plan updated")].join('\n')+'\n');expect((await reader.read(home,path,"thread"))[0]?.plan).toEqual([]);
 const outside=join(root,"personal.jsonl");await writeFile(outside,lines.join('\n'));await expect(reader.read(home,outside,"thread")).rejects.toThrow("escapes");
 await symlink(outside,join(home,"escape.jsonl"));await expect(reader.read(home,join(home,"escape.jsonl"),"thread")).rejects.toThrow("escapes");
});

const padding = row("response_item", { type: "function_call_output", call_id: "large-output", output: "x".repeat(8 * 1024 * 1024) });
async function longRollout(lines: string[]) {
  const home = await mkdtemp(join(tmpdir(), "ipollowork-codex-long-history-"));
  roots.push(home);
  const path = join(home, "rollout.jsonl");
  await writeFile(path, [row("session_meta", { id: "thread" }), ...lines].join("\n") + "\n");
  return { home, path };
}

test("cold readers recover the current plan before outputs larger than the former tail limit", async () => {
  const { home, path } = await longRollout([
    turn("current"), call("plan", "update_plan", { plan: [{ step: "Long task", status: "in_progress" }] }),
    output("plan", "Plan updated"), padding, row("event_msg", { type: "token_count" }),
  ]);
  for (let i = 0; i < 2; i++) {
    expect((await new CodexHistoryReader().read(home, path, "thread")).at(-1)).toMatchObject({
      id: "current", plan: [{ step: "Long task", status: "inProgress" }],
    });
  }
});

test("long history keeps successful clearing, rejects failed replacements and never inherits old plans", async () => {
  const prefix = [turn("old"), call("old-plan", "update_plan", { plan: [{ step: "Old", status: "completed" }] }), output("old-plan", "Plan updated")];
  const current = [turn("current"), call("new-plan", "update_plan", { plan: [{ step: "Current", status: "pending" }] }), output("new-plan", "Plan updated")];
  const scenarios = [
    { records: [...prefix, ...current, padding, call("failed", "update_plan", { plan: [] }), output("failed", { error: "rejected" })], expected: [{ step: "Current", status: "pending" }] },
    { records: [...prefix, ...current, call("clear", "update_plan", { plan: [] }), output("clear", "Plan updated"), padding], expected: [] },
    { records: [...prefix, padding, turn("current")], expected: undefined },
  ];
  for (const { records, expected } of scenarios) {
    const { home, path } = await longRollout(records);
    const latest = (await new CodexHistoryReader().read(home, path, "thread")).at(-1);
    expect(latest?.id).toBe("current");
    expect(latest?.plan).toEqual(expected);
  }
});

test("native custom tool call identities participate in chronological ordering", () => {
  const data = projectCodexHistory([turn("one"),
    row("event_msg", { type: "user_message" }),
    row("response_item", { type: "message", role: "assistant", id: "before", content: [{ text: "Editing" }] }),
    row("response_item", { type: "custom_tool_call", call_id: "patch", name: "apply_patch", input: "patch data" }),
    row("response_item", { type: "custom_tool_call_output", call_id: "patch", output: "Success" }),
    row("response_item", { type: "message", role: "assistant", id: "final", content: [{ text: "Done" }] }),
  ], "thread");
  expect(data[0]?.order).toEqual(["user:0", "before", "patch", "final"]);
});


test("appended long output cannot hide a cached plan or revive it after clear and a new turn", async () => {
  const { home, path } = await longRollout([
    turn("current"), call("plan", "update_plan", { plan: [{ step: "Work", status: "in_progress" }] }), output("plan", "Plan updated"),
  ]);
  const reader = new CodexHistoryReader();
  expect((await reader.read(home, path, "thread")).at(-1)?.plan).toHaveLength(1);
  await appendFile(path, padding + "\n");
  expect((await reader.read(home, path, "thread")).at(-1)?.plan).toEqual([{ step: "Work", status: "inProgress" }]);
  await appendFile(path, [call("clear", "update_plan", { plan: [] }), output("clear", "Plan updated")].join("\n") + "\n");
  expect((await reader.read(home, path, "thread")).at(-1)?.plan).toEqual([]);
  expect((await new CodexHistoryReader().read(home, path, "thread")).at(-1)?.plan).toEqual([]);
  await appendFile(path, turn("next") + "\n");
  expect((await new CodexHistoryReader().read(home, path, "thread")).at(-1)).toMatchObject({ id: "next" });
  expect((await reader.read(home, path, "thread")).at(-1)?.plan).toBeUndefined();
});
