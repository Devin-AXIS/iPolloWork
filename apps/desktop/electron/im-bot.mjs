// im-bot: push a sanitized workbench preview summary to an IM platform over
// its MCP (Streamable HTTP) endpoint. The endpoint is provided by the user
// (e.g. `dws mcp url get <mcpId>` for DingTalk); the tool that sends a
// message is discovered from the endpoint's tools list by name.
//
// Security: only reads via preview-core (read-only), sends a redacted
// summary, and never forwards lan-preview session tokens.
const PUSH_TIMEOUT_MS = 10_000;

// DingTalk / Feishu MCP send tools commonly expose one of these names.
const SEND_TOOL_CANDIDATES = [
  "send_message",
  "sendMessage",
  "send_text",
  "messages_send",
];

function jsonRpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

async function mcpFetch(baseUrl, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// The Streamable HTTP transport may return either a single JSON object or an
// SSE stream; collect both and parse the final result.
function parseMcpResponse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  // SSE: parse the last "data:" line that is valid JSON.
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload);
    } catch {
      // continue
    }
  }
  return null;
}

export function createImBot({ previewCore, log = () => {} }) {
  let requestId = 1;

  async function discoverSendTool(baseUrl, authHeaders) {
    const body = jsonRpc(requestId++, "tools/list", {});
    const { status, text } = await mcpFetch(baseUrl, body, authHeaders);
    if (status !== 200 && status !== 202) {
      throw new Error(`MCP endpoint returned HTTP ${status}`);
    }
    const parsed = parseMcpResponse(text);
    const tools = parsed?.result?.tools ?? parsed?.tools ?? [];
    if (!Array.isArray(tools)) {
      throw new Error("MCP endpoint did not return a tools list");
    }
    for (const candidate of SEND_TOOL_CANDIDATES) {
      const tool = tools.find((entry) => entry?.name === candidate);
      if (tool) return tool;
    }
    throw new Error(
      `No send tool found on MCP endpoint (looked for ${SEND_TOOL_CANDIDATES.join(", ")}). ` +
        `Available: ${tools.map((entry) => entry?.name).filter(Boolean).join(", ") || "(none)"}`,
    );
  }

  // Build a short markdown-ish summary from the sanitized snapshot.
  function formatSummary(summary) {
    const parts = [];
    const order = ["status", "sessionId", "workspaceId", "route", "narration", "busyActionId"];
    for (const key of order) {
      const value = summary[key];
      if (value === undefined || value === null || value === "") continue;
      parts.push(`${key}: ${value}`);
    }
    const rest = Object.entries(summary)
      .filter(([key]) => !order.includes(key))
      .filter(([, value]) => {
        if (value === undefined || value === null || value === "") return false;
        // Only carry scalars; objects/arrays would serialize to junk.
        return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
      });
    for (const [key, value] of rest) {
      parts.push(`${key}: ${value}`);
    }
    return parts.length ? parts.join("\n") : "(empty snapshot)";
  }

  // Push the current public preview summary to the given MCP endpoint.
  async function pushSummary({ mcpUrl, headers = {} }) {
    const target = String(mcpUrl ?? "").trim();
    if (!target) throw new Error("Missing MCP endpoint URL");
    const publicData = await previewCore.getPublicSummary();
    const message = formatSummary(publicData.summary);
    const tool = await discoverSendTool(target, headers);
    const args = {};
    // Heuristic: prefer string args named text/content/message; otherwise pass
    // the message as the first non-token argument.
    const schema = tool.inputSchema?.properties ?? {};
    const keys = Object.keys(schema);
    if (keys.length === 0) {
      args.message = message;
    } else {
      let filled = false;
      for (const key of keys) {
        if (/text|content|message|msg/i.test(key)) {
          args[key] = message;
          filled = true;
          break;
        }
      }
      if (!filled) {
        const firstKey = keys.find((key) => !/token|secret|auth/i.test(key));
        if (firstKey) args[firstKey] = message;
        else args.message = message;
      }
    }
    const callBody = jsonRpc(requestId++, "tools/call", {
      name: tool.name,
      arguments: args,
    });
    const { status, text } = await mcpFetch(target, callBody, headers);
    if (status !== 200 && status !== 202) {
      throw new Error(`MCP call returned HTTP ${status}`);
    }
    const parsed = parseMcpResponse(text);
    log(`im-bot: pushed summary via ${tool.name} (HTTP ${status})`);
    return { ok: true, tool: tool.name, message };
  }

  return { pushSummary, discoverSendTool, formatSummary };
}
