// Deterministic upstream protocol for server regression tests and UI proof.
// No model/network calls; reproduce the empty-thread list_turns rejection.
const readline = require("node:readline");
const used = new Set();
const reads = [];
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line), p = m.params || {};
  if (!m.id) return;
  const send = result => process.stdout.write(JSON.stringify({ id: m.id, result }) + "\n");
  const fail = message => process.stdout.write(JSON.stringify({ id: m.id, error: { code: -32601, message } }) + "\n");
  const thread = { id: p.threadId || p.name, name: "AI 热点拆解", modelProvider: "test", model: "test", turns: [] };
  if (m.method === "thread/start" || m.method === "thread/resume") { send({ thread, modelProvider: "test", model: "test" }); return; }
  if (m.method === "turn/start") { used.add(p.threadId); if (p.fail) fail("Ambiguous first send"); else send({ turn: { id: "first" } }); return; }
  if (m.method === "test/notify") {
    used.add(p.threadId);
    process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: p.threadId } }) + "\n");
    send({}); return;
  }
  if (m.method === "thread/read") {
    reads.push({ threadId: p.threadId, includeTurns: p.includeTurns });
    if (p.includeTurns && !used.has(p.threadId)) { fail("list_turns is not supported yet"); return; }
    if (p.includeTurns) thread.turns = [{ id: "first", status: "completed", items: [{ id: "input", type: "userMessage", content: [{ type: "text", text: "新品发布预告" }] }, { id: "answer", type: "agentMessage", text: "视频创作需求已收到（模拟回复）" }] }];
    if (!p.includeTurns && p.threadId === "race") setTimeout(() => send({ thread }), 100);
    else send({ thread });
    return;
  }
  if (m.method === "test/witness") { send({ reads }); return; }
  send({});
});
