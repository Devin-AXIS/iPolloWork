/**
 * Moonshot's Kimi K3 endpoint only accepts temperature 1. iPolloWork keeps a
 * lower default for its agent, so normalize this single provider/model pair
 * immediately before OpenCode sends the request.
 */

const MOONSHOT_PROVIDER_IDS = new Set(["moonshotai", "moonshotai-cn"]);

function requiresFixedTemperature(model: { id: string; providerID?: string; api?: { id?: string } }): boolean {
  if (!model.providerID || !MOONSHOT_PROVIDER_IDS.has(model.providerID)) return false;
  return (model.api?.id ?? model.id).toLowerCase() === "kimi-k3";
}

// Single export: the OpenCode plugin loader treats every export of a plugin
// module as a plugin factory, so helpers must stay module-private.
export const iPolloWorkMoonshotTemperature = async () => ({
  "chat.params": async (
    input: { model: { id: string; providerID?: string; api?: { id?: string } } },
    output: { temperature?: number },
  ) => {
    if (requiresFixedTemperature(input.model)) output.temperature = 1;
  },
});
