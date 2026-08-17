/**
 * Create a session, send a prompt, and stream the reply as it is generated.
 *
 * Run:
 *   export IPOLLOWORK_BASE_URL=http://127.0.0.1:8787
 *   export IPOLLOWORK_TOKEN=<client token>
 *   node --experimental-strip-types examples/public-api/01-stream-session.ts
 */

import { IPolloWorkClient } from "@ipollowork/api-sdk";

const client = new IPolloWorkClient({
  baseUrl: process.env.IPOLLOWORK_BASE_URL ?? "http://127.0.0.1:8787",
  token: process.env.IPOLLOWORK_TOKEN,
});

const { items: workspaces } = await client.listWorkspaces();
const workspace = workspaces[0];
if (!workspace) throw new Error("No workspace configured on this server");

console.log(`workspace: ${workspace.id}`);

const { session, engine, capabilities } = await client.createSession(workspace.id, { title: "API example" });
console.log(`session:   ${session.id}`);
console.log(`engine:    ${engine} (resumable stream: ${capabilities.resumableStreaming})\n`);

await client.promptText(
  workspace.id,
  session.id,
  "List the files in this project and describe what it does in two sentences.",
);

// `seq` is the durable cursor. Keeping the latest one means a dropped connection can be
// resumed with `{ after: cursor }` instead of replaying the whole session.
let cursor: string | undefined;

for await (const event of client.streamSession(workspace.id, session.id)) {
  cursor = event.seq ?? cursor;

  switch (event.type) {
    case "message.delta":
      // Reasoning deltas arrive on the same channel; only print the answer itself.
      if (event.kind === "text") process.stdout.write(event.delta);
      break;

    case "tool.called":
      console.log(`\n[tool] ${event.tool}`);
      break;

    case "tool.completed":
      console.log(`[tool] ${event.tool} → ${event.status}`);
      break;

    case "session.error":
      console.error(`\nerror: ${event.error.message}`);
      process.exit(1);
      break;

    case "session.idle":
      console.log(`\n\ndone. resume cursor: ${cursor ?? "(none)"}`);
      process.exit(0);
  }
}
