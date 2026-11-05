import { describe, expect, test } from "bun:test";

import { StdioJsonRpcProcess } from "./stdio-json-rpc-runtime.js";

const FIXTURE = String.raw`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  if (message.method === "emit") {
    process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "thread-1" } }) + "\n");
    process.stdout.write(JSON.stringify({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1" } }) + "\n");
    process.stdout.write(JSON.stringify({ id: message.id, result: { emitted: true } }) + "\n");
  }
});
`;

describe("stdio JSON-RPC runtime", () => {
  test("multiplexes responses, notifications, and server requests over one hidden process", async () => {
    const runtime = new StdioJsonRpcProcess({
      name: "fixture",
      command: process.execPath,
      args: ["-e", FIXTURE],
      cwd: process.cwd(),
      env: process.env,
    });
    const events: unknown[] = [];
    const unsubscribe = runtime.subscribe((event) => events.push(event));
    try {
      expect(await runtime.call<{ ready: boolean }>("initialize", {})).toEqual({ ready: true });
      expect(await runtime.call<{ emitted: boolean }>("emit", {})).toEqual({ emitted: true });
      expect(events).toEqual([
        { type: "notification", method: "turn/started", params: { threadId: "thread-1" } },
        {
          type: "request",
          id: "approval-1",
          method: "item/commandExecution/requestApproval",
          params: { threadId: "thread-1" },
        },
      ]);
    } finally {
      unsubscribe();
      await runtime.close();
    }
  });
});
