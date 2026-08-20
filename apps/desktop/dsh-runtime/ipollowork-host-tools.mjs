function requiredEnvironment(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required by the iPolloWork host tool bridge`);
  return value;
}

function jsonValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  }
  return fallback;
}

export const inject = ["tools"];

export async function apply(ctx) {
  const serverUrl = requiredEnvironment("IPOLLOWORK_SERVER_URL").replace(/\/+$/, "");
  const token = requiredEnvironment("IPOLLOWORK_SERVER_TOKEN");
  const workspaceId = String(process.env.IPOLLOWORK_WORKSPACE_ID ?? "").trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const response = await fetch(`${serverUrl}/engine-tools`, { headers });
  const catalog = await readJson(response);
  if (!response.ok || !catalog || !Array.isArray(catalog.tools)) {
    throw new Error(errorMessage(catalog, `iPolloWork host tool catalog failed (${response.status})`));
  }

  for (const descriptor of catalog.tools) {
    if (!descriptor || typeof descriptor.name !== "string" || typeof descriptor.description !== "string") continue;
    const definition = {
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.parameters && typeof descriptor.parameters === "object"
        ? descriptor.parameters
        : { type: "object", properties: {}, additionalProperties: false },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 120_000,
      async execute(args, exec) {
        const callResponse = await fetch(`${serverUrl}/engine-tools/call`, {
          method: "POST",
          headers,
          signal: exec.signal,
          body: JSON.stringify({
            name: descriptor.name,
            args: jsonValue(args),
            context: {
              ...(workspaceId ? { workspaceId } : {}),
              ...(exec.agent?.session?.meta?.cwd ? { directory: exec.agent.session.meta.cwd } : {}),
              ...(exec.agent?.id ? { sessionId: String(exec.agent.id) } : {}),
            },
          }),
        });
        const result = await readJson(callResponse);
        if (!callResponse.ok) {
          throw new Error(errorMessage(result, `iPolloWork host tool failed (${callResponse.status})`));
        }
        return jsonValue(result);
      },
    };
    ctx.effect(() => ctx.tools.register(definition), `ipollowork: ${descriptor.name}`);
  }
}
