/**
 * Answer tool-permission requests programmatically.
 *
 * With `--approval manual`, the agent stops and asks before each tool use. An API client
 * that ignores those requests will appear to hang: the run is waiting on an answer that
 * never comes. This is the pattern for deciding in code instead — the basis of any
 * unattended integration that still wants a policy tighter than "approve everything".
 *
 * Run:
 *   export IPOLLOWORK_BASE_URL=http://127.0.0.1:8787
 *   export IPOLLOWORK_TOKEN=<client token>
 *   node --experimental-strip-types examples/public-api/02-handle-permissions.ts
 */

import { IPolloWorkClient, type Permission } from "@ipollowork/api-sdk";

const client = new IPolloWorkClient({
  baseUrl: process.env.IPOLLOWORK_BASE_URL ?? "http://127.0.0.1:8787",
  token: process.env.IPOLLOWORK_TOKEN,
});

/**
 * Decide what the agent may do.
 *
 * "once" allows this call, "always" allows it for the rest of the session, and "reject"
 * refuses. Prefer "once" for anything that writes: "always" hands over the rest of the
 * session, and the next request under that grant may not resemble this one.
 */
function decide(permission: Permission): "once" | "always" | "reject" {
  const target = permission.resources.join(" ");

  // Reads anywhere in the workspace are safe to allow for the session.
  if (permission.kind === "read") return "always";

  // Writes are allowed one at a time, and only under src/.
  if (permission.kind === "write" || permission.kind === "edit") {
    return permission.resources.every((resource) => resource.startsWith("src/")) ? "once" : "reject";
  }

  // Shell commands: allow a known-safe read-only command, refuse everything else.
  if (permission.kind === "bash") {
    return /^(git (status|diff|log)|ls|cat|rg|grep)\b/.test(target) ? "once" : "reject";
  }

  // Anything unrecognized is refused — an allowlist fails closed, a denylist does not.
  return "reject";
}

const { items: workspaces } = await client.listWorkspaces();
const workspace = workspaces[0];
if (!workspace) throw new Error("No workspace configured on this server");

const { session } = await client.createSession(workspace.id, { title: "Permission handling" });
console.log(`session: ${session.id}\n`);

await client.promptText(
  workspace.id,
  session.id,
  "Check whether the tests pass, and fix any obvious failure in src/.",
);

for await (const event of client.streamSession(workspace.id, session.id)) {
  switch (event.type) {
    case "permission.asked": {
      const reply = decide(event.permission);
      const target = event.permission.resources.join(", ") || "(no resource)";
      console.log(`[permission] ${event.permission.kind} ${target} → ${reply}`);
      await client.replyPermission(workspace.id, session.id, event.permission.id, reply);
      break;
    }

    case "question.asked": {
      // The agent can also ask the operator a question. Answering with the first option
      // keeps an unattended run moving; a real integration should encode a real choice.
      const answers = event.question.questions.map((question) => [question.options[0]?.label ?? ""]);
      console.log(`[question] ${event.question.questions[0]?.question ?? ""}`);
      await client.replyQuestion(workspace.id, session.id, event.question.id, answers);
      break;
    }

    case "message.delta":
      if (event.kind === "text") process.stdout.write(event.delta);
      break;

    case "session.error":
      console.error(`\nerror: ${event.error.message}`);
      process.exit(1);
      break;

    case "session.idle":
      console.log("\n\ndone.");
      process.exit(0);
  }
}
