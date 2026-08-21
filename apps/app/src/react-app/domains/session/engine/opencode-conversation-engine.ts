import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { createClient, unwrap } from "@/app/lib/opencode";
import type { Client } from "@/app/types";
import { t } from "@/i18n";
import {
  type ConversationEngineAdapter,
  type ConversationEngineConnection,
  type ConversationPermission,
} from "./conversation-engine";
import {
  isOpenCodeV2Permission as isV2Permission,
  mapOpenCodeConversationEvent as mapEvent,
  mapOpenCodeConversationSnapshot as mapSnapshot,
  mapOpenCodeLegacyPermission as mapLegacyPermission,
  mapOpenCodeQuestion as mapQuestion,
  mapOpenCodeSession as mapSession,
  mapOpenCodeV2Permission as mapV2Permission,
  resolveOpenCodeForkBoundaryId,
} from "./opencode-conversation-mapper";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMethod(value: unknown, name: string) {
  return isRecord(value) && typeof value[name] === "function";
}

function isOpenCodeClient(value: unknown): value is Client {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.session) &&
    hasMethod(value.session, "abort") &&
    hasMethod(value.session, "promptAsync") &&
    isRecord(value.event) &&
    hasMethod(value.event, "subscribe")
  );
}

function openCodeConnection(input: { baseUrl: string; token?: string; directory?: string }): ConversationEngineConnection {
  const client = createClient(input.baseUrl, input.directory, {
    token: input.token,
    mode: "ipollowork",
  });
  if (!isOpenCodeClient(client)) throw new Error("OpenCode conversation client is unavailable");

  return {
    mapSnapshot,
    async subscribe(input) {
      const subscription = await client.event.subscribe(undefined, { signal: input.signal });
      for await (const raw of subscription.stream) {
        if (input.signal.aborted) return;
        const event = mapEvent(raw);
        if (event) input.onEvent(event);
      }
    },
    async listPermissions(input) {
      const receivedAt = Date.now();
      const permissions: ConversationPermission[] = [];
      let readSucceeded = false;
      try {
        permissions.push(
          ...unwrap(await client.permission.list({ directory: input.directory }))
            .map((permission) => mapLegacyPermission(permission, receivedAt)),
        );
        readSucceeded = true;
      } catch {}
      try {
        permissions.push(
          ...unwrap(await client.v2.session.permission.list({ sessionID: input.sessionId })).data
            .map((permission) => mapV2Permission(permission, receivedAt)),
        );
        readSucceeded = true;
      } catch {}
      if (!readSucceeded) throw new Error("Could not read pending permissions");
      return permissions.filter((permission) => permission.sessionId === input.sessionId);
    },
    async replyPermission(input) {
      if (isV2Permission(input.permission.native)) {
        const result = await client.v2.session.permission.reply({
          sessionID: input.permission.sessionId,
          requestID: input.permission.id,
          reply: input.reply,
        });
        if (result.error !== undefined) unwrap(result);
        return;
      }
      unwrap(await client.permission.reply({
        requestID: input.permission.id,
        reply: input.reply,
        directory: input.directory,
      }));
    },
    async listQuestions(input) {
      const receivedAt = Date.now();
      return unwrap(await client.question.list({ directory: input.directory }))
        .filter((question) => question.sessionID === input.sessionId)
        .map((question) => mapQuestion(question, receivedAt));
    },
    async replyQuestion(input) {
      unwrap(await client.question.reply({
        requestID: input.question.id,
        answers: input.answers,
        directory: input.directory,
      }));
    },
    async create(directory) {
      return mapSession(unwrap(await client.session.create({ directory })));
    },
    async abort(sessionId, directory) {
      return unwrap(await client.session.abort({ sessionID: sessionId, directory })) === true;
    },
    async revert(sessionId, messageId) {
      return mapSession(unwrap(await client.session.revert({ sessionID: sessionId, messageID: messageId })));
    },
    async fork(input) {
      return mapSession(unwrap(await client.session.fork({
        sessionID: input.sessionId,
        messageID: resolveOpenCodeForkBoundaryId(input.messages, input.messageId) ?? undefined,
      })));
    },
    async rename(sessionId, title, directory) {
      unwrap(await client.session.update({ sessionID: sessionId, title, directory }));
    },
    async setArchived(sessionId, archived, directory) {
      unwrap(await client.session.update({
        sessionID: sessionId,
        directory,
        time: { archived: archived ? Date.now() : 0 },
      }));
    },
    async shell(sessionId, command) {
      const result = await client.session.shell({ sessionID: sessionId, command });
      if (result.error !== undefined) unwrap(result);
    },
    async runCommand(input) {
      const result = await client.session.command({
        sessionID: input.sessionId,
        command: input.command,
        arguments: input.arguments,
        model: input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined,
        directory: input.directory,
        ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
      });
      if (result.error !== undefined) unwrap(result);
    },
    async sendPrompt(input) {
      const result = await client.session.promptAsync({
        sessionID: input.sessionId,
        parts: input.parts,
        model: input.model,
        agent: input.mode,
        ...(input.reasoningEffort
          ? { reasoning_effort: input.reasoningEffort }
          : input.variant
            ? { variant: input.variant }
            : {}),
        ...(input.system ? { system: input.system } : {}),
      });
      if (result.error !== undefined) unwrap(result);
      return { sessionId: input.sessionId };
    },
    async listCommands(directory) {
      try {
        const list = (await client.command.list({ directory }))?.data ?? [];
        if (!Array.isArray(list)) return [];
        return list.map((command) => ({
          id: `cmd:${command.name}`,
          name: String(command.name ?? ""),
          description: command.description ? String(command.description) : undefined,
          source: command.source,
        }));
      } catch {
        return [];
      }
    },
    async listModes() {
      const agents = unwrap(await client.app.agents());
      return agents
        .filter((agent) => !agent.hidden && agent.mode !== "subagent")
        .map((agent) => ({
          id: agent.name,
          label: agent.name === "build"
            ? t("composer.work_mode_execute")
            : agent.name === "plan"
              ? t("composer.work_mode_plan")
              : agent.name,
          description: agent.description,
          icon: agent.name === "plan" ? "plan" as const : "execute" as const,
          isDefault: agent.name === "build",
        }));
    },
    async listAgents() {
      return unwrap(await client.app.agents()).map((agent) => ({
        name: agent.name,
        description: agent.description,
        hidden: agent.hidden,
        mode: agent.mode,
      }));
    },
    async searchFiles(query, directory) {
      return unwrap(await client.find.files({ query, dirs: "true", limit: 50, directory }));
    },
  };
}

export const openCodeConversationEngineAdapter: ConversationEngineAdapter = {
  id: DEFAULT_ENGINE_ID,
  connect: openCodeConnection,
};
