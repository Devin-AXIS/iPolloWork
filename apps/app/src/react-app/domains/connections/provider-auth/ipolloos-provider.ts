import type { CompatibleProviderProfile } from "./provider-engine-adapter";

export const IPOLLOOS_PROVIDER = {
  providerId: "ipolloos",
  name: "iPolloOS 本地模型",
  baseURL: "http://127.0.0.1:4318/v1",
};

export function ipolloOSRuntimeModels(value: unknown, allowEmpty = false): CompatibleProviderProfile["models"] {
  if (typeof value !== "object" || value === null || !("data" in value) || !Array.isArray(value.data)) {
    throw new Error("iPolloOS 返回的模型列表无效。");
  }
  const models: CompatibleProviderProfile["models"] = {};
  for (const entry of value.data.slice(0, 100)) {
    if (typeof entry !== "object" || entry === null || typeof entry.id !== "string" || !entry.id.trim()) continue;
    if (Array.isArray(entry.capabilities) && entry.capabilities.includes("embedding") && !entry.capabilities.includes("completion")) continue;
    const context = typeof entry.context_length === "number" ? entry.context_length : 4096;
    models[entry.id] = {
      name: typeof entry.name === "string" ? entry.name : entry.id,
      tool_call: Array.isArray(entry.capabilities) && entry.capabilities.includes("tools"),
      limit: { context, output: Math.min(2048, Math.floor(context / 8)) },
    };
  }
  if (!allowEmpty && !Object.keys(models).length) throw new Error("请先在 iPolloOS 启动一个模型，再连接此渠道。");
  return models;
}
