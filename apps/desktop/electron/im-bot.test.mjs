import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";

import { createImBot } from "./im-bot.mjs";

function mockMcpEndpoint({ tools }) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    calls.push(body);
    response.setHeader("Content-Type", "application/json");
    if (body.method === "tools/list") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }));
      return;
    }
    if (body.method === "tools/call") {
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "sent" }] },
      }));
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "unknown" } }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

const fakePreviewCore = (summary) => ({
  getPublicSummary: async () => ({ ok: true, summary, actions: [] }),
});

test("pushSummary discovers the send tool and posts a redacted summary", async () => {
  const endpoint = await mockMcpEndpoint({
    tools: [
      { name: "send_message", inputSchema: { properties: { content: { type: "string" } } } },
    ],
  });
  try {
    const bot = createImBot({
      previewCore: fakePreviewCore({ status: "ready", sessionId: "s1", token: "redacted" }),
    });
    const result = await bot.pushSummary({ mcpUrl: endpoint.url });
    assert.equal(result.ok, true);
    assert.equal(result.tool, "send_message");
    const call = endpoint.calls.find((c) => c.method === "tools/call");
    assert.ok(call, "tools/call should have been invoked");
    assert.equal(call.params.name, "send_message");
    assert.match(call.params.arguments.content, /status: ready/);
    assert.match(call.params.arguments.content, /sessionId: s1/);
  } finally {
    await endpoint.close();
  }
});

test("pushSummary picks a matching send tool among candidates", async () => {
  const endpoint = await mockMcpEndpoint({
    tools: [
      { name: "something_else" },
      { name: "messages_send", inputSchema: { properties: { text: { type: "string" } } } },
    ],
  });
  try {
    const bot = createImBot({ previewCore: fakePreviewCore({ status: "idle" }) });
    const result = await bot.pushSummary({ mcpUrl: endpoint.url });
    assert.equal(result.tool, "messages_send");
    const call = endpoint.calls.find((c) => c.method === "tools/call");
    assert.equal(call.params.arguments.text, "status: idle");
  } finally {
    await endpoint.close();
  }
});

test("pushSummary throws when no send tool exists", async () => {
  const endpoint = await mockMcpEndpoint({ tools: [{ name: "other_tool" }] });
  try {
    const bot = createImBot({ previewCore: fakePreviewCore({ status: "idle" }) });
    await assert.rejects(() => bot.pushSummary({ mcpUrl: endpoint.url }), /No send tool found/);
  } finally {
    await endpoint.close();
  }
});

test("pushSummary throws on empty endpoint", async () => {
  const bot = createImBot({ previewCore: fakePreviewCore({ status: "idle" }) });
  await assert.rejects(() => bot.pushSummary({ mcpUrl: "" }), /Missing MCP endpoint/);
});

test("formatSummary includes only scalar fields in order", () => {
  const bot = createImBot({ previewCore: fakePreviewCore({}) });
  const text = bot.formatSummary({ status: "ready", narration: "hi", nested: { a: 1 } });
  assert.match(text, /^status: ready\nnarration: hi$/);
});
