import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type CodexProviderGatewayProtocol = "openai-completions" | "anthropic-messages";

export type CodexProviderGatewayUpstream = {
  providerId: string;
  protocol: CodexProviderGatewayProtocol;
  baseURL: string;
  apiKey: string;
  httpHeaders?: Record<string, string>;
};

export type CodexProviderGatewayRoute = {
  baseURL: string;
  apiKey: string;
};

type GatewayProvider = CodexProviderGatewayUpstream & { routeToken: string };

type ResponseTool = {
  type: "function" | "custom";
  name: string;
  originalName: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeToolName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 64) || "tool";
}

function uniqueToolName(candidate: string, used: Set<string>): string {
  const base = safeToolName(candidate);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const next = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}_${suffix}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  const fallback = randomBytes(8).toString("hex");
  used.add(fallback);
  return fallback;
}

function responseTools(value: unknown): ResponseTool[] {
  if (!Array.isArray(value)) return [];
  const tools: ResponseTool[] = [];
  const used = new Set<string>();

  const append = (entry: Record<string, unknown>, namespace?: string) => {
    const originalName = nonEmptyString(entry.name);
    if (!originalName) return;
    const type = entry.type === "custom" ? "custom" : "function";
    const combinedName = namespace ? `${namespace}__${originalName}` : originalName;
    const description = nonEmptyString(entry.description);
    const parameters = isRecord(entry.parameters) ? entry.parameters : undefined;
    tools.push({
      type,
      name: uniqueToolName(combinedName, used),
      originalName: combinedName,
      ...(description ? { description } : {}),
      ...(parameters ? { parameters } : {}),
    });
  };

  for (const rawTool of value) {
    if (!isRecord(rawTool)) continue;
    if (rawTool.type === "namespace" && Array.isArray(rawTool.tools)) {
      const namespace = nonEmptyString(rawTool.name);
      for (const nested of rawTool.tools) {
        if (isRecord(nested)) append(nested, namespace);
      }
      continue;
    }
    if (rawTool.type === "function" || rawTool.type === "custom") append(rawTool);
  }
  return tools;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!isRecord(part)) return [];
    const text = nonEmptyString(part.text) ?? nonEmptyString(part.output_text) ?? nonEmptyString(part.input_text);
    return text ? [text] : [];
  }).join("\n");
}

function responseInputItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function imageUrlFromPart(part: Record<string, unknown>): string | undefined {
  const direct = nonEmptyString(part.image_url);
  if (direct) return direct;
  if (isRecord(part.image_url)) return nonEmptyString(part.image_url.url);
  return undefined;
}

function chatContent(value: unknown): string | Array<Record<string, unknown>> {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return textFromContent(value);
  const parts = value.flatMap((rawPart): Record<string, unknown>[] => {
    if (typeof rawPart === "string") return [{ type: "text", text: rawPart }];
    if (!isRecord(rawPart)) return [];
    const text = nonEmptyString(rawPart.text) ?? nonEmptyString(rawPart.input_text) ?? nonEmptyString(rawPart.output_text);
    if (text) return [{ type: "text", text }];
    const imageUrl = imageUrlFromPart(rawPart);
    if (imageUrl) return [{ type: "image_url", image_url: { url: imageUrl } }];
    return [];
  });
  if (parts.length === 0) return "";
  return parts;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function reasoningKey(provider: GatewayProvider): Buffer {
  return createHash("sha256")
    .update("ipollowork-codex-reasoning\0")
    .update(provider.providerId)
    .update("\0")
    .update(provider.apiKey)
    .digest();
}

function sealReasoningContent(provider: GatewayProvider, value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", reasoningKey(provider), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function openReasoningContent(provider: GatewayProvider, value: string): string | undefined {
  try {
    const payload = Buffer.from(value, "base64url");
    if (payload.length < 30 || payload[0] !== 1) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", reasoningKey(provider), payload.subarray(1, 13));
    decipher.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

function reasoningText(provider: GatewayProvider, item: Record<string, unknown>): string | undefined {
  const encrypted = nonEmptyString(item.encrypted_content);
  const opened = encrypted ? openReasoningContent(provider, encrypted) : undefined;
  if (opened) return opened;
  return nonEmptyString(item.reasoning_content)
    ?? nonEmptyString(textFromContent(item.summary))
    ?? nonEmptyString(textFromContent(item.content));
}

function normalizedChatMessages(messages: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const normalized: Record<string, unknown>[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;
    if (message.role === "tool") {
      index += 1;
      continue;
    }
    const initialCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isRecord) : [];
    if (message.role !== "assistant" || initialCalls.length === 0) {
      normalized.push(message);
      index += 1;
      continue;
    }

    const assistant = { ...message };
    const calls = [...initialCalls];
    index += 1;
    while (index < messages.length) {
      const adjacent = messages[index];
      const adjacentCalls = adjacent?.role === "assistant" && Array.isArray(adjacent.tool_calls)
        ? adjacent.tool_calls.filter(isRecord)
        : [];
      if (!adjacent || adjacentCalls.length === 0) break;
      calls.push(...adjacentCalls);
      if (!textFromContent(assistant.content) && textFromContent(adjacent.content)) {
        assistant.content = adjacent.content;
      }
      if (!nonEmptyString(assistant.reasoning_content)) {
        const adjacentReasoning = nonEmptyString(adjacent.reasoning_content);
        if (adjacentReasoning) assistant.reasoning_content = adjacentReasoning;
      }
      index += 1;
    }

    const toolMessages = new Map<string, Record<string, unknown>>();
    while (index < messages.length && messages[index]?.role === "tool") {
      const toolMessage = messages[index];
      const callId = toolMessage && nonEmptyString(toolMessage.tool_call_id);
      if (toolMessage && callId && !toolMessages.has(callId)) toolMessages.set(callId, toolMessage);
      index += 1;
    }
    const matchedCalls = calls.filter((call) => {
      const callId = nonEmptyString(call.id);
      return Boolean(callId && toolMessages.has(callId));
    });
    if (matchedCalls.length === 0) {
      delete assistant.tool_calls;
      if (textFromContent(assistant.content) || nonEmptyString(assistant.reasoning_content)) {
        normalized.push(assistant);
      }
      continue;
    }
    assistant.tool_calls = matchedCalls;
    normalized.push(assistant);
    for (const call of matchedCalls) {
      const callId = nonEmptyString(call.id);
      const toolMessage = callId ? toolMessages.get(callId) : undefined;
      if (toolMessage) normalized.push(toolMessage);
    }
  }
  return normalized;
}

function chatMessages(provider: GatewayProvider, body: Record<string, unknown>): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  const instructions = nonEmptyString(body.instructions);
  if (instructions) messages.push({ role: "system", content: instructions });
  let pendingReasoning = "";
  const takeReasoning = (): string | undefined => {
    const value = nonEmptyString(pendingReasoning);
    pendingReasoning = "";
    return value;
  };
  const appendReasoningOnly = () => {
    const value = takeReasoning();
    if (value) messages.push({ role: "assistant", content: "", reasoning_content: value });
  };

  for (const item of responseInputItems(body.input)) {
    const type = nonEmptyString(item.type);
    const role = nonEmptyString(item.role);
    if (type === "reasoning") {
      const value = reasoningText(provider, item);
      if (value) pendingReasoning = [pendingReasoning, value].filter(Boolean).join("\n");
      continue;
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = nonEmptyString(item.call_id);
      if (callId) messages.push({ role: "tool", tool_call_id: callId, content: textFromContent(item.output) });
      continue;
    }
    if (type === "function_call" || type === "custom_tool_call") {
      const callId = nonEmptyString(item.call_id) ?? nonEmptyString(item.id);
      const name = nonEmptyString(item.name);
      if (callId && name) {
        const toolCall = {
          id: callId,
          type: "function",
          function: {
            name: safeToolName(name),
            arguments: type === "custom_tool_call"
              ? JSON.stringify({ input: nonEmptyString(item.input) ?? "" })
              : nonEmptyString(item.arguments) ?? "{}",
          },
        };
        const previous = messages[messages.length - 1];
        if (previous?.role === "assistant") {
          const existingCalls = Array.isArray(previous.tool_calls) ? previous.tool_calls : [];
          previous.tool_calls = [...existingCalls, toolCall];
          const value = takeReasoning();
          if (value) previous.reasoning_content = value;
        } else {
          const value = takeReasoning();
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [toolCall],
            ...(value ? { reasoning_content: value } : {}),
          });
        }
      }
      continue;
    }
    if (role === "system" || role === "developer" || role === "user" || role === "assistant") {
      if (role !== "assistant") appendReasoningOnly();
      const value = role === "assistant" ? takeReasoning() : undefined;
      messages.push({
        role: role === "developer" ? "system" : role,
        content: chatContent(item.content),
        ...(value ? { reasoning_content: value } : {}),
      });
      continue;
    }
    appendReasoningOnly();
    const text = textFromContent(item.content ?? item);
    if (text) messages.push({ role: "user", content: text });
  }
  appendReasoningOnly();
  return normalizedChatMessages(messages);
}

function openAiTools(tools: readonly ResponseTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.type === "custom"
        ? {
            type: "object",
            properties: { input: { type: "string", description: "Raw input for this custom tool" } },
            required: ["input"],
            additionalProperties: false,
          }
        : tool.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function anthropicTools(tools: readonly ResponseTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    input_schema: tool.type === "custom"
      ? {
          type: "object",
          properties: { input: { type: "string", description: "Raw input for this custom tool" } },
          required: ["input"],
          additionalProperties: false,
        }
      : tool.parameters ?? { type: "object", properties: {} },
  }));
}

function anthropicContent(value: unknown): Array<Record<string, unknown>> {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) {
    const text = textFromContent(value);
    return text ? [{ type: "text", text }] : [];
  }
  return value.flatMap((rawPart): Record<string, unknown>[] => {
    if (typeof rawPart === "string") return [{ type: "text", text: rawPart }];
    if (!isRecord(rawPart)) return [];
    const text = nonEmptyString(rawPart.text) ?? nonEmptyString(rawPart.input_text) ?? nonEmptyString(rawPart.output_text);
    if (text) return [{ type: "text", text }];
    const imageUrl = imageUrlFromPart(rawPart);
    if (!imageUrl?.startsWith("data:")) return [];
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(imageUrl);
    return match ? [{ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }] : [];
  });
}

function anthropicMessages(body: Record<string, unknown>): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const item of responseInputItems(body.input)) {
    const type = nonEmptyString(item.type);
    const role = nonEmptyString(item.role);
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = nonEmptyString(item.call_id);
      if (callId) {
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: textFromContent(item.output) }] });
      }
      continue;
    }
    if (type === "function_call" || type === "custom_tool_call") {
      const callId = nonEmptyString(item.call_id) ?? nonEmptyString(item.id);
      const name = nonEmptyString(item.name);
      if (callId && name) {
        messages.push({
          role: "assistant",
          content: [{
            type: "tool_use",
            id: callId,
            name: safeToolName(name),
            input: type === "custom_tool_call"
              ? { input: nonEmptyString(item.input) ?? "" }
              : parseJsonObject(item.arguments),
          }],
        });
      }
      continue;
    }
    if (role === "user" || role === "assistant") {
      messages.push({ role, content: anthropicContent(item.content) });
      continue;
    }
    const text = textFromContent(item.content ?? item);
    if (text) messages.push({ role: "user", content: [{ type: "text", text }] });
  }
  return messages;
}

function endpoint(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`;
}

async function upstreamJson(
  provider: GatewayProvider,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers = new Headers(provider.httpHeaders);
  headers.set("content-type", "application/json");
  if (provider.protocol === "anthropic-messages") {
    headers.set("x-api-key", provider.apiKey);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${provider.apiKey}`);
  }
  const response = await fetch(endpoint(provider.baseURL, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = isRecord(payload) && isRecord(payload.error)
      ? nonEmptyString(payload.error.message)
      : undefined;
    const error = new Error(detail ?? `Provider request failed (${response.status})`);
    Object.defineProperty(error, "status", { value: response.status, enumerable: false });
    throw error;
  }
  if (!isRecord(payload)) throw new Error("Provider returned an invalid JSON response");
  return payload;
}

type GatewayOutput =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "function"; name: string; callId: string; arguments: string }
  | { type: "custom"; name: string; callId: string; input: string };

function restoreTool(tools: readonly ResponseTool[], name: string): ResponseTool | undefined {
  return tools.find((tool) => tool.name === name);
}

async function callOpenAiCompatible(
  provider: GatewayProvider,
  body: Record<string, unknown>,
  tools: readonly ResponseTool[],
): Promise<{ output: GatewayOutput[]; usage?: Record<string, unknown> }> {
  const model = nonEmptyString(body.model);
  if (!model) throw new Error("A model is required");
  const maxOutputTokens = typeof body.max_output_tokens === "number" ? body.max_output_tokens : undefined;
  const payload = await upstreamJson(provider, "chat/completions", {
    model,
    messages: chatMessages(provider, body),
    stream: false,
    ...(tools.length ? { tools: openAiTools(tools), tool_choice: body.tool_choice ?? "auto" } : {}),
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
  });
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices.find(isRecord);
  const message = first && isRecord(first.message) ? first.message : {};
  const output: GatewayOutput[] = [];
  const reasoning = nonEmptyString(message.reasoning_content);
  if (reasoning) output.push({ type: "reasoning", text: reasoning });
  const text = textFromContent(message.content);
  if (text) output.push({ type: "text", text });
  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      if (!isRecord(rawCall) || !isRecord(rawCall.function)) continue;
      const callId = nonEmptyString(rawCall.id) ?? `call_${randomBytes(12).toString("hex")}`;
      const name = nonEmptyString(rawCall.function.name);
      if (!name) continue;
      const tool = restoreTool(tools, name);
      const restoredName = tool?.originalName ?? name;
      const argumentsValue = nonEmptyString(rawCall.function.arguments) ?? "{}";
      if (tool?.type === "custom") {
        const parsed = parseJsonObject(argumentsValue);
        output.push({ type: "custom", name: restoredName, callId, input: nonEmptyString(parsed.input) ?? argumentsValue });
      } else {
        output.push({ type: "function", name: restoredName, callId, arguments: argumentsValue });
      }
    }
  }
  return { output, ...(isRecord(payload.usage) ? { usage: payload.usage } : {}) };
}

async function callAnthropic(
  provider: GatewayProvider,
  body: Record<string, unknown>,
  tools: readonly ResponseTool[],
): Promise<{ output: GatewayOutput[]; usage?: Record<string, unknown> }> {
  const model = nonEmptyString(body.model);
  if (!model) throw new Error("A model is required");
  const instructions = nonEmptyString(body.instructions);
  const payload = await upstreamJson(provider, "messages", {
    model,
    messages: anthropicMessages(body),
    max_tokens: typeof body.max_output_tokens === "number" ? body.max_output_tokens : 8_192,
    stream: false,
    ...(instructions ? { system: instructions } : {}),
    ...(tools.length ? { tools: anthropicTools(tools) } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
  });
  const output: GatewayOutput[] = [];
  const content = Array.isArray(payload.content) ? payload.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text") {
      const text = nonEmptyString(part.text);
      if (text) output.push({ type: "text", text });
      continue;
    }
    if (part.type !== "tool_use") continue;
    const name = nonEmptyString(part.name);
    if (!name) continue;
    const callId = nonEmptyString(part.id) ?? `call_${randomBytes(12).toString("hex")}`;
    const tool = restoreTool(tools, name);
    const restoredName = tool?.originalName ?? name;
    const input = isRecord(part.input) ? part.input : {};
    if (tool?.type === "custom") {
      output.push({ type: "custom", name: restoredName, callId, input: nonEmptyString(input.input) ?? JSON.stringify(input) });
    } else {
      output.push({ type: "function", name: restoredName, callId, arguments: JSON.stringify(input) });
    }
  }
  return { output, ...(isRecord(payload.usage) ? { usage: payload.usage } : {}) };
}

function responseUsage(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const input = typeof value?.input_tokens === "number"
    ? value.input_tokens
    : typeof value?.prompt_tokens === "number"
      ? value.prompt_tokens
      : 0;
  const output = typeof value?.output_tokens === "number"
    ? value.output_tokens
    : typeof value?.completion_tokens === "number"
      ? value.completion_tokens
      : 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

function eventStream(
  provider: GatewayProvider,
  body: Record<string, unknown>,
  result: { output: GatewayOutput[]; usage?: Record<string, unknown> },
): string {
  const responseId = `resp_${randomBytes(12).toString("hex")}`;
  const model = nonEmptyString(body.model) ?? "unknown";
  const outputItems: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let sequence = 0;
  const emit = (type: string, value: Record<string, unknown>) => {
    events.push({ type, sequence_number: sequence, ...value });
    sequence += 1;
  };
  const baseResponse = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    model,
    error: null,
    incomplete_details: null,
    instructions: body.instructions ?? null,
    output: outputItems,
    parallel_tool_calls: body.parallel_tool_calls !== false,
    tool_choice: body.tool_choice ?? "auto",
    tools: body.tools ?? [],
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_output_tokens: body.max_output_tokens ?? null,
    previous_response_id: body.previous_response_id ?? null,
    reasoning: body.reasoning ?? null,
    service_tier: "default",
    store: false,
    truncation: "disabled",
    text: { format: { type: "text" } },
    usage: responseUsage(result.usage),
  };
  emit("response.created", { response: { ...baseResponse, status: "in_progress" } });
  emit("response.in_progress", { response: { ...baseResponse, status: "in_progress" } });

  for (const output of result.output) {
    const outputIndex = outputItems.length;
    const itemId = `item_${randomBytes(12).toString("hex")}`;
    if (output.type === "reasoning") {
      const part = { type: "summary_text", text: output.text };
      const item = {
        id: itemId,
        type: "reasoning",
        status: "completed",
        summary: [part],
        encrypted_content: sealReasoningContent(provider, output.text),
      };
      outputItems.push(item);
      emit("response.output_item.added", {
        output_index: outputIndex,
        item: { ...item, status: "in_progress", summary: [] },
      });
      emit("response.reasoning_summary_part.added", {
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      });
      emit("response.reasoning_summary_text.delta", {
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        delta: output.text,
      });
      emit("response.reasoning_summary_text.done", {
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        text: output.text,
      });
      emit("response.reasoning_summary_part.done", {
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        part,
      });
      emit("response.output_item.done", { output_index: outputIndex, item });
      continue;
    }
    if (output.type === "text") {
      const item = {
        id: itemId,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: output.text, annotations: [], logprobs: [] }],
      };
      outputItems.push(item);
      emit("response.output_item.added", { output_index: outputIndex, item: { ...item, status: "in_progress", content: [] } });
      emit("response.content_part.added", {
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [], logprobs: [] },
      });
      emit("response.output_text.delta", { item_id: itemId, output_index: outputIndex, content_index: 0, delta: output.text, logprobs: [] });
      emit("response.output_text.done", { item_id: itemId, output_index: outputIndex, content_index: 0, text: output.text, logprobs: [] });
      emit("response.content_part.done", { item_id: itemId, output_index: outputIndex, content_index: 0, part: item.content[0] });
      emit("response.output_item.done", { output_index: outputIndex, item });
      continue;
    }
    if (output.type === "custom") {
      const item = {
        id: itemId,
        type: "custom_tool_call",
        call_id: output.callId,
        name: output.name,
        input: output.input,
        status: "completed",
      };
      outputItems.push(item);
      emit("response.output_item.added", {
        output_index: outputIndex,
        item: { ...item, input: "", status: "in_progress" },
      });
      emit("response.custom_tool_call_input.delta", {
        item_id: itemId,
        output_index: outputIndex,
        delta: output.input,
      });
      emit("response.custom_tool_call_input.done", {
        item_id: itemId,
        output_index: outputIndex,
        input: output.input,
      });
      emit("response.output_item.done", { output_index: outputIndex, item });
      continue;
    }
    const item = {
      id: itemId,
      type: "function_call",
      call_id: output.callId,
      name: output.name,
      arguments: output.arguments,
      status: "completed",
    };
    outputItems.push(item);
    emit("response.output_item.added", {
      output_index: outputIndex,
      item: { ...item, arguments: "", status: "in_progress" },
    });
    emit("response.function_call_arguments.delta", {
      item_id: itemId,
      output_index: outputIndex,
      delta: output.arguments,
    });
    emit("response.function_call_arguments.done", {
      item_id: itemId,
      output_index: outputIndex,
      arguments: output.arguments,
    });
    emit("response.output_item.done", { output_index: outputIndex, item });
  }

  const completedResponse = { ...baseResponse, status: "completed", output: outputItems };
  emit("response.completed", { response: completedResponse });
  return `${events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("Provider request body is too large");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) throw new Error("Provider request body must be a JSON object");
  return parsed;
}

function secureTokenMatch(actualHeader: string | undefined, expected: string): boolean {
  const actual = actualHeader?.startsWith("Bearer ") ? actualHeader.slice(7) : "";
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export class CodexProviderGateway {
  #server: Server | null = null;
  #port = 0;
  #providers = new Map<string, GatewayProvider>();
  #tokens = new Map<string, string>();

  async configure(upstreams: readonly CodexProviderGatewayUpstream[]): Promise<Map<string, CodexProviderGatewayRoute>> {
    if (upstreams.length) await this.#ensureStarted();
    const next = new Map<string, GatewayProvider>();
    const routes = new Map<string, CodexProviderGatewayRoute>();
    for (const upstream of upstreams) {
      const routeToken = this.#tokens.get(upstream.providerId) ?? randomBytes(32).toString("base64url");
      this.#tokens.set(upstream.providerId, routeToken);
      next.set(upstream.providerId, { ...upstream, routeToken });
      routes.set(upstream.providerId, {
        baseURL: `http://127.0.0.1:${this.#port}/provider/${encodeURIComponent(upstream.providerId)}/v1`,
        apiKey: routeToken,
      });
    }
    this.#providers = next;
    return routes;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    this.#providers.clear();
    this.#tokens.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  async #ensureStarted(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      void this.#handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("Codex provider gateway failed to bind a loopback port");
    }
    this.#server = server;
    this.#port = address.port;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = /^\/provider\/([^/]+)\/v1\/responses$/u.exec(url.pathname);
      const providerId = match ? decodeURIComponent(match[1] ?? "") : "";
      const provider = this.#providers.get(providerId);
      if (request.method !== "POST" || !provider) {
        sendJson(response, 404, { error: { message: "Provider route not found", type: "invalid_request_error" } });
        return;
      }
      if (!secureTokenMatch(request.headers.authorization, provider.routeToken)) {
        sendJson(response, 401, { error: { message: "Invalid provider route token", type: "authentication_error" } });
        return;
      }
      const body = await readJsonBody(request);
      const tools = responseTools(body.tools);
      const result = provider.protocol === "anthropic-messages"
        ? await callAnthropic(provider, body, tools)
        : await callOpenAiCompatible(provider, body, tools);
      response.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
        connection: "keep-alive",
      });
      response.end(eventStream(provider, body, result));
    } catch (error) {
      const status = isRecord(error) && typeof error.status === "number" ? error.status : 502;
      sendJson(response, status, {
        error: {
          message: error instanceof Error ? error.message : "Provider gateway request failed",
          type: "provider_gateway_error",
        },
      });
    }
  }
}
