import type { EnginePluginPromptSelection } from "@ipollowork/types/plugins";

import { ApiError } from "./errors.js";
import { listPortablePluginPromptCapabilities } from "./plugin-package-lifecycle.js";
import type { ServerConfig } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEnginePluginPromptSelection(value: unknown): EnginePluginPromptSelection | undefined {
  if (!isRecord(value)) return undefined;
  const commandValue = isRecord(value.command) ? value.command : null;
  const commandName = typeof commandValue?.name === "string" ? commandValue.name.trim() : "";
  const commandArguments = typeof commandValue?.arguments === "string" ? commandValue.arguments.trim() : "";
  const agents = Array.isArray(value.agents)
    ? [...new Set(value.agents.flatMap((agent) => typeof agent === "string" && agent.trim() ? [agent.trim()] : []))]
    : [];
  if (!commandName && agents.length === 0) return undefined;
  return {
    ...(commandName ? { command: { name: commandName, ...(commandArguments ? { arguments: commandArguments } : {}) } } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  };
}

export async function resolveEnginePluginPrompt(input: {
  config: ServerConfig;
  engineId: string;
  selection?: EnginePluginPromptSelection;
}): Promise<{ systemInstructions: string[]; userInstructions: string[] }> {
  if (!input.selection) return { systemInstructions: [], userInstructions: [] };
  const capabilities = await listPortablePluginPromptCapabilities({
    serverConfig: input.config,
    engineId: input.engineId,
  });
  const resolveCapability = (type: "command" | "agent", name: string) => {
    const matches = capabilities.filter((capability) => capability.type === type && capability.name === name);
    if (matches.length !== 1) {
      throw new ApiError(
        matches.length === 0 ? 404 : 409,
        matches.length === 0 ? "plugin_prompt_capability_not_found" : "plugin_prompt_capability_ambiguous",
        matches.length === 0
          ? `Installed plugin ${type} was not found: ${name}`
          : `More than one installed plugin exposes ${type}: ${name}`,
      );
    }
    return matches[0];
  };
  const systemInstructions: string[] = [];
  const userInstructions: string[] = [];
  if (input.selection.command) {
    const command = resolveCapability("command", input.selection.command.name);
    systemInstructions.push(`Execute the installed plugin command /${command.name}. Follow its instructions:\n\n${command.content}`);
    userInstructions.push(input.selection.command.arguments
      ? `Run /${command.name} with these arguments: ${input.selection.command.arguments}`
      : `Run /${command.name}.`);
  }
  for (const agentName of input.selection.agents ?? []) {
    const agent = resolveCapability("agent", agentName);
    systemInstructions.push(`The user selected the plugin agent "${agent.name}". Follow these agent instructions:\n\n${agent.content}`);
  }
  return { systemInstructions, userInstructions };
}
