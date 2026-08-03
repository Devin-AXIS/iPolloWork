import { describe, expect, test } from "bun:test";
import { iPolloWorkMoonshotTemperature } from "./ipollowork-moonshot-temperature.js";

async function runHook(providerID: string, apiId: string, temperature: number) {
  const hooks = await iPolloWorkMoonshotTemperature();
  const output = { temperature };
  await hooks["chat.params"]({ model: { id: apiId, providerID, api: { id: apiId } } }, output);
  return output;
}

describe("iPolloWorkMoonshotTemperature chat.params", () => {
  test("sets Kimi K3 temperature to 1 for both Moonshot endpoints", async () => {
    expect(await runHook("moonshotai", "kimi-k3", 0.2)).toEqual({ temperature: 1 });
    expect(await runHook("moonshotai-cn", "kimi-k3", 0.2)).toEqual({ temperature: 1 });
  });

  test("leaves other Moonshot models untouched", async () => {
    expect(await runHook("moonshotai-cn", "kimi-k2.6", 0.2)).toEqual({ temperature: 0.2 });
  });

  test("leaves other providers untouched even when they use the same model id", async () => {
    expect(await runHook("custom-gateway", "kimi-k3", 0.2)).toEqual({ temperature: 0.2 });
  });

  test("module exposes only the plugin factory", async () => {
    const mod = await import("./ipollowork-moonshot-temperature.js");
    expect(Object.keys(mod)).toEqual(["iPolloWorkMoonshotTemperature"]);
  });
});
