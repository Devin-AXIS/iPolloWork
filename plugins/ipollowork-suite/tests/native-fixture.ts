/** Test-only local adapter and driver, loaded only through the isolated QA profile. */
import {
  LlmAdapter,
  ToolCallId,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import type {
  GenerateOptions,
  LlmResolvedModelInfo,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { setTimeout } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
interface FixtureContext {
  llm: { registerAdapter(names: string[], adapter: LlmAdapter): unknown };
  effect(setup: () => () => void, label?: string): unknown;
  webServer: {
    register(route: {
      kind: "prefix";
      path: string;
      handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
    }): () => void;
  };
  connection: {
    admit(req: IncomingMessage): { rejection: number } | { peer: object };
  };
  workspaceRegistry: {
    create(
      path: string,
      title?: string,
    ): Promise<{ id: string; title: string; path: string }>;
  };
  sessionController: {
    create(req: {
      workspaceId: string;
      agentPreset: string;
    }): Promise<{ sessionId: string; agentPreset?: string }>;
  };
  agents: { get(id: string): Agent | undefined };
  subagents: {
    waitForTreeWork(agent: Agent): Promise<boolean>;
    listDescendants(id: string): Promise<unknown[]>;
  };
  credentials: { set(ref: string, value: string): Promise<void> };
  mcpManager: {
    register(
      name: string,
      entry: {
        transport: "streamable-http";
        url: string;
        headers: Record<string, string>;
      },
    ): () => void;
    list(): { name: string; status: { state: string } }[];
  };
}

const requests: { messages: unknown; tools: string[]; model: string }[] = [];

class FixtureAdapter extends LlmAdapter {
  async listModels(provider: string) {
    return [
      { provider, id: "fixture", name: "Fixture default" },
      { provider, id: "fixed", name: "Fixture fixed model" },
    ];
  }
  async resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model };
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    requests.push({
      messages: structuredClone(options.messages),
      tools: (options.tools ?? []).map((tool) => tool.name),
      model: options.model,
    });
    const body = JSON.stringify(options.messages);
    if (body.includes("TRUNCATE_ONCE") && !body.includes("ipollowork-output-continuation")) {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: "Saved partial work." };
      yield { type: "block-end", index: 0, block: { type: "text", text: "Saved partial work." } };
      yield { type: "finish", reason: { kind: "max-tokens" } };
      return;
    }
    if (
      body.includes("ARCHIVE_NATIVE_OUTPUT") &&
      !options.messages.some((message) => message.role === "tool")
    ) {
      const id = ToolCallId("native-output");
      const args = JSON.stringify({
        files: [{ path: "result.html", description: "Native output fixture" }],
      });
      yield { type: "block-start", index: 0, blockType: "tool-call" };
      yield {
        type: "tool-call-delta",
        index: 0,
        id,
        name: "present",
        argumentsDelta: args,
      };
      yield {
        type: "block-end",
        index: 0,
        block: { type: "tool-call", id, name: "present", arguments: args },
      };
      yield { type: "finish", reason: { kind: "tool-calls" } };
      return;
    }
    if (
      body.includes("DELEGATE_TWO") &&
      !options.messages.some((message) => message.role === "tool")
    ) {
      const tool = options.tools?.find(
        (item) => item.name === "ipollo_delegate",
      );
      const choices =
        (
          tool?.parameters as {
            properties?: { agent_preset?: { enum?: string[] } };
          }
        )?.properties?.agent_preset?.enum ?? [];
      if (choices.length < 2)
        throw new Error("Expected two native iPollo delegation choices");
      for (const [index, choice] of choices.slice(0, 2).entries()) {
        const args = JSON.stringify({
          name: `specialist-${index}`,
          description: `Verify specialist ${index}`,
          prompt: "VERIFY_CHILD",
          agent_preset: choice,
        });
        const id = ToolCallId(`ipollo-call-${index}`);
        yield { type: "block-start", index, blockType: "tool-call" };
        yield {
          type: "tool-call-delta",
          index,
          id,
          name: "ipollo_delegate",
          argumentsDelta: args,
        };
        yield {
          type: "block-end",
          index,
          block: {
            type: "tool-call",
            id,
            name: "ipollo_delegate",
            arguments: args,
          },
        };
      }
      yield { type: "finish", reason: { kind: "tool-calls" } };
      return;
    }
    const text = "IPOLLO_NATIVE_VERIFIED";
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

export const name = "ipollo-native-fixture";
export const inject = [
  "webServer",
  "connection",
  "connection.authentication",
  "llm",
  "agents",
  "sessionController",
  "workspaceRegistry",
  "subagents",
  "mcpManager",
  "credentials",
];

/** Attach local test control operations; this file is excluded from the distributable package. */
export function apply(ctx: FixtureContext): void {
  ctx.llm.registerAdapter(["ipollo-fixture"], new FixtureAdapter());
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/ipollo-fixture",
      handler: async (request, response) => {
        const admission = ctx.connection.admit(request);
        if ("rejection" in admission) {
          response.writeHead(admission.rejection);
          response.end();
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          let value: unknown;
          if (request.url?.endsWith("/project")) {
            const project = await ctx.workspaceRegistry.create(
              input.path,
              input.title,
            );
            value = {
              id: project.id,
              title: project.title,
              path: project.path,
            };
          } else if (request.url?.endsWith("/service")) {
            await ctx.credentials.set(
              "IPOLLO_TEST_SHARED",
              "ipollo-test-credential",
            );
            ctx.effect(() =>
              ctx.mcpManager.register("shared", {
                transport: "streamable-http",
                url: input.url,
                headers: {
                  Authorization: "Bearer ${credential:IPOLLO_TEST_SHARED}",
                },
              }),
            );
            const deadline = Date.now() + 10000;
            while (
              ctx.mcpManager.list().find((item) => item.name === "shared")
                ?.status.state !== "connected"
            ) {
              if (Date.now() > deadline)
                throw new Error("Shared service did not connect");
              await setTimeout(10);
            }
            value = { name: "shared" };
          } else if (request.url?.endsWith("/run")) {
            requests.length = 0;
            const created = await ctx.sessionController.create({
              workspaceId: input.projectId,
              agentPreset: input.agentPreset,
            });
            const agent = ctx.agents.get(created.sessionId)!;
            if (input.prompt === "ARCHIVE_NATIVE_OUTPUT")
              await writeFile(
                join(agent.session.header.cwd!, "result.html"),
                "<!doctype html><title>Native output</title><h1>Saved by DSH</h1>",
              );
            if (!input.keepModel)
              agent.model.select({
                provider: "ipollo-fixture",
                model: "fixture",
              });
            agent.followup(
              createUserMessage({
                content: [{ type: "text", text: input.prompt }],
                source: { kind: "user" },
              }),
            );
            do {
              await agent.whenIdle();
            } while (await ctx.subagents.waitForTreeWork(agent));
            await agent.whenIdle();
            value = {
              ...created,
              requests: [...requests],
              children: await ctx.subagents.listDescendants(agent.id),
              presented: agent.session
                .snapshotEvents()
                .filter(
                  (event: { type: string }) =>
                    event.type === "deliverables/presented",
                ).length,
              continuations: agent.session.snapshotEvents().filter(event => event.type === "user/message"
                && event.data.source.kind === "ipollowork-output-continuation").length,
            };
          } else value = { requests };
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(value));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: String(error) }));
        }
      },
    }),
  );
}
